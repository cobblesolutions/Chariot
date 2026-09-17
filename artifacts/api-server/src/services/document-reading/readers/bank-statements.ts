import type { DocumentReader, DocumentRow } from "../types";
import {
  amountsOn, bool, fillEmptyClientFields, findAddress, int, list, median, num, oneOf, round,
  splitAddress, str, sum, toIsoDate,
} from "./shared";

export const COMMITMENT_KINDS = ["loan", "credit_card", "mortgage", "rent", "car_finance", "insurance", "subscription", "childcare", "other"] as const;
const CONFIDENCE = ["high", "medium", "low"] as const;

export interface StatementEntry { date: string | null; description: string; amount: number }
export interface Commitment { payee: string; amount: number; kind: (typeof COMMITMENT_KINDS)[number] }

/** What the bank-statements reader extracts from one statement (or a bundle of them). */
export interface BankStatementsReading extends Record<string, unknown> {
  bankName: string | null;
  accountHolder: string | null;
  address: string | null;
  city: string | null;
  postcode: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** Salary credits found (payer is usually the employer). */
  salaryCredits: StatementEntry[];
  employerName: string | null;
  /** Typical monthly net salary (median of the salary credits). */
  monthlyNetSalary: number | null;
  /** Regular outgoings that count as commitments for affordability. */
  commitments: Commitment[];
  /** Loans, cards, car finance, childcare — what lenders deduct (rent and mortgage listed separately). */
  monthlyCommitments: number | null;
  mortgagePayments: Commitment[];
  monthlyRentPaid: number | null;
  rentReceived: StatementEntry[];
  monthlyRentReceived: number | null;
  closingBalance: number | null;
  /** Things an underwriter will ask about. */
  gambling: boolean | null;
  returnedPayments: number | null;
  overdrawn: boolean | null;
  confidence: (typeof CONFIDENCE)[number] | null;
  notes: string | null;
}

const EMPTY: BankStatementsReading = {
  bankName: null, accountHolder: null, address: null, city: null, postcode: null, periodStart: null, periodEnd: null,
  salaryCredits: [], employerName: null, monthlyNetSalary: null, commitments: [], monthlyCommitments: null,
  mortgagePayments: [], monthlyRentPaid: null, rentReceived: [], monthlyRentReceived: null, closingBalance: null,
  gambling: null, returnedPayments: null, overdrawn: null, confidence: null, notes: null,
};

const SYSTEM_INSTRUCTION = `You read UK personal bank statements for a mortgage broker's affordability check and return JSON only.
Return an object with exactly these keys:
{ "bankName", "accountHolder", "address", "city", "postcode", "periodStart", "periodEnd", "salaryCredits", "employerName", "monthlyNetSalary", "commitments", "monthlyCommitments", "mortgagePayments", "monthlyRentPaid", "rentReceived", "monthlyRentReceived", "closingBalance", "gambling", "returnedPayments", "overdrawn", "confidence", "notes" }
Rules: null for anything not shown; amounts are plain numbers in pounds; dates are ISO YYYY-MM-DD.
"salaryCredits" is a list of { "date", "description", "amount" } for wages/salary credits (BACS from an employer). "employerName" is the payer of those credits, cleaned of reference codes. "monthlyNetSalary" is the typical monthly net salary (median of the regular credits; sum weekly pay into a month).
"commitments" is a list of { "payee", "amount", "kind" } for regular monthly outgoings with kind one of ${COMMITMENT_KINDS.map((t) => `"${t}"`).join(", ")}. "monthlyCommitments" is the monthly total of loan, credit_card, car_finance and childcare payments only (not mortgage, rent, insurance or subscriptions).
"mortgagePayments" lists mortgage direct debits (payee = lender). "monthlyRentPaid" is rent paid out, "rentReceived" lists rental income credits and "monthlyRentReceived" their monthly total.
"gambling" is true if there are payments to betting or gambling companies. "returnedPayments" counts returned/unpaid direct debits or bounced items. "overdrawn" is true if the balance went below zero during the period.
"confidence" is "high", "medium" or "low" for monthlyNetSalary. "notes" is one short sentence on anything an underwriter should know, or null.`;

const entry = (raw: unknown): StatementEntry | null => {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const amount = num(item.amount);
  return amount == null ? null : { date: toIsoDate(item.date), description: str(item.description) ?? "", amount };
};
const commitment = (raw: unknown): Commitment | null => {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const amount = num(item.amount);
  return amount == null ? null : { payee: str(item.payee) ?? "", amount: Math.abs(amount), kind: oneOf(item.kind, COMMITMENT_KINDS) ?? "other" };
};

function normalise(raw: unknown): BankStatementsReading {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reading: BankStatementsReading = {
    bankName: str(data.bankName),
    accountHolder: str(data.accountHolder),
    address: str(data.address),
    city: str(data.city),
    postcode: str(data.postcode),
    periodStart: toIsoDate(data.periodStart),
    periodEnd: toIsoDate(data.periodEnd),
    salaryCredits: list(data.salaryCredits, entry),
    employerName: companyCase(str(data.employerName)),
    monthlyNetSalary: num(data.monthlyNetSalary),
    commitments: list(data.commitments, commitment),
    monthlyCommitments: num(data.monthlyCommitments),
    mortgagePayments: list(data.mortgagePayments, commitment),
    monthlyRentPaid: num(data.monthlyRentPaid),
    rentReceived: list(data.rentReceived, entry),
    monthlyRentReceived: num(data.monthlyRentReceived),
    closingBalance: num(data.closingBalance),
    gambling: bool(data.gambling),
    returnedPayments: int(data.returnedPayments),
    overdrawn: bool(data.overdrawn),
    confidence: oneOf(data.confidence, CONFIDENCE),
    notes: str(data.notes),
  };
  return derive(reading);
}

/** Totals the model may have skipped, from the lists it did return. */
function derive(reading: BankStatementsReading) {
  if (reading.monthlyNetSalary == null && reading.salaryCredits.length > 0) {
    reading.monthlyNetSalary = median(reading.salaryCredits.map((credit) => credit.amount));
  }
  if (reading.monthlyCommitments == null && reading.commitments.length > 0) {
    const counted = reading.commitments.filter((item) => ["loan", "credit_card", "car_finance", "childcare"].includes(item.kind));
    if (counted.length > 0) reading.monthlyCommitments = sum(counted.map((item) => item.amount));
  }
  if (reading.monthlyRentReceived == null && reading.rentReceived.length > 0) {
    reading.monthlyRentReceived = sum(reading.rentReceived.map((credit) => credit.amount));
  }
  if (reading.monthlyRentPaid == null) {
    const rent = reading.commitments.find((item) => item.kind === "rent");
    if (rent) reading.monthlyRentPaid = rent.amount;
  }
  if (reading.mortgagePayments.length === 0) {
    reading.mortgagePayments = reading.commitments.filter((item) => item.kind === "mortgage");
  }
  return reading;
}

const SALARY = /\b(salary|payroll|wages|sal\b|net pay|pay ?roll)/i;
const GAMBLING = /\b(bet365|betfair|paddy ?power|ladbrokes|william ?hill|sky ?bet|coral|betfred|unibet|888|betway|casino|gambl|lottery|national ?lottery|tombola|bingo)/i;
const RETURNED = /\b(returned|unpaid|bounced|recalled|rejected)\b.*\b(dd|direct debit|item|payment|cheque)/i;
const KIND_PATTERNS: Array<[RegExp, Commitment["kind"]]> = [
  [/mortgage|\bmtg\b|halifax|nationwide bs|santander mtg|barclays mtg|hsbc mtg|natwest mtg|skipton|coventry bs|leeds bs|yorkshire bs|virgin money|tsb mtg|accord|bm solutions|precise|kensington|paragon|fleet/i, "mortgage"],
  [/\brent\b|letting|lettings|estates|property management/i, "rent"],
  [/car finance|motor finance|black horse|close brothers|moneybarn|volkswagen fin|bmw fin|mercedes fin|toyota fin|ford credit|arval|leaseplan|lex autolease/i, "car_finance"],
  [/credit card|barclaycard|capital one|aqua|vanquis|amex|american express|mbna|tesco bank cc|virgin cc|halifax cc|natwest cc|lloyds cc|hsbc cc|sainsburys bank/i, "credit_card"],
  [/\bloan\b|zopa|ratesetter|lendable|novuna|klarna|clearpay|very\b|tesco loan|118 ?118|amigo|likely loans|monzo flex|paypal credit/i, "loan"],
  [/nursery|childcare|childminder|after school/i, "childcare"],
  [/insurance|assurance|aviva|axa|admiral|direct line|churchill|legal & general|l&g|vitality|bupa/i, "insurance"],
  [/netflix|spotify|sky\b|virgin media|bt group|vodafone|ee\b|o2\b|three\b|amazon prime|disney|now tv|gym|puregym|david lloyd/i, "subscription"],
];

/**
 * Text-pattern reading of a statement export. Lines are treated as
 * transactions when they carry a date and at least one amount; credits vs
 * debits are decided by the CR/DR marker or the column the amount sits in.
 */
function heuristic(text: string, document: DocumentRow): BankStatementsReading {
  const reading: BankStatementsReading = { ...EMPTY, salaryCredits: [], commitments: [], mortgagePayments: [], rentReceived: [] };
  const haystack = `${document.name}\n${text}`;
  const lines = text.split("\n").map((line) => line.replace(/\s{2,}/g, "  ").trim()).filter(Boolean);

  reading.bankName = haystack.match(/\b(Barclays|HSBC|Lloyds|NatWest|Santander|Nationwide|Halifax|Monzo|Starling|TSB|Metro Bank|Royal Bank of Scotland|Bank of Scotland|Co-operative Bank|First Direct|Revolut|Chase|Virgin Money|Yorkshire Bank|Clydesdale)\b/i)?.[1] ?? null;
  const holder = haystack.match(/(?:account (?:name|holder)|name)\s*[:\-]?\s*((?:Mr|Mrs|Ms|Miss|Dr)?\.?\s*[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3})/);
  reading.accountHolder = holder ? holder[1]!.trim() : null;
  const address = findAddress(text);
  Object.assign(reading, splitAddress(address));
  const period = haystack.match(/(?:statement period|period|from)\s*[:\-]?\s*(\d{1,2}[/.\- ][A-Za-z0-9]{1,9}[/.\- ]\d{2,4})\s*(?:to|-|–)\s*(\d{1,2}[/.\- ][A-Za-z0-9]{1,9}[/.\- ]\d{2,4})/i);
  reading.periodStart = period ? toIsoDate(period[1]) : null;
  reading.periodEnd = period ? toIsoDate(period[2]) : null;

  const rentIn: StatementEntry[] = [];
  let returned = 0;
  let overdrawn = false;
  let gambling = false;
  const seenCommitments = new Map<string, Commitment>();
  for (const line of lines) {
    const amounts = amountsOn(line);
    if (amounts.length === 0) continue;
    const date = toIsoDate(line.match(/^\d{1,2}[/.\- ][A-Za-z0-9]{1,9}[/.\- ]\d{2,4}|^\d{1,2} [A-Za-z]{3}\b/)?.[0] ?? null);
    const description = line.replace(/^\d{1,2}[/.\- ][A-Za-z0-9]{1,9}(?:[/.\- ]\d{2,4})?\s*/, "").replace(/-?£?\s?[\d,]+\.\d{2}.*$/, "").trim();
    const isCredit = /\bCR\b/i.test(line) || SALARY.test(line) || /\brent\b.*(?:received|from)|\bfrom\b.*\brent\b/i.test(line);
    const amount = Math.abs(amounts[0]!);
    const balance = amounts.length > 1 ? amounts[amounts.length - 1]! : null;
    if (balance != null && balance < 0) overdrawn = true;
    if (/\b(overdrawn|OD)\b/.test(line) || /-£?\s?[\d,]+\.\d{2}\s*$/.test(line)) overdrawn = true;
    if (GAMBLING.test(description)) gambling = true;
    if (RETURNED.test(line)) returned += 1;
    if (SALARY.test(description) && isCredit) {
      reading.salaryCredits.push({ date, description, amount });
      continue;
    }
    if (/\brent\b/i.test(description) && isCredit) {
      rentIn.push({ date, description, amount });
      continue;
    }
    if (/\b(DD|direct debit|D\/D|SO|standing order|S\/O)\b/i.test(line) || /\bDD\b/.test(description)) {
      const kind = KIND_PATTERNS.find(([pattern]) => pattern.test(description))?.[1] ?? "other";
      if (kind === "other") continue;
      const payee = description.replace(/\b(DD|direct debit|D\/D|SO|standing order|S\/O)\b/gi, "").replace(/\s{2,}/g, " ").trim();
      const key = `${kind}:${payee.toLowerCase().slice(0, 16)}`;
      if (!seenCommitments.has(key)) seenCommitments.set(key, { payee, amount, kind });
    }
  }
  reading.commitments = [...seenCommitments.values()];
  reading.rentReceived = rentIn;
  reading.returnedPayments = returned;
  reading.overdrawn = overdrawn;
  reading.gambling = gambling;
  const employer = reading.salaryCredits[0]?.description.replace(SALARY, "").replace(/\b(BACS|FPI|FP|CR|REF|\d{4,})\b/gi, "").replace(/[^A-Za-z& ]/g, " ").replace(/\s{2,}/g, " ").trim();
  reading.employerName = employer && employer.length > 2 ? companyCase(employer) : null;
  const closing = haystack.match(/(?:closing balance|balance carried forward|end balance)[^\d£\-]{0,20}(-?£?\s?[\d,]+\.\d{2})/i);
  reading.closingBalance = closing ? num(closing[1]) : null;
  derive(reading);
  if (reading.monthlyNetSalary != null) {
    reading.monthlyNetSalary = round(reading.monthlyNetSalary);
    reading.confidence = "low";
    reading.notes = "Read by text patterns; check credits and direct debits against the statement.";
  }
  return reading;
}

/** Statement descriptors are upper case; the record wants "Acme Widgets Ltd". Mixed case is left alone. */
function companyCase(value: string | null) {
  if (!value) return null;
  if (value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .replace(/(^|\s)([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/\bPlc\b/, "PLC")
    .replace(/\bLlp\b/, "LLP");
}

async function apply(document: DocumentRow, data: BankStatementsReading, actorName: string) {
  const summary = [
    data.monthlyNetSalary != null ? `net salary £${data.monthlyNetSalary.toLocaleString("en-GB")}/mo` : null,
    data.monthlyCommitments != null ? `commitments £${data.monthlyCommitments.toLocaleString("en-GB")}/mo` : null,
    data.employerName ? `paid by ${data.employerName}` : null,
  ].filter(Boolean).join(", ");
  return fillEmptyClientFields(document, {
    currentAddress: data.address,
    currentAddressCity: data.city,
    currentAddressPostcode: data.postcode,
    employerName: data.employerName,
    monthlyCommitments: data.monthlyCommitments,
  }, actorName, "Document read: bank statements", summary || "statement details");
}

function merge(primary: BankStatementsReading, fallback: BankStatementsReading): BankStatementsReading {
  const merged = { ...primary };
  for (const key of Object.keys(EMPTY) as Array<keyof BankStatementsReading>) {
    const value = merged[key];
    const missing = value == null || (Array.isArray(value) && value.length === 0);
    if (missing && fallback[key] != null) merged[key] = fallback[key];
  }
  return derive(merged);
}

export const bankStatementsReader: DocumentReader<BankStatementsReading> = {
  key: "bank_statements",
  categories: ["bank_statements"],
  systemInstruction: SYSTEM_INSTRUCTION,
  progressLabels: {
    bankName: "Identifying the bank…",
    accountHolder: "Reading the account holder…",
    address: "Reading the address…",
    periodStart: "Reading the statement period…",
    salaryCredits: "Finding salary credits…",
    employerName: "Working out who pays the salary…",
    monthlyNetSalary: "Working out the monthly net pay…",
    commitments: "Going through the direct debits…",
    monthlyCommitments: "Adding up the commitments…",
    mortgagePayments: "Looking for mortgage payments…",
    rentReceived: "Looking for rent coming in…",
    gambling: "Checking account conduct…",
    confidence: "Weighing up how sure it is…",
  },
  normalise,
  heuristic,
  merge,
  apply,
};
