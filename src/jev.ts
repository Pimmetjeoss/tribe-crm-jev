import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
import type { JsonValue } from "@typesafe-ai/sdk";
import type { ExtractedFacts, JevDecisions, LeadInput, TribeCandidate } from "./types.js";

export interface DecisionEngine {
  decide(input: LeadInput, facts: ExtractedFacts, candidates: TribeCandidate[]): Promise<JevDecisions>;
}

export class JevDecisionEngine implements DecisionEngine {
  private readonly client: TypeSafeClient;

  constructor(client = new TypeSafeClient()) {
    this.client = client;
  }

  async decide(input: LeadInput, facts: ExtractedFacts, candidates: TribeCandidate[]): Promise<JevDecisions> {
    const personCandidateCriteria: Record<string, string> = {
      none: "None of the candidate CRM persons clearly represents the person in the source message.",
    };
    const organizationCandidateCriteria: Record<string, string> = {
      none: "None of the candidate CRM organizations clearly represents the organization in the source message.",
    };
    candidates.forEach((candidate, index) => {
      const criteria = candidate.entitySet === "Relation_Person" ? personCandidateCriteria : organizationCandidateCriteria;
      criteria[`candidate_${index}`] = JSON.stringify(candidate);
    });

    const state: JsonValue = {
      source: {
        id: input.sourceId,
        message: input.message,
        receivedAt: input.receivedAt ?? null,
        suppliedPerson: input.person ?? null,
        suppliedOrganization: input.organization ?? null,
      },
      extractedFacts: {
        emails: facts.emails,
        phoneNumbers: facts.phoneNumbers,
        urls: facts.urls,
      },
      tribeCandidates: candidates.map((candidate) => ({
        id: candidate.id,
        entitySet: candidate.entitySet,
        displayName: candidate.displayName,
        emailAddress: candidate.emailAddress ?? null,
        website: candidate.website ?? null,
      })),
    };

    const response = await this.client.systemOne({
      state,
      questions: {
        hasPerson: noul(
          "Does `source` identify a specific person who should be represented as a person in the CRM?",
          {
            true: "A specific real person is identified by name or supplied person data.",
            false: "No specific person is identified.",
          },
        ),
        hasOrganization: noul(
          "Does `source` identify a specific organization that should be represented as an organization in the CRM?",
          {
            true: "A specific company or organization is identified by name or supplied organization data.",
            false: "No specific organization is identified.",
          },
        ),
        intent: choice("What is the primary business intent expressed in `source.message`?", {
          sales: "Potential customer interest, quotation request, purchase intent, or other sales opportunity.",
          support: "Help or service concerning an existing product, service, or account.",
          supplier: "A supplier, purchasing, partnership, or vendor matter rather than a sales lead.",
          other: "None of the other intents clearly applies.",
        }),
        shouldCreateOpportunity: noul(
          "Does `source.message` contain sufficiently concrete commercial interest to justify suggesting a sales opportunity, rather than merely general contact or support?",
          {
            true: "There is a concrete need, buying signal, quotation request, project, budget, timeline, or requested sales follow-up.",
            false: "No concrete sales opportunity is evidenced.",
          },
        ),
        urgency: score("How urgently should a CRM user follow up on `source.message`?", [
          "No follow-up or no time sensitivity is apparent.",
          "Normal follow-up during the regular workflow is appropriate.",
          "Prompt follow-up is useful because the sender signals a near-term need.",
          "Immediate follow-up is warranted because an explicit deadline or serious business impact is present.",
        ]),
        matchingPersonCandidate: choice(
          "Which person entry in `tribeCandidates` represents the same real-world person identified in `source`? Choose none unless the evidence supports an identity match.",
          personCandidateCriteria,
        ),
        matchingOrganizationCandidate: choice(
          "Which organization entry in `tribeCandidates` represents the same real-world organization identified in `source`? Choose none unless the evidence supports an identity match.",
          organizationCandidateCriteria,
        ),
      },
    });

    const matchingPerson = candidateFromChoice(response.answers.matchingPersonCandidate.choice, candidates);
    const matchingOrganization = candidateFromChoice(response.answers.matchingOrganizationCandidate.choice, candidates);

    return {
      hasPerson: response.answers.hasPerson.noul,
      hasOrganization: response.answers.hasOrganization.noul,
      intent: response.answers.intent.choice,
      intentConfidence: response.answers.intent.confidence,
      shouldCreateOpportunity: response.answers.shouldCreateOpportunity.noul,
      urgencyScore: response.answers.urgency.score,
      urgencyConfidence: response.answers.urgency.confidence,
      matchingPersonCandidateId: matchingPerson?.id ?? null,
      matchingPersonCandidateConfidence: response.answers.matchingPersonCandidate.confidence,
      matchingOrganizationCandidateId: matchingOrganization?.id ?? null,
      matchingOrganizationCandidateConfidence: response.answers.matchingOrganizationCandidate.confidence,
    };
  }
}

function candidateFromChoice(key: string, candidates: TribeCandidate[]): TribeCandidate | undefined {
  const index = /^candidate_(\d+)$/.exec(key)?.[1];
  return index === undefined ? undefined : candidates[Number(index)];
}
