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
  phoneNumbers?: string[];
  matchedOn?: Array<"importId" | "email" | "phone" | "name" | "website">;
}

export type LeadIntent = "sales" | "support" | "supplier" | "other";

export interface JevDecisions {
  extractedPersonName?: string | null;
  extractedOrganizationName?: string | null;
  hasPerson: number;
  hasOrganization: number;
  intent: LeadIntent;
  intentConfidence: number;
  shouldCreateOpportunity: number;
  urgencyScore: number;
  urgencyConfidence: number;
  shouldCreateCall?: number;
  callDay?: "today" | "tomorrow" | "day_after" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday" | "none";
  callDayConfidence?: number;
  matchingPersonCandidateId: string | null;
  matchingPersonCandidateConfidence: number;
  matchingOrganizationCandidateId: string | null;
  matchingOrganizationCandidateConfidence: number;
}

export type PlannedAction =
  | { type: "link_existing"; entitySet: TribeCandidate["entitySet"]; id: string; displayName?: string; matchedOn?: TribeCandidate["matchedOn"] }
  | { type: "create_person"; body: Record<string, unknown> }
  | { type: "create_organization"; body: Record<string, unknown> }
  | { type: "suggest_contact_link"; reason: string; importId: string }
  | { type: "suggest_lead_relationship"; reason: string; importId: string }
  | { type: "suggest_opportunity"; reason: string; importId: string; noteContent: string; phase?: { id: string; code?: string; name?: string } }
  | { type: "suggest_call"; reason: string; importId: string; subject: string; startDate: string; endDate: string; description: string; phase?: { id: string; code?: string; name?: string } }
  | { type: "review"; reason: string };

export interface PipelineResult {
  mode: "dry-run" | "applied";
  resolvedInput: LeadInput;
  facts: ExtractedFacts;
  candidates: TribeCandidate[];
  decisions: JevDecisions;
  actions: PlannedAction[];
  applied: Array<{ action: PlannedAction; result: unknown }>;
}
