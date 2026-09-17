import assert from "node:assert/strict";
import test from "node:test";
import { demoQuestionMeta, demoQuestions } from "../src/demo-judgments.js";

test("live demo batches exactly sixteen typed CRM judgments", () => {
  assert.equal(demoQuestionMeta.length, 16);
  assert.equal(Object.keys(demoQuestions).length, 16);
  assert.deepEqual(new Set(Object.values(demoQuestions).map((question) => question.type)), new Set(["noul", "choice", "score"]));
  assert.deepEqual(demoQuestionMeta.map((item) => item.id), Object.keys(demoQuestions));
});
