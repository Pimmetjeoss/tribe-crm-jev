import assert from "node:assert/strict";
import test from "node:test";
import { demoQuestionMeta, demoQuestions } from "../src/demo-judgments.js";
import { identityCandidates } from "../src/jev.js";

test("live demo batches exactly sixteen typed CRM judgments", () => {
  assert.equal(demoQuestionMeta.length, 16);
  assert.equal(Object.keys(demoQuestions).length, 16);
  assert.deepEqual(new Set(Object.values(demoQuestions).map((question) => question.type)), new Set(["noul", "choice", "score"]));
  assert.deepEqual(demoQuestionMeta.map((item) => item.id), Object.keys(demoQuestions));
});

test("identity candidates preserve source-backed person and organization names", () => {
  const candidates = identityCandidates("Hallo, ik ben Noor de Vries van Studio Kompas Test.");
  assert.ok(candidates.includes("Noor de Vries"));
  assert.ok(candidates.includes("Studio Kompas Test"));
});

test("identity candidates include lowercase names and single-name contacts", () => {
  const candidates = identityCandidates("Maak voor alex de proef een nieuw contact aan, namelijk sam.");
  assert.ok(candidates.includes("alex de proef"));
  assert.ok(candidates.includes("sam"));
});
