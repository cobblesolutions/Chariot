import type { DocumentReader, DocumentRow } from "../types";
import {
  POSTCODE, bool, fillEmptyClientFields, int, list, matchAll, num, oneOf, splitAddress, str, sum, toIsoDate,
} from "./shared";

export const ADVERSE_KINDS = ["default", "ccj", "missed_payment", "arrangement", "iva", "bankruptcy", "debt_management", "other"] as const;
export const ACCOUNT_TYPES = ["mortgage", "credit_card", "loan", "car_finance", "current_account", "utility", "telecoms", "bnpl", "other"] as const;
const CONFIDENCE = ["high", "medium", "low"] as const;

export interface ReportedAddress { address: string | null; city: string | null; postcode: string | null; from: string | null; to: string | null; current: boolean }
export interface AdverseItem { kind: (typeof ADVERSE_KINDS)[number]; creditor: string | null; amount: number | null; date: string | null; status: string | null }
export interface CreditAccount { creditor: string; type: (typeof ACCOUNT_TYPES)[number]; balance: number | null; limit: number | null; monthlyPayment: number | null; status: string | null }

/** What the credit-report reader extracts (Experian, Equifax, TransUnion, Checkmyfile, ClearScore…). */
export interface CreditReportReading extends Record<string, unknown> {
  provider: string | null;
  reportDate: string | null;
  fullName: string | null;
  dateOfBirth: string | null;
  score: number | null;
  scoreMax: number | null;
  scoreBand: string | null;
  addresses: ReportedAddress[];
  electoralRoll: boolean | null;
  adverse: AdverseItem[];
  defaults: number | null;
  ccjs: number | null;
  missedPayments: number | null;
  iva: boolean | null;
  bankruptcy: boolean | null;
  accounts: CreditAccount[];
  totalUnsecuredDebt: number | null;
  /** Monthly payments on unsecured credit (what lenders deduct). */
  monthlyCommitments: number | null;
  mortgageAccounts: CreditAccount[];
  searches: number | null;
  summary: string | null;
  confidence: (typeof CONFIDENCE)[number] | null;
  notes: string | null;
}

const EMPTY: CreditReportReading = {
  provider: null, reportDate: null, fullName: null, dateOfBirth: null, score: null, scoreMax: null, scoreBand: null,
  addresses: [], electoralRoll: null, adverse: [], defaults: null, ccjs: null, missedPayments: null, iva: null,
  bankruptcy: null, accounts: [], totalUnsecuredDebt: null, monthlyCommitments: null, mortgageAccounts: [],
  searches: null, summary: null, confidence: null, notes: null,
};

const SYSTEM_INSTRUCTION = `You read UK consumer credit reports (Experian, Equifax, TransUnion, Checkmyfile, ClearScore, Credit Karma) for a mortgage broker and return JSON only.
Return an object with exactly these keys:
{ "provider", "reportDate", "fullName", "dateOfBirth", "score", "scoreMax", "scoreBand", "addresses", "electoralRoll", "adverse", "defaults", "ccjs", "missedPayments", "iva", "bankruptcy", "accounts", "totalUnsecuredDebt", "monthlyCommitments", "mortgageAccounts", "searches", "summary", "confidence", "notes" }
Rules: null for anything not shown; amounts are plain numbers in pounds; dates are ISO YYYY-MM-DD.
"score"/"scoreMax" are the printed score and its scale (e.g. 745 and 999). "scoreBand" is the printed band ("Good", "Fair").
"addresses" is a list of { "address", "city", "postcode", "from", "to", "current" } for every address on the report, current first.
"adverse" lists every negative item as { "kind", "creditor", "amount", "date", "status" } with kind one of ${ADVERSE_KINDS.map((t) => `"${t}"`).join(", ")}; "defaults", "ccjs" and "missedPayments" are the counts (missedPayments counts late-payment markers in the last 6 years); "iva" and "bankruptcy" are booleans.
"accounts" lists open credit accounts as { "creditor", "type", "balance", "limit", "monthlyPayment", "status" } with type one of ${ACCOUNT_TYPES.map((t) => `"${t}"`).join(", ")}. "mortgageAccounts" repeats the mortgage ones. "totalUnsecuredDebt" is the sum of balances on cards, loans, car finance and BNPL; "monthlyCommitments" is the sum of their monthly payments (use 3% of balance for a card with no payment shown).
"searches" counts hard credit searches in the last 12 months. "summary" is two plain sentences a broker could paste into a client's credit-history notes (score, adverse items with dates, total unsecured debt). "confidence" is "high", "medium" or "low". "notes" is one short sentence, or null.`;

const reportedAddress = (raw: unknown): ReportedAddress | null => {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const address = str(item.address);
  const postcode = str(item.postcode);
  if (!address && !postcode) return null;
  return { address, city: str(item.city), postcode, from: toIsoDate(item.from) ?? str(item.from), to: toIsoDate(item.to) ?? str(item.to), current: bool(item.current) ?? false };
};
const adverseItem = (raw: unknown): AdverseItem | null => {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = oneOf(item.kind, ADVERSE_KINDS);
  return kind ? { kind, creditor: str(item.creditor), amount: num(item.amount), date: toIsoDate(item.date) ?? str(item.date), status: str(item.status) } : null;
};
const account = (raw: unknown): CreditAccount | null => {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const creditor = str(item.creditor);
  return creditor ? { creditor, type: oneOf(item.type, ACCOUNT_TYPES) ?? "other", balance: num(item.balance), limit: num(item.limit), monthlyPayment: num(item.monthlyPayment), status: str(item.status) } : null;
};

function normalise(raw: unknown): CreditReportReading {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reading: CreditReportReading = {
    provider: str(data.provider),
    reportDate: toIsoDate(data.reportDate),
    fullName: str(data.fullName),
    dateOfBirth: toIsoDate(data.dateOfBirth),
    score: int(data.score),
    scoreMax: int(data.scoreMax),
    scoreBand: str(data.scoreBand),
    addresses: list(data.addresses, reportedAddress),
    electoralRoll: bool(data.electoralRoll),
    adverse: list(data.adverse, adverseItem),
    defaults: int(data.defaults),
    ccjs: int(data.ccjs),
    missedPayments: int(data.missedPayments),
    iva: bool(data.iva),
    bankruptcy: bool(data.bankruptcy),
    accounts: list(data.accounts, account),
    totalUnsecuredDebt: num(data.totalUnsecuredDebt),
    monthlyCommitments: num(data.monthlyCommitments),
    mortgageAccounts: list(data.mortgageAccounts, account),
    searches: int(data.searches),
    summary: str(data.summary),
    confidence: oneOf(data.confidence, CONFIDENCE),
    notes: str(data.notes),
  };
  return derive(reading);
}

const UNSECURED: ReadonlyArray<CreditAccount["type"]> = ["credit_card", "loan", "car_finance", "bnpl"];

function derive(reading: CreditReportReading) {
  const counts = (kind: AdverseItem["kind"]) => reading.adverse.filter((item) => item.kind === kind).length;
  if (reading.adverse.length > 0) {
    reading.defaults ??= counts("default");
    reading.ccjs ??= counts("ccj");
    reading.missedPayments ??= counts("missed_payment");
    reading.iva ??= counts("iva") > 0;
    reading.bankruptcy ??= counts("bankruptcy") > 0;
  }
  const unsecured = reading.accounts.filter((item) => UNSECURED.includes(item.type));
  if (reading.totalUnsecuredDebt == null && unsecured.some((item) => item.balance != null)) {
    reading.totalUnsecuredDebt = sum(unsecured.map((item) => item.balance ?? 0));
  }
  if (reading.monthlyCommitments == null && unsecured.length > 0) {
    const payments = unsecured.map((item) => item.monthlyPayment ?? (item.type === "credit_card" && item.balance != null ? item.balance * 0.03 : 0));
    if (payments.some((value) => value > 0)) reading.monthlyCommitments = sum(payments);
  }
  if (reading.mortgageAccounts.length === 0) {
    reading.mortgageAccounts = reading.accounts.filter((item) => item.type === "mortgage");
  }
  if (!reading.summary) reading.summary = composeSummary(reading);
  return reading;
}

/** Plain-English paragraph for the client's credit-history notes. */
export function composeSummary(reading: CreditReportReading): string | null {
  const parts: string[] = [];
  if (reading.score != null) {
    parts.push(`${reading.provider ?? "Credit"} score ${reading.score}${reading.scoreMax ? `/${reading.scoreMax}` : ""}${reading.scoreBand ? ` (${reading.scoreBand})` : ""}${reading.reportDate ? ` on ${reading.reportDate}` : ""}.`);
  }
  const adverse: string[] = [];
  if (reading.defaults) adverse.push(`${reading.defaults} default${reading.defaults === 1 ? "" : "s"}`);
  if (reading.ccjs) adverse.push(`${reading.ccjs} CCJ${reading.ccjs === 1 ? "" : "s"}`);
  if (reading.missedPayments) adverse.push(`${reading.missedPayments} missed payment${reading.missedPayments === 1 ? "" : "s"}`);
  if (reading.iva) adverse.push("IVA");
  if (reading.bankruptcy) adverse.push("bankruptcy");
  const detail = reading.adverse
    .filter((item) => item.kind !== "missed_payment")
    .slice(0, 4)
    .map((item) => [item.kind.replace("_", " "), item.creditor, item.amount != null ? `£${item.amount.toLocaleString("en-GB")}` : null, item.date, item.status].filter(Boolean).join(" "))
    .join("; ");
  if (adverse.length > 0) parts.push(`Adverse: ${adverse.join(", ")}${detail ? ` (${detail})` : ""}.`);
  else if (reading.defaults === 0 && reading.ccjs === 0) parts.push("No defaults or CCJs.");
  if (reading.totalUnsecuredDebt != null) {
    parts.push(`Unsecured debt £${reading.totalUnsecuredDebt.toLocaleString("en-GB")}${reading.monthlyCommitments != null ? `, £${reading.monthlyCommitments.toLocaleString("en-GB")}/mo` : ""}.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Text patterns for the common report layouts; enough for score, counts, DOB and addresses. */
function heuristic(text: string, document: DocumentRow): CreditReportReading {
  const reading: CreditReportReading = { ...EMPTY, addresses: [], adverse: [], accounts: [], mortgageAccounts: [] };
  const haystack = `${document.name}\n${text}`;
  reading.provider = haystack.match(/\b(Experian|Equifax|TransUnion|Checkmyfile|ClearScore|Credit Karma|Noddle|Call Credit)\b/i)?.[1] ?? null;
  const score = haystack.match(/(?:credit )?score\s*(?:is|:|of)?\s*(\d{3,4})\s*(?:\/|out of)\s*(\d{3,4})/i)
    ?? haystack.match(/(?:credit )?score\s*(?:is|:|of)?\s*(\d{3,4})\b/i);
  reading.score = score ? int(score[1]) : null;
  reading.scoreMax = score?.[2] ? int(score[2]) : reading.score != null ? (reading.score <= 700 ? 700 : reading.score <= 710 ? 710 : 999) : null;
  reading.scoreBand = haystack.match(/\b(Excellent|Very Good|Good|Fair|Poor|Very Poor)\b/)?.[1] ?? null;
  reading.reportDate = toIsoDate(haystack.match(/(?:report (?:date|generated|created)|date of report|as at)\s*[:\-]?\s*(\d{1,2}[/.\- ][A-Za-z0-9]{1,9}[/.\- ]\d{2,4})/i)?.[1] ?? null);
  reading.dateOfBirth = toIsoDate(haystack.match(/(?:date of birth|dob)\s*[:\-]?\s*(\d{1,2}[/.\- ][A-Za-z0-9]{1,9}[/.\- ]\d{2,4})/i)?.[1] ?? null);
  const name = haystack.match(/(?:^|\n)\s*(?:name|report for)\s*[:\-]?\s*((?:Mr|Mrs|Ms|Miss|Dr)?\.?\s*[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3})/);
  reading.fullName = name ? name[1]!.trim() : null;
  reading.electoralRoll = /electoral roll\s*[:\-]?\s*(yes|registered|confirmed)/i.test(haystack) ? true : /electoral roll\s*[:\-]?\s*(no|not registered)/i.test(haystack) ? false : null;

  // "Defaults: 1", "Missed payments (last 6 years): 2", "2 defaults".
  const count = (label: RegExp) => {
    const match = haystack.match(new RegExp(`${label.source}\\s*(?:\\([^)]*\\))?\\s*[:\\-]\\s*(\\d{1,3})\\b`, "i"))
      ?? haystack.match(new RegExp(`(?:^|\\n)\\s*(\\d{1,3})\\s+${label.source}`, "i"));
    return match ? int(match[1]) : null;
  };
  reading.defaults = count(/defaults?/);
  reading.ccjs = count(/(?:ccjs?|county court judg(?:e)?ments?)/);
  reading.missedPayments = count(/(?:missed|late) payments?/);
  reading.iva = /\bIVA\b|individual voluntary arrangement/i.test(haystack) && !/no (?:iva|individual voluntary)/i.test(haystack) ? true : /\bIVA\b/i.test(haystack) ? false : null;
  reading.bankruptcy = /bankrupt/i.test(haystack) && !/no bankrupt|not bankrupt/i.test(haystack) ? true : /bankrupt/i.test(haystack) ? false : null;
  reading.searches = count(/(?:hard )?searches/);
  reading.totalUnsecuredDebt = num(haystack.match(/(?:total (?:unsecured )?(?:debt|balance|borrowing)|unsecured (?:debt|balance))\s*[:\-]?\s*(£?\s?[\d,]+(?:\.\d{2})?)/i)?.[1] ?? null);

  // Addresses: each postcode line with up to two lines above it; the first is
  // the current one. Bracketed notes ("(current, since 05/2019)") carry the dates.
  const lines = haystack.split("\n");
  lines.forEach((line, index) => {
    if (!POSTCODE.test(line) || reading.addresses.length >= 6) return;
    const raw = lines.slice(Math.max(0, index - 2), index + 1).map((l) => l.trim()).filter((l) => l && l.length < 80 && !/score|report|date of birth/i.test(l));
    const annotations = raw.flatMap((l) => l.match(/\(([^)]*)\)/g) ?? []).join(" ");
    const block = raw.map((l) => l.replace(/\([^)]*\)/g, "").trim()).filter(Boolean);
    const parts = splitAddress(block.join(", "));
    if (!parts.postcode) return;
    if (reading.addresses.some((existing) => existing.postcode === parts.postcode)) return;
    const dates = matchAll(`${annotations} ${lines[index + 1] ?? ""}`, /(\d{1,2}[/.\- ][A-Za-z0-9]{1,9}[/.\- ]\d{2,4}|\b\d{2}\/\d{4}\b|[A-Za-z]{3,9} \d{4})/g).map((m) => m[1]!);
    const current = /current|present/i.test(annotations) || reading.addresses.length === 0;
    reading.addresses.push({ ...parts, from: dates[0] ?? null, to: current ? null : dates[1] ?? null, current });
  });

  // Itemised adverse lines: "Default  Vodafone  £240  14/08/2022  Satisfied" (count lines like "Defaults: 1" are skipped).
  for (const match of matchAll(haystack, /(?:^|\n)[ \t]*(default|ccj|county court judg(?:e)?ment)\b(?!s?\s*[:(])[ \t]+([^\n£\d]{2,40})?[ \t]*(£\s?[\d,]+(?:\.\d{2})?)?[^\n]*?(\d{1,2}[/.\- ][A-Za-z0-9]{1,9}[/.\- ]\d{2,4})?[ \t]*(satisfied|settled|unsatisfied|active|partially satisfied)?/gi)) {
    if (!match[2] && !match[3] && !match[4]) continue;
    reading.adverse.push({ kind: /default/i.test(match[1]!) ? "default" : "ccj", creditor: match[2]?.trim() || null, amount: num(match[3]), date: toIsoDate(match[4]), status: match[5]?.toLowerCase() ?? null });
    if (reading.adverse.length >= 10) break;
  }
  derive(reading);
  if (reading.score != null || reading.defaults != null) {
    reading.confidence = "low";
    reading.notes = "Read by text patterns; check the counts against the report.";
  }
  return reading;
}

async function apply(document: DocumentRow, data: CreditReportReading, actorName: string) {
  const previous = data.addresses.find((item) => !item.current) ?? data.addresses[1] ?? null;
  const summary = [
    data.score != null ? `score ${data.score}${data.scoreMax ? `/${data.scoreMax}` : ""}` : null,
    data.defaults != null || data.ccjs != null ? `${data.defaults ?? 0} defaults, ${data.ccjs ?? 0} CCJs` : null,
  ].filter(Boolean).join(", ");
  return fillEmptyClientFields(document, {
    dateOfBirth: data.dateOfBirth,
    creditHistoryNotes: data.summary,
    monthlyCommitments: data.monthlyCommitments,
    previousAddress: previous?.address ?? null,
    previousAddressCity: previous?.city ?? null,
    previousAddressPostcode: previous?.postcode ?? null,
  }, actorName, "Document read: credit report", summary || "credit report details");
}

function merge(primary: CreditReportReading, fallback: CreditReportReading): CreditReportReading {
  const merged = { ...primary };
  for (const key of Object.keys(EMPTY) as Array<keyof CreditReportReading>) {
    const value = merged[key];
    const missing = value == null || (Array.isArray(value) && value.length === 0);
    if (missing && fallback[key] != null) merged[key] = fallback[key];
  }
  return derive(merged);
}

export const creditReportReader: DocumentReader<CreditReportReading> = {
  key: "credit_report",
  categories: ["credit_report"],
  systemInstruction: SYSTEM_INSTRUCTION,
  progressLabels: {
    provider: "Identifying the credit agency…",
    score: "Reading the score…",
    addresses: "Reading the address history…",
    adverse: "Looking for defaults, CCJs and missed payments…",
    accounts: "Going through the credit accounts…",
    totalUnsecuredDebt: "Totalling unsecured debt…",
    monthlyCommitments: "Adding up monthly commitments…",
    summary: "Writing the credit-history summary…",
    confidence: "Weighing up how sure it is…",
  },
  normalise,
  heuristic,
  merge,
  apply,
};
