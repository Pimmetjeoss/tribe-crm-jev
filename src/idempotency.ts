export type ImportKind = "person" | "organization" | "contact" | "lead" | "opportunity" | "call" | "person_note" | "organization_note" | "opportunity_note";

export function sourceImportId(sourceId: string, kind: ImportKind): string {
  return `tribe-jev:${sourceId.trim()}:${kind}`;
}
