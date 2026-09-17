import type { ExtractedFacts } from "./types.js";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\w)(?:\+|00)?\d[\d .()/-]{7,}\d(?!\w)/g;
const URL = /\bhttps?:\/\/[^\s<>"']+/gi;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function extractFacts(message: string): ExtractedFacts {
  return {
    emails: unique((message.match(EMAIL) ?? []).map((value) => value.toLowerCase())),
    phoneNumbers: unique((message.match(PHONE) ?? []).map((value) => value.trim())),
    urls: unique(message.match(URL) ?? []),
  };
}
