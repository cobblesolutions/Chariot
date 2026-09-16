import { db, lendersTable } from "@workspace/db";
import { runOpenRouterWorkflow } from "../integrations/openrouter";
import { logger } from "../lib/logger";

/** What we read out of an execution-only client's email: the mortgage they have chosen. */
export interface ExtractedInstruction {
  lenderId: number | null;
  lenderName: string | null;
  product: string | null;
  ratePct: number | null;
  termYears: number | null;
  loanAmount: number | null;
  summary: string | null;
}

const EMPTY: ExtractedInstruction = { lenderId: null, lenderName: null, product: null, ratePct: null, termYears: null, loanAmount: null, summary: null };

const SYSTEM_INSTRUCTION = `You read an email from a UK mortgage client who has already chosen their mortgage (execution-only). Return JSON only:
{ "lenderName", "product", "ratePct", "termYears", "loanAmount", "summary" }
Rules: null for anything not stated. "product" is the deal they name (e.g. "5-year fixed, 75% LTV"). "ratePct" is a plain number. "termYears" is the mortgage term in years (not the fixed period). "loanAmount" in pounds. "summary" is one or two plain sentences of what they are instructing us to submit.`;

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[£,%\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export async function extractInstruction(emailText: string): Promise<{ extracted: ExtractedInstruction; model: string | null }> {
  const lenders = await db.select({ id: lendersTable.id, name: lendersTable.name }).from(lendersTable);
  const heuristic = heuristicInstruction(emailText, lenders);
  try {
    const result = await runOpenRouterWorkflow<{ email: string; knownLenders: string[] }, Partial<Record<keyof ExtractedInstruction, unknown>>>({
      workflow: "extract_client_instruction",
      schemaName: "ClientInstruction",
      systemInstruction: SYSTEM_INSTRUCTION,
      context: { email: emailText, knownLenders: lenders.map((lender) => lender.name) },
    });
    if (result.status === "completed" && result.data) {
      const ai: ExtractedInstruction = {
        ...EMPTY,
        lenderName: str(result.data.lenderName),
        product: str(result.data.product),
        ratePct: num(result.data.ratePct),
        termYears: num(result.data.termYears) != null ? Math.round(num(result.data.termYears)!) : null,
        loanAmount: num(result.data.loanAmount),
        summary: str(result.data.summary),
      };
      ai.lenderId = matchLender(ai.lenderName, lenders)?.id ?? null;
      const pick = <T>(a: T | null, b: T | null) => (a === null ? b : a);
      return {
        extracted: {
          lenderId: pick(ai.lenderId, heuristic.lenderId),
          lenderName: pick(ai.lenderName, heuristic.lenderName),
          product: pick(ai.product, heuristic.product),
          ratePct: pick(ai.ratePct, heuristic.ratePct),
          termYears: pick(ai.termYears, heuristic.termYears),
          loanAmount: pick(ai.loanAmount, heuristic.loanAmount),
          summary: pick(ai.summary, heuristic.summary),
        },
        model: result.model ?? null,
      };
    }
  } catch (error) {
    logger.warn({ err: error }, "Instruction extraction fell back to heuristics");
  }
  return { extracted: heuristic, model: null };
}

function matchLender(name: string | null, lenders: Array<{ id: number; name: string }>) {
  if (!name) return null;
  const needle = name.toLowerCase();
  return lenders.find((lender) => lender.name.toLowerCase() === needle)
    ?? lenders.find((lender) => needle.includes(lender.name.toLowerCase()) || lender.name.toLowerCase().includes(needle))
    ?? null;
}

const SIGN_OFF_RE = /^(?:kind regards|best regards|regards|many thanks|thanks|thank you|cheers|best|yours sincerely|yours faithfully)[,.!]?\s*$/i;

/** Deterministic read when the AI is not active: lender by name match, rate %, term, £ amount, first paragraph. */
export function heuristicInstruction(emailText: string, lenders: Array<{ id: number; name: string }>): ExtractedInstruction {
  const text = emailText.replace(/\r/g, "");
  const lower = text.toLowerCase();
  const lender = lenders.find((item) => lower.includes(item.name.toLowerCase())) ?? null;

  const rate = /(\d{1,2}(?:\.\d{1,3})?)\s?%/.exec(text);
  // "25 year term" / "over 25 years" beat "5 year fix": prefer a term phrase, then the larger of any year figures.
  const termPhrase = /(\d{1,2})\s*[- ]?years?\s*(?:term|mortgage term)|(?:term of|over)\s*(\d{1,2})\s*[- ]?years?/i.exec(text);
  const years = [...text.matchAll(/(\d{1,2})\s*[- ]?(?:years?|yr)\b/gi)].map((match) => Number(match[1])).filter((n) => n >= 5 && n <= 40);
  const termYears = termPhrase ? Number(termPhrase[1] ?? termPhrase[2]) : years.length ? Math.max(...years) : null;
  const fix = /(\d{1,2})\s*[- ]?year\s*(?:fix(?:ed)?|tracker|variable|discount)/i.exec(text);
  const ltv = /(\d{2})\s?%\s*ltv/i.exec(text);
  const productBits = [
    fix ? `${fix[1]}-year ${/tracker/i.test(fix[0]) ? "tracker" : /variable/i.test(fix[0]) ? "variable" : /discount/i.test(fix[0]) ? "discount" : "fixed"}` : null,
    ltv ? `${ltv[1]}% LTV` : null,
  ].filter(Boolean);
  const amounts = [...text.matchAll(/£\s?([\d,]+(?:\.\d+)?)\s*(k|m)?\b/gi)]
    .map((match) => Number(match[1].replace(/,/g, "")) * (match[2]?.toLowerCase() === "k" ? 1_000 : match[2]?.toLowerCase() === "m" ? 1_000_000 : 1))
    .filter((value) => Number.isFinite(value) && value > 0);
  const loanContext = /(?:borrow|loan|mortgage of|lend)[^£\n]{0,40}£\s?([\d,]+(?:\.\d+)?)\s*(k|m)?/i.exec(text);
  const loanAmount = loanContext
    ? Number(loanContext[1].replace(/,/g, "")) * (loanContext[2]?.toLowerCase() === "k" ? 1_000 : loanContext[2]?.toLowerCase() === "m" ? 1_000_000 : 1)
    : amounts.length ? Math.min(...amounts) : null;

  const lines = text.split("\n").map((line) => line.trim());
  const bodyStart = lines.findIndex((line) => /^(?:hi|hello|dear|good (?:morning|afternoon|evening))\b/i.test(line));
  const bodyEnd = lines.findIndex((line, index) => index > bodyStart && SIGN_OFF_RE.test(line));
  const body = lines
    .slice(bodyStart >= 0 ? bodyStart + 1 : 0, bodyEnd > 0 ? bodyEnd : undefined)
    .filter((line) => line && !/^(?:from|to|cc|subject|sent|date):/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    lenderId: lender?.id ?? null,
    lenderName: lender?.name ?? null,
    product: productBits.length ? productBits.join(", ") : null,
    ratePct: rate ? Number(rate[1]) : null,
    termYears,
    loanAmount,
    summary: body ? (body.length > 400 ? `${body.slice(0, 397)}…` : body) : null,
  };
}
