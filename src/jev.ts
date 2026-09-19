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
    const sourceNameCandidates = identityCandidates(input.message);
    const suppliedPersonName = [input.person?.firstName, input.person?.middleName, input.person?.lastName].filter(Boolean).join(" ");
    const personNameCriteria = valueCriteria(
      "No specific person name can be copied from the source.",
      [suppliedPersonName, ...sourceNameCandidates],
    );
    const organizationNameCriteria = valueCriteria(
      "No specific organization name can be copied from the source.",
      [input.organization?.name ?? "", ...sourceNameCandidates],
    );
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
        phoneNumbers: candidate.phoneNumbers ?? [],
        matchedOn: candidate.matchedOn ?? [],
      })),
    };

    const response = await this.client.systemOne({
      state,
      questions: {
        personName: choice(
          "Which option is the complete name of the person that `source.message` asks to create or add as the new CRM contact? Prefer the target of words such as new contact, aanmaken, toevoegen, or namelijk. Do not select the requester, owner, or person the contact is created for. If no creation request exists, select the primary person the message is about. Copy only an offered source span and choose none when no person is named.",
          personNameCriteria,
        ),
        organizationName: choice(
          "Which option is the complete name of the company or organization that the new contact works for in `source.message`? Do not treat a person's name as an organization. Select only an offered source span and choose none when no organization is named.",
          organizationNameCriteria,
        ),
        hasPerson: noul(
          "Does `source` identify a specific target person who should be created, added, or represented as a person in the CRM?",
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
        shouldCreateCall: noul(
          "Does `source.message` explicitly request or instruct that a phone call or call appointment be scheduled?",
          {
            true: "The message asks to call, schedule a call, or create a belafspraak/telefonische afspraak.",
            false: "No phone call is requested; merely reviewing, emailing, meeting, or following up is not enough.",
          },
        ),
        callDay: choice(
          "If `source.message` schedules a phone call, which relative day is requested? Choose the named weekday for a weekday reference and none if no call day is stated.",
          {
            today: "Today / vandaag.", tomorrow: "Tomorrow / morgen.", day_after: "The day after tomorrow / overmorgen.",
            monday: "Monday / maandag.", tuesday: "Tuesday / dinsdag.", wednesday: "Wednesday / woensdag.",
            thursday: "Thursday / donderdag.", friday: "Friday / vrijdag.", saturday: "Saturday / zaterdag.", sunday: "Sunday / zondag.",
            none: "No day for a phone call is stated.",
          },
        ),
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
      extractedPersonName: valueFromChoice(response.answers.personName.choice, personNameCriteria),
      extractedOrganizationName: valueFromChoice(response.answers.organizationName.choice, organizationNameCriteria),
      hasPerson: response.answers.hasPerson.noul,
      hasOrganization: response.answers.hasOrganization.noul,
      intent: response.answers.intent.choice,
      intentConfidence: response.answers.intent.confidence,
      shouldCreateOpportunity: response.answers.shouldCreateOpportunity.noul,
      urgencyScore: response.answers.urgency.score,
      urgencyConfidence: response.answers.urgency.confidence,
      shouldCreateCall: response.answers.shouldCreateCall.noul,
      callDay: response.answers.callDay.choice,
      callDayConfidence: response.answers.callDay.confidence,
      matchingPersonCandidateId: matchingPerson?.id ?? null,
      matchingPersonCandidateConfidence: response.answers.matchingPersonCandidate.confidence,
      matchingOrganizationCandidateId: matchingOrganization?.id ?? null,
      matchingOrganizationCandidateConfidence: response.answers.matchingOrganizationCandidate.confidence,
    };
  }
}

export function identityCandidates(text: string): string[] {
  const words = text.match(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu) ?? [];
  const stopwords = new Set(["aan", "als", "aub", "dat", "deze", "een", "en", "het", "hier", "in", "is", "maak", "met", "namelijk", "nieuwe", "om", "op", "telefoonnummer", "tekst", "van", "voor"]);
  const candidates = new Set<string>();
  for (let start = 0; start < words.length; start += 1) {
    for (let length = 1; length <= 4 && start + length <= words.length; length += 1) {
      const phrase = words.slice(start, start + length);
      const first = phrase[0]!.toLocaleLowerCase("nl-NL");
      const last = phrase.at(-1)!.toLocaleLowerCase("nl-NL");
      if (stopwords.has(first) || stopwords.has(last)) continue;
      candidates.add(phrase.join(" "));
      if (candidates.size >= 220) return [...candidates];
    }
  }
  return [...candidates];
}

function valueCriteria(noneDescription: string, values: string[]): Record<string, string> {
  const criteria: Record<string, string> = { none: noneDescription };
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].forEach((value, index) => {
    criteria[`value_${index}`] = value;
  });
  return criteria;
}

function valueFromChoice(key: string, criteria: Record<string, string>): string | null {
  return key === "none" ? null : criteria[key] ?? null;
}

function candidateFromChoice(key: string, candidates: TribeCandidate[]): TribeCandidate | undefined {
  const index = /^candidate_(\d+)$/.exec(key)?.[1];
  return index === undefined ? undefined : candidates[Number(index)];
}
