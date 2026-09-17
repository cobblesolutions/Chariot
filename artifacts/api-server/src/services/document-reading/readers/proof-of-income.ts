import type { DocumentReader, DocumentRow } from "../types";
import { fillEmptyClientFields } from "./shared";

export const INCOME_DOCUMENT_TYPES = [
  "payslip", "p60", "sa302", "tax_year_overview", "accounts", "employment_contract", "bank_statement", "other",
] as const;
export const EMPLOYMENT_STATUSES = [
  "employed", "self_employed", "company_director", "contractor", "retired", "not_working", "other",
] as const;
export const PAY_FREQUENCIES = ["weekly", "fortnightly", "four_weekly", "monthly", "annual"] as const;
const CONFIDENCE = ["high", "medium", "low"] as const;

const PERIODS_PER_YEAR: Record<(typeof PAY_FREQUENCIES)[number], number> = {
  weekly: 52, fortnightly: 26, four_weekly: 13, monthly: 12, annual: 1,
};

/** What the proof-of-income reader extracts. Every field is null when the document does not say. */
export interface ProofOfIncomeReading extends Record<string, unknown> {
  documentType: (typeof INCOME_DOCUMENT_TYPES)[number] | null;
  employerName: string | null;
  jobTitle: string | null;
  employmentStatus: (typeof EMPLOYMENT_STATUSES)[number] | null;
  payFrequency: (typeof PAY_FREQUENCIES)[number] | null;
  /** Gross pay for the period the document covers (one payslip, one tax year for a P60). */
  grossPayForPeriod: number | null;
  /** Gross income annualised from the document — what goes on the client record. */
  annualGrossIncome: number | null;
  /** Pay date / period end / tax year the figures relate to, as printed. */
  periodEnd: string | null;
  confidence: (typeof CONFIDENCE)[number] | null;
  notes: string | null;
}

const EMPTY: ProofOfIncomeReading = {
  documentType: null, employerName: null, jobTitle: null, employmentStatus: null, payFrequency: null,
  grossPayForPeriod: null, annualGrossIncome: null, periodEnd: null, confidence: null, notes: null,
};

const SYSTEM_INSTRUCTION = `You read proof-of-income documents (UK payslips, P60s, SA302 tax calculations, tax year overviews, company accounts, employment contracts) for a mortgage broker and return JSON only.
Return an object with exactly these keys:
{ "documentType", "employerName", "jobTitle", "employmentStatus", "payFrequency", "grossPayForPeriod", "annualGrossIncome", "periodEnd", "confidence", "notes" }
Rules: use null for anything the document does not state.
"documentType" is one of ${INCOME_DOCUMENT_TYPES.map((t) => `"${t}"`).join(", ")}.
"employmentStatus" is one of ${EMPLOYMENT_STATUSES.map((t) => `"${t}"`).join(", ")}: payslips and P60s mean "employed" (or "company_director" if the person is a director of the paying company), SA302s and tax year overviews mean "self_employed".
"payFrequency" is one of ${PAY_FREQUENCIES.map((t) => `"${t}"`).join(", ")}.
"grossPayForPeriod" is the gross (pre-tax) pay for the period the document covers, as a plain number in pounds.
"annualGrossIncome" is the gross annual income as a plain number in pounds: for a payslip multiply the regular gross pay by the number of pay periods in a year (exclude one-off bonuses), or use the printed annual salary if there is one; for a P60 use the total pay for the year; for an SA302 use the total income received; for accounts use salary plus dividends drawn.
"periodEnd" is the pay date, period end or tax year exactly as printed.
"confidence" is "high", "medium" or "low" for how sure you are about annualGrossIncome.
"notes" is one short sentence on how annualGrossIncome was derived, or null.`;

const round = (value: number) => Math.round(value * 100) / 100;
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return round(value);
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[£,\s]/g, ""));
    return Number.isFinite(parsed) ? round(parsed) : null;
  }
  return null;
};
const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | null =>
  typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : null;

function normalise(raw: unknown): ProofOfIncomeReading {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reading: ProofOfIncomeReading = {
    documentType: oneOf(data.documentType, INCOME_DOCUMENT_TYPES),
    employerName: str(data.employerName),
    jobTitle: str(data.jobTitle),
    employmentStatus: oneOf(data.employmentStatus, EMPLOYMENT_STATUSES),
    payFrequency: oneOf(data.payFrequency, PAY_FREQUENCIES),
    grossPayForPeriod: num(data.grossPayForPeriod),
    annualGrossIncome: num(data.annualGrossIncome),
    periodEnd: str(data.periodEnd),
    confidence: oneOf(data.confidence, CONFIDENCE),
    notes: str(data.notes),
  };
  return annualised(reading);
}

/** Derives the annual figure from a period figure when the reader only found the latter. */
function annualised(reading: ProofOfIncomeReading) {
  if (reading.annualGrossIncome == null && reading.grossPayForPeriod != null && reading.payFrequency) {
    reading.annualGrossIncome = round(reading.grossPayForPeriod * PERIODS_PER_YEAR[reading.payFrequency]);
  }
  return reading;
}

const MONEY = "£?\\s*(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{2})?|\\d+(?:\\.\\d{2})?)";

/** Named amounts on the page: "Gross pay 3,250.00", "Total for year £48,000". */
function amountAfter(text: string, label: RegExp): number | null {
  const match = text.match(new RegExp(`${label.source}[^\\d£\\n]{0,40}${MONEY}`, "i"));
  return match ? num(match[1]) : null;
}

/**
 * Text-pattern fallback for when no model is configured (or it fails). Reads
 * the common UK layouts well enough to pre-fill a figure staff then check.
 */
function heuristic(text: string, document: DocumentRow): ProofOfIncomeReading {
  const reading = { ...EMPTY };
  const haystack = `${document.name}\n${text}`;
  const lower = haystack.toLowerCase();

  reading.documentType =
    /\bp60\b/.test(lower) ? "p60"
    : /sa302|tax calculation/.test(lower) ? "sa302"
    : /tax year overview/.test(lower) ? "tax_year_overview"
    : /payslip|pay slip|pay advice|payroll|net pay|gross pay|take home/.test(lower) ? "payslip"
    : /contract of employment|employment contract|offer of employment/.test(lower) ? "employment_contract"
    : /profit and loss|balance sheet|financial statements|abbreviated accounts/.test(lower) ? "accounts"
    : /statement of account|bank statement|sort code/.test(lower) ? "bank_statement"
    : null;

  const yearly = reading.documentType === "p60" || reading.documentType === "sa302" || reading.documentType === "tax_year_overview";
  reading.payFrequency =
    yearly ? "annual"
    : /four[\s-]?weekly|4[\s-]?weekly/.test(lower) ? "four_weekly"
    : /fortnight/.test(lower) ? "fortnightly"
    : /\bweekly\b|\bweek\s*(?:no\.?|number|ending)?\s*\d/.test(lower) ? "weekly"
    : /\bmonthly\b|\bmonth\s*(?:no\.?|number)?\s*:?\s*\d|tax period|pay period/.test(lower) ? "monthly"
    : null;

  const employer = haystack.match(/employer(?:'s)?(?:\s+name)?\s*[:\-]?\s*([^\n]{2,80})/i);
  reading.employerName = employer ? cleanLabelValue(employer[1]!) : null;
  const job = haystack.match(/(?:job title|position|occupation)\s*[:\-]?\s*([^\n]{2,80})/i);
  reading.jobTitle = job ? cleanLabelValue(job[1]!) : null;

  if (reading.documentType === "p60") {
    reading.annualGrossIncome = amountAfter(haystack, /(?:total for year|pay in this employment|total pay)/);
    reading.grossPayForPeriod = reading.annualGrossIncome;
  } else if (reading.documentType === "sa302" || reading.documentType === "tax_year_overview") {
    reading.annualGrossIncome = amountAfter(haystack, /(?:total income received|total income|profit from self[- ]employment)/);
    reading.grossPayForPeriod = reading.annualGrossIncome;
  } else {
    // Payslip: the period figure is the gross line that is *not* a year-to-date one.
    const grossLine = new RegExp(`((?:total\\s+)?gross(?:\\s+pay|\\s+earnings|\\s+for\\s+period)?(?:\\s+(?:to\\s+date|ytd|this\\s+year))?)[^\\d£\\n]{0,40}${MONEY}`, "gi");
    const grossLines = [...haystack.matchAll(grossLine)];
    const isToDate = (label: string) => /to date|ytd|this year/i.test(label);
    const period = grossLines.find((m) => !isToDate(m[1]!));
    const toDate = grossLines.find((m) => isToDate(m[1]!));
    reading.grossPayForPeriod = period ? num(period[2]) : null;
    const annualSalary = amountAfter(haystack, /(?:annual salary|basic salary|salary per annum|per annum)/);
    if (annualSalary != null) {
      reading.annualGrossIncome = annualSalary;
    } else if (reading.grossPayForPeriod != null && reading.payFrequency) {
      reading.annualGrossIncome = round(reading.grossPayForPeriod * PERIODS_PER_YEAR[reading.payFrequency]);
    } else if (toDate) {
      // Year-to-date ÷ periods elapsed, when the payslip numbers its period.
      const periodNumber = haystack.match(/(?:tax period|period|month|week)\s*(?:no\.?|number)?\s*[:\-]?\s*(\d{1,2})\b/i);
      const n = periodNumber ? Number(periodNumber[1]) : NaN;
      const ytd = num(toDate[2]);
      if (ytd != null && n > 0) {
        const perYear = reading.payFrequency ? PERIODS_PER_YEAR[reading.payFrequency] : 12;
        reading.annualGrossIncome = round((ytd / n) * perYear);
      }
    }
  }

  const payDate = haystack.match(/(?:pay(?:ment)? date|period end(?:ing)?|date paid|tax year(?: to)?(?: 5 april)?)\s*[:\-]?\s*(\d{1,2}[/\-. ][0-9A-Za-z]{1,9}[/\-. ]\d{2,4}|20\d\d\s*[/\-]\s*\d{2,4}|20\d\d\s+to\s+20\d\d)/i);
  reading.periodEnd = payDate ? payDate[1]!.trim() : null;

  reading.employmentStatus =
    reading.documentType === "sa302" || reading.documentType === "tax_year_overview" ? "self_employed"
    : reading.documentType === "payslip" || reading.documentType === "p60"
      ? (/\bdirector\b/i.test(reading.jobTitle ?? "") ? "company_director" : "employed")
      : null;

  if (reading.annualGrossIncome != null) {
    reading.confidence = yearly ? "medium" : "low";
    reading.notes = "Read by text patterns; check the figure against the document.";
  }
  return reading;
}

function cleanLabelValue(value: string) {
  const cleaned = value.replace(/\s{2,}.*$/, "").replace(/[|:]+$/, "").trim();
  return cleaned.length >= 2 && !/^\d+$/.test(cleaned) ? cleaned : null;
}

/** Fills the client's employment fields that are still empty; never overwrites what staff entered. */
async function apply(document: DocumentRow, data: ProofOfIncomeReading, actorName: string) {
  const income = data.annualGrossIncome != null ? `£${data.annualGrossIncome.toLocaleString("en-GB")}/yr` : "no annual figure";
  return fillEmptyClientFields(document, {
    annualIncome: data.annualGrossIncome,
    employerName: data.employerName,
    jobTitle: data.jobTitle,
    employmentStatus: data.employmentStatus,
  }, actorName, "Document read: proof of income", income);
}

/** AI values win; the heuristic fills anything the model left null. */
function merge(primary: ProofOfIncomeReading, fallback: ProofOfIncomeReading): ProofOfIncomeReading {
  const merged = { ...primary };
  for (const key of Object.keys(EMPTY) as Array<keyof ProofOfIncomeReading>) {
    if (merged[key] == null && fallback[key] != null) merged[key] = fallback[key];
  }
  return annualised(merged);
}

export const proofOfIncomeReader: DocumentReader<ProofOfIncomeReading> = {
  key: "proof_of_income",
  categories: ["proof_income"],
  systemInstruction: SYSTEM_INSTRUCTION,
  progressLabels: {
    documentType: "Working out what kind of document this is…",
    employerName: "Reading the employer…",
    jobTitle: "Reading the job title…",
    payFrequency: "Checking how often they are paid…",
    grossPayForPeriod: "Finding the gross pay…",
    annualGrossIncome: "Working out the annual income…",
    confidence: "Weighing up how sure it is…",
  },
  normalise,
  heuristic,
  merge,
  apply,
};
