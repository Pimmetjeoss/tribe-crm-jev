# Tribe CRM × Jev

A safe, Jev-minded lead-intake pilot for Tribe CRM. It demonstrates how [TypeSafe Jev](https://typesafe.ai/) can interpret unstructured lead messages while deterministic TypeScript controls CRM lookups, confidence gates, idempotency, and writes.

## How it works

1. deterministic code extracts literal values and queries Tribe candidates;
2. Jev makes narrow typed judgments (`Choice`, `Noul`, and `Score`);
3. code applies explicit thresholds and builds a write plan;
4. dry-run is the default; writes require two separate opt-ins.

## Setup

```powershell
npm install
Copy-Item .env.example .env
```

Add your own credentials to `.env` (which is ignored by Git):

```dotenv
TYPESAFE_API_KEY=...
TRIBE_CLIENT_ID=...
TRIBE_CLIENT_SECRET=...
TRIBE_BASE_URL=https://api.tribecrm.nl
TRIBE_ENABLE_WRITES=false
```

## Run safely

```powershell
npm run demo
```

For the browser-based live demo with 16 CRM judgments in one TypeSafe call:

```powershell
npm run demo:live
```

Open `http://127.0.0.1:4173`. The browser never receives the TypeSafe key and this demo server exposes no Tribe write endpoint. Typing is coalesced into a single in-flight request plus the newest queued text, so live results keep moving without spending calls on browser-aborted responses. Calls are capped by `DEMO_MAX_CALLS` (default: `250`); the in-memory demo ledger resets when the server restarts.

Without Tribe credentials this still calls Jev and produces a dry-run plan. With credentials it queries narrow name candidates, shortlists exact e-mail/name matches in code, and lets Jev judge any remaining identity ambiguity.

CLI output hides candidate CRM details by default. Add `--verbose` only when inspecting output locally.

To allow actual creation of a Person or Organization, both controls must be present:

```dotenv
TRIBE_ENABLE_WRITES=true
```

```powershell
npm run apply
```

The pilot does not mutate semantic matches. In apply mode it resolves or creates the person and organization first, then executes the contact relationship, lead relationship, and opportunity in dependency order. Every created object receives a deterministic `ImportId` derived from the source ID. Person, organization, contact, lead, and opportunity creation first query that key and return the existing record when present; multiple matches stop as an idempotency conflict.

Only use apply mode against an environment where you are authorized to create records. Keep `TRIBE_ENABLE_WRITES=false` for the live browser demo and during development.

## Verify

```powershell
npm run check
npm test
```

## Status

This is an independent experimental integration, not an official Tribe CRM or TypeSafe product. Always verify the current [Tribe CRM API documentation](https://developer.tribecrm.nl/) and [TypeSafe documentation](https://docs.typesafe.ai/) before production use.
