import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  appUsersTable,
  casesTable,
  clientsTable,
  db,
  taskChecklistItemsTable,
  taskCommentsTable,
  tasksTable,
} from "@workspace/db";
import { isStaffRole } from "../auth/roles";
import { renderChariotEmail } from "../integrations/email-template";
import { sendChariotEmail } from "../integrations/resend";
import { logger } from "../lib/logger";

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

type TaskRow = typeof tasksTable.$inferSelect;

/** Rows written before the status/priority enums existed ("pending", "medium"…) map onto the nearest value. */
export function normalizeStatus(value: string): TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value) ? (value as TaskStatus) : "todo";
}
export function normalizePriority(value: string): TaskPriority {
  if ((TASK_PRIORITIES as readonly string[]).includes(value)) return value as TaskPriority;
  return value === "medium" ? "normal" : value === "critical" ? "urgent" : "normal";
}

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

export interface TaskCaseInfo {
  reference: string;
  clientId: number;
  clientName: string;
}

/** Case reference + client name for a set of case ids, in one round trip. */
async function caseInfoFor(caseIds: number[]): Promise<Map<number, TaskCaseInfo>> {
  const result = new Map<number, TaskCaseInfo>();
  if (caseIds.length === 0) return result;
  const rows = await db
    .select({
      id: casesTable.id,
      reference: sql<string>`coalesce(${casesTable.displayReference}, ${casesTable.reference})`,
      clientId: casesTable.clientId,
      clientName: clientsTable.name,
    })
    .from(casesTable)
    .innerJoin(clientsTable, eq(casesTable.clientId, clientsTable.id))
    .where(inArray(casesTable.id, caseIds));
  for (const row of rows) result.set(row.id, { reference: row.reference, clientId: row.clientId, clientName: row.clientName });
  return result;
}

async function checklistCountsFor(taskIds: number[]) {
  const result = new Map<number, { total: number; done: number; next: string | null }>();
  if (taskIds.length === 0) return result;
  const rows = await db
    .select({
      taskId: taskChecklistItemsTable.taskId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${taskChecklistItemsTable.done})::int`,
      // The first unfinished step, in checklist order: what the task is up to.
      next: sql<string | null>`(array_agg(${taskChecklistItemsTable.title} order by ${taskChecklistItemsTable.position}, ${taskChecklistItemsTable.id}) filter (where not ${taskChecklistItemsTable.done}))[1]`,
    })
    .from(taskChecklistItemsTable)
    .where(inArray(taskChecklistItemsTable.taskId, taskIds))
    .groupBy(taskChecklistItemsTable.taskId);
  for (const row of rows) result.set(row.taskId, { total: row.total, done: row.done, next: row.next ?? null });
  return result;
}

async function commentCountsFor(taskIds: number[]) {
  const result = new Map<number, number>();
  if (taskIds.length === 0) return result;
  const rows = await db
    .select({ taskId: taskCommentsTable.taskId, count: sql<number>`count(*)::int` })
    .from(taskCommentsTable)
    .where(inArray(taskCommentsTable.taskId, taskIds))
    .groupBy(taskCommentsTable.taskId);
  for (const row of rows) result.set(row.taskId, row.count);
  return result;
}

async function creatorNamesFor(userIds: number[]) {
  const result = new Map<number, string>();
  if (userIds.length === 0) return result;
  const rows = await db
    .select({ id: appUsersTable.id, displayName: appUsersTable.displayName })
    .from(appUsersTable)
    .where(inArray(appUsersTable.id, userIds));
  for (const row of rows) result.set(row.id, row.displayName);
  return result;
}

/** API shape of a list of task rows — batches every lookup so a long list costs a fixed number of queries. */
export async function taskViews(rows: TaskRow[]) {
  const unique = (values: (number | null | undefined)[]) => [...new Set(values.filter((v): v is number => v != null))];
  const [cases, checklist, comments, creators] = await Promise.all([
    caseInfoFor(unique(rows.map((row) => row.caseId))),
    checklistCountsFor(rows.map((row) => row.id)),
    commentCountsFor(rows.map((row) => row.id)),
    creatorNamesFor(unique(rows.map((row) => row.createdByUserId))),
  ]);
  return rows.map((task) => {
    const caseInfo = task.caseId ? cases.get(task.caseId) : undefined;
    const counts = checklist.get(task.id);
    return {
      id: task.id,
      title: task.title,
      caseId: task.caseId ?? null,
      clientId: task.clientId ?? caseInfo?.clientId ?? null,
      caseReference: caseInfo?.reference ?? null,
      clientName: caseInfo?.clientName ?? null,
      assignee: task.assignee,
      assignedUserId: task.assignedUserId!,
      status: normalizeStatus(task.status),
      priority: normalizePriority(task.priority),
      dueDate: task.dueDate,
      notes: task.notes,
      createdAt: task.createdAt.toISOString(),
      completedAt: iso(task.completedAt),
      createdByUserId: task.createdByUserId ?? null,
      createdByName: task.createdByUserId ? creators.get(task.createdByUserId) ?? null : null,
      checklistTotal: counts?.total ?? 0,
      checklistDone: counts?.done ?? 0,
      checklistNext: counts?.next ?? null,
      commentCount: comments.get(task.id) ?? 0,
      kind: task.kind ?? null,
      propertyId: task.propertyId ?? null,
    };
  });
}

export async function taskView(task: TaskRow) {
  const [view] = await taskViews([task]);
  return view!;
}

export const checklistItemView = (row: typeof taskChecklistItemsTable.$inferSelect) => ({
  id: row.id,
  taskId: row.taskId,
  title: row.title,
  done: row.done,
  position: row.position,
  sourceKey: row.sourceKey ?? null,
});

export const commentView = (row: typeof taskCommentsTable.$inferSelect) => ({
  id: row.id,
  taskId: row.taskId,
  authorUserId: row.authorUserId ?? null,
  authorName: row.authorName,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
});

/** Task plus its checklist and comment thread, for the inspector. */
export async function taskDetailView(task: TaskRow) {
  const [view, checklist, comments] = await Promise.all([
    taskView(task),
    db
      .select()
      .from(taskChecklistItemsTable)
      .where(eq(taskChecklistItemsTable.taskId, task.id))
      .orderBy(asc(taskChecklistItemsTable.position), asc(taskChecklistItemsTable.id)),
    db
      .select()
      .from(taskCommentsTable)
      .where(eq(taskCommentsTable.taskId, task.id))
      .orderBy(asc(taskCommentsTable.createdAt), asc(taskCommentsTable.id)),
  ]);
  return { ...view, checklist: checklist.map(checklistItemView), comments: comments.map(commentView) };
}

export interface TaskAssignee {
  id: number;
  displayName: string;
  email: string;
}

/** Active staff user by id, or null when missing, inactive, or not staff. */
export async function taskAssignee(userId: number): Promise<TaskAssignee | null> {
  const [row] = await db
    .select({
      id: appUsersTable.id,
      displayName: appUsersTable.displayName,
      email: appUsersTable.email,
      role: appUsersTable.role,
      active: appUsersTable.active,
    })
    .from(appUsersTable)
    .where(eq(appUsersTable.id, userId));
  if (!row || !row.active || !isStaffRole(row.role)) return null;
  return { id: row.id, displayName: row.displayName, email: row.email };
}

/** Notify the assignee about a task they were just given. Delivery failures are logged, never thrown. */
export function notifyAssignee(assignee: TaskAssignee, task: TaskRow, reason: "assigned" | "reassigned") {
  const heading = reason === "assigned" ? "A new task has been assigned to you" : "A task has been reassigned to you";
  sendChariotEmail({
    purpose: "task_assignment",
    to: [assignee.email],
    subject: `${reason === "assigned" ? "New task assigned" : "Task reassigned to you"}: ${task.title}`,
    html: renderChariotEmail({
      preheader: `${heading}, due ${task.dueDate}.`,
      heading,
      paragraphs: [
        `Dear ${assignee.displayName},`,
        `The following task is now yours, due <strong>${task.dueDate}</strong>:`,
        `<strong>${task.title}</strong>`,
        ...(task.notes ? [task.notes] : []),
      ],
    }),
  }).catch((error) => logger.warn({ err: error, taskId: task.id }, "Task assignment email was not delivered"));
}

/** Newest-first list of tasks visible to a user: admins see everything, other staff only their own. */
export async function visibleTaskRows(user: { id: number; role: string }, fullAccess: boolean) {
  return db
    .select()
    .from(tasksTable)
    .where(fullAccess ? undefined : eq(tasksTable.assignedUserId, user.id))
    .orderBy(asc(tasksTable.dueDate), desc(tasksTable.id));
}

/** Rows from `ids` that the user is allowed to change — admins all of them, other staff only those assigned to them. */
export async function editableTaskRows(ids: number[], user: { id: number }, fullAccess: boolean) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(tasksTable)
    .where(
      fullAccess
        ? inArray(tasksTable.id, ids)
        : and(inArray(tasksTable.id, ids), eq(tasksTable.assignedUserId, user.id)),
    );
}
