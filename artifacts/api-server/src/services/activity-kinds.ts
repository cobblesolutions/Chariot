/**
 * Machine-readable activity kinds. Activities are written with a free-text
 * title; `activities.kind` records which kind it is so the notifications page
 * can group and colour without regex-matching the words. Rows written before
 * the column existed (or by code that has not been moved to `logActivity`)
 * are classified from the title at read time with the same matchers.
 * Mirrored by `KINDS` in chariot-platform/src/lib/notification-kinds.ts.
 */
export const ACTIVITY_KINDS = [
  "case_completed",
  "case_archived",
  "case_restored",
  "case_reference",
  "stage",
  "case",
  "stress_test",
  "lender_offer",
  "underwriting",
  "advice",
  "client_flag",
  "enquiry_accepted",
  "enquiry_closed",
  "enquiry",
  "welcome",
  "terms",
  "onboarded",
  "client",
  "property",
  "document",
  "invoice",
  "renewal",
  "payment",
  "update",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const isActivityKind = (value: unknown): value is ActivityKind =>
  typeof value === "string" && (ACTIVITY_KINDS as readonly string[]).includes(value);

/** Ordered: the first matcher that hits wins, so specific titles come before generic ones. */
const MATCHERS: Array<[RegExp, ActivityKind]> = [
  [/^case completed/i, "case_completed"],
  [/^case archived/i, "case_archived"],
  [/^case restored/i, "case_restored"],
  [/^case number/i, "case_reference"],
  [/^(stage completed|pipeline reordered)/i, "stage"],
  [/^case/i, "case"],
  [/^stress test/i, "stress_test"],
  [/^lender offer/i, "lender_offer"],
  [/^(requirement|underwriting)/i, "underwriting"],
  [/^(service level confirmed|advice (sent|re-sent)|client approved advice|details (sent|re-sent) for confirmation|client confirmed details|details prefilled|client instruction)/i, "advice"],
  [/^(client asked to discuss|client flagged|advanced without client confirmation)/i, "client_flag"],
  [/^enquiry (accepted|reopened)/i, "enquiry_accepted"],
  [/^(enquiry declined|client lost)/i, "enquiry_closed"],
  [/^(repeat )?enquiry/i, "enquiry"],
  [/^welcome email/i, "welcome"],
  [/^terms of business/i, "terms"],
  [/^onboarding complete/i, "onboarded"],
  [/^client/i, "client"],
  [/^propert/i, "property"],
  [/^document/i, "document"],
  [/^invoice/i, "invoice"],
  [/^renewal/i, "renewal"],
  [/^(payment|application fee)/i, "payment"],
];

export function classifyActivityTitle(title: string): ActivityKind {
  return MATCHERS.find(([re]) => re.test(title))?.[1] ?? "update";
}

/**
 * Routine activities are housekeeping and intermediate steps — references
 * being set, reminders re-sent, drafts created, documents uploaded — that a
 * record's own timeline wants but the firm-wide activity page hides by
 * default so it reads as milestones. Kept as one POSIX-compatible pattern
 * so the API can filter in SQL (`title !~* pattern`) and pagination still
 * counts correctly; do not use JS-only regex syntax in it.
 */
export const ROUTINE_TITLE_PATTERN = [
  "case number set",
  "pipeline reordered",
  "details prefilled",
  "welcome email",
  "onboarding reminder",
  "terms of business (sent for signature|template published|signature request voided)",
  "email template",
  "document (uploaded|read)",
  "review [0-9]+ propert",
  "requirement added",
  "underwriting round added",
  "stress test",
  "valuation (figure recorded|reopened)",
  "renewal updated",
  "invoice created",
  "lender offer details reviewed",
  "submission reopened",
  "property added",
  "advice re-sent",
  "details re-sent",
]
  .map((prefix) => `^(${prefix})`)
  .join("|");

const ROUTINE_TITLE = new RegExp(ROUTINE_TITLE_PATTERN, "i");

export const isRoutineActivityTitle = (title: string) => ROUTINE_TITLE.test(title);
