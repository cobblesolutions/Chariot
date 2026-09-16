import type { PropertyInput } from "@workspace/api-client-react";
import {
  MATTER_TYPES,
  OCCUPANCIES,
  PROPERTY_TYPES,
  TENANCY_TYPES,
  TENURES,
} from "./utils";

/** RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF, blank lines skipped. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushRow = () => {
    row.push(field);
    field = "";
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

type PropertyKey = keyof Omit<PropertyInput, "clientId" | "assignedUserId">;

const HEADER_ALIASES: Record<string, PropertyKey> = {
  address: "address",
  propertyaddress: "address",
  fulladdress: "address",
  street: "address",
  addressline1: "address",
  city: "city",
  town: "city",
  posttown: "city",
  postcode: "postcode",
  postalcode: "postcode",
  zip: "postcode",
  mattertype: "matterType",
  matter: "matterType",
  value: "value",
  propertyvalue: "value",
  estimatedvalue: "value",
  valuation: "value",
  loanamount: "loanAmount",
  loan: "loanAmount",
  loanrequired: "loanAmount",
  mortgageamount: "loanAmount",
  rent: "rent",
  expectedrent: "rent",
  monthlyrent: "rent",
  rentpcm: "rent",
  rentalincome: "rent",
  rentalincomepcm: "rent",
  rentalincomemonthly: "rent",
  gdv: "gdv",
  grossdevelopmentvalue: "gdv",
  propertytype: "propertyType",
  tenure: "tenure",
  leaseyearsremaining: "leaseYearsRemaining",
  leaseyears: "leaseYearsRemaining",
  leaseremaining: "leaseYearsRemaining",
  bedrooms: "bedrooms",
  beds: "bedrooms",
  yearbuilt: "yearBuilt",
  built: "yearBuilt",
  epc: "epcRating",
  epcrating: "epcRating",
  occupancy: "occupancy",
  tenancytype: "tenancyType",
  tenancy: "tenancyType",
  purchaseprice: "purchasePrice",
  pricepaid: "purchasePrice",
  purchasedate: "purchaseDate",
  datepurchased: "purchaseDate",
  currentlender: "currentLender",
  lender: "currentLender",
  existinglender: "currentLender",
  currentrate: "currentRatePct",
  currentratepct: "currentRatePct",
  rate: "currentRatePct",
  interestrate: "currentRatePct",
  currentbalance: "currentBalance",
  outstandingbalance: "currentBalance",
  balance: "currentBalance",
  mortgagebalance: "currentBalance",
  currentrateenddate: "currentRateEndDate",
  rateenddate: "currentRateEndDate",
  rateend: "currentRateEndDate",
  dealenddate: "currentRateEndDate",
  notes: "notes",
  comments: "notes",
};

/** Header row for the downloadable template, in a sensible order. */
export const TEMPLATE_HEADERS = [
  "address",
  "city",
  "postcode",
  "matter_type",
  "value",
  "loan_amount",
  "rent",
  "gdv",
  "property_type",
  "tenure",
  "lease_years_remaining",
  "bedrooms",
  "year_built",
  "epc_rating",
  "occupancy",
  "tenancy_type",
  "purchase_price",
  "purchase_date",
  "current_lender",
  "current_rate_pct",
  "current_balance",
  "current_rate_end_date",
  "notes",
];

export const TEMPLATE_EXAMPLE_ROW = [
  "12 Example Street, London, N1 1AA",
  "btl",
  "350000",
  "250000",
  "1500",
  "",
  "flat",
  "leasehold",
  "95",
  "2",
  "1990",
  "C",
  "let",
  "ast",
  "300000",
  "2019-06-01",
  "Example Bank",
  "4.25",
  "240000",
  "2027-03-31",
  "",
];

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseMoney(value: string): number | null | "invalid" {
  const cleaned = value.replace(/[£,\s]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : "invalid";
}

function parseInteger(value: string): number | null | "invalid" {
  const cleaned = value.replace(/[,\s]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isInteger(parsed) ? parsed : "invalid";
}

/** Accepts YYYY-MM-DD or DD/MM/YYYY and returns YYYY-MM-DD. */
function parseDate(value: string): string | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const uk = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (uk) {
    const [, day, month, year] = uk;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return "invalid";
}

function matchOption(
  value: string,
  options: ReadonlyArray<{ value: string; label: string }>,
  aliases: Record<string, string> = {},
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const key = normalizeKey(trimmed);
  if (aliases[key]) return aliases[key];
  const hit = options.find(
    (option) =>
      normalizeKey(option.value) === key || normalizeKey(option.label) === key,
  );
  return hit ? hit.value : trimmed.toLowerCase().replace(/\s+/g, "_");
}

const MATTER_ALIASES: Record<string, string> = {
  buytolet: "btl",
  btl: "btl",
  remo: "remortgage",
  remortgage: "remortgage",
  purchase: "purchase",
  buy: "purchase",
  bridging: "bridging",
  bridge: "bridging",
};

export interface ParsedPropertyRow {
  /** 1-based line number in the file (header is line 1). */
  line: number;
  input: PropertyInput | null;
  errors: string[];
  address: string;
  matterType: string;
  value: number | null;
  loanAmount: number | null;
}

export interface ParsedPropertyCsv {
  rows: ParsedPropertyRow[];
  recognisedColumns: PropertyKey[];
  ignoredColumns: string[];
}

/** Turn CSV text into validated property inputs, keeping per-row errors. */
export function parsePropertyCsv(text: string): ParsedPropertyCsv {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], recognisedColumns: [], ignoredColumns: [] };
  const [header, ...body] = table;
  const columns = header.map((name) => HEADER_ALIASES[normalizeKey(name)] ?? null);
  const recognisedColumns = columns.filter((key): key is PropertyKey => key !== null);
  const ignoredColumns = header.filter((_, index) => columns[index] === null && header[index].trim());

  const rows: ParsedPropertyRow[] = body.map((cells, index) => {
    const get = (key: PropertyKey) => {
      const position = columns.indexOf(key);
      return position === -1 ? "" : (cells[position] ?? "").trim();
    };
    const errors: string[] = [];
    const address = get("address");
    if (!address) errors.push("Address is required");

    const value = parseMoney(get("value"));
    if (value === "invalid") errors.push("Value is not a number");
    if (value === null) errors.push("Value is required");
    const loanAmount = parseMoney(get("loanAmount"));
    if (loanAmount === "invalid") errors.push("Loan amount is not a number");
    if (loanAmount === null) errors.push("Loan amount is required");

    const matterType = matchOption(get("matterType"), MATTER_TYPES, MATTER_ALIASES) ?? "remortgage";

    const optionalMoney = (key: PropertyKey, label: string) => {
      const parsed = parseMoney(get(key));
      if (parsed === "invalid") errors.push(`${label} is not a number`);
      return parsed === "invalid" ? null : parsed;
    };
    const optionalInt = (key: PropertyKey, label: string) => {
      const parsed = parseInteger(get(key));
      if (parsed === "invalid") errors.push(`${label} is not a whole number`);
      return parsed === "invalid" ? null : parsed;
    };
    const optionalDate = (key: PropertyKey, label: string) => {
      const parsed = parseDate(get(key));
      if (parsed === "invalid") errors.push(`${label} must be YYYY-MM-DD or DD/MM/YYYY`);
      return parsed === "invalid" ? null : parsed;
    };

    const rent = optionalMoney("rent", "Rent");
    const gdv = optionalMoney("gdv", "GDV");
    const purchasePrice = optionalMoney("purchasePrice", "Purchase price");
    const currentBalance = optionalMoney("currentBalance", "Current balance");
    const currentRatePct = optionalMoney("currentRatePct", "Current rate");
    const leaseYearsRemaining = optionalInt("leaseYearsRemaining", "Lease years");
    const bedrooms = optionalInt("bedrooms", "Bedrooms");
    const yearBuilt = optionalInt("yearBuilt", "Year built");
    const purchaseDate = optionalDate("purchaseDate", "Purchase date");
    const currentRateEndDate = optionalDate("currentRateEndDate", "Rate end date");

    const epc = get("epcRating").toUpperCase();
    const input: PropertyInput | null =
      errors.length > 0 || value === null || loanAmount === null || typeof value !== "number" || typeof loanAmount !== "number"
        ? null
        : {
            address,
            city: get("city") || null,
            postcode: get("postcode").toUpperCase() || null,
            matterType,
            value,
            loanAmount,
            rent,
            gdv,
            propertyType: matchOption(get("propertyType"), PROPERTY_TYPES),
            tenure: matchOption(get("tenure"), TENURES),
            leaseYearsRemaining,
            bedrooms,
            yearBuilt,
            epcRating: /^[A-G]$/.test(epc) ? epc : null,
            occupancy: matchOption(get("occupancy"), OCCUPANCIES),
            tenancyType: matchOption(get("tenancyType"), TENANCY_TYPES),
            purchasePrice,
            purchaseDate,
            currentLender: get("currentLender") || null,
            currentRatePct,
            currentBalance,
            currentRateEndDate,
            notes: get("notes") || null,
          };

    return {
      line: index + 2,
      input,
      errors,
      address,
      matterType,
      value: typeof value === "number" ? value : null,
      loanAmount: typeof loanAmount === "number" ? loanAmount : null,
    };
  });

  return { rows, recognisedColumns, ignoredColumns };
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildTemplateCsv() {
  return [TEMPLATE_HEADERS, TEMPLATE_EXAMPLE_ROW]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
