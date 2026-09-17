import { eq } from "drizzle-orm";
import { clientsTable, db, propertiesTable } from "@workspace/db";
import { logActivity } from "../../activities";
import { createAssignmentTask, resolveAssignee } from "../../assignment";
import { logger } from "../../../lib/logger";
import { formatAddress } from "../../../lib/address";
import type { DocumentReader, DocumentRow } from "../types";
import { POSTCODE, int, list, normalisePostcode, num, oneOf, splitAddress, str, sum, toIsoDate } from "./shared";

const PROPERTY_TYPES = ["house", "flat", "maisonette", "bungalow", "hmo", "commercial", "mixed_use", "land", "other"] as const;
const TENANCY_TYPES = ["none", "ast", "company_let", "hmo_rooms", "commercial_lease", "regulated"] as const;
const TENURES = ["freehold", "leasehold", "share_of_freehold", "commonhold"] as const;
const CONFIDENCE = ["high", "medium", "low"] as const;

export interface PortfolioProperty {
  address: string;
  city: string | null;
  postcode: string | null;
  propertyType: (typeof PROPERTY_TYPES)[number] | null;
  tenure: (typeof TENURES)[number] | null;
  bedrooms: number | null;
  value: number | null;
  purchasePrice: number | null;
  purchaseDate: string | null;
  currentLender: string | null;
  currentBalance: number | null;
  currentRatePct: number | null;
  currentRateEndDate: string | null;
  monthlyPayment: number | null;
  rent: number | null;
  tenancyType: (typeof TENANCY_TYPES)[number] | null;
  notes: string | null;
}

/** What the portfolio reader extracts from a client's schedule of properties. */
export interface PortfolioReading extends Record<string, unknown> {
  properties: PortfolioProperty[];
  totalValue: number | null;
  totalBorrowing: number | null;
  totalMonthlyRent: number | null;
  /** Ids of the property records created from this reading (filled by apply). */
  createdPropertyIds: number[];
  skipped: number;
  confidence: (typeof CONFIDENCE)[number] | null;
  notes: string | null;
}

const EMPTY: PortfolioReading = {
  properties: [], totalValue: null, totalBorrowing: null, totalMonthlyRent: null, createdPropertyIds: [], skipped: 0, confidence: null, notes: null,
};

const SYSTEM_INSTRUCTION = `You read a landlord's property portfolio schedule (a spreadsheet, table or list of properties they own, often with mortgage details) for a UK mortgage broker and return JSON only.
Return an object with exactly these keys:
{ "properties", "totalValue", "totalBorrowing", "totalMonthlyRent", "confidence", "notes" }
"properties" is a list, one per property, each with exactly these keys:
{ "address", "city", "postcode", "propertyType", "tenure", "bedrooms", "value", "purchasePrice", "purchaseDate", "currentLender", "currentBalance", "currentRatePct", "currentRateEndDate", "monthlyPayment", "rent", "tenancyType", "notes" }
Rules: null for anything not given; amounts are plain numbers in pounds; rent is per month (convert annual rent ÷ 12); rates are percentages as plain numbers; dates are ISO YYYY-MM-DD.
"address" is the street line only; put the town in "city" and the postcode in "postcode". "propertyType" is one of ${PROPERTY_TYPES.map((t) => `"${t}"`).join(", ")}; "tenure" one of ${TENURES.map((t) => `"${t}"`).join(", ")}; "tenancyType" one of ${TENANCY_TYPES.map((t) => `"${t}"`).join(", ")} (an ordinary let is "ast"). "currentLender" is the mortgage lender, "currentBalance" the outstanding mortgage, "currentRateEndDate" when the fixed/discount rate ends.
Skip total rows. "totalValue", "totalBorrowing" and "totalMonthlyRent" are the sums across the properties. "confidence" is "high", "medium" or "low". "notes" is one short sentence, or null.`;

const property = (raw: unknown): PortfolioProperty | null => {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const address = str(item.address);
  if (!address) return null;
  return {
    address,
    city: str(item.city),
    postcode: normalisePostcode(str(item.postcode)) ?? str(item.postcode),
    propertyType: oneOf(item.propertyType, PROPERTY_TYPES),
    tenure: oneOf(item.tenure, TENURES),
    bedrooms: int(item.bedrooms),
    value: num(item.value),
    purchasePrice: num(item.purchasePrice),
    purchaseDate: toIsoDate(item.purchaseDate),
    currentLender: str(item.currentLender),
    currentBalance: num(item.currentBalance),
    currentRatePct: num(item.currentRatePct),
    currentRateEndDate: toIsoDate(item.currentRateEndDate),
    monthlyPayment: num(item.monthlyPayment),
    rent: num(item.rent),
    tenancyType: oneOf(item.tenancyType, TENANCY_TYPES),
    notes: str(item.notes),
  };
};

function normalise(raw: unknown): PortfolioReading {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return derive({
    properties: list(data.properties, property),
    totalValue: num(data.totalValue),
    totalBorrowing: num(data.totalBorrowing),
    totalMonthlyRent: num(data.totalMonthlyRent),
    createdPropertyIds: [],
    skipped: 0,
    confidence: oneOf(data.confidence, CONFIDENCE),
    notes: str(data.notes),
  });
}

function derive(reading: PortfolioReading) {
  const total = (pick: (item: PortfolioProperty) => number | null) => {
    const values = reading.properties.map(pick).filter((value): value is number => value != null);
    return values.length > 0 ? sum(values) : null;
  };
  reading.totalValue ??= total((item) => item.value);
  reading.totalBorrowing ??= total((item) => item.currentBalance);
  reading.totalMonthlyRent ??= total((item) => item.rent);
  return reading;
}

/** Column headings a schedule might use, normalised to lower-case letters only. */
const HEADERS: Array<[RegExp, keyof PortfolioProperty]> = [
  [/^(property)?address|^street|^addressline1|^property$/, "address"],
  [/^(city|town|posttown)$/, "city"],
  [/^(postcode|postalcode|zip)$/, "postcode"],
  [/^(propertytype|type)$/, "propertyType"],
  [/^tenure$/, "tenure"],
  [/^(bedrooms|beds)$/, "bedrooms"],
  [/^(value|propertyvalue|estimatedvalue|valuation|currentvalue|marketvalue)$/, "value"],
  [/^(purchaseprice|pricepaid)$/, "purchasePrice"],
  [/^(purchasedate|datepurchased|bought)$/, "purchaseDate"],
  [/^(lender|currentlender|existinglender|mortgagelender|mortgagewith)$/, "currentLender"],
  [/^(balance|currentbalance|outstandingbalance|mortgagebalance|mortgage|outstanding|loan|loanamount)$/, "currentBalance"],
  [/^(rate|currentrate|interestrate|ratepct|currentratepct)$/, "currentRatePct"],
  [/^(rateenddate|rateend|dealenddate|fixedend|productend|enddate|expiry)$/, "currentRateEndDate"],
  [/^(monthlypayment|payment|mortgagepayment|pcmpayment)$/, "monthlyPayment"],
  [/^(rent|monthlyrent|rentpcm|rentalincome|rentalincomepcm|rentpm)$/, "rent"],
  [/^(annualrent|rentpa|rentperannum|yearlyrent)$/, "rent"],
  [/^(tenancy|tenancytype)$/, "tenancyType"],
  [/^(notes|comments)$/, "notes"],
];

/** CSV / tab-separated schedules with a header row; otherwise one property per line with a postcode. */
function heuristic(text: string, _document: DocumentRow): PortfolioReading {
  const reading: PortfolioReading = { ...EMPTY, properties: [], createdPropertyIds: [] };
  const rows = parseRows(text);
  const headerIndex = rows.findIndex((row) => row.filter((cell) => HEADERS.some(([re]) => re.test(key(cell)))).length >= 2);
  if (headerIndex >= 0) {
    const header = rows[headerIndex]!;
    const columns = header.map((cell) => {
      const k = key(cell);
      const match = HEADERS.find(([re]) => re.test(k));
      return match ? { field: match[1], annualRent: /^(annualrent|rentpa|rentperannum|yearlyrent)$/.test(k) } : null;
    });
    for (const row of rows.slice(headerIndex + 1)) {
      if (row.every((cell) => !cell.trim())) continue;
      if (/^total/i.test(row[0] ?? "")) continue;
      const raw: Record<string, unknown> = {};
      row.forEach((cell, index) => {
        const column = columns[index];
        if (!column || !cell.trim()) return;
        raw[column.field] = column.annualRent ? (num(cell) ?? 0) / 12 : cell.trim();
      });
      if (typeof raw.address === "string") {
        // Address columns often carry the whole address; split off town and postcode when the sheet has no such columns.
        const parts = splitAddress(raw.address);
        if (parts.postcode && !raw.postcode) raw.postcode = parts.postcode;
        if (parts.city && !raw.city) raw.city = parts.city;
        if (parts.address && (parts.postcode || parts.city)) raw.address = parts.address;
      }
      raw.propertyType = mapType(String(raw.propertyType ?? ""));
      raw.tenancyType = mapTenancy(String(raw.tenancyType ?? ""));
      raw.tenure = mapTenure(String(raw.tenure ?? ""));
      const item = property(raw);
      if (item) reading.properties.push(item);
    }
  } else {
    for (const line of text.split("\n")) {
      if (!POSTCODE.test(line) || line.length > 200) continue;
      const parts = splitAddress(line.replace(/£?\s?[\d,]+(?:\.\d{2})?/g, " ").replace(/\s{2,}/g, " "));
      if (!parts.address) continue;
      const amounts = (line.match(/£?\s?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\b\d{4,7}\b/g) ?? []).map((raw) => num(raw)).filter((value): value is number => value != null);
      reading.properties.push({
        ...property({ address: parts.address, city: parts.city, postcode: parts.postcode })!,
        value: amounts[0] ?? null,
        currentBalance: amounts[1] ?? null,
        rent: amounts.find((value) => value >= 200 && value < 20000) ?? null,
      });
    }
  }
  derive(reading);
  if (reading.properties.length > 0) {
    reading.confidence = headerIndex >= 0 ? "medium" : "low";
    reading.notes = headerIndex >= 0 ? "Read from the spreadsheet's headed columns." : "Read by text patterns; check each property.";
  }
  return reading;
}

const key = (cell: string) => cell.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");

function parseRows(text: string): string[][] {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const push = () => { row.push(field); field = ""; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) push();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      push();
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { push(); if (row.some((cell) => cell.trim())) rows.push(row); }
  return rows;
}

function mapType(value: string) {
  const v = value.toLowerCase();
  if (!v) return null;
  if (/hmo/.test(v)) return "hmo";
  if (/flat|apartment/.test(v)) return "flat";
  if (/maisonette/.test(v)) return "maisonette";
  if (/bungalow/.test(v)) return "bungalow";
  if (/house|terrace|semi|detached|cottage/.test(v)) return "house";
  if (/mixed/.test(v)) return "mixed_use";
  if (/commercial|shop|office|retail|industrial/.test(v)) return "commercial";
  if (/land|plot/.test(v)) return "land";
  return "other";
}
function mapTenancy(value: string) {
  const v = value.toLowerCase();
  if (!v) return null;
  if (/ast|assured|shorthold/.test(v)) return "ast";
  if (/company/.test(v)) return "company_let";
  if (/hmo|room/.test(v)) return "hmo_rooms";
  if (/commercial|lease/.test(v)) return "commercial_lease";
  if (/regulated|protected/.test(v)) return "regulated";
  if (/none|vacant|owner/.test(v)) return "none";
  return "ast";
}
function mapTenure(value: string) {
  const v = value.toLowerCase();
  if (!v) return null;
  if (/share/.test(v)) return "share_of_freehold";
  if (/lease/.test(v)) return "leasehold";
  if (/free/.test(v)) return "freehold";
  if (/common/.test(v)) return "commonhold";
  return null;
}

/**
 * Creates property records for every property in the schedule the client
 * does not already have (matched on postcode, then on the street line), and
 * raises the same review task the CSV import does.
 */
async function apply(document: DocumentRow, data: PortfolioReading, actorName: string) {
  if (data.properties.length === 0) return [];
  const [client] = await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, document.clientId));
  if (!client) return [];
  const existing = await db.select({ id: propertiesTable.id, address: propertiesTable.address, postcode: propertiesTable.postcode })
    .from(propertiesTable).where(eq(propertiesTable.clientId, client.id));
  const known = new Set<string>();
  for (const row of existing) {
    const postcode = normalisePostcode(row.postcode) ?? normalisePostcode(row.address);
    if (postcode) known.add(`pc:${postcode}`);
    known.add(`addr:${streetKey(row.address)}`);
  }
  const fresh: PortfolioProperty[] = [];
  let skipped = 0;
  for (const item of data.properties) {
    const postcode = normalisePostcode(item.postcode);
    const keys = [postcode ? `pc:${postcode}` : null, `addr:${streetKey(item.address)}`].filter((k): k is string => !!k);
    if (keys.some((k) => known.has(k))) { skipped += 1; continue; }
    keys.forEach((k) => known.add(k));
    fresh.push({ ...item, postcode });
  }
  data.skipped = skipped;
  if (fresh.length === 0) return [];
  const created = await db.insert(propertiesTable).values(fresh.map((item) => ({
    clientId: client.id,
    address: item.address,
    city: item.city,
    postcode: item.postcode,
    // A let property is a BTL matter; anything else is treated as residential until staff say otherwise.
    matterType: item.rent != null || (item.tenancyType && item.tenancyType !== "none") ? "btl" : "remortgage",
    value: item.value ?? item.purchasePrice ?? 0,
    loanAmount: item.currentBalance ?? 0,
    rent: item.rent,
    propertyType: item.propertyType,
    tenure: item.tenure,
    bedrooms: item.bedrooms,
    occupancy: item.rent != null || (item.tenancyType && item.tenancyType !== "none") ? "let" : null,
    tenancyType: item.tenancyType,
    purchasePrice: item.purchasePrice,
    purchaseDate: item.purchaseDate,
    currentLender: item.currentLender,
    currentRatePct: item.currentRatePct,
    currentBalance: item.currentBalance,
    currentRateEndDate: item.currentRateEndDate,
    notes: [item.notes, item.monthlyPayment != null ? `Mortgage payment £${item.monthlyPayment.toLocaleString("en-GB")}/mo (from portfolio)` : null].filter(Boolean).join("\n") || null,
  }))).returning({ id: propertiesTable.id, address: propertiesTable.address, city: propertiesTable.city, postcode: propertiesTable.postcode });
  data.createdPropertyIds = created.map((row) => row.id);
  await logActivity({
    kind: "property",
    title: "Properties imported",
    detail: `${created.length} propert${created.length === 1 ? "y was" : "ies were"} read from ${document.name} for ${client.name}${skipped ? ` (${skipped} already on record)` : ""}`,
    actorName,
    entityType: "client",
    entityId: client.id,
  });
  const assignee = await resolveAssignee({ section: "property" });
  if (assignee.ok) {
    const preview = created.slice(0, 5).map((row) => formatAddress(row)).join("; ");
    await createAssignmentTask({
      staffUser: assignee.staffUser,
      title: `Review ${created.length} propert${created.length === 1 ? "y" : "ies"} read from portfolio: ${client.name}`,
      notes: created.length > 5 ? `${preview}; and ${created.length - 5} more` : preview,
      caseId: null,
      clientId: client.id,
      kind: "property_import",
    }).catch((error) => logger.warn({ err: error, clientId: client.id }, "Portfolio review task was not created"));
  }
  return created.map((row) => `property:${row.id}`);
}

const streetKey = (address: string) => address.toLowerCase().replace(POSTCODE, "").replace(/[^a-z0-9]/g, "").slice(0, 24);

function merge(primary: PortfolioReading, fallback: PortfolioReading): PortfolioReading {
  const merged = { ...primary };
  if (merged.properties.length === 0) merged.properties = fallback.properties;
  for (const key of ["totalValue", "totalBorrowing", "totalMonthlyRent", "confidence", "notes"] as const) {
    if (merged[key] == null && fallback[key] != null) (merged as Record<string, unknown>)[key] = fallback[key];
  }
  return derive(merged);
}

export const portfolioReader: DocumentReader<PortfolioReading> = {
  key: "portfolio",
  categories: ["portfolio"],
  systemInstruction: SYSTEM_INSTRUCTION,
  progressLabels: {
    properties: "Reading the properties one by one…",
    totalValue: "Totalling the portfolio value…",
    totalBorrowing: "Totalling the borrowing…",
    totalMonthlyRent: "Totalling the rent…",
    confidence: "Weighing up how sure it is…",
  },
  normalise,
  heuristic,
  merge,
  apply,
};
