import type { clientsTable, propertiesTable } from "@workspace/db";

/**
 * Extended ("advanced") client and property fields. Kept in one place so the
 * create, update and read handlers all agree on the field list.
 */
export const CLIENT_PROFILE_KEYS = [
  "title",
  "dateOfBirth",
  "nationality",
  "maritalStatus",
  "dependants",
  "currentAddress",
  "currentAddressCity",
  "currentAddressPostcode",
  "previousAddress",
  "previousAddressCity",
  "previousAddressPostcode",
  "alternativePhone",
  "employmentStatus",
  "employerName",
  "jobTitle",
  "annualIncome",
  "otherIncome",
  "monthlyCommitments",
  "creditHistoryNotes",
  "companyNumber",
  "companyRegisteredAddress",
  "companyRegisteredCity",
  "companyRegisteredPostcode",
  "notes",
] as const;

export const PROPERTY_DETAIL_KEYS = [
  "city",
  "postcode",
  "propertyType",
  "tenure",
  "leaseYearsRemaining",
  "bedrooms",
  "yearBuilt",
  "epcRating",
  "occupancy",
  "tenancyType",
  "purchasePrice",
  "purchaseDate",
  "currentLender",
  "currentRatePct",
  "currentBalance",
  "currentRateEndDate",
  "notes",
] as const;

type ClientRow = typeof clientsTable.$inferSelect;
type PropertyRow = typeof propertiesTable.$inferSelect;
type ClientProfileKey = (typeof CLIENT_PROFILE_KEYS)[number];
type PropertyDetailKey = (typeof PROPERTY_DETAIL_KEYS)[number];

/** Response view of the extended client fields (null when unset). */
export function clientProfile(row: ClientRow): Pick<ClientRow, ClientProfileKey> {
  const out = {} as Record<ClientProfileKey, unknown>;
  for (const key of CLIENT_PROFILE_KEYS) out[key] = row[key] ?? null;
  return out as Pick<ClientRow, ClientProfileKey>;
}

/** Response view of the extended property fields (null when unset). */
export function propertyDetails(row: PropertyRow): Pick<PropertyRow, PropertyDetailKey> {
  const out = {} as Record<PropertyDetailKey, unknown>;
  for (const key of PROPERTY_DETAIL_KEYS) out[key] = row[key] ?? null;
  return out as Pick<PropertyRow, PropertyDetailKey>;
}

/**
 * Only the keys the caller actually sent. Missing keys stay untouched on
 * update; explicit nulls clear the value. Empty strings are treated as clears
 * so a blanked form field does not persist "".
 */
export function pickProvided<T extends Record<string, unknown>, K extends keyof T & string>(
  body: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    const value = body[key];
    if (value === undefined) continue;
    out[key] = (typeof value === "string" && value.trim() === "" ? null : value) as T[K];
  }
  return out;
}
