import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { loadConfig } from "./config.js";
import { demoGroups, demoQuestionMeta, judgeDemoText } from "./demo-judgments.js";
import { JevDecisionEngine } from "./jev.js";
import { processLead } from "./pipeline.js";
import { TribeClient } from "./tribe-client.js";
import type { LeadInput } from "./types.js";

const port = positiveInteger(process.env.DEMO_PORT, 4173);
const maxCalls = positiveInteger(process.env.DEMO_MAX_CALLS, 250);
const publicDir = join(import.meta.dirname, "..", "public");
const ledger = { calls: 0, inputTokens: 0, outputTokens: 0 };

function configuredTribe(): TribeClient | undefined {
  const config = loadConfig();
  return config.tribe ? new TribeClient(config.tribe) : undefined;
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/meta") {
      return json(response, 200, {
        groups: demoGroups,
        questions: demoQuestionMeta,
        configured: Boolean(process.env.TYPESAFE_API_KEY?.trim()),
        budget: budgetState(),
      });
    }
    if (request.method === "GET" && request.url === "/api/crm/status") {
      const config = loadConfig();
      return json(response, 200, {
        tribeConfigured: Boolean(config.tribe),
        typeSafeConfigured: Boolean(process.env.TYPESAFE_API_KEY?.trim()),
        writesEnabled: config.tribe?.writesEnabled ?? false,
        baseUrl: config.tribe?.baseUrl ?? null,
      });
    }
    if (request.method === "POST" && request.url === "/api/crm/connectivity") {
      const tribe = configuredTribe();
      if (!tribe) return json(response, 400, { error: "Tribe-credentials ontbreken in .env." });
      const started = performance.now();
      const phases = await tribe.opportunityPhases();
      return json(response, 200, {
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        qualificationPhase: phases.find((phase) => phase.code === "Qualification") ?? null,
        phaseCount: phases.length,
      });
    }
    if (request.method === "POST" && request.url === "/api/crm/verify") {
      const tribe = configuredTribe();
      if (!tribe) return json(response, 400, { error: "Tribe-credentials ontbreken in .env." });
      const body = await readJsonBody(request);
      const sourceId = requiredString(body.sourceId, "sourceId");
      return json(response, 200, { sourceId, records: await verifySource(tribe, sourceId), checkedAt: new Date().toISOString() });
    }
    if (request.method === "POST" && request.url === "/api/crm/run") {
      const tribe = configuredTribe();
      if (!tribe) return json(response, 400, { error: "Tribe-credentials ontbreken in .env." });
      if (!process.env.TYPESAFE_API_KEY?.trim()) return json(response, 400, { error: "TYPESAFE_API_KEY ontbreekt in .env." });
      const body = await readJsonBody(request);
      const lead = leadInput(body.lead);
      const apply = body.apply === true;
      const started = performance.now();
      const result = await processLead(lead, { decisionEngine: new JevDecisionEngine(), tribe, apply });
      return json(response, 200, {
        result,
        records: await verifySource(tribe, lead.sourceId),
        latencyMs: Math.round(performance.now() - started),
        ranAt: new Date().toISOString(),
      });
    }
    if (request.method === "POST" && request.url === "/api/judge") {
      if (ledger.calls >= maxCalls) return json(response, 429, { error: "Demo budget spent.", budget: budgetState() });
      const body = await readJsonBody(request);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return json(response, 400, { error: "Voer eerst tekst in.", budget: budgetState() });
      if (text.length > 2_000) return json(response, 413, { error: "De demo accepteert maximaal 2.000 tekens.", budget: budgetState() });

      // Reserve the call before awaiting so simultaneous visitors cannot exceed the cap.
      ledger.calls += 1;
      try {
        const started = performance.now();
        const result = await judgeDemoText(text);
        ledger.inputTokens += result.usage.input_tokens;
        ledger.outputTokens += result.usage.output_tokens;
        return json(response, 200, {
          ...result,
          latencyMs: Math.round(performance.now() - started),
          budget: budgetState(),
        });
      } catch (error) {
        ledger.calls -= 1;
        throw error;
      }
    }
    if (request.method === "GET") return serveStatic(request.url ?? "/", response);
    return json(response, 405, { error: "Method not allowed." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Onbekende fout";
    return json(response, 500, { error: message, budget: budgetState() });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Tribe × Jev live demo: http://127.0.0.1:${port}`);
  console.log(`Demo budget: ${maxCalls} TypeSafe calls; CRM dashboard: http://127.0.0.1:${port}/crm.html`);
});

function budgetState() {
  return {
    calls: ledger.calls,
    maxCalls,
    remainingCalls: Math.max(0, maxCalls - ledger.calls),
    inputTokens: ledger.inputTokens,
    outputTokens: ledger.outputTokens,
    exhausted: ledger.calls >= maxCalls,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 25_000) throw new Error("Request body is te groot.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("Ongeldige JSON request body.");
  }
}

async function serveStatic(rawUrl: string, response: ServerResponse): Promise<void> {
  const pathname = new URL(rawUrl, "http://localhost").pathname;
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return json(response, 403, { error: "Forbidden." });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    return json(response, 404, { error: "Not found." });
  }
  response.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
  });
  createReadStream(filePath).pipe(response);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is verplicht.`);
  return value.trim();
}

function leadInput(value: unknown): LeadInput {
  if (!value || typeof value !== "object") throw new Error("lead is verplicht.");
  const raw = value as Record<string, unknown>;
  const person = raw.person && typeof raw.person === "object" ? raw.person as LeadInput["person"] : undefined;
  const organization = raw.organization && typeof raw.organization === "object" ? raw.organization as LeadInput["organization"] : undefined;
  return {
    sourceId: requiredString(raw.sourceId, "sourceId"),
    message: requiredString(raw.message, "message"),
    ...(typeof raw.receivedAt === "string" ? { receivedAt: raw.receivedAt } : {}),
    ...(person ? { person } : {}),
    ...(organization ? { organization } : {}),
  };
}

async function verifySource(tribe: TribeClient, sourceId: string) {
  const targets = [
    ["person", "Relation_Person"],
    ["organization", "Relation_Organization"],
    ["contact", "Relationship_Person_Contact_Standard"],
    ["lead", "Relationship_Organization_CommercialRelationship_Lead"],
    ["opportunity", "Activity_SalesOpportunity"],
    ["call", "Activity_Call"],
  ] as const;
  return Promise.all(targets.map(async ([kind, entitySet]) => {
    const importId = `tribe-jev:${sourceId}:${kind}`;
    const matches = kind === "person" || kind === "organization" || kind === "opportunity"
      ? await tribe.findByImportIdWithNotes(entitySet, importId)
      : await tribe.findByImportId(entitySet, importId);
    return {
      kind,
      entitySet,
      importId,
      status: matches.length === 0 ? "missing" : matches.length === 1 ? "found" : "conflict",
      matches,
    };
  }));
}

function contentType(path: string): string {
  return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" } as Record<string, string>)[extname(path)] ?? "application/octet-stream";
}
