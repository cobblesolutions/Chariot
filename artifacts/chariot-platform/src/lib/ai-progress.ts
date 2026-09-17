import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAiProgress } from "@workspace/api-client-react";

/** Header the API reads to tie a request to a progress token. */
export const AI_PROGRESS_HEADER = "x-ai-progress";

export const newProgressToken = () =>
  `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * What a read is doing when the server has not said anything yet (or between
 * its messages): a per-kind sequence that walks forward on a timer, so the
 * button never sits on one line for long.
 */
export type AiReadKind =
  | "email"
  | "instruction"
  | "underwriting"
  | "lender_offer"
  | "identity"
  | "bank_statements"
  | "proof_income"
  | "credit_report"
  | "portfolio"
  | "document";

const FALLBACK: Record<AiReadKind, string[]> = {
  email: ["Reading the email…", "Working out who is asking…", "Finding the property and the numbers…", "Working out what they want…", "Checking how they came to us…", "Checking for existing clients…", "Nearly there…"],
  instruction: ["Reading the email…", "Working out which lender they chose…", "Reading the product and rate…", "Reading the loan amount…", "Writing the summary…"],
  underwriting: ["Reading the email…", "Listing what the lender is asking for…", "Tidying the list…"],
  lender_offer: ["Opening the offer…", "Reading the offer terms…", "Finding the dates…", "Writing the summary…"],
  identity: ["Opening the document…", "Working out what kind of ID this is…", "Reading the name and date of birth…", "Checking the expiry date…", "Filling in the record…"],
  bank_statements: ["Opening the statement…", "Finding salary credits…", "Going through the direct debits…", "Adding up the commitments…", "Checking account conduct…", "Filling in the record…"],
  proof_income: ["Opening the document…", "Finding the gross pay…", "Working out the annual income…", "Reading the employer and job title…", "Filling in the record…"],
  credit_report: ["Opening the report…", "Reading the score…", "Looking for defaults, CCJs and missed payments…", "Reading the address history…", "Totalling unsecured debt…", "Writing the credit-history summary…"],
  portfolio: ["Opening the schedule…", "Matching the columns…", "Reading the properties one by one…", "Checking against existing properties…", "Creating property records…"],
  document: ["Opening the document…", "Reading…", "Filling in the record…"],
};

const DOCUMENT_KINDS: ReadonlyArray<string> = ["identity", "bank_statements", "proof_income", "credit_report", "portfolio"];
export const readKindForCategory = (category: string): AiReadKind =>
  DOCUMENT_KINDS.includes(category) ? (category as AiReadKind) : "document";

/**
 * The line to show while `active`. Server messages (polled by token, or
 * passed in for background document reads) win as they arrive; between them
 * the fallback sequence for `kind` keeps moving every few seconds.
 */
export function useAiProgress(options: {
  active: boolean;
  kind: AiReadKind;
  /** Token sent as x-ai-progress on the request; polled while active. */
  token?: string | null;
  /** A message already known (e.g. `reading.progress` from a polled document). */
  serverMessage?: string | null;
}): string | null {
  const { active, kind, token, serverMessage } = options;
  const polled = useQuery({
    queryKey: ["/api/ai/progress", token],
    queryFn: () => getAiProgress(token!),
    enabled: active && !!token,
    refetchInterval: active ? 700 : false,
    staleTime: 0,
  });
  const latestServer = serverMessage ?? polled.data?.current ?? null;

  // Fallback stepper: advances every few seconds until the server says something.
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) {
      setStep(0);
      return;
    }
    const timer = window.setInterval(() => setStep((current) => current + 1), 3000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return null;
  if (latestServer) return latestServer;
  const sequence = FALLBACK[kind];
  return sequence[Math.min(step, sequence.length - 1)] ?? "Reading…";
}
