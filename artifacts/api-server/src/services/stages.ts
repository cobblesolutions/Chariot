import type { StaffRole } from "../auth/roles";

/**
 * Pipeline stages in order — the scope's steps 5–7 come first: the adviser
 * confirms the service level and sends the advice, then the submission
 * details are gathered and confirmed by the client, then the case goes to
 * the lender. Mirrored in chariot-platform/src/lib/stages.ts.
 */
export const STAGES = [
  "Advice & approval",
  "Submission details",
  "Submission",
  "Underwriting",
  "Stress test",
  "Lender offer",
  "Invoice & payment",
  "Completion",
] as const;

export const SUBMISSION_STAGE_INDEX = STAGES.indexOf("Submission");

// Which staff role "owns" each pipeline stage: the advice stage belongs to
// the adviser (always an administrator); details and submission to the case
// manager; everything from underwriting on to completions. A handoff task
// goes to the stage's default assignee (Settings) or that role when a case
// enters the stage.
export const stageOwnerRole: StaffRole[] = STAGES.map((stage) => {
  if (stage === "Advice & approval") return "broker_ceo";
  if (stage === "Submission details" || stage === "Submission") return "case_manager";
  return "completions_manager";
});
