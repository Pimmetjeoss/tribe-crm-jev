import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionEngine } from "../src/jev.js";
import { processLead, type TribeGateway } from "../src/pipeline.js";

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
  assert.deepEqual(result.actions[0]?.type === "create_person" ? result.actions[0].body : null, {
    FirstName: "Jane",
    LastName: "Doe",
    EmailAddress: "jane@example.com",
    PhoneNumber: "+31 6 12345678",
    ImportId: "tribe-jev:mail-1:person",
  });
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
      calls.push(`opportunity:${input.relationshipId}:${input.contactRelationshipId}:${input.phaseId}:${input.importId}:${input.subject}`);
      return { ID: "opportunity-id" };
    },
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
    "opportunity:lead-id:contact-id:phase-id:tribe-jev:mail-apply:opportunity:Commerciële aanvraag - Studio Kompas",
  ]);
  assert.equal(result.applied.length, 5);
});
