export type ImportKind = "person" | "organization" | "contact" | "lead" | "opportunity";

export function sourceImportId(sourceId: string, kind: ImportKind): string {
  return `tribe-jev:${sourceId.trim()}:${kind}`;
}
