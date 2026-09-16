import { and, eq, like, ne } from "drizzle-orm";
import { activitiesTable, calendarEventsTable, caseStressTestsTable, casesTable, db, propertiesTable, propertyValuationsTable, tasksTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { createAssignmentTask, resolveAssignee, stageSection } from "./assignment";
import { STAGES, stageOwnerRole } from "./stages";
import { syncCaseChecklists } from "./task-checklists";

/**
 * Keeps a case's valuation date and expected completion date in step with the
 * calendar and the task list:
 *
 *   case date  ──▶  calendar event (source case_valuation / case_completion)
 *              ──▶  follow-up task for the step's default assignee, due that day
 *
 * and back again: confirming the valuation from the case, the event or the
 * task marks all three; moving the event on the calendar moves the case date.
 */

type CaseRow = typeof casesTable.$inferSelect;
type EventRow = typeof calendarEventsTable.$inferSelect;

export type CaseDateKind = "valuation" | "completion";
export const CASE_EVENT_SOURCE: Record<CaseDateKind, "case_valuation" | "case_completion"> = {
  valuation: "case_valuation",
  completion: "case_completion",
};
const COMPLETION_STAGE_INDEX = STAGES.indexOf("Completion");

const refOf = (row: Pick<CaseRow, "reference" | "displayReference">) => row.displayReference || row.reference;
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

function eventTitle(kind: CaseDateKind, reference: string) {
  return kind === "valuation" ? `Valuation — ${reference}` : `Completion — ${reference}`;
}
function taskTitle(kind: CaseDateKind, reference: string) {
  return kind === "valuation"
    ? `Valuation — ${reference}: confirm it took place`
    : `Completion — ${reference}: verify completion and mark the case complete`;
}
function taskNotes(kind: CaseDateKind, date: Date) {
  return kind === "valuation"
    ? `The valuation is booked for ${dateOnly(date)}. Once it has taken place, mark this task done (or confirm it on the case) and request the lender's decision.`
    : `The mortgage is expected to complete on ${dateOnly(date)}. Verify completion, then mark the case completed so the property joins the client's portfolio.`;
}

async function caseEvent(caseId: number, kind: CaseDateKind): Promise<EventRow | undefined> {
  const [row] = await db
    .select()
    .from(calendarEventsTable)
    .where(and(eq(calendarEventsTable.caseId, caseId), eq(calendarEventsTable.source, CASE_EVENT_SOURCE[kind])))
    .limit(1);
  if (row || kind !== "valuation") return row;
  // Valuation events written before `source` existed ("Valuation date — REF", manual): adopt them.
  const [legacy] = await db
    .select()
    .from(calendarEventsTable)
    .where(
      and(
        eq(calendarEventsTable.caseId, caseId),
        eq(calendarEventsTable.source, "manual"),
        eq(calendarEventsTable.eventType, "valuation"),
        like(calendarEventsTable.title, "Valuation date — %"),
      ),
    )
    .limit(1);
  if (!legacy) return undefined;
  const [adopted] = await db
    .update(calendarEventsTable)
    .set({ source: CASE_EVENT_SOURCE.valuation })
    .where(eq(calendarEventsTable.id, legacy.id))
    .returning();
  return adopted;
}

async function eventTask(eventId: number) {
  const [row] = await db.select().from(tasksTable).where(eq(tasksTable.calendarEventId, eventId)).limit(1);
  return row;
}

/**
 * Mirror a case date onto the calendar and the task list. `date` null removes
 * both. Changing the date reopens the event/task so the follow-up happens again.
 */
export async function syncCaseDate(
  caseRow: CaseRow,
  kind: CaseDateKind,
  date: Date | null,
  actorUserId: number | null,
) {
  const reference = refOf(caseRow);
  const existing = await caseEvent(caseRow.id, kind);

  if (!date) {
    if (existing) {
      await db.delete(tasksTable).where(and(eq(tasksTable.calendarEventId, existing.id), ne(tasksTable.status, "done")));
      await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, existing.id));
    }
    return;
  }

  const unchanged = existing && existing.eventDate.getTime() === date.getTime();
  let event: EventRow | undefined = existing;
  if (existing) {
    const [updated] = await db
      .update(calendarEventsTable)
      .set(
        unchanged
          ? { title: eventTitle(kind, reference) }
          : { title: eventTitle(kind, reference), eventDate: date, completed: false, completedAt: null },
      )
      .where(eq(calendarEventsTable.id, existing.id))
      .returning();
    event = updated;
  } else {
    const [created] = await db
      .insert(calendarEventsTable)
      .values({
        caseId: caseRow.id,
        title: eventTitle(kind, reference),
        eventType: kind,
        eventDate: date,
        source: CASE_EVENT_SOURCE[kind],
        createdByUserId: actorUserId,
      })
      .returning();
    event = created;
  }
  if (!event) return;

  const task = await eventTask(event.id);
  if (task) {
    await db
      .update(tasksTable)
      .set(
        unchanged
          ? { title: taskTitle(kind, reference) }
          : { title: taskTitle(kind, reference), notes: taskNotes(kind, date), dueDate: dateOnly(date), status: "todo", completedAt: null, completedByUserId: null },
      )
      .where(eq(tasksTable.id, task.id));
    return;
  }
  const resolved = await resolveAssignee(
    kind === "valuation"
      ? { section: "submission_valuation_date" }
      : { section: stageSection(COMPLETION_STAGE_INDEX), fallbackRole: stageOwnerRole[COMPLETION_STAGE_INDEX] },
  );
  if (!resolved.ok) {
    logger.warn({ caseId: caseRow.id, kind }, "No assignee for the case date follow-up task");
    return;
  }
  await createAssignmentTask({
    staffUser: resolved.staffUser,
    title: taskTitle(kind, reference),
    notes: taskNotes(kind, date),
    caseId: caseRow.id,
    clientId: caseRow.clientId,
    dueDate: dateOnly(date),
    calendarEventId: event.id,
  });
}

/** Close (or reopen) the event and task that mirror a case date, without touching the case. */
async function setMirrorsCompleted(caseId: number, kind: CaseDateKind, completed: boolean, actorUserId: number | null) {
  const event = await caseEvent(caseId, kind);
  if (!event) return;
  await db
    .update(calendarEventsTable)
    .set({ completed, completedAt: completed ? new Date() : null })
    .where(eq(calendarEventsTable.id, event.id));
  await db
    .update(tasksTable)
    .set(
      completed
        ? { status: "done", completedAt: new Date(), completedByUserId: actorUserId }
        : { status: "todo", completedAt: null, completedByUserId: null },
    )
    .where(eq(tasksTable.calendarEventId, event.id));
}

/**
 * Record that the valuation took place (or reopen it). Called from the case
 * endpoint, from completing the calendar event, and from completing the task,
 * so every entry point ends in the same state.
 */
export async function setValuationCompleted(
  caseId: number,
  completed: boolean,
  actor: { userId: number | null; displayName: string },
  /** The lender's valuation figure; when confirming, it becomes the case and property value. */
  amount?: number,
): Promise<CaseRow | null> {
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
  if (!caseRow) return null;
  const already = Boolean(caseRow.valuationCompletedAt) === completed;
  const newAmount = completed && amount && amount > 0 ? amount : null;
  const amountChanged = newAmount != null && newAmount !== caseRow.valuationAmount;
  const [updated] = already && !amountChanged
    ? [caseRow]
    : await db
        .update(casesTable)
        .set({
          valuationCompletedAt: completed ? (caseRow.valuationCompletedAt ?? new Date()) : null,
          ...(completed
            ? newAmount != null ? { valuationAmount: newAmount, propertyValue: newAmount } : {}
            : { valuationAmount: null }),
        })
        .where(eq(casesTable.id, caseId))
        .returning();
  if (amountChanged && newAmount != null) {
    // The valuer's figure is now the property's value everywhere it is used.
    if (caseRow.propertyId) {
      await db.update(propertiesTable).set({ value: newAmount }).where(eq(propertiesTable.id, caseRow.propertyId));
      await db.insert(propertyValuationsTable).values({
        propertyId: caseRow.propertyId,
        amount: newAmount,
        valuedAt: dateOnly(caseRow.valuationDate ?? new Date()),
        source: "case_valuation",
        caseId,
        notes: `Recorded from ${refOf(caseRow)}`,
        recordedByUserId: actor.userId,
      });
    }
    await db
      .update(caseStressTestsTable)
      .set({ propertyValue: newAmount })
      .where(eq(caseStressTestsTable.caseId, caseId));
    await db.insert(activitiesTable).values({
      caseId,
      title: "Valuation figure recorded",
      detail: `${refOf(caseRow)}: valued at £${newAmount.toLocaleString("en-GB")} — property value updated`,
      actorName: actor.displayName,
    });
  }
  await setMirrorsCompleted(caseId, "valuation", completed, actor.userId);
  await syncCaseChecklists(caseId);
  if (!already) {
    await db.insert(activitiesTable).values({
      caseId,
      title: completed ? "Valuation took place" : "Valuation reopened",
      detail: completed
        ? `${refOf(caseRow)}: the valuation was confirmed as completed`
        : `${refOf(caseRow)}: the valuation was marked as not yet completed`,
      actorName: actor.displayName,
    });
  }
  return updated ?? caseRow;
}

/** Called when the case is marked completed: closes the completion event and its task. */
export async function markCompletionMirrorsDone(caseId: number, actorUserId: number | null) {
  await setMirrorsCompleted(caseId, "completion", true, actorUserId);
}

/** Which case date (if any) an event or task mirrors. */
export function caseDateKindOf(source: string): CaseDateKind | null {
  if (source === "case_valuation") return "valuation";
  if (source === "case_completion") return "completion";
  return null;
}

/**
 * A case-sourced calendar event was moved on the calendar: push the new date
 * back onto the case (which re-syncs the event title/date and the task).
 */
export async function moveCaseDateFromEvent(event: EventRow, newDate: Date, actorUserId: number | null) {
  const kind = caseDateKindOf(event.source);
  if (!kind || !event.caseId) return;
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, event.caseId));
  if (!caseRow) return;
  const [updated] = await db
    .update(casesTable)
    .set(kind === "valuation" ? { valuationDate: newDate, valuationCompletedAt: null } : { expectedCompletionDate: newDate })
    .where(eq(casesTable.id, caseRow.id))
    .returning();
  if (updated) await syncCaseDate(updated, kind, newDate, actorUserId);
}

/** A task linked to a case event changed status: mirror it (valuation only — completion is confirmed by completing the case). */
export async function syncTaskStatusToCase(task: typeof tasksTable.$inferSelect, actor: { userId: number | null; displayName: string }) {
  if (!task.calendarEventId) return;
  const [event] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, task.calendarEventId));
  if (!event?.caseId || caseDateKindOf(event.source) !== "valuation") return;
  await setValuationCompleted(event.caseId, task.status === "done", actor);
}
