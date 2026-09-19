import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionEngine } from "../src/jev.js";
import { processLead, resolveCallDate, type TribeGateway } from "../src/pipeline.js";

const personDecision: DecisionEngine = {
  async decide() {
    return {
      hasPerson: 0.95,
      hasOrganization: 0.01,
      intent: "sales",
      intentConfidence: 0.96,
      shouldCreateOpportunity: 0.91,
      urgencyScore: 2.1,
      urgencyConfidence: 0.8,
      matchingPersonCandidateId: null,
      matchingPersonCandidateConfidence: 0.99,
      matchingOrganizationCandidateId: null,
      matchingOrganizationCandidateConfidence: 0.99,
    };
  },
};

test("dry-run creates a source-backed person plan and opportunity suggestion", async () => {
  const result = await processLead(
    {
      sourceId: "mail-1",
      message: "Please send a quote to jane@example.com or call +31 6 12345678.",
      person: { firstName: "Jane", lastName: "Doe" },
    },
    { decisionEngine: personDecision },
  );

  assert.equal(result.mode, "dry-run");
  assert.equal(result.actions[0]?.type, "create_person");
  const body = result.actions[0]?.type === "create_person" ? result.actions[0].body : null;
  assert.deepEqual(body && Object.fromEntries(Object.entries(body).filter(([key]) => key !== "Notes")), {
    FirstName: "Jane", LastName: "Doe", EmailAddress: "jane@example.com", PhoneNumber: "+31 6 12345678", ImportId: "tribe-jev:mail-1:person",
  });
  assert.match(String((body?.Notes as Array<{ Content: string }>)[0]?.Content), /Please send a quote/);
  assert.equal(result.actions[1]?.type, "suggest_opportunity");
  assert.equal(result.applied.length, 0);
});

test("missing source-backed last name is sent to review", async () => {
  const result = await processLead(
    { sourceId: "mail-2", message: "Please call me at jane@example.com." },
    { decisionEngine: personDecision },
  );
  assert.deepEqual(result.actions[0], {
    type: "review",
    reason: "A person appears to be the primary party, but no source-backed last name was supplied.",
  });
});

test("one source can plan both a person and an organization", async () => {
  const bothDecision: DecisionEngine = {
    async decide() {
      return {
        ...(await personDecision.decide({ sourceId: "unused", message: "unused" }, { emails: [], phoneNumbers: [], urls: [] }, [])),
        hasOrganization: 0.97,
      };
    },
  };
  const result = await processLead(
    {
      sourceId: "mail-3",
      message: "Noor from Studio Kompas requests a quote at noor@studiokompas.example.",
      person: { firstName: "Noor", lastName: "De Vries" },
      organization: { name: "Studio Kompas" },
    },
    { decisionEngine: bothDecision },
  );

  assert.deepEqual(result.actions.map((action) => action.type), [
    "create_person",
    "create_organization",
    "suggest_contact_link",
    "suggest_lead_relationship",
    "suggest_opportunity",
  ]);
});

test("Jev-extracted identities can drive a complete plan from message-only input", async () => {
  const extractingDecision: DecisionEngine = {
    async decide() {
      return {
        ...(await personDecision.decide({ sourceId: "unused", message: "unused" }, { emails: [], phoneNumbers: [], urls: [] }, [])),
        extractedPersonName: "Noor de Vries",
        extractedOrganizationName: "Studio Kompas",
        hasOrganization: 0.97,
      };
    },
  };
  const result = await processLead({
    sourceId: "message-only",
    message: "Hallo, ik ben Noor de Vries van Studio Kompas. Mail noor@example.com voor een offerte.",
  }, { decisionEngine: extractingDecision });

  assert.deepEqual(result.resolvedInput.person, { firstName: "Noor", middleName: "de", lastName: "Vries" });
  assert.deepEqual(result.resolvedInput.organization, { name: "Studio Kompas" });
  assert.deepEqual(result.actions.map((action) => action.type), [
    "create_person", "create_organization", "suggest_contact_link", "suggest_lead_relationship", "suggest_opportunity",
  ]);
});

test("apply executes dependent records in order and reuses resolved IDs", async () => {
  const calls: string[] = [];
  const bothDecision: DecisionEngine = {
    async decide() {
      return {
        ...(await personDecision.decide({ sourceId: "unused", message: "unused" }, { emails: [], phoneNumbers: [], urls: [] }, [])),
        hasOrganization: 0.97,
      };
    },
  };
  const tribe: TribeGateway = {
    writesEnabled: true,
    async findCandidates() { return []; },
    async opportunityPhases() { return [{ id: "phase-id", code: "Qualification" }]; },
    async callPhases() { return [{ id: "call-phase-id", code: "Planned" }]; },
    async apply(action) {
      calls.push(action.type);
      if (action.type === "create_person") return { ID: "person-id" };
      if (action.type === "create_organization") return { ID: "organization-id" };
      throw new Error(`Unexpected base action: ${action.type}`);
    },
    async createContactLink(parentId, personId, importId) {
      calls.push(`contact:${parentId}:${personId}:${importId}`);
      return { ID: "contact-id" };
    },
    async organizationIdentityRelationId() {
      calls.push("identity");
      return "owner-id";
    },
    async createOrganizationLead(parentId, organizationId, importId) {
      calls.push(`lead:${parentId}:${organizationId}:${importId}`);
      return { ID: "lead-id" };
    },
    async createSalesOpportunity(input) {
      calls.push(`opportunity:${input.relationshipId}:${input.contactRelationshipId}:${input.phaseId}:${input.importId}:${input.subject}:${input.noteImportId}:${input.noteContent.includes("Noor van Studio Kompas vraagt")}`);
      return { ID: "opportunity-id" };
    },
    async createCall() { return { ID: "call-id" }; },
  };

  const result = await processLead({
    sourceId: "mail-apply",
    message: "Noor van Studio Kompas vraagt om een offerte via noor@example.com.",
    person: { firstName: "Noor", lastName: "Vries" },
    organization: { name: "Studio Kompas" },
  }, { decisionEngine: bothDecision, tribe, apply: true });

  assert.equal(result.mode, "applied");
  assert.deepEqual(calls, [
    "create_person",
    "create_organization",
    "contact:organization-id:person-id:tribe-jev:mail-apply:contact",
    "identity",
    "lead:owner-id:organization-id:tribe-jev:mail-apply:lead",
    "opportunity:lead-id:contact-id:phase-id:tribe-jev:mail-apply:opportunity:Commerciële aanvraag - Studio Kompas:tribe-jev:mail-apply:opportunity_note:true",
  ]);
  assert.equal(result.applied.length, 5);
});

test("an explicit call request resolves tomorrow in code and plans a call", async () => {
  const callDecision: DecisionEngine = {
    async decide() {
      return {
        ...(await personDecision.decide({ sourceId: "unused", message: "unused" }, { emails: [], phoneNumbers: [], urls: [] }, [])),
        extractedPersonName: "Alex-Test",
        intent: "other",
        intentConfidence: 0.8,
        shouldCreateOpportunity: 0.1,
        shouldCreateCall: 0.98,
        callDay: "tomorrow",
        callDayConfidence: 0.96,
      };
    },
  };
  const result = await processLead({
    sourceId: "call-tomorrow",
    receivedAt: "2026-09-19T20:00:00+02:00",
    message: "Alex-Test wil morgen een belafspraak.",
  }, { decisionEngine: callDecision });
  const call = result.actions.find((action) => action.type === "suggest_call");
  assert.equal(call?.type, "suggest_call");
  assert.match(call?.type === "suggest_call" ? call.startDate : "", /^2026-09-20T/);
  assert.equal(resolveCallDate("none", "2026-09-19T20:00:00+02:00"), undefined);
});

test("a unique exact phone match links an existing compatible person without duplicate creation", async () => {
  const tribe: TribeGateway = {
    writesEnabled: false,
    async findCandidates() { return [{ id: "test-person-id", entitySet: "Relation_Person", displayName: "Alex-Test", phoneNumbers: ["+31 6 00000000"], matchedOn: ["phone"] }]; },
    async opportunityPhases() { return []; }, async callPhases() { return []; },
    async apply() { throw new Error("not used"); }, async createContactLink() { throw new Error("not used"); },
    async organizationIdentityRelationId() { throw new Error("not used"); }, async createOrganizationLead() { throw new Error("not used"); },
    async createSalesOpportunity() { throw new Error("not used"); }, async createCall() { throw new Error("not used"); },
  };
  const decision: DecisionEngine = {
    async decide() { return { ...(await personDecision.decide({ sourceId: "unused", message: "unused" }, { emails: [], phoneNumbers: [], urls: [] }, [])), extractedPersonName: "Alex-Test", matchingPersonCandidateConfidence: 0.2 }; },
  };
  const result = await processLead({ sourceId: "phone-link", message: "Bel Alex-Test op 0600000000" }, { decisionEngine: decision, tribe });

  assert.deepEqual(result.actions[0], { type: "link_existing", entitySet: "Relation_Person", id: "test-person-id", displayName: "Alex-Test", matchedOn: ["phone"] });
  assert.equal(result.actions.some((action) => action.type === "create_person"), false);
});

test("a phone match does not attach an organization when Jev found no organization", async () => {
  const tribe: TribeGateway = {
    writesEnabled: false,
    async findCandidates() { return [{ id: "org-id", entitySet: "Relation_Organization", displayName: "Voorbeeldbedrijf Noord", phoneNumbers: ["0600000000"], matchedOn: ["phone"] }]; },
    async opportunityPhases() { return []; }, async callPhases() { return []; },
    async apply() { throw new Error("not used"); }, async createContactLink() { throw new Error("not used"); },
    async organizationIdentityRelationId() { throw new Error("not used"); }, async createOrganizationLead() { throw new Error("not used"); },
    async createSalesOpportunity() { throw new Error("not used"); }, async createCall() { throw new Error("not used"); },
  };
  const decision: DecisionEngine = {
    async decide() { return { ...(await personDecision.decide({ sourceId: "unused", message: "unused" }, { emails: [], phoneNumbers: [], urls: [] }, [])), extractedPersonName: "andy", hasOrganization: 0.05, matchingOrganizationCandidateId: "org-id", matchingOrganizationCandidateConfidence: 0.99 }; },
  };
  const result = await processLead({ sourceId: "no-false-org", message: "Maak Sam aan met 0600000000" }, { decisionEngine: decision, tribe });

  assert.deepEqual(result.actions.map((action) => action.type), ["create_person", "suggest_opportunity"]);
  assert.equal(result.actions.some((action) => action.type === "link_existing" && action.entitySet === "Relation_Organization"), false);
});
