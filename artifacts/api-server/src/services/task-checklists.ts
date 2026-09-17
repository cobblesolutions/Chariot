import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  activitiesTable,
  casesTable,
  clientOnboardingItemsTable,
  clientsTable,
  db,
  documentsTable,
  propertiesTable,
  caseSubmissionsTable,
  lendersTable,
  requirementsTable,
  taskChecklistItemsTable,
  tasksTable,
  underwritingRoundsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { ONBOARDING_DEFINITIONS } from "./client-onboarding";
import { portfolioRequirementLabel } from "./case-portfolio-requirement";
import { STAGES, SUBMISSION_STAGE_INDEX } from "./stages";

const UNDERWRITING_STAGE_INDEX = STAGES.indexOf("Underwriting");
import { syncCaseFromSubmissions } from "./case-submissions";

/**
 * Auto-maintained task checklists. A client onboarding, property review or
 * case submission task gets one step per record field; each step carries a
 * `sourceKey` and is ticked/unticked whenever that record is saved, so the
 * task's progress mirrors the Add page.
 */
export const CLIENT_ONBOARDING_KIND = "client_onboarding";
export const PROPERTY_REVIEW_KIND = "property_review";
export const CASE_SUBMISSION_KIND = "case_submission";
/**
 * Stage hand-off tasks carry the stage's own steps: the Submission stage's
 * structured steps, or the stage's requirements (which grow as underwriting
 * rounds are added). Requirement steps use the key `req:<id>` and tick both
 * ways — ticking one on the task completes the requirement on the case.
 */
export const STAGE_HANDOFF_KIND = "stage_handoff";
/**
 * A Submission step handed to someone other than the stage owner (Settings →
 * default assignees per step). It pops up when the stage task reaches that
 * step, carries that one step as its checklist, and closes itself when the
 * step is done on the case.
 */
export const SUBMISSION_STEP_KIND = "submission_step";
/** One task per underwriting round; its steps are that round's requirements only. */
export const UNDERWRITING_ROUND_KIND = "underwriting_round";
export const REQUIREMENT_KEY_PREFIX = "req:";
export const requirementKey = (id: number) => `${REQUIREMENT_KEY_PREFIX}${id}`;
export const requirementIdFromKey = (key: string | null | undefined) =>
  key?.startsWith(REQUIREMENT_KEY_PREFIX) ? Number(key.slice(REQUIREMENT_KEY_PREFIX.length)) || null : null;

/** `sub:<submissionId>:<field>` — one lender's step on the Submission stage. */
const submissionStepFromKey = (key: string) => {
  const match = /^sub:(\d+):(dip|caseNumber|fee|decision)$/.exec(key);
  return match ? { submissionId: Number(match[1]), field: match[2] as "dip" | "caseNumber" | "fee" | "decision" } : null;
};

/** Settings section that owns a Submission step — which default assignee a step task goes to. */
function submissionStepSection(key: string): import("./assignment").SubmissionStepSection | null {
  if (key === "lenderId" || key === "lenderChosen") return "submission_lender";
  if (key === "portfolio") return "submission_portfolio";
  if (key === "valuationDate" || key === "valuationCompleted") return "submission_valuation_date";
  const step = submissionStepFromKey(key);
  if (!step) return null;
  return ({ dip: "submission_dip", caseNumber: "submission_case_number", fee: "submission_fee", decision: "submission_decision" } as const)[step.field];
}

/**
 * Requirements the system ticks itself (emails going out, the client
 * answering, a signature landing, the calculator passing). The case page has
 * no checkbox for these either, so a task must not offer one. Keyed by the
 * requirement label as seeded in routes/operations.ts and services/case-advice.ts.
 */
const SYSTEM_REQUIREMENT_LOCKS: Record<string, string> = {
  "Service level confirmed": "Confirmed by the adviser on the case",
  "Advice sent to client": "Sent from the advice stage on the case",
  "Client approved advice": "Ticked when the client answers the advice email or portal",
  "Client instruction recorded": "Recorded from the client's email on the case",
  "Terms of Business signed": "Ticked when the client signs the Terms of Business",
  "Stress test completed": "Passed from the stress test calculator on the case",
};

/**
 * Where a synced step has to be filled in when it cannot simply be ticked
 * from the task: it needs a value, a document or a choice, so the task shows
 * it locked with this hint and the API refuses a manual tick. Null means the
 * step is a plain yes/no that the task may tick — it is written through to
 * the case (`applyChecklistItemToCase`).
 */
export function checklistStepLock(sourceKey: string | null | undefined, title?: string | null): string | null {
  if (!sourceKey) return null;
  if (requirementIdFromKey(sourceKey)) return (title && SYSTEM_REQUIREMENT_LOCKS[title]) || null;
  if (sourceKey === "portfolio" || sourceKey === "valuationCompleted") return null;
  const step = submissionStepFromKey(sourceKey);
  if (step) {
    if (step.field === "fee" || step.field === "decision") return null;
    return step.field === "dip" ? "Upload the DIP on the case" : "Record the lender's case number on the case";
  }
  if (sourceKey === "lenderId") return "Choose the lender on the case";
  if (sourceKey === "lenderChosen") return "Choose the lender to proceed with on the case";
  if (sourceKey === "valuationDate") return "Set the valuation date on the case";
  if (sourceKey === "dip") return "Upload the DIP on the case";
  if (sourceKey === "caseNumber") return "Record the lender's case number on the case";
  if (sourceKey.startsWith("card:")) return "Filled in on the Add page — the card turns green";
  // Case field steps mirror the case record.
  return "Filled in on the record";
}

interface Step {
  key: string;
  label: string;
}

/**
 * One step per card of the Add page's client form, in page order; a step is
 * done when its card is green there (every counted field filled), so the
 * task's checklist is the page's card colours. Field lists mirror
 * chariot-platform/src/components/add/client-column.tsx.
 */
const CLIENT_CARDS: Array<Step & { fields: string[] }> = [
  { key: "card:contact", label: "Contact", fields: ["name", "email", "phone", "currentAddress"] },
  { key: "card:personal", label: "Personal", fields: ["dateOfBirth", "nationality", "maritalStatus", "dependants"] },
  { key: "card:employment", label: "Employment & income", fields: ["employmentStatus", "employerName", "jobTitle", "annualIncome", "monthlyCommitments"] },
  { key: "card:company", label: "Company", fields: ["companyName", "companyNumber", "companyRegisteredAddress"] },
  { key: "card:enquiry", label: "Enquiry", fields: ["source", "enquiryType", "enquirySummary"] },
];
const CLIENT_ONBOARDING_CARD: Step = { key: "card:onboarding", label: "Onboarding & documents" };
const CLIENT_STEPS: Step[] = [CLIENT_ONBOARDING_CARD, ...CLIENT_CARDS];

/**
 * One step per card of the Add page's property form (see
 * chariot-platform/src/components/add/property-column.tsx). The deal and
 * details cards count extra fields for let / bridging properties, so their
 * field lists are worked out per property.
 */
const PROPERTY_STEPS: Step[] = [
  { key: "card:deal", label: "The deal" },
  { key: "card:details", label: "Property details" },
  { key: "card:mortgage", label: "Purchase & current mortgage" },
];

function propertyCardFields(property: typeof propertiesTable.$inferSelect): Record<string, string[]> {
  const isLet = property.occupancy === "let" || property.occupancy === "holiday_let";
  const wantsRent = property.matterType === "btl" || isLet;
  const wantsGdv = property.matterType === "bridging";
  return {
    "card:deal": ["address", "matterType", "value", "loanAmount", ...(wantsRent ? ["rent"] : []), ...(wantsGdv ? ["gdv"] : [])],
    "card:details": ["propertyType", "tenure", "bedrooms", "yearBuilt", "epcRating", "occupancy", ...(isLet ? ["tenancyType"] : [])],
    "card:mortgage": ["purchasePrice", "purchaseDate", "currentLender", "currentRatePct", "currentBalance", "currentRateEndDate"],
  };
}

const CASE_STEPS: Step[] = [
  { key: "serviceType", label: "Service level chosen" },
  { key: "amounts", label: "Loan amount and property value" },
  { key: "lenderId", label: "Lender selected" },
  { key: "dip", label: "Decision in principle uploaded" },
  { key: "caseNumber", label: "Lender case number" },
  { key: "valuationDate", label: "Valuation date" },
  { key: "applicationFeeConfirmed", label: "Application & valuation fee confirmed" },
  { key: "bankDecisionRequested", label: "Bank decision requested" },
];

const filled = (value: unknown) =>
  value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
/** A card is green when every counted field on it is filled (the Add page's `countFilled(...) >= total`). */
const cardDone = (record: Record<string, unknown>, fields: string[]) =>
  fields.every((field) => {
    const value = record[field];
    return typeof value === "number" ? value !== 0 : filled(value);
  });

/** Which client steps are complete right now. Null when the client is gone. */
async function clientDoneMap(clientId: number): Promise<Map<string, boolean> | null> {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) return null;
  const [items, documents] = await Promise.all([
    db
      .select({ key: clientOnboardingItemsTable.key, value: clientOnboardingItemsTable.value, kind: clientOnboardingItemsTable.kind })
      .from(clientOnboardingItemsTable)
      .where(eq(clientOnboardingItemsTable.clientId, clientId)),
    db.select({ category: documentsTable.category }).from(documentsTable).where(eq(documentsTable.clientId, clientId)),
  ]);
  const categories = new Set(documents.map((document) => document.category));
  const done = new Map<string, boolean>();
  for (const card of CLIENT_CARDS) done.set(card.key, cardDone(client as Record<string, unknown>, card.fields));
  // The onboarding card is green when every item on the list is complete.
  const onboardingDone = ONBOARDING_DEFINITIONS.every((definition) => {
    const item = items.find((row) => row.key === definition.key);
    return definition.kind === "document" ? categories.has(definition.key) : filled(item?.value);
  });
  done.set(CLIENT_ONBOARDING_CARD.key, onboardingDone);
  return done;
}

async function propertyDoneMap(propertyId: number): Promise<Map<string, boolean> | null> {
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) return null;
  const fields = propertyCardFields(property);
  return new Map(PROPERTY_STEPS.map((step) => [step.key, cardDone(property as Record<string, unknown>, fields[step.key] ?? [])]));
}

async function caseDoneMap(caseId: number): Promise<Map<string, boolean> | null> {
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
  if (!caseRow) return null;
  const [dip] = await db
    .select({ id: documentsTable.id })
    .from(documentsTable)
    .where(and(eq(documentsTable.caseId, caseId), eq(documentsTable.category, "DIP")))
    .limit(1);
  return new Map<string, boolean>([
    ["serviceType", filled(caseRow.serviceType)],
    ["amounts", caseRow.loanAmount > 0 && caseRow.propertyValue > 0],
    ["lenderId", caseRow.lenderId != null],
    ["dip", !!dip],
    ["caseNumber", filled(caseRow.lenderCaseNumber)],
    ["valuationDate", caseRow.valuationDate != null],
    ["applicationFeeConfirmed", caseRow.applicationFeeConfirmed],
    ["bankDecisionRequested", caseRow.bankDecisionRequested],
  ]);
}

/** Steps + completion for one stage of a case. Null when the case is gone. */
async function stageSteps(caseId: number, stageIndex: number): Promise<{ steps: Step[]; done: Map<string, boolean> } | null> {
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
  if (!caseRow) return null;
  const requirements = await db
    .select({ id: requirementsTable.id, label: requirementsTable.label, complete: requirementsTable.complete })
    .from(requirementsTable)
    .where(and(eq(requirementsTable.caseId, caseId), eq(requirementsTable.stageIndex, stageIndex)))
    .orderBy(asc(requirementsTable.round), asc(requirementsTable.id));
  if (stageIndex === SUBMISSION_STAGE_INDEX) {
    // One block of steps per lender the case is open with, then the case-level ones.
    const submissions = await db
      .select({
        id: caseSubmissionsTable.id,
        lenderId: caseSubmissionsTable.lenderId,
        status: caseSubmissionsTable.status,
        isPrimary: caseSubmissionsTable.isPrimary,
        lenderCaseNumber: caseSubmissionsTable.lenderCaseNumber,
        applicationFeeConfirmed: caseSubmissionsTable.applicationFeeConfirmed,
        bankDecisionRequested: caseSubmissionsTable.bankDecisionRequested,
      })
      .from(caseSubmissionsTable)
      .where(eq(caseSubmissionsTable.caseId, caseId))
      .orderBy(asc(caseSubmissionsTable.createdAt), asc(caseSubmissionsTable.id));
    const open = submissions.filter((row) => row.status === "active" || row.status === "offered");
    const lenderIds = [...new Set(open.map((row) => row.lenderId))];
    const lenders = lenderIds.length
      ? await db.select({ id: lendersTable.id, name: lendersTable.name }).from(lendersTable).where(inArray(lendersTable.id, lenderIds))
      : [];
    const lenderName = new Map(lenders.map((row) => [row.id, row.name]));
    const dips = open.length
      ? await db
          .select({ submissionId: documentsTable.submissionId })
          .from(documentsTable)
          .where(and(eq(documentsTable.caseId, caseId), eq(documentsTable.category, "DIP")))
      : [];
    const dipFor = new Set(dips.map((row) => row.submissionId));
    const portfolio = requirements.find((item) => item.label === portfolioRequirementLabel);
    const steps: Step[] = [];
    const done = new Map<string, boolean>();
    if (open.length === 0) {
      steps.push({ key: "lenderId", label: "Select a lender" });
      done.set("lenderId", caseRow.lenderId != null);
    }
    for (const row of open) {
      const name = lenderName.get(row.lenderId) ?? "Lender";
      const prefix = `sub:${row.id}:`;
      steps.push(
        { key: `${prefix}dip`, label: `Upload the DIP from ${name}` },
        { key: `${prefix}caseNumber`, label: `Record the ${name} case number` },
        { key: `${prefix}fee`, label: `Confirm the application & valuation fee with ${name}` },
        { key: `${prefix}decision`, label: `Request the decision from ${name}` },
      );
      done.set(`${prefix}dip`, dipFor.has(row.id));
      done.set(`${prefix}caseNumber`, filled(row.lenderCaseNumber));
      done.set(`${prefix}fee`, row.applicationFeeConfirmed);
      done.set(`${prefix}decision`, row.bankDecisionRequested);
    }
    if (portfolio) {
      steps.push({ key: "portfolio", label: portfolioRequirementLabel });
      done.set("portfolio", portfolio.complete);
    }
    steps.push(
      { key: "valuationDate", label: "Set the valuation date" },
      { key: "valuationCompleted", label: "Confirm the valuation took place" },
    );
    done.set("valuationDate", caseRow.valuationDate != null);
    done.set("valuationCompleted", caseRow.valuationCompletedAt != null);
    if (open.length > 1) {
      steps.push({ key: "lenderChosen", label: "Choose the lender to proceed with" });
      done.set("lenderChosen", open.some((row) => row.isPrimary));
    }
    return { steps, done };
  }
  return {
    steps: requirements.map((item) => ({ key: requirementKey(item.id), label: item.label })),
    done: new Map(requirements.map((item) => [requirementKey(item.id), item.complete])),
  };
}

function stepsFor(kind: string): Step[] | null {
  if (kind === CLIENT_ONBOARDING_KIND) return CLIENT_STEPS;
  if (kind === PROPERTY_REVIEW_KIND) return PROPERTY_STEPS;
  if (kind === CASE_SUBMISSION_KIND) return CASE_STEPS;
  return null;
}

async function doneMapFor(kind: string, ids: { clientId?: number | null; propertyId?: number | null; caseId?: number | null }) {
  if (kind === CLIENT_ONBOARDING_KIND && ids.clientId) return clientDoneMap(ids.clientId);
  if (kind === PROPERTY_REVIEW_KIND && ids.propertyId) return propertyDoneMap(ids.propertyId);
  if (kind === CASE_SUBMISSION_KIND && ids.caseId) return caseDoneMap(ids.caseId);
  return null;
}

/** Create the auto-maintained steps for a freshly created task (no-op for kinds without a checklist). */
export async function seedTaskChecklist(
  taskId: number,
  kind: string | null | undefined,
  ids: { clientId?: number | null; propertyId?: number | null; caseId?: number | null; stageIndex?: number | null },
) {
  if (!kind) return;
  let steps: Step[] | null;
  let done: Map<string, boolean>;
  if (kind === STAGE_HANDOFF_KIND) {
    if (ids.caseId == null || ids.stageIndex == null) return;
    const stage = await stageSteps(ids.caseId, ids.stageIndex);
    if (!stage) return;
    steps = stage.steps;
    done = stage.done;
  } else {
    steps = stepsFor(kind);
    if (!steps) return;
    done = (await doneMapFor(kind, ids)) ?? new Map<string, boolean>();
  }
  if (steps.length === 0) return;
  await db.insert(taskChecklistItemsTable).values(
    steps.map((step, position) => ({
      taskId,
      title: step.label,
      done: done.get(step.key) ?? false,
      position,
      sourceKey: step.key,
    })),
  );
}

/**
 * Re-tick the steps of every open stage hand-off task for the case, adding
 * steps that appeared since (a new underwriting round, an added requirement)
 * and dropping ones whose requirement was removed. Manual steps are left alone.
 */
/** The requirements of the underwriting round a task was created for. */
async function roundSteps(caseId: number, taskId: number): Promise<{ steps: Step[]; done: Map<string, boolean> } | null> {
  const [round] = await db
    .select({ round: underwritingRoundsTable.round, submissionId: underwritingRoundsTable.submissionId })
    .from(underwritingRoundsTable)
    .where(and(eq(underwritingRoundsTable.caseId, caseId), eq(underwritingRoundsTable.taskId, taskId)));
  if (!round) return null;
  const requirements = await db
    .select({ id: requirementsTable.id, label: requirementsTable.label, complete: requirementsTable.complete })
    .from(requirementsTable)
    .where(and(
      eq(requirementsTable.caseId, caseId),
      eq(requirementsTable.stageIndex, UNDERWRITING_STAGE_INDEX),
      eq(requirementsTable.round, round.round),
      round.submissionId == null ? isNull(requirementsTable.submissionId) : eq(requirementsTable.submissionId, round.submissionId),
    ))
    .orderBy(asc(requirementsTable.id));
  return {
    steps: requirements.map((item) => ({ key: requirementKey(item.id), label: item.label })),
    done: new Map(requirements.map((item) => [requirementKey(item.id), item.complete])),
  };
}

async function syncStageChecklists(caseId: number) {
  const tasks = await db
    .select({ id: tasksTable.id, title: tasksTable.title, stageIndex: tasksTable.stageIndex, kind: tasksTable.kind, assignedUserId: tasksTable.assignedUserId })
    .from(tasksTable)
    .where(and(inArray(tasksTable.kind, [STAGE_HANDOFF_KIND, UNDERWRITING_ROUND_KIND]), eq(tasksTable.caseId, caseId), ne(tasksTable.status, "done")));
  for (const task of tasks) {
    const stage = task.kind === UNDERWRITING_ROUND_KIND
      ? await roundSteps(caseId, task.id)
      : task.stageIndex == null ? null : await stageSteps(caseId, task.stageIndex);
    if (!stage) continue;
    if (task.kind === STAGE_HANDOFF_KIND && task.stageIndex === SUBMISSION_STAGE_INDEX) await syncSubmissionStepTasks(caseId, task, stage);
    const items = await db
      .select({
        id: taskChecklistItemsTable.id,
        sourceKey: taskChecklistItemsTable.sourceKey,
        title: taskChecklistItemsTable.title,
        done: taskChecklistItemsTable.done,
        position: taskChecklistItemsTable.position,
      })
      .from(taskChecklistItemsTable)
      .where(eq(taskChecklistItemsTable.taskId, task.id));
    const known = new Set(items.map((item) => item.sourceKey).filter(Boolean));
    const wanted = new Set(stage.steps.map((step) => step.key));
    const labelFor = new Map(stage.steps.map((step) => [step.key, step.label]));
    for (const item of items) {
      const label = item.sourceKey ? labelFor.get(item.sourceKey) : undefined;
      if (label && label !== item.title) {
        await db.update(taskChecklistItemsTable).set({ title: label }).where(eq(taskChecklistItemsTable.id, item.id));
      }
    }
    const missing = stage.steps.filter((step) => !known.has(step.key));
    const stale = items.filter((item) => item.sourceKey && !wanted.has(item.sourceKey)).map((item) => item.id);
    let position = items.reduce((max, item) => Math.max(max, item.position), -1) + 1;
    if (missing.length) {
      await db.insert(taskChecklistItemsTable).values(
        missing.map((step) => ({
          taskId: task.id,
          title: step.label,
          done: stage.done.get(step.key) ?? false,
          position: position++,
          sourceKey: step.key,
        })),
      );
    }
    if (stale.length) await db.delete(taskChecklistItemsTable).where(inArray(taskChecklistItemsTable.id, stale));
    const toTick = items.filter((item) => item.sourceKey && stage.done.get(item.sourceKey) === true && !item.done).map((item) => item.id);
    const toUntick = items.filter((item) => item.sourceKey && stage.done.get(item.sourceKey) === false && item.done).map((item) => item.id);
    if (toTick.length) await db.update(taskChecklistItemsTable).set({ done: true }).where(inArray(taskChecklistItemsTable.id, toTick));
    if (toUntick.length) await db.update(taskChecklistItemsTable).set({ done: false }).where(inArray(taskChecklistItemsTable.id, toUntick));
  }
}

/**
 * The Submission stage's steps can each have their own default assignee in
 * Settings. When the stage task is up to such a step and that person is not
 * the stage task's assignee, a task for the step pops up for them — one at a
 * time, as the stage gets there — and every step task is kept in step with
 * the case: ticked when the step is done, closed when all its steps are.
 */
async function syncSubmissionStepTasks(
  caseId: number,
  stageTask: { id: number; title: string; assignedUserId: number | null },
  stage: { steps: Step[]; done: Map<string, boolean> },
) {
  const [caseRow] = await db
    .select({ stageIndex: casesTable.stageIndex, clientId: casesTable.clientId, reference: casesTable.reference, displayReference: casesTable.displayReference })
    .from(casesTable)
    .where(eq(casesTable.id, caseId));
  if (!caseRow) return;
  const stepTasks = await db
    .select({ id: tasksTable.id, status: tasksTable.status, completedByUserId: tasksTable.completedByUserId })
    .from(tasksTable)
    .where(and(eq(tasksTable.kind, SUBMISSION_STEP_KIND), eq(tasksTable.caseId, caseId)));
  const items = stepTasks.length
    ? await db
        .select({ id: taskChecklistItemsTable.id, taskId: taskChecklistItemsTable.taskId, sourceKey: taskChecklistItemsTable.sourceKey, title: taskChecklistItemsTable.title, done: taskChecklistItemsTable.done })
        .from(taskChecklistItemsTable)
        .where(inArray(taskChecklistItemsTable.taskId, stepTasks.map((task) => task.id)))
    : [];

  // Pop the task for the step the stage is up to, when Settings hands that step to someone else.
  const current = caseRow.stageIndex === SUBMISSION_STAGE_INDEX ? stage.steps.find((step) => !stage.done.get(step.key)) : undefined;
  const section = current ? submissionStepSection(current.key) : null;
  if (current && section && !items.some((item) => item.sourceKey === current.key)) {
    // Lazy: assignment imports this module to seed checklists.
    const { createAssignmentTask, getDefaultAssignees } = await import("./assignment");
    const owner = (await getDefaultAssignees())[section];
    if (owner && owner.id !== stageTask.assignedUserId) {
      const reference = caseRow.displayReference || caseRow.reference;
      const due = new Date(); due.setDate(due.getDate() + 2);
      const created = await createAssignmentTask({
        staffUser: owner,
        title: `${current.label} — ${reference}`,
        notes: `Your step of "${stageTask.title}". It ticks itself once recorded on the case.`,
        caseId,
        clientId: caseRow.clientId,
        kind: SUBMISSION_STEP_KIND,
        dueDate: due.toISOString().slice(0, 10),
      });
      if (created) {
        await db.insert(taskChecklistItemsTable).values({ taskId: created.id, title: current.label, done: false, position: 0, sourceKey: current.key });
      }
    }
  }

  // Keep every step task in step with the case.
  for (const task of stepTasks) {
    if (task.status === "done" && task.completedByUserId != null) continue;
    const own = items.filter((item) => item.taskId === task.id);
    for (const item of own) {
      if (!item.sourceKey) continue;
      const label = stage.steps.find((step) => step.key === item.sourceKey)?.label;
      const done = stage.done.get(item.sourceKey);
      if ((label && label !== item.title) || (done != null && done !== item.done)) {
        await db.update(taskChecklistItemsTable).set({ title: label ?? item.title, done: done ?? item.done }).where(eq(taskChecklistItemsTable.id, item.id));
      }
    }
    const allDone = own.length > 0 && own.every((item) => (item.sourceKey ? stage.done.get(item.sourceKey) !== false : item.done));
    if (allDone && task.status !== "done") {
      await db.update(tasksTable).set({ status: "done", completedAt: new Date(), completedByUserId: null }).where(eq(tasksTable.id, task.id));
    } else if (!allDone && task.status === "done") {
      await db.update(tasksTable).set({ status: "in_progress", completedAt: null }).where(eq(tasksTable.id, task.id));
    }
  }
}

/**
 * Re-tick the auto steps of every task of `kind` that points at the given
 * record, adding steps that are missing and dropping ones the kind no longer
 * has (older tasks carried one step per field; now it is one per card).
 * A task whose steps are all done closes itself — the record is complete, so
 * it comes off the list — and one the system closed reopens if a card goes
 * orange again. Tasks a person completed are left alone.
 */
async function syncChecklists(kind: string, column: "clientId" | "propertyId" | "caseId", id: number) {
  const tasks = await db
    .select({ id: tasksTable.id, status: tasksTable.status, completedByUserId: tasksTable.completedByUserId })
    .from(tasksTable)
    .where(and(eq(tasksTable.kind, kind), eq(tasksTable[column], id)));
  const open = tasks.filter((task) => task.status !== "done" || task.completedByUserId == null);
  if (open.length === 0) return;
  const done = await doneMapFor(kind, { [column]: id });
  if (!done) return;
  const steps = stepsFor(kind) ?? [];
  const wanted = new Set(steps.map((step) => step.key));
  for (const task of open) {
    const items = await db
      .select({ id: taskChecklistItemsTable.id, sourceKey: taskChecklistItemsTable.sourceKey, done: taskChecklistItemsTable.done, position: taskChecklistItemsTable.position })
      .from(taskChecklistItemsTable)
      .where(eq(taskChecklistItemsTable.taskId, task.id));
    const known = new Set(items.map((item) => item.sourceKey).filter(Boolean));
    const stale = items.filter((item) => item.sourceKey && !wanted.has(item.sourceKey)).map((item) => item.id);
    if (stale.length) await db.delete(taskChecklistItemsTable).where(inArray(taskChecklistItemsTable.id, stale));
    const missing = steps.filter((step) => !known.has(step.key));
    let position = items.reduce((max, item) => Math.max(max, item.position), -1) + 1;
    if (missing.length) {
      await db.insert(taskChecklistItemsTable).values(
        missing.map((step) => ({ taskId: task.id, title: step.label, done: done.get(step.key) ?? false, position: position++, sourceKey: step.key })),
      );
    }
    const kept = items.filter((item) => !stale.includes(item.id));
    const toTick = kept.filter((item) => item.sourceKey && done.get(item.sourceKey) === true && !item.done).map((item) => item.id);
    const toUntick = kept.filter((item) => item.sourceKey && done.get(item.sourceKey) === false && item.done).map((item) => item.id);
    if (toTick.length) await db.update(taskChecklistItemsTable).set({ done: true }).where(inArray(taskChecklistItemsTable.id, toTick));
    if (toUntick.length) await db.update(taskChecklistItemsTable).set({ done: false }).where(inArray(taskChecklistItemsTable.id, toUntick));

    const allDone = steps.length > 0 && steps.every((step) => done.get(step.key) === true)
      && kept.filter((item) => !item.sourceKey).every((item) => item.done);
    if (allDone && task.status !== "done") {
      await db.update(tasksTable).set({ status: "done", completedAt: new Date(), completedByUserId: null }).where(eq(tasksTable.id, task.id));
    } else if (!allDone && task.status === "done" && task.completedByUserId == null) {
      await db.update(tasksTable).set({ status: "in_progress", completedAt: null }).where(eq(tasksTable.id, task.id));
    }
  }
}

const swallow = (label: string) => (error: unknown) => logger.warn({ err: error }, `${label} checklist sync failed`);

export const syncClientChecklists = (clientId: number) =>
  syncChecklists(CLIENT_ONBOARDING_KIND, "clientId", clientId).catch(swallow("Client"));
export const syncPropertyChecklists = (propertyId: number) =>
  syncChecklists(PROPERTY_REVIEW_KIND, "propertyId", propertyId).catch(swallow("Property"));
/** Both the "gather submission details" task and every open stage task of the case. */
export const syncCaseChecklists = (caseId: number) =>
  Promise.all([syncChecklists(CASE_SUBMISSION_KIND, "caseId", caseId), syncStageChecklists(caseId)])
    .then(() => undefined)
    .catch(swallow("Case"));

export class ChecklistStepLockedError extends Error {}

/**
 * Ticking a synced step on a task writes it through to the case: a
 * requirement completes (or reopens), a lender's fee/decision flag flips on
 * its submission, the valuation is confirmed. Steps that need a value or a
 * document cannot be ticked by hand — the task shows them locked and this
 * throws `ChecklistStepLockedError` with where to go instead.
 */
export async function applyChecklistItemToCase(
  task: { caseId: number | null },
  item: { sourceKey: string | null; title?: string | null; done: boolean },
  actor: { userId: number; displayName: string },
) {
  if (!item.sourceKey) return;
  const lock = checklistStepLock(item.sourceKey, item.title);
  if (lock) throw new ChecklistStepLockedError(`${lock} — this step ticks itself once it is recorded.`);
  const completion = { complete: item.done, completedAt: item.done ? new Date() : null, completedBy: item.done ? actor.displayName : null };
  const requirementId = requirementIdFromKey(item.sourceKey);
  if (requirementId) {
    await db.update(requirementsTable).set(completion).where(eq(requirementsTable.id, requirementId));
    return;
  }
  if (!task.caseId) return;
  if (item.sourceKey === "portfolio") {
    await db
      .update(requirementsTable)
      .set(completion)
      .where(and(eq(requirementsTable.caseId, task.caseId), eq(requirementsTable.label, portfolioRequirementLabel)));
    return;
  }
  if (item.sourceKey === "valuationCompleted") {
    const [caseRow] = await db.select({ valuationDate: casesTable.valuationDate }).from(casesTable).where(eq(casesTable.id, task.caseId));
    if (item.done && !caseRow?.valuationDate) throw new ChecklistStepLockedError("Set the valuation date on the case first.");
    // Lazy: case-dates imports this module (via assignment) for its own syncs.
    const { setValuationCompleted } = await import("./case-dates");
    await setValuationCompleted(task.caseId, item.done, actor);
    return;
  }
  const step = submissionStepFromKey(item.sourceKey);
  if (!step) return;
  const [submission] = await db
    .select()
    .from(caseSubmissionsTable)
    .where(and(eq(caseSubmissionsTable.id, step.submissionId), eq(caseSubmissionsTable.caseId, task.caseId)));
  if (!submission) return;
  const [lender] = await db.select({ name: lendersTable.name }).from(lendersTable).where(eq(lendersTable.id, submission.lenderId));
  const lenderName = lender?.name ?? "Lender";
  if (step.field === "fee") {
    if (submission.applicationFeeConfirmed === item.done) return;
    await db
      .update(caseSubmissionsTable)
      .set({ applicationFeeConfirmed: item.done, applicationFeeConfirmedAt: item.done ? new Date() : null })
      .where(eq(caseSubmissionsTable.id, submission.id));
    if (item.done) {
      await db.insert(activitiesTable).values({
        caseId: task.caseId, title: "Fee confirmed", detail: `Application & valuation fee confirmed with ${lenderName}`, actorName: actor.displayName,
      });
    }
  } else if (step.field === "decision") {
    if (submission.bankDecisionRequested === item.done) return;
    await db
      .update(caseSubmissionsTable)
      .set({ bankDecisionRequested: item.done, bankDecisionRequestedAt: item.done ? new Date() : null })
      .where(eq(caseSubmissionsTable.id, submission.id));
    if (item.done) {
      await db.insert(activitiesTable).values({
        caseId: task.caseId, title: "Decision requested", detail: `Decision requested from ${lenderName}`, actorName: actor.displayName,
      });
    }
  }
  // The case row mirrors the primary submission.
  await syncCaseFromSubmissions(task.caseId);
}
