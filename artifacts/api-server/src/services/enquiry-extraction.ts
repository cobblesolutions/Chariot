import { ENQUIRY_TYPES, type EnquiryType } from "@workspace/db";
import { runOpenRouterWorkflow } from "../integrations/openrouter";
import { logger } from "../lib/logger";

/**
 * What we try to read out of an enquiry email. Every field is optional — the
 * worker reviews and completes the form before anything is saved.
 */
export interface ExtractedEnquiry {
  client: {
    name: string | null;
    email: string | null;
    phone: string | null;
    companyName: string | null;
    companyNumber: string | null;
  };
  property: {
    address: string | null;
    value: number | null;
    loanAmount: number | null;
    rent: number | null;
    matterType: string | null;
  };
  enquiry: {
    type: EnquiryType | null;
    timescale: string | null;
    summary: string | null;
  };
}

export interface ExtractionResult {
  extracted: ExtractedEnquiry;
  /** Model that produced the result, or null when the heuristic fallback ran. */
  model: string | null;
}

const EMPTY: ExtractedEnquiry = {
  client: { name: null, email: null, phone: null, companyName: null, companyNumber: null },
  property: { address: null, value: null, loanAmount: null, rent: null, matterType: null },
  enquiry: { type: null, timescale: null, summary: null },
};

const SYSTEM_INSTRUCTION = `You read enquiry emails received by a UK mortgage broker and return JSON only.
Return an object with exactly these keys:
{
  "client": { "name", "email", "phone", "companyName", "companyNumber" },
  "property": { "address", "value", "loanAmount", "rent", "matterType" },
  "enquiry": { "type", "timescale", "summary" }
}
Rules: use null for anything not stated. "name" is the person enquiring (not the broker). "companyName" is the borrowing limited company/SPV if one is mentioned. "value", "loanAmount" and "rent" are plain numbers in pounds (rent per month). "matterType" is one of "btl", "residential", "commercial", "bridging", "development" or null. "type" is one of ${ENQUIRY_TYPES.map((t) => `"${t}"`).join(", ")} or null. "timescale" is the client's own words about timing. "summary" is one or two sentences, in plain English, on what they want.`;

/**
 * Read the pasted/forwarded email. Uses the AI workflow when it is active and
 * falls back to simple heuristics so the intake form is always pre-filled
 * with something the worker can correct.
 */
export async function extractEnquiry(input: {
  emailText: string;
  subject?: string | null;
  from?: string | null;
}): Promise<ExtractionResult> {
  const heuristic = heuristicExtract(input);
  try {
    const result = await runOpenRouterWorkflow<{ subject: string | null; from: string | null; email: string }, Partial<ExtractedEnquiry>>({
      workflow: "extract_client_enquiry",
      schemaName: "EnquiryExtraction",
      systemInstruction: SYSTEM_INSTRUCTION,
      context: { subject: input.subject ?? null, from: input.from ?? null, email: input.emailText },
    });
    if (result.status === "completed" && result.data) {
      return { extracted: mergeExtraction(normaliseAi(result.data), heuristic), model: result.model ?? null };
    }
  } catch (error) {
    logger.warn({ err: error }, "Enquiry extraction fell back to heuristics");
  }
  return { extracted: heuristic, model: null };
}

/** AI values win; the heuristic fills anything the model left null. */
function mergeExtraction(primary: ExtractedEnquiry, fallback: ExtractedEnquiry): ExtractedEnquiry {
  const pick = <T>(a: T | null, b: T | null) => (a === null || a === "" ? b : a);
  return {
    client: {
      name: pick(primary.client.name, fallback.client.name),
      email: pick(primary.client.email, fallback.client.email),
      phone: pick(primary.client.phone, fallback.client.phone),
      companyName: pick(primary.client.companyName, fallback.client.companyName),
      companyNumber: pick(primary.client.companyNumber, fallback.client.companyNumber),
    },
    property: {
      address: pick(primary.property.address, fallback.property.address),
      value: pick(primary.property.value, fallback.property.value),
      loanAmount: pick(primary.property.loanAmount, fallback.property.loanAmount),
      rent: pick(primary.property.rent, fallback.property.rent),
      matterType: pick(primary.property.matterType, fallback.property.matterType),
    },
    enquiry: {
      type: pick(primary.enquiry.type, fallback.enquiry.type),
      timescale: pick(primary.enquiry.timescale, fallback.enquiry.timescale),
      summary: pick(primary.enquiry.summary, fallback.enquiry.summary),
    },
  };
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const num = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[£,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
const enquiryType = (value: unknown): EnquiryType | null =>
  typeof value === "string" && (ENQUIRY_TYPES as readonly string[]).includes(value) ? (value as EnquiryType) : null;

function normaliseAi(data: Partial<ExtractedEnquiry>): ExtractedEnquiry {
  const client = (data.client ?? {}) as Record<string, unknown>;
  const property = (data.property ?? {}) as Record<string, unknown>;
  const enquiry = (data.enquiry ?? {}) as Record<string, unknown>;
  return {
    client: {
      name: str(client.name),
      email: str(client.email)?.toLowerCase() ?? null,
      phone: str(client.phone),
      companyName: str(client.companyName),
      companyNumber: str(client.companyNumber),
    },
    property: {
      address: str(property.address),
      value: num(property.value),
      loanAmount: num(property.loanAmount),
      rent: num(property.rent),
      matterType: str(property.matterType),
    },
    enquiry: {
      type: enquiryType(enquiry.type),
      timescale: str(enquiry.timescale),
      summary: str(enquiry.summary),
    },
  };
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const UK_PHONE_RE = /(?:\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}|(?:\+44\s?\d{2,4}|\(?0\d{2,4}\)?)\s?\d{3,4}\s?\d{3,4}/;
const MONEY_RE = /£\s?([\d,]+(?:\.\d+)?)\s*(k|m)?\b/gi;
// Up to five capitalised words straight before a company suffix, so a sentence
// prefix ("I own a buy to let through …") is never swept into the name.
const COMPANY_RE = /\b((?:[A-Z][A-Za-z0-9&'.\-]*\s+){1,5}(?:Ltd|Limited|LLP|PLC))\b\.?/;
const MONTH = "(?:january|february|march|april|may|june|july|august|september|october|november|december)";
const PERIOD = `(?:the\\s+)?(?:end of\\s+|start of\\s+|beginning of\\s+|mid[- ]?)?(?:\\d+\\s+(?:days?|weeks?|months?)|${MONTH}(?:\\s+\\d{4})?|(?:next|this)\\s+(?:week|month|year)|christmas|easter|the new year)`;
// A deadline ("by the end of October") beats a passing mention ("in November").
const DEADLINE_RE = new RegExp(`\\b((?:by|before|within|no later than)\\s+${PERIOD})`, "i");
const MENTION_RE = new RegExp(`\\b((?:in|around|from)\\s+${PERIOD}|asap|as soon as possible|urgently?)`, "i");

function timescaleIn(text: string): string | null {
  return DEADLINE_RE.exec(text)?.[1] ?? MENTION_RE.exec(text)?.[1] ?? null;
}

/**
 * The address is whatever sits in front of the first UK postcode: back to a
 * house number ("14 Elm Grove"), or failing that to "at" / "is" / a colon.
 */
function addressAround(text: string): string | null {
  const postcode = UK_POSTCODE_RE.exec(text);
  if (!postcode || postcode.index == null) return null;
  const before = text.slice(Math.max(0, postcode.index - 90), postcode.index);
  const houseNumber = [...before.matchAll(/\b(\d{1,4}[A-Za-z]?\s+[A-Z][A-Za-z'\-]+)/g)].at(-1);
  let start: number;
  if (houseNumber && houseNumber.index != null) {
    start = houseNumber.index;
  } else {
    const anchor = [...before.matchAll(/(?:\bat|\bis|\baddress|:)\s+/gi)].at(-1);
    start = anchor && anchor.index != null ? anchor.index + anchor[0].length : Math.max(0, before.length - 60);
    // Never start mid-word.
    const wordBoundary = before.slice(start).search(/[A-Z0-9]/);
    start += wordBoundary > 0 ? wordBoundary : 0;
  }
  const address = `${before.slice(start)}${postcode[0]}`
    .replace(/\s+/g, " ")
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "")
    .trim();
  return address.length >= 6 && address.length <= 120 ? address : null;
}
const COMPANY_NUMBER_RE = /\b(?:company (?:no|number|reg(?:istration)?)\.?:?\s*)(\d{8}|[A-Z]{2}\d{6})\b/i;
const UK_POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
// "From: Name <addr>" or "From: addr". The display name is only taken when an
// angle-bracketed address follows, so a bare address is never split in two.
const FROM_LINE_RE = /^from:\s*(?:"?([^"<\n@]+?)"?\s*<)?\s*([^\s<>@]+@[^\s<>]+)>?/im;
const SIGN_OFF_RE = /^(?:kind regards|best regards|regards|many thanks|thanks|thank you|cheers|best|yours sincerely|yours faithfully)[,.!]?\s*$/i;

const TYPE_KEYWORDS: Array<[EnquiryType, RegExp]> = [
  ["bridging", /\bbridg(?:e|ing)\b/i],
  ["development", /\bdevelopment (?:finance|loan)|\brefurb/i],
  ["commercial", /\bcommercial\b|\bsemi-commercial\b/i],
  ["remortgage", /\bremortgag|\bre-mortgag|\brate (?:is )?(?:ending|expir)|\bproduct transfer/i],
  ["refinance", /\brefinanc|\bcapital raise|\braise (?:some )?(?:capital|funds)/i],
  ["purchase", /\bpurchas|\bbuy(?:ing)?\b|\boffer (?:has been )?accepted|\bauction/i],
];

const MATTER_KEYWORDS: Array<[string, RegExp]> = [
  ["bridging", /\bbridg/i],
  ["development", /\bdevelopment|\brefurb/i],
  ["commercial", /\bcommercial/i],
  ["btl", /\bbuy[- ]to[- ]let|\bbtl\b|\brental|\btenant|\blet(?:ting)?\b|\bhmo\b|\bportfolio/i],
  ["residential", /\bresidential|\bown home|\bfamily home|\bfirst[- ]time buyer/i],
];

function toNumber(raw: string, suffix: string | undefined): number {
  const base = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(base)) return NaN;
  if (suffix?.toLowerCase() === "k") return base * 1_000;
  if (suffix?.toLowerCase() === "m") return base * 1_000_000;
  return base;
}

/** Cheap, deterministic read of the email for when the AI is not active. */
export function heuristicExtract(input: {
  emailText: string;
  subject?: string | null;
  from?: string | null;
}): ExtractedEnquiry {
  const text = input.emailText.replace(/\r/g, "");
  const lines = text.split("\n").map((line) => line.trim());
  const out: ExtractedEnquiry = structuredClone(EMPTY);

  // Sender: explicit From header on the webhook, or a From: line in a pasted email.
  const fromLine = FROM_LINE_RE.exec(text);
  const fromHeader = input.from ? FROM_LINE_RE.exec(`From: ${input.from}`) : null;
  const fromName = (fromHeader?.[1] ?? fromLine?.[1] ?? "").trim() || null;
  const fromEmail = fromHeader?.[2] ?? fromLine?.[2] ?? null;
  out.client.email = (fromEmail ?? EMAIL_RE.exec(text)?.[0] ?? null)?.toLowerCase() ?? null;

  // Name: the line after a sign-off beats the From display name, which is often a mailbox label.
  let signatureName: string | null = null;
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (SIGN_OFF_RE.test(lines[index]!)) {
      const candidate = lines.slice(index + 1).find((line) => line.length > 0) ?? "";
      if (candidate && candidate.length <= 60 && !EMAIL_RE.test(candidate) && !/\d{4,}/.test(candidate)) {
        signatureName = candidate.replace(/[,.]$/, "");
      }
      break;
    }
  }
  out.client.name = signatureName ?? (fromName && !fromName.includes("@") ? fromName.trim() : null);

  out.client.phone = UK_PHONE_RE.exec(text)?.[0]?.replace(/\s+/g, " ").trim() ?? null;
  out.client.companyName = COMPANY_RE.exec(text)?.[1]?.trim() ?? null;
  out.client.companyNumber = COMPANY_NUMBER_RE.exec(text)?.[1] ?? null;

  // Amounts: the largest £ figure is the property value, the next the loan.
  // Anything that reads like a monthly figure is rent.
  const amounts: Array<{ value: number; monthly: boolean }> = [];
  for (const match of text.matchAll(MONEY_RE)) {
    const value = toNumber(match[1]!, match[2]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const tail = text.slice(match.index! + match[0].length, match.index! + match[0].length + 20);
    amounts.push({ value, monthly: /^\s*(?:pcm|per month|a month|\/month|p\/m|pm\b)/i.test(tail) });
  }
  const rent = amounts.find((item) => item.monthly);
  const capital = amounts.filter((item) => !item.monthly).map((item) => item.value).sort((a, b) => b - a);
  out.property.rent = rent?.value ?? null;
  out.property.value = capital[0] ?? null;
  out.property.loanAmount = capital[1] ?? null;

  out.property.address = addressAround(text);

  const haystack = `${input.subject ?? ""}\n${text}`;
  out.enquiry.type = TYPE_KEYWORDS.find(([, re]) => re.test(haystack))?.[0] ?? null;
  out.property.matterType = MATTER_KEYWORDS.find(([, re]) => re.test(haystack))?.[0] ?? null;
  if (!out.property.matterType && out.enquiry.type) {
    out.property.matterType = out.enquiry.type === "bridging" || out.enquiry.type === "development" || out.enquiry.type === "commercial"
      ? out.enquiry.type
      : null;
  }

  out.enquiry.timescale = timescaleIn(text);

  // Summary: the body before any sign-off, minus headers, trimmed to a paragraph.
  const bodyStart = lines.findIndex((line) => /^(?:hi|hello|dear|good (?:morning|afternoon|evening))\b/i.test(line));
  const bodyEnd = lines.findIndex((line, index) => index > bodyStart && SIGN_OFF_RE.test(line));
  const body = lines
    .slice(bodyStart >= 0 ? bodyStart + 1 : 0, bodyEnd > 0 ? bodyEnd : undefined)
    .filter((line) => line && !/^(?:from|to|cc|subject|sent|date):/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  out.enquiry.summary = body ? (body.length > 400 ? `${body.slice(0, 397)}…` : body) : null;

  return out;
}
