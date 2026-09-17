import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { demoGroups, demoQuestionMeta, judgeDemoText } from "./demo-judgments.js";

const port = positiveInteger(process.env.DEMO_PORT, 4173);
const maxCalls = positiveInteger(process.env.DEMO_MAX_CALLS, 250);
const publicDir = join(import.meta.dirname, "..", "public");
const ledger = { calls: 0, inputTokens: 0, outputTokens: 0 };

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
  console.log(`Demo budget: ${maxCalls} TypeSafe calls; Tribe writes are not available in this server.`);
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

function contentType(path: string): string {
  return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" } as Record<string, string>)[extname(path)] ?? "application/octet-stream";
}
