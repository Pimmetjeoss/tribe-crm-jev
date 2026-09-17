import assert from "node:assert/strict";
import test from "node:test";
import { extractFacts } from "../src/extract.js";

test("extractFacts returns unique normalized source values", () => {
  const facts = extractFacts("Mail TEST@Example.com or test@example.com, call +31 6 12345678, see https://example.com/demo");
  assert.deepEqual(facts.emails, ["test@example.com"]);
  assert.deepEqual(facts.phoneNumbers, ["+31 6 12345678"]);
  assert.deepEqual(facts.urls, ["https://example.com/demo"]);
});
