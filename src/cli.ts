import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { JevDecisionEngine } from "./jev.js";
import { processLead } from "./pipeline.js";
import { TribeClient } from "./tribe-client.js";
import type { LeadInput } from "./types.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const inputPath = args.find((arg) => !arg.startsWith("--"));

if (!inputPath) {
  throw new Error("Usage: npm run demo -- <lead.json> [--apply]");
}

const input = JSON.parse(await readFile(resolve(inputPath), "utf8")) as LeadInput;
const config = loadConfig();
const tribe = config.tribe ? new TribeClient(config.tribe) : undefined;
const result = await processLead(input, {
  decisionEngine: new JevDecisionEngine(),
  ...(tribe ? { tribe } : {}),
  apply,
});

if (args.includes("--verbose")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const candidateSummary = result.candidates.reduce<Record<string, number>>((summary, candidate) => {
    summary[candidate.entitySet] = (summary[candidate.entitySet] ?? 0) + 1;
    return summary;
  }, {});
  const safeActions = result.actions.map((action) => action.type === "link_existing"
    ? { ...action, id: "[redacted; use --verbose locally to inspect]" }
    : action);
  const { candidates: _candidates, actions: _actions, ...safeResult } = result;
  console.log(JSON.stringify({ ...safeResult, candidateSummary, actions: safeActions }, null, 2));
}
