import { and, asc, eq, inArray, ne } from "drizzle-orm";
import {
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
} from "@workspace/db";
import { logger } from "../lib/logger";
import { ONBOARDING_DEFINITIONS } from "./client-onboarding";
import { portfolioRequirementLabel } from "./case-portfolio-requirement";
import { SUBMISSION_STAGE_INDEX } from "./stages";

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
export const REQUIREMENT_KEY_PREFIX = "req:";
export const requirementKey = (id: number) => `${REQUIREMENT_KEY_PREFIX}${id}`;
export const requirementIdFromKey = (key: string | null | undefined) =>
  key?.startsWith(REQUIREMENT_KEY_PREFIX) ? Number(key.slice(REQUIREMENT_KEY_PREFIX.length)) || null : null;

interface Step {
  key: string;
  label: string;
}

const CLIENT_FIELD_STEPS: Step[] = [
  { key: "phone", label: "Phone number" },
  { key: "dateOfBirth", label: "Date of birth" },
  { key: "currentAddress", label: "Current address" },
  { key: "employmentStatus", label: "Employment status" },
  { key: "annualIncome", label: "Annual income" },
];

const CLIENT_STEPS: Step[] = [
  ...CLIENT_FIELD_STEPS,
  ...ONBOARDING_DEFINITIONS.map((item) => ({ key: `onboarding:${item.key}`, label: item.label })),
];

/** The deal itself: always on a property review task. */
const PROPERTY_DEAL_STEPS: Step[] = [
  { key: "matterType", label: "Matter type" },
  { key: "value", label: "Property value" },
  { key: "loanAmount", label: "Loan amount" },
];
/** Only for buy-to-let / let properties. */
const PROPERTY_RENT_STEP: Step = { key: "rent", label: "Rental income" };
/** Only for bridging / development deals. */
const PROPERTY_GDV_STEP: Step = { key: "gdv", label: "GDV (gross development value)" };
const PROPERTY_DETAIL_STEPS: Step[] = [
  { key: "propertyType", label: "Property type" },
  { key: "tenure", label: "Tenure" },
  { key: "occupancy", label: "Occupancy" },
  { key: "bedrooms", label: "Bedrooms" },
  { key: "epcRating", label: "EPC rating" },
];
const PROPERTY_STEPS: Step[] = [
  ...PROPERTY_DEAL_STEPS,
  PROPERTY_RENT_STEP,
  PROPERTY_GDV_STEP,
  ...PROPERTY_DETAIL_STEPS,
];

/** Steps a review task for this particular property should carry. */
function propertyStepsFor(property: typeof propertiesTable.$inferSelect): Step[] {
  const isLet = property.occupancy === "let" || property.occupancy === "holiday_let";
  const wantsRent = property.matterType === "btl" || isLet || property.rent != null;
  const wantsGdv = property.matterType === "bridging" || property.gdv != null;
  return [
    ...PROPERTY_DEAL_STEPS,
    ...(wantsRent ? [PROPERTY_RENT_STEP] : []),
    ...(wantsGdv ? [PROPERTY_GDV_STEP] : []),
    ...PROPERTY_DETAIL_STEPS,
  ];
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
  for (const step of CLIENT_FIELD_STEPS) done.set(step.key, filled((client as Record<string, unknown>)[step.key]));
  for (const definition of ONBOARDING_DEFINITIONS) {
    const item = items.find((row) => row.key === definition.key);
    done.set(
      `onboarding:${definition.key}`,
      definition.kind === "document" ? categories.has(definition.key) : filled(item?.value),
    );
  }
  return done;
}

async function propertyDoneMap(propertyId: number): Promise<Map<string, boolean> | null> {
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) return null;
  const done = new Map<string, boolean>();
  for (const step of PROPERTY_STEPS) done.set(step.key, filled((property as Record<string, unknown>)[step.key]));
  done.set("value", property.value > 0);
  done.set("loanAmount", property.loanAmount > 0);
  done.set("rent", property.rent != null && property.rent > 0);
  done.set("gdv", property.gdv != null && property.gdv > 0);
  return done;
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
      steps.push({ key: "lenderId", label: "Lender selected" });
      done.set("lenderId", caseRow.lenderId != null);
    }
    for (const row of open) {
      const name = lenderName.get(row.lenderId) ?? "Lender";
      const prefix = `sub:${row.id}:`;
      steps.push(
        { key: `${prefix}dip`, label: `${name} · DIP uploaded` },
        { key: `${prefix}caseNumber`, label: `${name} · case number recorded` },
        { key: `${prefix}fee`, label: `${name} · application & valuation fee confirmed` },
        { key: `${prefix}decision`, label: `${name} · decision requested` },
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
      { key: "valuationDate", label: "Valuation date set" },
      { key: "valuationCompleted", label: "Valuation took place" },
    );
    done.set("valuationDate", caseRow.valuationDate != null);
    done.set("valuationCompleted", caseRow.valuationCompletedAt != null);
    if (open.length > 1) {
      steps.push({ key: "lenderChosen", label: "Lender chosen to proceed with" });
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
  } else if (kind === PROPERTY_REVIEW_KIND && ids.propertyId) {
    // Rent and GDV steps only appear when the matter type calls for them.
    const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, ids.propertyId));
    if (!property) return;
    steps = propertyStepsFor(property);
    done = (await propertyDoneMap(property.id)) ?? new Map<string, boolean>();
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
async function syncStageChecklists(caseId: number) {
  const tasks = await db
    .select({ id: tasksTable.id, stageIndex: tasksTable.stageIndex })
    .from(tasksTable)
    .where(and(eq(tasksTable.kind, STAGE_HANDOFF_KIND), eq(tasksTable.caseId, caseId), ne(tasksTable.status, "done")));
  for (const task of tasks) {
    if (task.stageIndex == null) continue;
    const stage = await stageSteps(caseId, task.stageIndex);
    if (!stage) return;
    const items = await db
      .select({
        id: taskChecklistItemsTable.id,
        sourceKey: taskChecklistItemsTable.sourceKey,
        done: taskChecklistItemsTable.done,
        position: taskChecklistItemsTable.position,
      })
      .from(taskChecklistItemsTable)
      .where(eq(taskChecklistItemsTable.taskId, task.id));
    const known = new Set(items.map((item) => item.sourceKey).filter(Boolean));
    const wanted = new Set(stage.steps.map((step) => step.key));
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

/** Re-tick the auto steps of every open task of `kind` that points at the given record. */
async function syncChecklists(kind: string, column: "clientId" | "propertyId" | "caseId", id: number) {
  const tasks = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.kind, kind), eq(tasksTable[column], id), ne(tasksTable.status, "done")));
  if (tasks.length === 0) return;
  const done = await doneMapFor(kind, { [column]: id });
  if (!done) return;
  const taskIds = tasks.map((task) => task.id);
  const items = await db
    .select({ id: taskChecklistItemsTable.id, sourceKey: taskChecklistItemsTable.sourceKey, done: taskChecklistItemsTable.done })
    .from(taskChecklistItemsTable)
    .where(inArray(taskChecklistItemsTable.taskId, taskIds));
  const toTick = items.filter((item) => item.sourceKey && done.get(item.sourceKey) === true && !item.done).map((item) => item.id);
  const toUntick = items.filter((item) => item.sourceKey && done.get(item.sourceKey) === false && item.done).map((item) => item.id);
  if (toTick.length) await db.update(taskChecklistItemsTable).set({ done: true }).where(inArray(taskChecklistItemsTable.id, toTick));
  if (toUntick.length) await db.update(taskChecklistItemsTable).set({ done: false }).where(inArray(taskChecklistItemsTable.id, toUntick));
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

/** Ticking a requirement step on a task completes (or reopens) the requirement itself. */
export async function applyChecklistItemToCase(item: { sourceKey: string | null; done: boolean }, completedBy: string) {
  const requirementId = requirementIdFromKey(item.sourceKey);
  if (!requirementId) return;
  await db
    .update(requirementsTable)
    .set({
      complete: item.done,
      completedAt: item.done ? new Date() : null,
      completedBy: item.done ? completedBy : null,
    })
    .where(eq(requirementsTable.id, requirementId));
}
