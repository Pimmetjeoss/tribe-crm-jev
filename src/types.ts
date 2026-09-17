export interface LeadInput {
  sourceId: string;
  message: string;
  receivedAt?: string;
  person?: {
    firstName?: string;
    middleName?: string;
    lastName?: string;
  };
  organization?: {
    name?: string;
    website?: string;
  };
}

export interface ExtractedFacts {
  emails: string[];
  phoneNumbers: string[];
  urls: string[];
}

export interface TribeCandidate {
  id: string;
  entitySet: "Relation_Person" | "Relation_Organization";
  displayName: string;
  emailAddress?: string;
  website?: string;
}

export type LeadIntent = "sales" | "support" | "supplier" | "other";

export interface JevDecisions {
  hasPerson: number;
  hasOrganization: number;
  intent: LeadIntent;
  intentConfidence: number;
  shouldCreateOpportunity: number;
  urgencyScore: number;
  urgencyConfidence: number;
  matchingPersonCandidateId: string | null;
  matchingPersonCandidateConfidence: number;
  matchingOrganizationCandidateId: string | null;
  matchingOrganizationCandidateConfidence: number;
}

export type PlannedAction =
  | { type: "link_existing"; entitySet: TribeCandidate["entitySet"]; id: string }
  | { type: "create_person"; body: Record<string, unknown> }
  | { type: "create_organization"; body: Record<string, unknown> }
  | { type: "suggest_contact_link"; reason: string; importId: string }
  | { type: "suggest_lead_relationship"; reason: string; importId: string }
  | { type: "suggest_opportunity"; reason: string; importId: string; phase?: { id: string; code?: string; name?: string } }
  | { type: "review"; reason: string };

export interface PipelineResult {
  mode: "dry-run" | "applied";
  facts: ExtractedFacts;
  candidates: TribeCandidate[];
  decisions: JevDecisions;
  actions: PlannedAction[];
  applied: Array<{ action: PlannedAction; result: unknown }>;
}
