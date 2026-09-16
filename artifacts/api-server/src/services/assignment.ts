import { and, eq } from "drizzle-orm";
import { appUsersTable, db, sectionDefaultAssigneesTable, tasksTable } from "@workspace/db";
import { isStaffRole, type StaffRole } from "../auth/roles";
import { sendChariotEmail } from "../integrations/resend";
import { renderChariotEmail } from "../integrations/email-template";
import { logger } from "../lib/logger";
import { STAGES, SUBMISSION_STAGE_INDEX, stageOwnerRole } from "./stages";
import { seedTaskChecklist } from "./task-checklists";

/**
 * Sections of the Add flow that can carry a master default assignee
 * (configured in Settings) and a per-record manual override.
 */
export const ASSIGNMENT_SECTIONS = ["client", "property", "case"] as const;
export type AssignmentSection = (typeof ASSIGNMENT_SECTIONS)[number];

export const SECTION_LABELS: Record<AssignmentSection, string> = {
  client: "Client",
  property: "Property",
  case: "Case",
};

/** Role used when no default assignee is configured for a section. */
export const SECTION_FALLBACK_ROLE: Record<AssignmentSection, StaffRole> = {
  client: "case_manager",
  property: "case_manager",
  case: "case_manager",
};

/** One Settings row per pipeline stage: who receives the handoff task when a case enters it. */
export const STAGE_SECTIONS = STAGES.map((_, index) => `stage_${index}` as const);
export type StageSection = (typeof STAGE_SECTIONS)[number];
export const stageSection = (stageIndex: number): StageSection => `stage_${stageIndex}` as StageSection;

/**
 * The structured steps inside the Submission stage. Each can carry its own
 * default assignee; when set, that person gets a dedicated task for the step
 * as the case enters Submission.
 */
export const SUBMISSION_STEPS = [
  { section: "submission_lender", label: "Select a lender" },
  { section: "submission_dip", label: "Upload the decision in principle (DIP)" },
  { section: "submission_case_number", label: "Add the lender's case number" },
  { section: "submission_portfolio", label: "Send the required portfolio" },
  { section: "submission_fee", label: "Confirm the application & valuation fee" },
  { section: "submission_valuation_date", label: "Set the valuation date" },
  { section: "submission_decision", label: "Request the lender's decision" },
] as const;
export type SubmissionStepSection = (typeof SUBMISSION_STEPS)[number]["section"];
export const SUBMISSION_STEP_SECTIONS: readonly SubmissionStepSection[] = SUBMISSION_STEPS.map(
  (step) => step.section,
);

export type DefaultAssigneeSection = AssignmentSection | StageSection | SubmissionStepSection;

/** Every section key the Settings page can configure, in display order. */
export const DEFAULT_ASSIGNEE_SECTIONS: readonly DefaultAssigneeSection[] = [
  ...ASSIGNMENT_SECTIONS,
  ...STAGE_SECTIONS,
  ...SUBMISSION_STEP_SECTIONS,
];

export function isDefaultAssigneeSection(value: string): value is DefaultAssigneeSection {
  return (DEFAULT_ASSIGNEE_SECTIONS as readonly string[]).includes(value);
}

const isStageSection = (section: string): section is StageSection =>
  (STAGE_SECTIONS as readonly string[]).includes(section);
const isSubmissionStepSection = (section: string): section is SubmissionStepSection =>
  (SUBMISSION_STEP_SECTIONS as readonly string[]).includes(section);

export const AUTO_TASK_DUE_DAYS = 3;

export function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface AssigneeStaffUser {
  id: number;
  displayName: string;
  email: string;
}

const staffColumns = {
  id: appUsersTable.id,
  displayName: appUsersTable.displayName,
  email: appUsersTable.email,
  role: appUsersTable.role,
  active: appUsersTable.active,
};

function toAssignee(row: { id: number; displayName: string; email: string }): AssigneeStaffUser {
  return { id: row.id, displayName: row.displayName, email: row.email };
}

/** First active staff user holding the given role, or null. */
export async function primaryStaffForRole(role: StaffRole): Promise<AssigneeStaffUser | null> {
  const [staffUser] = await db
    .select({ id: appUsersTable.id, displayName: appUsersTable.displayName, email: appUsersTable.email })
    .from(appUsersTable)
    .where(and(eq(appUsersTable.role, role), eq(appUsersTable.active, true)))
    .limit(1);
  return staffUser ?? null;
}

/** Active staff user by id, or null when missing, inactive, or not a staff role. */
export async function activeStaffUser(userId: number): Promise<AssigneeStaffUser | null> {
  const [row] = await db.select(staffColumns).from(appUsersTable).where(eq(appUsersTable.id, userId));
  if (!row || !row.active || !isStaffRole(row.role)) return null;
  return toAssignee(row);
}

export type DefaultAssigneeMap = Record<DefaultAssigneeSection, AssigneeStaffUser | null>;

/**
 * Configured default assignee per section. Sections without a row, or whose
 * user is no longer an active staff member, resolve to null.
 */
export async function getDefaultAssignees(): Promise<DefaultAssigneeMap> {
  const rows = await db
    .select({ section: sectionDefaultAssigneesTable.section, user: staffColumns })
    .from(sectionDefaultAssigneesTable)
    .leftJoin(appUsersTable, eq(sectionDefaultAssigneesTable.userId, appUsersTable.id));
  const result = Object.fromEntries(
    DEFAULT_ASSIGNEE_SECTIONS.map((section) => [section, null]),
  ) as DefaultAssigneeMap;
  for (const row of rows) {
    if (!isDefaultAssigneeSection(row.section)) continue;
    const user = row.user;
    result[row.section] = user && user.id != null && user.active && isStaffRole(user.role)
      ? toAssignee(user as { id: number; displayName: string; email: string })
      : null;
  }
  return result;
}

/**
 * Settings sections consulted, most specific first, for a given section.
 * Stage handoffs inherit the Case default; Submission steps inherit the
 * Submission stage (and through it the Case default).
 */
export function defaultAssigneeChain(section: DefaultAssigneeSection): DefaultAssigneeSection[] {
  if (isSubmissionStepSection(section)) return [section, stageSection(SUBMISSION_STAGE_INDEX), "case"];
  if (isStageSection(section)) return [section, "case"];
  return [section];
}

/** Role used when nothing along the chain is configured. */
export function defaultFallbackRole(section: DefaultAssigneeSection): StaffRole {
  if (isSubmissionStepSection(section)) return stageOwnerRole[SUBMISSION_STAGE_INDEX];
  if (isStageSection(section)) {
    return stageOwnerRole[Number(section.slice("stage_".length))] ?? "case_manager";
  }
  return SECTION_FALLBACK_ROLE[section];
}

/** First configured user along the section's inheritance chain, or null. */
export function configuredAssignee(
  defaults: DefaultAssigneeMap,
  section: DefaultAssigneeSection,
): AssigneeStaffUser | null {
  for (const key of defaultAssigneeChain(section)) {
    const user = defaults[key];
    if (user) return user;
  }
  return null;
}

export type ResolveAssigneeResult =
  | { ok: true; staffUser: AssigneeStaffUser | null }
  | { ok: false; error: string };

/**
 * Resolve who should own a newly created record/task:
 * explicit pick → Settings default for the section (walking its inheritance
 * chain) → first active user in the fallback role.
 * An explicit pick that is not an active staff user is an error (route → 400).
 */
export async function resolveAssignee(options: {
  section: DefaultAssigneeSection;
  explicitUserId?: number | null;
  fallbackRole?: StaffRole;
  /** Pre-fetched defaults, to avoid re-querying when resolving several sections at once. */
  defaults?: DefaultAssigneeMap;
}): Promise<ResolveAssigneeResult> {
  if (options.explicitUserId != null) {
    const staffUser = await activeStaffUser(options.explicitUserId);
    if (!staffUser) return { ok: false, error: "Assignee must be an active staff user" };
    return { ok: true, staffUser };
  }
  const defaults = options.defaults ?? (await getDefaultAssignees());
  const configured = configuredAssignee(defaults, options.section);
  if (configured) return { ok: true, staffUser: configured };
  const fallback = await primaryStaffForRole(options.fallbackRole ?? defaultFallbackRole(options.section));
  return { ok: true, staffUser: fallback };
}

/**
 * Create a task for the resolved assignee and email them about it.
 * Email delivery failures are logged, never thrown.
 */
export async function createAssignmentTask(options: {
  staffUser: AssigneeStaffUser | null;
  title: string;
  notes: string;
  caseId: number | null;
  /** Client the task is about; lets the Tasks page deep-link to the Add page. */
  clientId?: number | null;
  /** Property the task is about (property review). */
  propertyId?: number | null;
  /** Why the task exists; kinds with a checklist definition get auto-maintained steps. */
  kind?: string | null;
  /** "yyyy-MM-dd"; defaults to AUTO_TASK_DUE_DAYS from now. */
  dueDate?: string;
  /** Calendar event the task follows up (valuation / completion dates). */
  calendarEventId?: number | null;
  /** Stage a hand-off task covers; its checklist mirrors that stage's steps. */
  stageIndex?: number | null;
}) {
  const { staffUser } = options;
  if (!staffUser) {
    logger.warn({ title: options.title }, "Assignment task was not created because no assignee could be resolved");
    return null;
  }
  const [created] = await db
    .insert(tasksTable)
    .values({
      title: options.title,
      caseId: options.caseId,
      clientId: options.clientId ?? null,
      propertyId: options.propertyId ?? null,
      kind: options.kind ?? null,
      stageIndex: options.stageIndex ?? null,
      assignee: staffUser.displayName,
      assignedUserId: staffUser.id,
      priority: "normal",
      notes: options.notes,
      dueDate: options.dueDate ?? addDays(AUTO_TASK_DUE_DAYS),
      calendarEventId: options.calendarEventId ?? null,
    })
    .returning();
  if (!created) return null;
  // Client / property / case tasks carry one step per record field, kept in
  // sync with the Add page as those fields are filled in.
  await seedTaskChecklist(created.id, options.kind, {
    clientId: options.clientId,
    propertyId: options.propertyId,
    caseId: options.caseId,
    stageIndex: options.stageIndex,
  }).catch((error) => logger.warn({ err: error, taskId: created.id }, "Task checklist was not seeded"));
  sendChariotEmail({
    purpose: "task_assignment",
    to: [staffUser.email],
    subject: `New task assigned: ${created.title}`,
    html: renderChariotEmail({
      preheader: `A new task has been assigned to you, due ${created.dueDate}.`,
      heading: "A new task has been assigned to you",
      paragraphs: [
        `Dear ${staffUser.displayName},`,
        `The following task has been assigned to you, due <strong>${created.dueDate}</strong>:`,
        `<strong>${created.title}</strong>`,
        ...(created.notes ? [created.notes] : []),
      ],
    }),
  }).catch((error) => logger.warn({ err: error, taskId: created.id }, "Task assignment email was not delivered"));
  return created;
}
