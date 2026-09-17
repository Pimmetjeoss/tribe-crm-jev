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
