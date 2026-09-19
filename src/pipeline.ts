import { extractFacts } from "./extract.js";
import { sourceImportId } from "./idempotency.js";
import type { DecisionEngine } from "./jev.js";
import type { CreatedEntity, OpportunityPhase } from "./tribe-client.js";
import type { ExtractedFacts, JevDecisions, LeadInput, PipelineResult, PlannedAction, TribeCandidate } from "./types.js";

export interface TribeGateway {
  readonly writesEnabled: boolean;
  findCandidates(input: LeadInput, facts: ExtractedFacts): Promise<TribeCandidate[]>;
  opportunityPhases(): Promise<OpportunityPhase[]>;
  callPhases(): Promise<OpportunityPhase[]>;
  apply(action: PlannedAction): Promise<unknown>;
  organizationIdentityRelationId(): Promise<string>;
  createContactLink(parentOrganizationId: string, personId: string, importId: string): Promise<CreatedEntity>;
  createOrganizationLead(parentOrganizationId: string, organizationId: string, importId: string): Promise<CreatedEntity>;
  createSalesOpportunity(input: {
    subject: string;
    relationshipId: string;
    contactRelationshipId: string;
    phaseId: string;
    importId: string;
    noteContent: string;
    noteImportId: string;
  }): Promise<CreatedEntity>;
  createCall(input: { subject: string; startDate: string; endDate: string; description: string; phaseId: string; importId: string }): Promise<CreatedEntity>;
}

interface PipelineOptions {
  decisionEngine: DecisionEngine;
  tribe?: TribeGateway;
  apply?: boolean;
}

export async function processLead(input: LeadInput, options: PipelineOptions): Promise<PipelineResult> {
  validateInput(input);
  const facts = extractFacts(input.message);
  let candidates = options.tribe ? await options.tribe.findCandidates(input, facts) : [];
  let decisions = await options.decisionEngine.decide(input, facts, candidates);
  const resolvedInput = mergeInferredIdentity(input, decisions);
  if (options.tribe && resolvedInput !== input) {
    const refreshedCandidates = await options.tribe.findCandidates(resolvedInput, facts);
    if (candidateKeys(refreshedCandidates) !== candidateKeys(candidates)) {
      candidates = refreshedCandidates;
      decisions = await options.decisionEngine.decide(resolvedInput, facts, candidates);
    } else {
      candidates = refreshedCandidates;
    }
  }
  let actions = planActions(resolvedInput, facts, candidates, decisions);
  if (options.tribe && actions.some((action) => action.type === "suggest_opportunity")) {
    const phase = (await options.tribe.opportunityPhases()).find((item) => item.code === "Qualification");
    if (phase) {
      actions = actions.map((action) => action.type === "suggest_opportunity"
        ? { ...action, phase }
        : action);
    }
  }
  if (options.tribe && actions.some((action) => action.type === "suggest_call")) {
    const phase = (await options.tribe.callPhases()).find((item) => item.code === "Planned");
    if (phase) actions = actions.map((action) => action.type === "suggest_call" ? { ...action, phase } : action);
  }
  const shouldApply = options.apply === true;
  const applied: PipelineResult["applied"] = [];

  if (shouldApply) {
    if (!options.tribe) throw new Error("Cannot apply without Tribe credentials.");
    if (!options.tribe.writesEnabled) throw new Error("Cannot apply while TRIBE_ENABLE_WRITES is false.");
    applied.push(...await applyActions(resolvedInput, decisions, actions, options.tribe));
  }

  return {
    mode: shouldApply ? "applied" : "dry-run",
    resolvedInput,
    facts,
    candidates,
    decisions,
    actions,
    applied,
  };
}

function mergeInferredIdentity(input: LeadInput, decisions: JevDecisions): LeadInput {
  let changed = false;
  let person = input.person;
  let organization = input.organization;
  if (!person?.lastName && decisions.extractedPersonName) {
    person = splitPersonName(decisions.extractedPersonName);
    changed = true;
  }
  if (!organization?.name && decisions.extractedOrganizationName) {
    organization = { name: decisions.extractedOrganizationName };
    changed = true;
  }
  return changed ? { ...input, ...(person ? { person } : {}), ...(organization ? { organization } : {}) } : input;
}

function splitPersonName(name: string): NonNullable<LeadInput["person"]> {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { lastName: parts[0]! };
  return {
    firstName: parts[0]!,
    ...(parts.length > 2 ? { middleName: parts.slice(1, -1).join(" ") } : {}),
    lastName: parts.at(-1)!,
  };
}

function candidateKeys(candidates: TribeCandidate[]): string {
  return candidates.map((candidate) => `${candidate.entitySet}:${candidate.id}`).sort().join("|");
}

async function applyActions(
  input: LeadInput,
  decisions: JevDecisions,
  actions: PlannedAction[],
  tribe: TribeGateway,
): Promise<PipelineResult["applied"]> {
  const applied: PipelineResult["applied"] = [];
  let personId: string | undefined;
  let organizationId: string | undefined;

  // Resolve the primary entities first. Dependent records are never written until
  // both their prerequisites and their deterministic ImportIds are available.
  for (const action of actions) {
    if (action.type === "link_existing") {
      if (action.entitySet === "Relation_Person") personId = action.id;
      if (action.entitySet === "Relation_Organization") organizationId = action.id;
      applied.push({ action, result: { linked: true, ID: action.id } });
    } else if (action.type === "create_person" || action.type === "create_organization") {
      const result = await tribe.apply(action) as CreatedEntity;
      if (!result?.ID) throw new Error(`${action.type} did not return a Tribe ID.`);
      if (action.type === "create_person") personId = result.ID;
      else organizationId = result.ID;
      applied.push({ action, result });
    } else if (action.type === "review") {
      applied.push({ action, result: { skipped: true, reason: "Human review is required." } });
    }
  }

  let contactRelationship: CreatedEntity | undefined;
  const contactAction = actions.find((action) => action.type === "suggest_contact_link");
  if (contactAction?.type === "suggest_contact_link") {
    if (personId && organizationId) {
      contactRelationship = await tribe.createContactLink(organizationId, personId, contactAction.importId);
      applied.push({ action: contactAction, result: contactRelationship });
    } else {
      applied.push({ action: contactAction, result: { skipped: true, reason: "A person and organization are both required." } });
    }
  }

  let leadRelationship: CreatedEntity | undefined;
  const leadAction = actions.find((action) => action.type === "suggest_lead_relationship");
  if (leadAction?.type === "suggest_lead_relationship") {
    if (organizationId) {
      const owningOrganizationId = await tribe.organizationIdentityRelationId();
      leadRelationship = await tribe.createOrganizationLead(owningOrganizationId, organizationId, leadAction.importId);
      applied.push({ action: leadAction, result: leadRelationship });
    } else {
      applied.push({ action: leadAction, result: { skipped: true, reason: "An organization is required." } });
    }
  }

  const opportunityAction = actions.find((action) => action.type === "suggest_opportunity");
  if (opportunityAction?.type === "suggest_opportunity") {
    if (leadRelationship?.ID && contactRelationship?.ID && opportunityAction.phase?.id) {
      const opportunity = await tribe.createSalesOpportunity({
        subject: opportunitySubject(input),
        relationshipId: leadRelationship.ID,
        contactRelationshipId: contactRelationship.ID,
        phaseId: opportunityAction.phase.id,
        importId: opportunityAction.importId,
        noteContent: opportunityAction.noteContent,
        noteImportId: sourceImportId(input.sourceId, "opportunity_note"),
      });
      applied.push({ action: opportunityAction, result: opportunity });
    } else {
      applied.push({
        action: opportunityAction,
        result: {
          skipped: true,
          reason: "A lead relationship, contact relationship, and Qualification phase are required.",
        },
      });
    }
  }

  const callAction = actions.find((action) => action.type === "suggest_call");
  if (callAction?.type === "suggest_call") {
    if (callAction.phase?.id) {
      const call = await tribe.createCall({
        subject: callAction.subject,
        startDate: callAction.startDate,
        endDate: callAction.endDate,
        description: callAction.description,
        phaseId: callAction.phase.id,
        importId: callAction.importId,
      });
      applied.push({ action: callAction, result: call });
    } else {
      applied.push({ action: callAction, result: { skipped: true, reason: "The Planned call phase is required." } });
    }
  }

  return applied;
}

function crmNote(input: LeadInput, decisions: JevDecisions): string {
  const person = [input.person?.firstName, input.person?.middleName, input.person?.lastName].filter(Boolean).join(" ") || "niet herkend";
  const organization = input.organization?.name ?? "niet herkend";
  return [
    "Origineel bronbericht",
    input.message.trim(),
    "",
    "Jev-uitkomsten",
    `Persoon: ${person}`,
    `Organisatie: ${organization}`,
    `Intentie: ${decisions.intent} (${Math.round(decisions.intentConfidence * 100)}% confidence)`,
    `Opportunity: ${Math.round(decisions.shouldCreateOpportunity * 100)}% kans`,
    `Urgentie: ${decisions.urgencyScore.toFixed(1)}/3 (${Math.round(decisions.urgencyConfidence * 100)}% confidence)`,
  ].join("\n");
}

function opportunitySubject(input: LeadInput): string {
  const party = input.organization?.name?.trim()
    || [input.person?.firstName, input.person?.middleName, input.person?.lastName].filter(Boolean).join(" ")
    || input.sourceId;
  return `Commerciële aanvraag - ${party}`;
}

export function planActions(
  input: LeadInput,
  facts: ReturnType<typeof extractFacts>,
  candidates: TribeCandidate[],
  decisions: JevDecisions,
): PlannedAction[] {
  const actions: PlannedAction[] = [];
  const deterministicPerson = deterministicIdentityMatch(candidates, "Relation_Person", input);
  const deterministicOrganization = deterministicIdentityMatch(candidates, "Relation_Organization", input);
  const matchedPerson = decisions.hasPerson >= 0.8
    ? deterministicPerson ?? candidates.find((candidate) => candidate.id === decisions.matchingPersonCandidateId)
    : undefined;
  const matchedOrganization = decisions.hasOrganization >= 0.8
    ? deterministicOrganization ?? candidates.find((candidate) => candidate.id === decisions.matchingOrganizationCandidateId)
    : undefined;

  if (matchedPerson && (deterministicPerson || decisions.matchingPersonCandidateConfidence >= 0.9)) {
    actions.push({ type: "link_existing", entitySet: matchedPerson.entitySet, id: matchedPerson.id, displayName: matchedPerson.displayName, matchedOn: matchedPerson.matchedOn });
  } else if (matchedPerson) {
    actions.push({ type: "review", reason: "Jev found a possible duplicate, but its match confidence is below the initial 0.90 safety threshold." });
  } else if (decisions.hasPerson >= 0.8) {
    const lastName = input.person?.lastName?.trim();
    if (!lastName) {
      actions.push({ type: "review", reason: "A person appears to be the primary party, but no source-backed last name was supplied." });
    } else {
      actions.push({
        type: "create_person",
        body: compact({
          FirstName: input.person?.firstName?.trim(),
          MiddleName: input.person?.middleName?.trim(),
          LastName: lastName,
          EmailAddress: facts.emails[0],
          PhoneNumber: facts.phoneNumbers[0],
          ImportId: sourceImportId(input.sourceId, "person"),
          Notes: [{ Content: crmNote(input, decisions), ImportId: sourceImportId(input.sourceId, "person_note"), IsPinned: true }],
        }),
      });
    }
  } else if (decisions.hasPerson >= 0.5) {
    actions.push({ type: "review", reason: "A person may be present, but the evidence does not meet the initial 0.80 threshold." });
  }

  if (matchedOrganization && (deterministicOrganization || decisions.matchingOrganizationCandidateConfidence >= 0.9)) {
    actions.push({ type: "link_existing", entitySet: matchedOrganization.entitySet, id: matchedOrganization.id, displayName: matchedOrganization.displayName, matchedOn: matchedOrganization.matchedOn });
  } else if (matchedOrganization) {
    actions.push({ type: "review", reason: "Jev found a possible organization duplicate, but its match confidence is below the initial 0.90 safety threshold." });
  } else if (decisions.hasOrganization >= 0.8) {
    const name = input.organization?.name?.trim();
    if (!name) {
      actions.push({ type: "review", reason: "An organization appears to be the primary party, but no source-backed organization name was supplied." });
    } else {
      actions.push({
        type: "create_organization",
        body: compact({
          Name: name,
          EmailAddress: facts.emails[0],
          PhoneNumber: facts.phoneNumbers[0],
          Website: input.organization?.website?.trim() ?? facts.urls[0],
          ImportId: sourceImportId(input.sourceId, "organization"),
          Notes: [{ Content: crmNote(input, decisions), ImportId: sourceImportId(input.sourceId, "organization_note"), IsPinned: true }],
        }),
      });
    }
  } else if (decisions.hasOrganization >= 0.5) {
    actions.push({ type: "review", reason: "An organization may be present, but the evidence does not meet the initial 0.80 threshold." });
  }

  if (actions.length === 0) {
    actions.push({ type: "review", reason: "No source-backed person or organization could be planned." });
  }

  const hasPersonAction = actions.some((action) => action.type === "create_person" || (action.type === "link_existing" && action.entitySet === "Relation_Person"));
  const hasOrganizationAction = actions.some((action) => action.type === "create_organization" || (action.type === "link_existing" && action.entitySet === "Relation_Organization"));

  if (hasPersonAction && hasOrganizationAction) {
    actions.push({
      type: "suggest_contact_link",
      reason: "Link the person to the organization through Relationship_Person_Contact_Standard after both relation IDs are known.",
      importId: sourceImportId(input.sourceId, "contact"),
    });
  }

  if (decisions.intent === "sales" && decisions.intentConfidence >= 0.8 && decisions.shouldCreateOpportunity >= 0.85) {
    if (hasOrganizationAction) {
      actions.push({
        type: "suggest_lead_relationship",
        reason: "Represent the organization as a lead through Relationship_Organization_CommercialRelationship_Lead before creating the opportunity.",
        importId: sourceImportId(input.sourceId, "lead"),
      });
    }
    actions.push({
      type: "suggest_opportunity",
      reason: "Jev found high-confidence sales intent and concrete commercial interest. Creating the tenant-specific relationship and opportunity remains a reviewed pilot action.",
      importId: sourceImportId(input.sourceId, "opportunity"),
      noteContent: crmNote(input, decisions),
    });
  }


  if ((decisions.shouldCreateCall ?? 0) >= 0.8 && (decisions.callDayConfidence ?? 0) >= 0.6) {
    const start = resolveCallDate(decisions.callDay ?? "none", input.receivedAt);
    if (start) {
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      const party = [input.person?.firstName, input.person?.middleName, input.person?.lastName].filter(Boolean).join(" ") || input.organization?.name || "onbekende relatie";
      actions.push({
        type: "suggest_call",
        reason: "Jev found an explicit request to schedule a phone call and identified its day.",
        importId: sourceImportId(input.sourceId, "call"),
        subject: `Belafspraak - ${party}`,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        description: crmNote(input, decisions),
      });
    }
  }

  return actions;
}

function deterministicIdentityMatch(candidates: TribeCandidate[], entitySet: TribeCandidate["entitySet"], input: LeadInput): TribeCandidate | undefined {
  const strong = candidates.filter((candidate) => candidate.entitySet === entitySet && candidate.matchedOn?.some((item) => item === "importId" || item === "email" || item === "phone" || item === "website"));
  if (strong.length !== 1) return undefined;
  const candidate = strong[0]!;
  const expectedName = entitySet === "Relation_Person"
    ? [input.person?.firstName, input.person?.middleName, input.person?.lastName].filter(Boolean).join(" ")
    : input.organization?.name ?? "";
  if (!expectedName) return undefined;
  const expected = normalizeIdentityName(expectedName);
  const actual = normalizeIdentityName(candidate.displayName);
  return actual.includes(expected) || expected.includes(actual) ? candidate : undefined;
}

function normalizeIdentityName(value: string): string {
  return value.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

export function resolveCallDate(day: NonNullable<JevDecisions["callDay"]>, receivedAt?: string): Date | undefined {
  if (day === "none") return undefined;
  const date = receivedAt ? new Date(receivedAt) : new Date();
  if (Number.isNaN(date.getTime())) return undefined;
  date.setHours(9, 0, 0, 0);
  if (day === "tomorrow") date.setDate(date.getDate() + 1);
  else if (day === "day_after") date.setDate(date.getDate() + 2);
  else if (day !== "today") {
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
    const target = weekdays.indexOf(day);
    date.setDate(date.getDate() + ((target - date.getDay() + 7) % 7));
  }
  return date;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function validateInput(value: LeadInput): void {
  if (!value || typeof value !== "object") throw new Error("Lead input must be an object.");
  if (!value.sourceId?.trim()) throw new Error("Lead input requires sourceId.");
  if (!value.message?.trim()) throw new Error("Lead input requires message.");
}
