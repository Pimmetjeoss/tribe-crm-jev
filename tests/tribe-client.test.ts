import assert from "node:assert/strict";
import test from "node:test";
import { TribeClient } from "../src/tribe-client.js";

test("dependent create methods return an ImportId match without posting a duplicate", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/oauth2/token")) {
      return Response.json({ access_token: "test-token", expires_in: 3600 });
    }
    if (method === "GET" && url.includes("Relationship_Person_Contact_Standard")) {
      return Response.json({
        value: [{
          ID: "existing-contact-id",
          _Type: "Relationship.Person.Contact.Standard",
          ImportId: "tribe-jev:mail-1:contact",
        }],
      });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const client = new TribeClient({
    clientId: "client",
    clientSecret: "secret",
    baseUrl: "https://api.tribecrm.nl",
    writesEnabled: true,
    fetch: fakeFetch as typeof fetch,
  });
  const result = await client.createContactLink(
    "organization-id",
    "person-id",
    "tribe-jev:mail-1:contact",
  );

  assert.equal(result.ID, "existing-contact-id");
  assert.equal(result.deduplicated, true);
  assert.equal(calls.filter((call) => call.method === "POST" && call.url.includes("/v1/odata/")).length, 0);
});

test("opportunity creation deep-inserts the original-message note", async () => {
  let postedBody: Record<string, unknown> | undefined;
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/oauth2/token")) return Response.json({ access_token: "test-token", expires_in: 3600 });
    if ((init?.method ?? "GET") === "GET") return Response.json({ value: [] });
    postedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ ID: "opportunity-id" });
  };
  const client = new TribeClient({ clientId: "client", clientSecret: "secret", baseUrl: "https://api.tribecrm.nl", writesEnabled: true, fetch: fakeFetch as typeof fetch });

  await client.createSalesOpportunity({
    subject: "Test opportunity",
    relationshipId: "lead-id",
    contactRelationshipId: "contact-id",
    phaseId: "phase-id",
    importId: "tribe-jev:test:opportunity",
    noteImportId: "tribe-jev:test:note",
    noteContent: "Origineel bronbericht\nHallo wereld",
  });

  assert.deepEqual(postedBody?.Notes, [{ Content: "Origineel bronbericht\nHallo wereld", ImportId: "tribe-jev:test:note", IsPinned: true }]);
});

test("candidate lookup finds an existing person by normalized phone number", async () => {
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = decodeURIComponent(String(input));
    if (url.includes("/oauth2/token")) return Response.json({ access_token: "test-token", expires_in: 3600 });
    if (url.includes("Relation_Person") && url.includes("PhoneNumber") && !url.includes("ImportId")) {
      return Response.json({ value: [{ ID: "test-person-id", _Name: "Alex-Test", LastName: "Alex-Test", MobilePhoneNumber: "+31 6 00000000" }] });
    }
    return Response.json({ value: [] });
  };
  const client = new TribeClient({ clientId: "client", clientSecret: "secret", baseUrl: "https://api.tribecrm.nl", writesEnabled: false, fetch: fakeFetch as typeof fetch });

  const candidates = await client.findCandidates(
    { sourceId: "phone-match", message: "Bel Alex-Test op 0600000000", person: { lastName: "Alex-Test" } },
    { emails: [], phoneNumbers: ["0600000000"], urls: [] },
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.id, "test-person-id");
  assert.deepEqual(candidates[0]?.matchedOn, ["phone", "name"]);
});
