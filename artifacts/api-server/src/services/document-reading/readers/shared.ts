import { eq, sql } from "drizzle-orm";
import { clientsTable, db } from "@workspace/db";
import { logActivity } from "../../activities";
import type { DocumentRow } from "../types";

/** Coercion helpers shared by every reader: the model's JSON is never trusted as-is. */
export const round = (value: number) => Math.round(value * 100) / 100;
export const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
export const num = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return round(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    const negative = /^-|^\(.*\)$|\bDR$/i.test(trimmed);
    const parsed = Number(trimmed.replace(/[£$€,\s()A-Za-z-]/g, ""));
    return trimmed !== "" && Number.isFinite(parsed) ? round(negative ? -parsed : parsed) : null;
  }
  return null;
};
export const int = (value: unknown): number | null => {
  const parsed = num(value);
  return parsed == null ? null : Math.round(parsed);
};
export const bool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : typeof value === "string" ? /^(true|yes|y)$/i.test(value) : null;
export const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | null =>
  typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : null;
export const list = <T>(value: unknown, item: (raw: unknown) => T | null): T[] =>
  Array.isArray(value) ? value.map(item).filter((entry): entry is T => entry != null) : [];

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Normalises the date formats seen on UK documents to YYYY-MM-DD:
 * 12/03/1980, 12.03.80, 12 MAR 1980, 12 March 1980, 1980-03-12, MRZ 800312.
 */
export function toIsoDate(value: unknown, mrzCentury?: "past" | "future"): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return valid(match[1]!, match[2]!, match[3]!);
  match = text.match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2,4})$/);
  if (match) return valid(expandYear(match[3]!), match[2]!.padStart(2, "0"), match[1]!.padStart(2, "0"));
  match = text.match(/^(\d{1,2})(?:st|nd|rd|th)?[ \-/]([A-Za-z]{3,9})[ \-/,]+(\d{2,4})$/);
  if (match) {
    const month = MONTHS[match[2]!.slice(0, 4).toLowerCase()] ?? MONTHS[match[2]!.slice(0, 3).toLowerCase()];
    return month ? valid(expandYear(match[3]!), month, match[1]!.padStart(2, "0")) : null;
  }
  match = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (match) {
    const month = MONTHS[match[1]!.slice(0, 3).toLowerCase()];
    return month ? valid(match[3]!, month, match[2]!.padStart(2, "0")) : null;
  }
  match = text.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (match && mrzCentury) {
    const yy = Number(match[1]);
    const thisYear = new Date().getFullYear() % 100;
    const century = mrzCentury === "past" ? (yy > thisYear ? 1900 : 2000) : (yy < thisYear - 5 ? 2100 : 2000);
    return valid(String(century + yy), match[2]!, match[3]!);
  }
  return null;
}

function expandYear(year: string) {
  if (year.length === 4) return year;
  const yy = Number(year);
  return String(yy > new Date().getFullYear() % 100 ? 1900 + yy : 2000 + yy);
}

function valid(year: string, month: string, day: string) {
  const m = Number(month), d = Number(day), y = Number(year);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  return `${year}-${month}-${day}`;
}

export const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

export function normalisePostcode(value: string | null | undefined) {
  if (!value) return null;
  const match = value.toUpperCase().match(POSTCODE);
  return match ? `${match[1]} ${match[2]}` : null;
}

/** Splits "12 High Street, Anytown, AB1 2CD" into the three address fields the client record uses. */
export function splitAddress(value: string | null): { address: string | null; city: string | null; postcode: string | null } {
  if (!value) return { address: null, city: null, postcode: null };
  const postcode = normalisePostcode(value);
  let rest = value.replace(POSTCODE, "").replace(/\s{2,}/g, " ").trim().replace(/[,\s]+$/, "");
  const parts = rest.split(/,|\n/).map((part) => part.trim()).filter(Boolean);
  const city = parts.length > 1 ? parts[parts.length - 1]! : null;
  const address = parts.length > 1 ? parts.slice(0, -1).join(", ") : rest || null;
  return { address: address || null, city, postcode };
}

/** First address-looking block around a postcode in free text (label line + the postcode line). */
export function findAddress(text: string, label?: RegExp): string | null {
  if (label) {
    const match = text.match(new RegExp(`${label.source}\\s*[:\\-]?\\s*([^\\n]{4,120}(?:\\n[^\\n]{2,80}){0,3})`, "i"));
    if (match) {
      const block = match[1]!;
      const upTo = block.search(POSTCODE);
      if (upTo >= 0) {
        const pc = block.slice(upTo).match(POSTCODE)![0];
        return block.slice(0, upTo + pc.length).replace(/\n/g, ", ").replace(/,\s*,/g, ",").trim();
      }
    }
  }
  const lines = text.split("\n");
  const index = lines.findIndex((line) => POSTCODE.test(line));
  if (index < 0) return null;
  const start = Math.max(0, index - 2);
  const block = lines.slice(start, index + 1).map((line) => line.trim()).filter((line) => line && line.length < 80);
  return block.join(", ").replace(/,\s*,/g, ",");
}

export function matchAll(text: string, pattern: RegExp) {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
}

/** Money on a line, the last amount wins (bank statements print amount then balance). */
export const MONEY_RE = /-?£?\s?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|-?£?\s?\d+\.\d{2}/g;

export function amountsOn(line: string): number[] {
  return (line.match(MONEY_RE) ?? []).map((raw) => num(raw)).filter((value): value is number => value != null);
}

export const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
};

export const sum = (values: number[]) => round(values.reduce((total, value) => total + value, 0));

export const FIELD_LABELS: Record<string, string> = {
  title: "title", dateOfBirth: "date of birth", nationality: "nationality",
  currentAddress: "current address", currentAddressCity: "current address", currentAddressPostcode: "current address",
  previousAddress: "previous address", previousAddressCity: "previous address", previousAddressPostcode: "previous address",
  employmentStatus: "employment status", employerName: "employer", jobTitle: "job title",
  annualIncome: "annual income", monthlyCommitments: "monthly commitments", creditHistoryNotes: "credit history",
};
export const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

type ClientPatch = Partial<Pick<typeof clientsTable.$inferInsert,
  | "title" | "dateOfBirth" | "nationality"
  | "currentAddress" | "currentAddressCity" | "currentAddressPostcode"
  | "previousAddress" | "previousAddressCity" | "previousAddressPostcode"
  | "employmentStatus" | "employerName" | "jobTitle" | "annualIncome" | "monthlyCommitments" | "creditHistoryNotes">>;

/**
 * Writes `candidates` onto the client, but only into fields that are still
 * empty — a reading never overwrites what staff typed. Address fields are
 * treated as one unit (street/city/postcode fill together when the street is empty).
 * Returns the fields it filled and logs one activity for them.
 */
export async function fillEmptyClientFields(
  document: DocumentRow,
  candidates: ClientPatch,
  actorName: string,
  activityTitle: string,
  summary: string,
): Promise<string[]> {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, document.clientId));
  if (!client) return [];
  const patch: ClientPatch = {};
  const applied: string[] = [];
  const empty = (value: unknown) => value == null || value === "";
  for (const [key, value] of Object.entries(candidates) as Array<[keyof ClientPatch, ClientPatch[keyof ClientPatch]]>) {
    if (value == null || value === "") continue;
    // City/postcode ride with their street line so a half-filled address is never mixed from two sources.
    const unit = key.startsWith("currentAddress") ? "currentAddress" : key.startsWith("previousAddress") ? "previousAddress" : key;
    if (!empty(client[unit as keyof typeof client])) continue;
    if (unit !== key && !empty(client[key])) continue;
    (patch as Record<string, unknown>)[key] = value;
    applied.push(key);
  }
  if (applied.length === 0) return applied;
  // Readers run concurrently (one per upload), so the list is appended in SQL rather than read-modify-written.
  await db.update(clientsTable)
    .set({
      ...patch,
      documentFilledFields: sql`(select coalesce(jsonb_agg(distinct value), '[]'::jsonb) from jsonb_array_elements(coalesce(${clientsTable.documentFilledFields}, '[]'::jsonb) || ${JSON.stringify(applied)}::jsonb) as value)`,
    })
    .where(eq(clientsTable.id, client.id));
  const labels = [...new Set(applied.map(fieldLabel))];
  await logActivity({
    kind: "document",
    title: activityTitle,
    detail: `${document.name}: ${summary} — filled ${labels.join(", ")} for ${client.name}`,
    actorName,
    entityType: "document",
    entityId: document.id,
  });
  return applied;
}
