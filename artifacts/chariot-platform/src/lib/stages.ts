import type { DefaultAssigneeSection } from "@workspace/api-client-react";
import type { StaffRole } from "@/lib/roles";

// Pipeline stages in order. Mirrors `stages` in api-server/src/routes/operations.ts;
// the API sends stage names (and usually stageIndex), this maps them to a colour.
export const CASE_STAGES = [
  "Advice & approval",
  "Submission details",
  "Submission",
  "Underwriting",
  "Stress test",
  "Lender offer",
  "Invoice & payment",
  "Completion",
] as const;

export const SUBMISSION_STAGE_INDEX = CASE_STAGES.indexOf("Submission");

export type StageSection = Extract<DefaultAssigneeSection, `stage_${number}`>;

/** Settings key holding the default assignee for a pipeline stage. */
export const stageSection = (stageIndex: number): StageSection =>
  `stage_${stageIndex}` as StageSection;

/**
 * Staff role that owns each stage (mirrors stageOwnerRole in
 * api-server/src/services/stages.ts). Used to label the role fallback.
 */
export function stageOwnerRole(stageIndex: number): StaffRole {
  const stage = CASE_STAGES[stageIndex];
  if (stage === "Advice & approval") return "broker_ceo";
  if (stage === "Submission details" || stage === "Submission")
    return "case_manager";
  return "completions_manager";
}

/**
 * Structured steps inside the Submission stage, each with its own Settings
 * key for a default assignee (mirrors SUBMISSION_STEPS in
 * api-server/src/services/assignment.ts).
 */
export const SUBMISSION_STEPS = [
  {
    section: "submission_lender",
    label: "Lender",
    description: "Selects the lender for the case.",
  },
  {
    section: "submission_dip",
    label: "Decision in principle (DIP)",
    description: "Uploads the DIP document.",
  },
  {
    section: "submission_case_number",
    label: "Lender case number",
    description: "Records the case number issued by the lender.",
  },
  {
    section: "submission_portfolio",
    label: "Required portfolio",
    description:
      "Sends the portfolio when the lender requires one at submission.",
  },
  {
    section: "submission_fee",
    label: "Application & valuation fee",
    description: "Confirms the fee has been paid.",
  },
  {
    section: "submission_valuation_date",
    label: "Valuation date",
    description: "Books and records the valuation date.",
  },
  {
    section: "submission_decision",
    label: "Lender decision",
    description: "Requests the decision from the lender.",
  },
] as const;
export type SubmissionStepSection =
  (typeof SUBMISSION_STEPS)[number]["section"];

export type StageClasses = {
  /** Solid fill + white text (badges, stepper nodes). */
  solid: string;
  /** Coloured text on the page background. */
  text: string;
  /** Soft tint background (cards, rows). */
  tint: string;
  /** Solid background only (dots, bars, connectors). */
  bg: string;
  /** Much darker fill for large surfaces such as the case hero band. */
  hero: string;
  /** Border in the stage colour. */
  border: string;
  /** Left-edge accent bar in the stage colour. */
  accent: string;
  /** Focus/selection ring in the stage colour. */
  ring: string;
};

// Full literal class strings so Tailwind's scanner picks them up.
const STAGE_CLASSES: StageClasses[] = [
  {
    solid: "bg-stage-0 text-stage-foreground border-stage-0",
    text: "text-stage-0",
    tint: "bg-stage-0/10",
    bg: "bg-stage-0",
    hero: "bg-[color-mix(in_srgb,var(--color-stage-0),black_45%)]",
    border: "border-stage-0",
    accent: "border-l-stage-0",
    ring: "ring-stage-0/30",
  },
  {
    solid: "bg-stage-1 text-stage-foreground border-stage-1",
    text: "text-stage-1",
    tint: "bg-stage-1/10",
    bg: "bg-stage-1",
    hero: "bg-[color-mix(in_srgb,var(--color-stage-1),black_45%)]",
    border: "border-stage-1",
    accent: "border-l-stage-1",
    ring: "ring-stage-1/30",
  },
  {
    solid: "bg-stage-2 text-stage-foreground border-stage-2",
    text: "text-stage-2",
    tint: "bg-stage-2/10",
    bg: "bg-stage-2",
    hero: "bg-[color-mix(in_srgb,var(--color-stage-2),black_45%)]",
    border: "border-stage-2",
    accent: "border-l-stage-2",
    ring: "ring-stage-2/30",
  },
  {
    solid: "bg-stage-3 text-stage-foreground border-stage-3",
    text: "text-stage-3",
    tint: "bg-stage-3/10",
    bg: "bg-stage-3",
    hero: "bg-[color-mix(in_srgb,var(--color-stage-3),black_45%)]",
    border: "border-stage-3",
    accent: "border-l-stage-3",
    ring: "ring-stage-3/30",
  },
  {
    solid: "bg-stage-4 text-stage-foreground border-stage-4",
    text: "text-stage-4",
    tint: "bg-stage-4/10",
    bg: "bg-stage-4",
    hero: "bg-[color-mix(in_srgb,var(--color-stage-4),black_45%)]",
    border: "border-stage-4",
    accent: "border-l-stage-4",
    ring: "ring-stage-4/30",
  },
  {
    solid: "bg-stage-5 text-stage-foreground border-stage-5",
    text: "text-stage-5",
    tint: "bg-stage-5/10",
    bg: "bg-stage-5",
    hero: "bg-[color-mix(in_srgb,var(--color-stage-5),black_45%)]",
    border: "border-stage-5",
    accent: "border-l-stage-5",
    ring: "ring-stage-5/30",
  },
  {
    solid: "bg-stage-6 text-stage-foreground border-stage-6",
    text: "text-stage-6",
    tint: "bg-stage-6/10",
    bg: "bg-stage-6",
    hero: "bg-[color-mix(in_srgb,var(--color-stage-6),black_45%)]",
    border: "border-stage-6",
    accent: "border-l-stage-6",
    ring: "ring-stage-6/30",
  },
  {
    solid: "bg-stage-7 text-stage-foreground border-stage-7",
    text: "text-stage-7",
    tint: "bg-stage-7/10",
    bg: "bg-stage-7",
    hero: "bg-[color-mix(in_srgb,var(--color-stage-7),black_45%)]",
    border: "border-stage-7",
    accent: "border-l-stage-7",
    ring: "ring-stage-7/30",
  },
];

const FALLBACK_CLASSES: StageClasses = {
  solid: "bg-muted text-muted-foreground border-border",
  text: "text-muted-foreground",
  tint: "bg-muted",
  bg: "bg-muted-foreground",
  hero: "bg-[color-mix(in_srgb,var(--color-muted-foreground),black_45%)]",
  border: "border-border",
  accent: "border-l-border",
  ring: "ring-ring/30",
};

/** Index of a stage by name, or -1 when unknown. */
export function stageIndexOf(stage: string): number {
  return CASE_STAGES.indexOf(stage as (typeof CASE_STAGES)[number]);
}

/**
 * Colour classes for a stage. Accepts a stage index, or a name when the API
 * payload has no index (e.g. property active cases, dashboard stage counts).
 */
export function stageClasses(stage: number | string): StageClasses {
  const index = typeof stage === "number" ? stage : stageIndexOf(stage);
  return STAGE_CLASSES[index] ?? FALLBACK_CLASSES;
}
