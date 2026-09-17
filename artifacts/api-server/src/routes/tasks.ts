import { Router, type IRouter, type Response } from "express";
import {
  BulkDeleteTasksBody,
  BulkUpdateTasksBody,
  BulkUpdateTasksResponse,
  CreateTaskBody,
  CreateTaskChecklistItemBody,
  CreateTaskChecklistItemParams,
  CreateTaskChecklistItemResponse,
  CreateTaskCommentBody,
  CreateTaskCommentParams,
  CreateTaskCommentResponse,
  CreateTaskResponse,
  DeleteTaskChecklistItemParams,
  DeleteTaskCommentParams,
  DeleteTaskParams,
  GetTaskParams,
  GetTaskResponse,
  ListTasksResponse,
  UpdateTaskBody,
  UpdateTaskChecklistItemBody,
  UpdateTaskChecklistItemParams,
  UpdateTaskChecklistItemResponse,
  UpdateTaskParams,
  UpdateTaskResponse,
} from "@workspace/api-zod";
import { casesTable, db, taskChecklistItemsTable, taskCommentsTable, tasksTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { isFullAccess } from "../auth/roles";
import { requireStaff } from "../auth/session";
import { syncTaskStatusToCase } from "../services/case-dates";
import { stageName } from "../services/stages";
import {
  ChecklistStepLockedError,
  STAGE_HANDOFF_KIND,
  applyChecklistItemToCase,
  checklistStepLock,
  syncCaseChecklists,
} from "../services/task-checklists";
import { advanceCaseStage, refOf } from "./operations";
import {
  checklistItemView,
  commentView,
  normalizeStatus,
  editableTaskRows,
  notifyAssignee,
  taskAssignee,
  taskDetailView,
  taskView,
  taskViews,
  visibleTaskRows,
} from "../services/tasks";

const router: IRouter = Router();
router.use(requireStaff);

const currentUser = (res: Response) => res.locals.authUser as { id: number; role: string; displayName: string };
const fullAccess = (res: Response) => isFullAccess(currentUser(res).role);
const invalid = (res: Response, message = "Invalid request") => void res.status(400).json({ error: message });
const notFound = (res: Response) => void res.status(404).json({ error: "Task not found" });
const toDateString = (value: Date) => value.toISOString().slice(0, 10);

/** Load one task the current user may see (admins any; other staff only their own). Replies 404/403 itself. */
async function loadVisibleTask(taskId: number, res: Response) {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) {
    notFound(res);
    return null;
  }
  if (!fullAccess(res) && task.assignedUserId !== currentUser(res).id) {
    res.status(403).json({ error: "Task is not assigned to you" });
    return null;
  }
  return task;
}

type TaskRow = typeof tasksTable.$inferSelect;

/**
 * A stage hand-off task *is* the stage: completing it moves the case on
 * through the same gate as the Advance button, and is refused — the task
 * stays open — while the case cannot leave the stage. A hand-off for a stage
 * the case has already left just closes. Returns the refusal, or null.
 */
async function completeStageHandoff(
  task: TaskRow,
  user: { id: number; displayName: string },
): Promise<{ error: string; incomplete?: string[] } | null> {
  if (task.kind !== STAGE_HANDOFF_KIND || task.caseId == null || task.stageIndex == null) return null;
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, task.caseId));
  if (!caseRow || caseRow.status === "completed" || caseRow.stageIndex !== task.stageIndex) return null;
  const outcome = await advanceCaseStage(caseRow, user, { completedRequirementIds: [] });
  if (outcome.ok) return null;
  const stage = stageName(caseRow.stageIndex);
  return outcome.incomplete
    ? { error: `${refOf(caseRow)} can't leave ${stage} yet — finish the steps on the case first`, incomplete: outcome.incomplete }
    : { error: `${stage} is finished from the case page: ${outcome.error.toLowerCase()}` };
}

/** Column values that move a task into or out of `done`. */
function completionFields(status: string | undefined, userId: number) {
  if (status === undefined) return {};
  return status === "done"
    ? { completedAt: new Date(), completedByUserId: userId }
    : { completedAt: null, completedByUserId: null };
}

router.get("/tasks", async (_req, res): Promise<void> => {
  const rows = await visibleTaskRows(currentUser(res), fullAccess(res));
  res.json(ListTasksResponse.parse(await taskViews(rows)));
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.message);
  const user = currentUser(res);
  if (!fullAccess(res) && parsed.data.assignedUserId !== user.id) {
    res.status(403).json({ error: "Staff can only create tasks assigned to themselves" });
    return;
  }
  if (parsed.data.caseId) {
    const [caseRow] = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.id, parsed.data.caseId));
    if (!caseRow) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
  }
  const assignee = await taskAssignee(parsed.data.assignedUserId);
  if (!assignee) return invalid(res, "Task assignee must be an active staff user");
  const status = parsed.data.status ?? "todo";
  const [created] = await db
    .insert(tasksTable)
    .values({
      title: parsed.data.title.trim(),
      caseId: parsed.data.caseId ?? null,
      clientId: parsed.data.clientId ?? null,
      propertyId: parsed.data.propertyId ?? null,
      assignee: assignee.displayName,
      assignedUserId: assignee.id,
      status,
      priority: parsed.data.priority,
      notes: parsed.data.notes ?? "",
      dueDate: toDateString(parsed.data.dueDate),
      createdByUserId: user.id,
      ...completionFields(status, user.id),
    })
    .returning();
  if (!created) {
    res.status(500).json({ error: "Task was not created" });
    return;
  }
  if (assignee.id !== user.id) notifyAssignee(assignee, created, "assigned");
  res.status(201).json(CreateTaskResponse.parse(await taskView(created)));
});

router.post("/tasks/bulk", async (req, res): Promise<void> => {
  const parsed = BulkUpdateTasksBody.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.message);
  const user = currentUser(res);
  const admin = fullAccess(res);
  if (!admin && (parsed.data.assignedUserId !== undefined || parsed.data.dueDate !== undefined)) {
    res.status(403).json({ error: "Only administrators can reassign or reschedule tasks" });
    return;
  }
  const rows = await editableTaskRows(parsed.data.ids, user, admin);
  if (rows.length === 0) return notFound(res);
  let assignee: Awaited<ReturnType<typeof taskAssignee>> = null;
  if (parsed.data.assignedUserId !== undefined) {
    assignee = await taskAssignee(parsed.data.assignedUserId);
    if (!assignee) return invalid(res, "Task assignee must be an active staff user");
  }
  if (parsed.data.status === "done") {
    for (const row of rows) {
      if (row.status === "done") continue;
      const refusal = await completeStageHandoff(row, user);
      if (refusal) {
        res.status(409).json({ ...refusal, error: `${row.title}: ${refusal.error}` });
        return;
      }
    }
  }
  const ids = rows.map((row) => row.id);
  const updated = await db
    .update(tasksTable)
    .set({
      status: parsed.data.status,
      priority: parsed.data.priority,
      assignee: assignee?.displayName,
      assignedUserId: assignee?.id,
      dueDate: parsed.data.dueDate ? toDateString(parsed.data.dueDate) : undefined,
      ...completionFields(parsed.data.status, user.id),
    })
    .where(inArray(tasksTable.id, ids))
    .returning();
  if (parsed.data.status !== undefined) {
    for (const row of updated) {
      if (row.calendarEventId) await syncTaskStatusToCase(row, { userId: user.id, displayName: user.displayName });
    }
  }
  if (assignee && assignee.id !== user.id) {
    for (const row of rows) {
      if (row.assignedUserId !== assignee.id) {
        const fresh = updated.find((item) => item.id === row.id);
        if (fresh) notifyAssignee(assignee, fresh, "reassigned");
      }
    }
  }
  res.json(BulkUpdateTasksResponse.parse(await taskViews(updated)));
});

router.post("/tasks/bulk-delete", async (req, res): Promise<void> => {
  const parsed = BulkDeleteTasksBody.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.message);
  const user = currentUser(res);
  // Admins delete anything; other staff only tasks they created for themselves.
  await db.delete(tasksTable).where(
    fullAccess(res)
      ? inArray(tasksTable.id, parsed.data.ids)
      : and(
          inArray(tasksTable.id, parsed.data.ids),
          eq(tasksTable.assignedUserId, user.id),
          eq(tasksTable.createdByUserId, user.id),
        ),
  );
  res.status(204).end();
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) return invalid(res);
  const task = await loadVisibleTask(params.data.id, res);
  if (!task) return;
  res.json(GetTaskResponse.parse(await taskDetailView(task)));
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  const body = UpdateTaskBody.safeParse(req.body);
  if (!params.success || !body.success) return invalid(res, "Invalid task update");
  const user = currentUser(res);
  const admin = fullAccess(res);
  const existing = await loadVisibleTask(params.data.id, res);
  if (!existing) return;
  if (!admin && (body.data.assignedUserId !== undefined || body.data.dueDate !== undefined)) {
    res.status(403).json({ error: "Only administrators can reassign or reschedule tasks" });
    return;
  }
  if (body.data.caseId) {
    const [caseRow] = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.id, body.data.caseId));
    if (!caseRow) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
  }
  let assignee: Awaited<ReturnType<typeof taskAssignee>> = null;
  if (body.data.assignedUserId !== undefined) {
    assignee = await taskAssignee(body.data.assignedUserId);
    if (!assignee) return invalid(res, "Task assignee must be an active staff user");
  }
  const status =
    body.data.status ?? (body.data.completed === true ? "done" : body.data.completed === false ? "todo" : undefined);
  if (status === "done" && existing.status !== "done") {
    const refusal = await completeStageHandoff(existing, user);
    if (refusal) {
      res.status(409).json(refusal);
      return;
    }
  }
  const [updated] = await db
    .update(tasksTable)
    .set({
      title: body.data.title?.trim(),
      caseId: body.data.caseId === undefined ? undefined : body.data.caseId,
      clientId: body.data.clientId === undefined ? undefined : body.data.clientId,
      status,
      priority: body.data.priority,
      assignee: assignee?.displayName,
      assignedUserId: assignee?.id,
      notes: body.data.notes,
      dueDate: body.data.dueDate ? toDateString(body.data.dueDate) : undefined,
      ...completionFields(status, user.id),
    })
    .where(eq(tasksTable.id, params.data.id))
    .returning();
  if (!updated) return notFound(res);
  if (assignee && assignee.id !== existing.assignedUserId && assignee.id !== user.id) {
    notifyAssignee(assignee, updated, "reassigned");
  }
  if (status !== undefined && updated.status !== existing.status) {
    await syncTaskStatusToCase(updated, { userId: user.id, displayName: user.displayName });
  }
  res.json(UpdateTaskResponse.parse(await taskView(updated)));
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) return invalid(res);
  const task = await loadVisibleTask(params.data.id, res);
  if (!task) return;
  if (!fullAccess(res) && task.createdByUserId !== currentUser(res).id) {
    res.status(403).json({ error: "Only administrators can delete tasks assigned by someone else" });
    return;
  }
  await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
  res.status(204).end();
});

router.post("/tasks/:id/checklist", async (req, res): Promise<void> => {
  const params = CreateTaskChecklistItemParams.safeParse(req.params);
  const body = CreateTaskChecklistItemBody.safeParse(req.body);
  if (!params.success || !body.success) return invalid(res);
  const task = await loadVisibleTask(params.data.id, res);
  if (!task) return;
  const [{ next } = { next: 0 }] = await db
    .select({ next: sql<number>`coalesce(max(${taskChecklistItemsTable.position}), -1)::int + 1` })
    .from(taskChecklistItemsTable)
    .where(eq(taskChecklistItemsTable.taskId, task.id));
  const [created] = await db
    .insert(taskChecklistItemsTable)
    .values({ taskId: task.id, title: body.data.title.trim(), position: next })
    .returning();
  res.status(201).json(CreateTaskChecklistItemResponse.parse(checklistItemView(created!)));
});

router.patch("/tasks/:id/checklist/:itemId", async (req, res): Promise<void> => {
  const params = UpdateTaskChecklistItemParams.safeParse(req.params);
  const body = UpdateTaskChecklistItemBody.safeParse(req.body);
  if (!params.success || !body.success) return invalid(res);
  const task = await loadVisibleTask(params.data.id, res);
  if (!task) return;
  const [existing] = await db
    .select()
    .from(taskChecklistItemsTable)
    .where(and(eq(taskChecklistItemsTable.id, params.data.itemId), eq(taskChecklistItemsTable.taskId, task.id)));
  if (!existing) {
    res.status(404).json({ error: "Checklist item not found" });
    return;
  }
  // Synced steps that need a value or a document are ticked by the case, not by hand.
  const lock = body.data.done !== undefined ? checklistStepLock(existing.sourceKey, existing.title) : null;
  if (lock) {
    res.status(409).json({ error: `${lock} — this step ticks itself once it is recorded.` });
    return;
  }
  const user = currentUser(res);
  // A synced step writes through to the case (requirement, lender flag, valuation) before the task is updated,
  // so a refusal leaves the task as it was.
  if (body.data.done !== undefined && existing.sourceKey) {
    try {
      await applyChecklistItemToCase(task, { sourceKey: existing.sourceKey, title: existing.title, done: body.data.done }, { userId: user.id, displayName: user.displayName });
    } catch (error) {
      if (error instanceof ChecklistStepLockedError) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  }
  const [updated] = await db
    .update(taskChecklistItemsTable)
    .set({ title: body.data.title?.trim(), done: body.data.done })
    .where(eq(taskChecklistItemsTable.id, existing.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Checklist item not found" });
    return;
  }
  if (body.data.done !== undefined && task.caseId) await syncCaseChecklists(task.caseId);
  // Ticking the first step means work has started: a "to do" task moves itself to "in progress".
  if (updated.done && normalizeStatus(task.status) === "todo") {
    await db.update(tasksTable).set({ status: "in_progress" }).where(eq(tasksTable.id, task.id));
  }
  res.json(UpdateTaskChecklistItemResponse.parse(checklistItemView(updated)));
});

router.delete("/tasks/:id/checklist/:itemId", async (req, res): Promise<void> => {
  const params = DeleteTaskChecklistItemParams.safeParse(req.params);
  if (!params.success) return invalid(res);
  const task = await loadVisibleTask(params.data.id, res);
  if (!task) return;
  await db
    .delete(taskChecklistItemsTable)
    .where(and(eq(taskChecklistItemsTable.id, params.data.itemId), eq(taskChecklistItemsTable.taskId, task.id)));
  res.status(204).end();
});

router.post("/tasks/:id/comments", async (req, res): Promise<void> => {
  const params = CreateTaskCommentParams.safeParse(req.params);
  const body = CreateTaskCommentBody.safeParse(req.body);
  if (!params.success || !body.success) return invalid(res);
  const task = await loadVisibleTask(params.data.id, res);
  if (!task) return;
  const user = currentUser(res);
  const [created] = await db
    .insert(taskCommentsTable)
    .values({ taskId: task.id, authorUserId: user.id, authorName: user.displayName, body: body.data.body.trim() })
    .returning();
  res.status(201).json(CreateTaskCommentResponse.parse(commentView(created!)));
});

router.delete("/tasks/:id/comments/:commentId", async (req, res): Promise<void> => {
  const params = DeleteTaskCommentParams.safeParse(req.params);
  if (!params.success) return invalid(res);
  const task = await loadVisibleTask(params.data.id, res);
  if (!task) return;
  const user = currentUser(res);
  // Authors remove their own comments; admins can remove any.
  await db.delete(taskCommentsTable).where(
    fullAccess(res)
      ? and(eq(taskCommentsTable.id, params.data.commentId), eq(taskCommentsTable.taskId, task.id))
      : and(
          eq(taskCommentsTable.id, params.data.commentId),
          eq(taskCommentsTable.taskId, task.id),
          eq(taskCommentsTable.authorUserId, user.id),
        ),
  );
  res.status(204).end();
});

export default router;
