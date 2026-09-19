import type { ExtractedFacts, LeadInput, PlannedAction, TribeCandidate } from "./types.js";
import { sourceImportId } from "./idempotency.js";

interface TribeClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  writesEnabled: boolean;
  fetch?: typeof globalThis.fetch;
}

interface ODataList<T> {
  value: T[];
}

interface RelationRow {
  ID: string;
  _Name?: string;
  FirstName?: string;
  LastName?: string;
  Name?: string;
  EmailAddress?: string;
  Website?: string;
  PhoneNumber?: string;
  MobilePhoneNumber?: string;
}

export interface OpportunityPhase {
  id: string;
  code?: string;
  name?: string;
}

export interface CreatedEntity {
  ID: string;
  _Type?: string;
  _Name?: string;
  ImportId?: string;
  deduplicated?: boolean;
  Notes?: Array<{ ID: string; Content?: string; ImportId?: string }>;
}

export class TribeClient {
  readonly writesEnabled: boolean;
  private readonly options: TribeClientOptions;
  private readonly doFetch: typeof globalThis.fetch;
  private token?: { value: string; expiresAt: number };

  constructor(options: TribeClientOptions) {
    this.options = options;
    this.writesEnabled = options.writesEnabled;
    this.doFetch = options.fetch ?? globalThis.fetch;
  }

  async metadata(): Promise<unknown> {
    return this.request("/v1/odata/$metadata?$format=json");
  }

  async opportunityPhases(): Promise<OpportunityPhase[]> {
    const rows = await this.list<{ ID: string; Code?: string; _Name?: string }>(
      "Datastore_Phase_ActivitySalesOpportunity",
      undefined,
      "ID,Code,_Name",
      100,
    );
    return rows.map((row) => ({
      id: row.ID,
      ...(row.Code ? { code: row.Code } : {}),
      ...(row._Name ? { name: row._Name } : {}),
    }));
  }

  async callPhases(): Promise<OpportunityPhase[]> {
    const rows = await this.list<{ ID: string; Code?: string; _Name?: string }>("Datastore_Phase_ActivityCall", undefined, "ID,Code,_Name", 100);
    return rows.map((row) => ({ id: row.ID, ...(row.Code ? { code: row.Code } : {}), ...(row._Name ? { name: row._Name } : {}) }));
  }

  async createCall(input: { subject: string; startDate: string; endDate: string; description: string; phaseId: string; importId: string }): Promise<CreatedEntity> {
    return this.createOnce("Activity_Call", input.importId, {
      Subject: input.subject,
      StartDate: input.startDate,
      EndDate: input.endDate,
      Description: input.description,
      Phase: { ID: input.phaseId },
    });
  }

  async organizationIdentityRelationId(): Promise<string> {
    const params = new URLSearchParams({
      "$expand": "Relation($select=ID)",
      "$select": "ID,Name",
      "$top": "10",
    });
    const response = await this.request<ODataList<{ Relation?: { ID?: string } }>>(
      `/v1/odata/Relationship_Organization_Identity?${params}`,
    );
    const ids = [...new Set(response.value.map((row) => row.Relation?.ID).filter((id): id is string => Boolean(id)))];
    if (ids.length !== 1) {
      throw new Error(`Expected exactly one owning organization identity, found ${ids.length}.`);
    }
    return ids[0]!;
  }

  async createContactLink(parentOrganizationId: string, personId: string, importId: string): Promise<CreatedEntity> {
    return this.createOnce("Relationship_Person_Contact_Standard", importId, {
      Relation: { ID: parentOrganizationId },
      Person: { ID: personId },
    });
  }

  async createOrganizationLead(parentOrganizationId: string, organizationId: string, importId: string): Promise<CreatedEntity> {
    return this.createOnce("Relationship_Organization_CommercialRelationship_Lead", importId, {
      Relation: { ID: parentOrganizationId },
      Organization: { ID: organizationId },
    });
  }

  async createSalesOpportunity(input: {
    subject: string;
    relationshipId: string;
    contactRelationshipId: string;
    phaseId: string;
    importId: string;
    noteContent: string;
    noteImportId: string;
  }): Promise<CreatedEntity> {
    return this.createOnce("Activity_SalesOpportunity", input.importId, {
      Subject: input.subject,
      Relationship: { ID: input.relationshipId },
      Contact: { ID: input.contactRelationshipId },
      Phase: { ID: input.phaseId },
      Notes: [{ Content: input.noteContent, ImportId: input.noteImportId, IsPinned: true }],
    });
  }

  async findOpportunityByImportId(importId: string): Promise<CreatedEntity[]> {
    return this.findByImportIdWithNotes("Activity_SalesOpportunity", importId);
  }

  async findByImportIdWithNotes(entitySet: string, importId: string): Promise<CreatedEntity[]> {
    const params = new URLSearchParams({
      "$filter": `contains(ImportId,'${escapeODataString(importId)}')`,
      "$select": "ID,_Type,_Name,ImportId",
      "$expand": "Notes($select=ID,Content,ImportId)",
      "$top": "10",
    });
    const response = await this.request<ODataList<CreatedEntity>>(`/v1/odata/${entitySet}?${params}`);
    return response.value.filter((entity) => entity.ImportId === importId);
  }

  async updateSalesOpportunityContact(opportunityId: string, contactRelationshipId: string): Promise<CreatedEntity> {
    if (!this.writesEnabled) {
      throw new Error("Tribe writes are disabled. Set TRIBE_ENABLE_WRITES=true for an explicitly approved run.");
    }
    return this.request<CreatedEntity>(`/v1/odata/Activity_SalesOpportunity(${opportunityId})`, {
      method: "PUT",
      body: { Contact: { ID: contactRelationshipId } },
    });
  }

  async deleteRelationship(relationshipId: string): Promise<void> {
    if (!this.writesEnabled) {
      throw new Error("Tribe writes are disabled. Set TRIBE_ENABLE_WRITES=true for an explicitly approved run.");
    }
    await this.request(`/v1/odata/Relationship(${relationshipId})`, { method: "DELETE" });
  }

  async updateImportId(entitySet: string, entityId: string, importId: string): Promise<CreatedEntity> {
    if (!this.writesEnabled) {
      throw new Error("Tribe writes are disabled. Set TRIBE_ENABLE_WRITES=true for an explicitly approved run.");
    }
    return this.request<CreatedEntity>(`/v1/odata/${entitySet}(${entityId})`, {
      method: "PUT",
      body: { ImportId: importId },
    });
  }

  async findByImportId(entitySet: string, importId: string): Promise<CreatedEntity[]> {
    const params = new URLSearchParams({
      "$filter": `contains(ImportId,'${escapeODataString(importId)}')`,
      "$select": "ID,_Type,_Name,ImportId",
      "$top": "10",
    });
    const response = await this.request<ODataList<CreatedEntity>>(`/v1/odata/${entitySet}?${params}`);
    return response.value.filter((entity) => entity.ImportId === importId);
  }

  async findCandidates(input: LeadInput, facts: ExtractedFacts): Promise<TribeCandidate[]> {
    const byId = new Map<string, TribeCandidate>();
    const [importedPeople, importedOrganizations] = await Promise.all([
      this.findByImportId("Relation_Person", sourceImportId(input.sourceId, "person")),
      this.findByImportId("Relation_Organization", sourceImportId(input.sourceId, "organization")),
    ]);
    for (const entity of importedPeople) {
      const candidate: TribeCandidate = {
        id: entity.ID,
        entitySet: "Relation_Person",
        displayName: entity._Name ?? entity.ID,
        matchedOn: ["importId"],
      };
      byId.set(`${candidate.entitySet}:${candidate.id}`, candidate);
    }
    for (const entity of importedOrganizations) {
      const candidate: TribeCandidate = {
        id: entity.ID,
        entitySet: "Relation_Organization",
        displayName: entity._Name ?? entity.ID,
        matchedOn: ["importId"],
      };
      byId.set(`${candidate.entitySet}:${candidate.id}`, candidate);
    }
    const lastName = input.person?.lastName?.trim();
    const firstName = input.person?.firstName?.trim();
    const organizationName = input.organization?.name?.trim();
    const searches: Array<Promise<{ entitySet: TribeCandidate["entitySet"]; rows: RelationRow[] }>> = [];
    const personSelect = "ID,_Name,FirstName,LastName,EmailAddress,PhoneNumber,MobilePhoneNumber";
    const organizationSelect = "ID,_Name,Name,EmailAddress,PhoneNumber,Website";

    if (lastName || firstName) {
      const field = lastName ? "LastName" : "FirstName";
      const value = lastName ?? firstName ?? "";
      searches.push(
        this.list<RelationRow>("Relation_Person", `contains(${field},'${escapeODataString(value)}')`, personSelect)
          .then((rows) => ({ entitySet: "Relation_Person" as const, rows })),
      );
    }
    if (organizationName) {
      searches.push(
        this.list<RelationRow>("Relation_Organization", `contains(Name,'${escapeODataString(organizationName)}')`, organizationSelect)
          .then((rows) => ({ entitySet: "Relation_Organization" as const, rows })),
      );
    }
    for (const email of facts.emails) {
      const filter = `contains(EmailAddress,'${escapeODataString(email)}')`;
      searches.push(this.list<RelationRow>("Relation_Person", filter, personSelect, 25).then((rows) => ({ entitySet: "Relation_Person" as const, rows })));
      searches.push(this.list<RelationRow>("Relation_Organization", filter, organizationSelect, 25).then((rows) => ({ entitySet: "Relation_Organization" as const, rows })));
    }
    for (const phone of facts.phoneNumbers) {
      const needle = phone.replace(/\D/g, "").slice(-4);
      if (!needle) continue;
      searches.push(this.list<RelationRow>("Relation_Person", `contains(PhoneNumber,'${needle}')`, personSelect, 50).then((rows) => ({ entitySet: "Relation_Person" as const, rows })));
      searches.push(this.list<RelationRow>("Relation_Person", `contains(MobilePhoneNumber,'${needle}')`, personSelect, 50).then((rows) => ({ entitySet: "Relation_Person" as const, rows })));
      searches.push(this.list<RelationRow>("Relation_Organization", `contains(PhoneNumber,'${needle}')`, organizationSelect, 50).then((rows) => ({ entitySet: "Relation_Organization" as const, rows })));
    }
    for (const url of facts.urls) {
      const host = normalizeHost(url);
      if (host) searches.push(this.list<RelationRow>("Relation_Organization", `contains(Website,'${escapeODataString(host)}')`, organizationSelect, 25).then((rows) => ({ entitySet: "Relation_Organization" as const, rows })));
    }

    for (const search of await Promise.all(searches)) {
      for (const row of search.rows) {
        const candidate = toCandidate(row, search.entitySet);
        const matchedOn = matchingEvidence(candidate, input, facts);
        if (matchedOn.length === 0) continue;
        const key = `${candidate.entitySet}:${candidate.id}`;
        const existing = byId.get(key);
        byId.set(key, existing ? { ...existing, ...candidate, matchedOn: [...new Set([...(existing.matchedOn ?? []), ...matchedOn])] } : { ...candidate, matchedOn });
      }
    }
    return [...byId.values()];
  }

  async apply(action: PlannedAction): Promise<unknown> {
    if (!this.writesEnabled) {
      throw new Error("Tribe writes are disabled. Set TRIBE_ENABLE_WRITES=true as well as using --apply.");
    }

    switch (action.type) {
      case "create_person":
        return this.createOnce("Relation_Person", requiredImportId(action.body), action.body);
      case "create_organization":
        return this.createOnce("Relation_Organization", requiredImportId(action.body), action.body);
      case "link_existing":
      case "suggest_contact_link":
      case "suggest_lead_relationship":
      case "suggest_opportunity":
      case "review":
        return { skipped: true, reason: "This action does not mutate Tribe in the pilot." };
    }
  }

  private async writeEntity(entitySet: string, body: Record<string, unknown>): Promise<CreatedEntity> {
    if (!this.writesEnabled) {
      throw new Error("Tribe writes are disabled. Set TRIBE_ENABLE_WRITES=true for an explicitly approved run.");
    }
    return this.request<CreatedEntity>(`/v1/odata/${entitySet}`, { method: "POST", body });
  }

  private async createOnce(entitySet: string, importId: string, body: Record<string, unknown>): Promise<CreatedEntity> {
    const existing = await this.findByImportId(entitySet, importId);
    if (existing.length > 1) {
      throw new Error(`Idempotency conflict: ${existing.length} ${entitySet} records have ImportId ${importId}.`);
    }
    if (existing[0]) return { ...existing[0], deduplicated: true };
    return this.writeEntity(entitySet, { ...body, ImportId: importId });
  }

  private async list<T>(entitySet: string, filter: string | undefined, select: string, top = 10): Promise<T[]> {
    const params = new URLSearchParams({ "$select": select, "$top": String(top) });
    if (filter) params.set("$filter", filter);
    const result = await this.request<ODataList<T>>(`/v1/odata/${entitySet}?${params}`);
    return result.value;
  }

  private async request<T = unknown>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const token = await this.accessToken();
    const response = await this.doFetch(`${this.options.baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

    if (!response.ok) {
      throw new Error(`Tribe request failed (${response.status}) on ${init.method ?? "GET"} ${path}: ${await response.text()}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      scope: "read write offline",
    });
    const response = await this.doFetch("https://auth.tribecrm.nl/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error(`Tribe authentication failed (${response.status}): ${await response.text()}`);

    const json = (await response.json()) as { access_token: string; expires_in?: number };
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 86_400) * 1000,
    };
    return this.token.value;
  }
}

function escapeODataString(value: string): string {
  return value.replaceAll("'", "''");
}

function toCandidate(row: RelationRow, entitySet: TribeCandidate["entitySet"]): TribeCandidate {
  const displayName = row._Name ?? row.Name ?? ([row.FirstName, row.LastName].filter(Boolean).join(" ") || row.ID);
  return {
    id: row.ID,
    entitySet,
    displayName,
    ...(row.EmailAddress ? { emailAddress: row.EmailAddress } : {}),
    ...(row.Website ? { website: row.Website } : {}),
    ...([row.PhoneNumber, row.MobilePhoneNumber].filter((value): value is string => Boolean(value)).length
      ? { phoneNumbers: [row.PhoneNumber, row.MobilePhoneNumber].filter((value): value is string => Boolean(value)) }
      : {}),
  };
}

function matchingEvidence(candidate: TribeCandidate, input: LeadInput, facts: ExtractedFacts): NonNullable<TribeCandidate["matchedOn"]> {
  const evidence: NonNullable<TribeCandidate["matchedOn"]> = [];
  if (candidate.emailAddress && facts.emails.includes(candidate.emailAddress.toLowerCase())) evidence.push("email");
  if ((candidate.phoneNumbers ?? []).some((phone) => facts.phoneNumbers.some((fact) => normalizePhone(phone) === normalizePhone(fact)))) evidence.push("phone");

  const expectedName = candidate.entitySet === "Relation_Person"
    ? [input.person?.firstName, input.person?.middleName, input.person?.lastName].filter(Boolean).join(" ")
    : input.organization?.name ?? "";

  if (expectedName.length > 0 && normalizeName(candidate.displayName) === normalizeName(expectedName)) evidence.push("name");
  if (candidate.entitySet === "Relation_Organization" && candidate.website && facts.urls.some((url) => normalizeHost(candidate.website!) === normalizeHost(url))) evidence.push("website");
  return evidence;
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

function normalizeHost(value: string): string {
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./i, "").toLowerCase(); }
  catch { return value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0]!.toLowerCase(); }
}

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

function requiredImportId(body: Record<string, unknown>): string {
  const value = body.ImportId;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Every create action requires a deterministic ImportId.");
  }
  return value;
}
