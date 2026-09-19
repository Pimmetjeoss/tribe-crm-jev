import type { ExtractedFacts } from "./types.js";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\w)(?:\+|00)?\d[\d .()/-]{7,}\d(?!\w)/g;
const URL = /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/gi;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function extractFacts(message: string): ExtractedFacts {
  return {
    emails: unique((message.match(EMAIL) ?? []).map((value) => value.toLowerCase())),
    phoneNumbers: unique((message.match(PHONE) ?? []).map((value) => value.trim())),
    urls: extractUrls(message),
  };
}

function extractUrls(message: string): string[] {
  const matches = [...message.matchAll(URL)]
    .filter((match) => message[(match.index ?? 0) - 1] !== "@")
    .map((match) => match[0].replace(/[.,;:!?]+$/, ""))
    .map((value) => /^https?:\/\//i.test(value) ? value : `https://${value}`);
  return unique(matches);
}
