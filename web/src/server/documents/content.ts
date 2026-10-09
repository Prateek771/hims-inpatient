import "server-only";
import { createHash } from "node:crypto";
import { DomainError } from "../contracts";
/** Stable object-key ordering; array order is part of the captured source contract. */
export function canonicalJSON(value: unknown): string {
  const normalized = JSON.parse(JSON.stringify(value, (_key, v) => typeof v === "bigint" ? v.toString() : v));
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, item]) => [k, sort(item)])) : v;
  return JSON.stringify(sort(normalized));
}
export const snapshotHash = (value: unknown) => createHash("sha256").update(canonicalJSON(value)).digest("hex");
export const documentFontFamily = (text: string) => /[\u0900-\u097f\ua8e0-\ua8ff]/u.test(text) ? "DocumentDevanagari" : "DocumentSans";
export const documentTextParts = (text: string) => text.match(/[\u0900-\u097f\ua8e0-\ua8ff\u200c\u200d]+|[^\u0900-\u097f\ua8e0-\ua8ff\u200c\u200d]+/gu) ?? [];
export const documentLimits = { charges: 50_000, statementLines: 2500, sourceCharacters: 64_000_000, printableCharacters: 500_000, rowCharacters: 1600, pages: 200, bytes: 10_485_760 } as const;
export function assertDocumentSourceSize(source: { money: { bill: { charges: readonly unknown[] }; statement?: { lines: readonly unknown[] } } } & Record<string, unknown>) {
  if (source.money.bill.charges.length > documentLimits.charges || (source.money.statement?.lines.length ?? 0) > documentLimits.statementLines || canonicalJSON(source).length > documentLimits.sourceCharacters) throw new DomainError("PRECONDITION", "Complete discharge export supports at most 50000 source charges, 2500 statement lines and 64000000 source characters; source records are retained without truncation");
}
