/** Human-readable message from an API error thrown by the generated client. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as
    | { data?: { error?: string } | null; message?: string }
    | null;
  return candidate?.data?.error ?? candidate?.message ?? fallback;
}

export function apiErrorStatus(error: unknown): number | undefined {
  return (error as { status?: number } | null)?.status;
}

/** CommaInput already strips separators; still tolerate them for safety. */
export function parseAmount(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseWholeNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Blank strings become null so cleared fields are cleared server-side too. */
export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function numberToInput(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

export const MATTER_TYPES = [
  { value: "remortgage", label: "Remortgage" },
  { value: "purchase", label: "Purchase" },
  { value: "btl", label: "BTL" },
  { value: "bridging", label: "Bridging" },
] as const;

export const CLIENT_TITLES = ["Mr", "Mrs", "Ms", "Miss", "Mx", "Dr", "Prof"] as const;

export const MARITAL_STATUSES = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "civil_partnership", label: "Civil partnership" },
  { value: "cohabiting", label: "Cohabiting" },
  { value: "divorced", label: "Divorced" },
  { value: "separated", label: "Separated" },
  { value: "widowed", label: "Widowed" },
] as const;

export const EMPLOYMENT_STATUSES = [
  { value: "employed", label: "Employed" },
  { value: "self_employed", label: "Self-employed" },
  { value: "company_director", label: "Company director" },
  { value: "contractor", label: "Contractor" },
  { value: "retired", label: "Retired" },
  { value: "not_working", label: "Not currently working" },
  { value: "other", label: "Other" },
] as const;

export const PROPERTY_TYPES = [
  { value: "house", label: "House" },
  { value: "flat", label: "Flat / apartment" },
  { value: "maisonette", label: "Maisonette" },
  { value: "bungalow", label: "Bungalow" },
  { value: "hmo", label: "HMO" },
  { value: "commercial", label: "Commercial" },
  { value: "mixed_use", label: "Mixed use" },
  { value: "land", label: "Land" },
  { value: "other", label: "Other" },
] as const;

export const TENURES = [
  { value: "freehold", label: "Freehold" },
  { value: "leasehold", label: "Leasehold" },
  { value: "share_of_freehold", label: "Share of freehold" },
  { value: "commonhold", label: "Commonhold" },
] as const;

export const EPC_RATINGS = ["A", "B", "C", "D", "E", "F", "G"] as const;

export const OCCUPANCIES = [
  { value: "owner_occupied", label: "Owner occupied" },
  { value: "let", label: "Let to tenants" },
  { value: "vacant", label: "Vacant" },
  { value: "holiday_let", label: "Holiday let" },
  { value: "second_home", label: "Second home" },
] as const;

export const TENANCY_TYPES = [
  { value: "none", label: "No tenancy" },
  { value: "ast", label: "Assured shorthold tenancy" },
  { value: "company_let", label: "Company let" },
  { value: "hmo_rooms", label: "HMO room lets" },
  { value: "commercial_lease", label: "Commercial lease" },
  { value: "regulated", label: "Regulated tenancy" },
] as const;

export const ACCEPTED_DOCUMENT_TYPES =
  ".pdf,.jpg,.jpeg,.png,.tif,.tiff,.doc,.docx,.xls,.xlsx,.txt,.csv";
