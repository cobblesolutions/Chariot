import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import {
  appUsersTable,
  caseSubmissionsTable,
  casesTable,
  db,
  lendersTable,
  requirementsTable,
  taskChecklistItemsTable,
  tasksTable,
  underwritingRoundsTable,
} from "@workspace/db";
import { runOpenRouterWorkflow } from "../integrations/openrouter";
import { logger } from "../lib/logger";
import { logActivity } from "./activities";
import { activeStaffUser, createAssignmentTask, resolveAssignee } from "./assignment";
import { STAGES } from "./stages";
import { UNDERWRITING_ROUND_KIND, requirementKey, syncCaseChecklists } from "./task-checklists";

/**
 * Underwriting, kept simple: paste the lender's email → a task for the case
 * handler with one checkbox per requirement → tick them off → mark the round
 * "sent to the lender" → if the lender comes back, paste again for round 2.
 */
export const UNDERWRITING_STAGE_INDEX = STAGES.indexOf("Underwriting");

type CaseRow = typeof casesTable.$inferSelect;
const refOf = (row: CaseRow) => row.displayReference || row.reference;

/** `submission_id = X` or `is null`, for the tables scoped per lender submission. */
export const submissionScope = (column: { submissionId: any }, submissionId: number | null): SQL =>
  submissionId == null ? isNull(column.submissionId) : eq(column.submissionId, submissionId);

async function lenderNameForSubmission(submissionId: number | null) {
  if (submissionId == null) return null;
  const [row] = await db
    .select({ name: lendersTable.name })
    .from(caseSubmissionsTable)
    .innerJoin(lendersTable, eq(lendersTable.id, caseSubmissionsTable.lenderId))
    .where(eq(caseSubmissionsTable.id, submissionId));
  return row?.name ?? null;
}

const SYSTEM_INSTRUCTION = `You read an email from a UK mortgage lender's underwriting team to a broker. List every document, piece of information or action the lender is asking for, one per item, as short plain-English labels a case handler can tick off (e.g. "3 months' business bank statements", "Explanation of the £4,000 credit on 12 June", "Signed direct debit mandate"). Keep the lender's detail (periods, names, amounts). Do not include greetings, sign-offs or things the lender has already received. Return JSON only: { "requirements": ["..."] }.`;

/** AI over a heuristic: the model when it is active and finds something, the line splitter otherwise. */
export async function extractUnderwritingRequirements(emailText: string, progressToken?: string | null): Promise<{ suggestions: string[]; model: string | null }> {
  const heuristic = heuristicRequirementLines(emailText);
  try {
    const result = await runOpenRouterWorkflow<{ email: string }, { requirements?: unknown }>({
      workflow: "create_underwriting_tasks",
      // A list out of an email: the cheapest model is plenty.
      tier: "cheap",
      schemaName: "UnderwritingRequirements",
      systemInstruction: SYSTEM_INSTRUCTION,
      context: { email: emailText },
      progress: { token: progressToken, labels: { requirements: "Listing what the lender is asking for…" } },
    });
    if (result.status === "completed" && Array.isArray(result.data?.requirements)) {
      const items = [...new Set((result.data.requirements as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))];
      if (items.length) return { suggestions: items, model: result.model ?? null };
    }
  } catch (error) {
    logger.warn({ err: error }, "Underwriting extraction fell back to the line splitter");
  }
  return { suggestions: heuristic, model: null };
}

/** Splits the pasted text into candidate requirement lines, skipping greetings and sign-offs. */
export function heuristicRequirementLines(emailText: string): string[] {
  const greetingOrSignoff = /^(dear|to whom|regards|kind regards|best regards|many thanks|hi |hello|thanks|thank you|best[,.]?$|sincerely|yours)/i;
  const rawLines = emailText.split(/\r?\n/).map((line) =>
    line.replace(/^[\s*••\-–—]+/, "").replace(/^\d+[.)]\s*/, "").trim(),
  );
  const suggestions: string[] = [];
  const seen = new Set<string>();
  const signoff = /^(regards|kind regards|best regards|many thanks|thanks|thank you|best[,.]?$|sincerely|yours)/i;
  for (const line of rawLines) {
    // A short standalone sign-off ("Kind regards,") ends the requirements: what follows is the signature block.
    // A long line that merely starts with "Thank you for…" is body text and is skipped by the greeting rule below.
    if (signoff.test(line) && line.length <= 40) break;
    if (greetingOrSignoff.test(line)) continue;
    if (line.length < 4 || /^(please|as discussed|following|further to|in order to)/i.test(line) && !/[:]/.test(line) && line.length < 25) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push(line);
  }
  return suggestions;
}

export class RoundStillOpenError extends Error {
  constructor(public round: number) {
    super(`Round ${round} has not been sent to the lender yet`);
  }
}
export class RoundIncompleteError extends Error {
  constructor(public round: number, public open: number) {
    super(`${open} item${open === 1 ? "" : "s"} in round ${round} still open`);
  }
}

async function roundRows(caseId: number, submissionId: number | null) {
  return db
    .select()
    .from(underwritingRoundsTable)
    .where(and(eq(underwritingRoundsTable.caseId, caseId), submissionScope(underwritingRoundsTable, submissionId)))
    .orderBy(asc(underwritingRoundsTable.round), asc(underwritingRoundsTable.createdAt));
}

/**
 * A new round from the lender's email: its requirements on the case and a
 * task for the case handler whose checkboxes are those requirements (ticking
 * either side ticks the other, via the requirement:<id> checklist keys).
 */
export async function createUnderwritingRound(
  caseRow: CaseRow,
  input: { emailText: string; labels: string[]; submissionId: number | null },
  actor: { id: number; displayName: string },
) {
  const labels = [...new Set(input.labels.map((label) => label.trim()).filter(Boolean))];
  if (labels.length === 0) throw new Error("At least one requirement is required");
  const existing = await roundRows(caseRow.id, input.submissionId);
  const latest = existing[existing.length - 1];
  if (latest && !latest.sentAt) throw new RoundStillOpenError(latest.round);
  const round = (latest?.round ?? 0) + 1;
  const lenderName = await lenderNameForSubmission(input.submissionId);

  const requirements = await db
    .insert(requirementsTable)
    .values(labels.map((label) => ({ caseId: caseRow.id, submissionId: input.submissionId, stageIndex: UNDERWRITING_STAGE_INDEX, label, round })))
    .returning();

  // The task goes to the case handler (or the case default when there is none).
  const handler = caseRow.assignedUserId != null ? await activeStaffUser(caseRow.assignedUserId) : null;
  const fallback = handler ? null : await resolveAssignee({ section: "case", fallbackRole: "case_manager" });
  const staffUser = handler ?? (fallback?.ok ? fallback.staffUser ?? null : null);
  const task = await createAssignmentTask({
    staffUser,
    title: `Underwriting round ${round}${lenderName ? ` (${lenderName})` : ""}: ${refOf(caseRow)}`,
    notes: `${lenderName ?? "The lender"} asked for ${labels.length} thing${labels.length === 1 ? "" : "s"} on ${new Date().toLocaleDateString("en-GB")}. Tick each one as it is provided, then mark the round as sent to the lender on the case.`,
    caseId: caseRow.id,
    clientId: caseRow.clientId,
    kind: UNDERWRITING_ROUND_KIND,
    stageIndex: UNDERWRITING_STAGE_INDEX,
  });
  if (task) {
    await db.insert(taskChecklistItemsTable).values(
      requirements.map((item, position) => ({ taskId: task.id, title: item.label, done: false, position, sourceKey: requirementKey(item.id) })),
    );
  }
  const [row] = await db
    .insert(underwritingRoundsTable)
    .values({ caseId: caseRow.id, submissionId: input.submissionId, round, emailText: input.emailText, createdByUserId: actor.id, taskId: task?.id ?? null })
    .returning();
  // New outstanding items mean underwriting is no longer cleared, if it had been.
  if (caseRow.underwritingCleared) {
    await db.update(casesTable).set({ underwritingCleared: false, underwritingClearedAt: null }).where(eq(casesTable.id, caseRow.id));
  }
  await logActivity({
    kind: "underwriting",
    caseId: caseRow.id,
    title: "Underwriting round added",
    detail: `Round ${round}${lenderName ? ` with ${lenderName}` : ""} on ${refOf(caseRow)}: ${labels.length} requirement${labels.length === 1 ? "" : "s"} from the lender's email${task ? ` — task for ${task.assignee}` : ""}`,
    actorName: actor.displayName,
  });
  await syncCaseChecklists(caseRow.id);
  return row!;
}

/** Everything asked for is provided and has gone to the lender: closes the round and its task. */
export async function markRoundSent(caseRow: CaseRow, roundId: number, actor: { id: number; displayName: string }) {
  const [row] = await db
    .select()
    .from(underwritingRoundsTable)
    .where(and(eq(underwritingRoundsTable.caseId, caseRow.id), eq(underwritingRoundsTable.id, roundId)));
  if (!row) return null;
  if (row.sentAt) return row;
  const items = await db
    .select({ complete: requirementsTable.complete, required: requirementsTable.required })
    .from(requirementsTable)
    .where(and(
      eq(requirementsTable.caseId, caseRow.id),
      eq(requirementsTable.stageIndex, UNDERWRITING_STAGE_INDEX),
      submissionScope(requirementsTable, row.submissionId),
      eq(requirementsTable.round, row.round),
    ));
  const open = items.filter((item) => item.required && !item.complete).length;
  if (open > 0) throw new RoundIncompleteError(row.round, open);
  const [updated] = await db
    .update(underwritingRoundsTable)
    .set({ sentAt: new Date(), sentByUserId: actor.id })
    .where(eq(underwritingRoundsTable.id, row.id))
    .returning();
  if (row.taskId != null) {
    await db
      .update(tasksTable)
      .set({ status: "done", completedAt: new Date(), completedByUserId: actor.id })
      .where(and(eq(tasksTable.id, row.taskId), inArray(tasksTable.status, ["todo", "in_progress"])));
  }
  const lenderName = await lenderNameForSubmission(row.submissionId);
  await logActivity({
    kind: "underwriting",
    caseId: caseRow.id,
    title: "Underwriting round sent to lender",
    detail: `Round ${row.round}${lenderName ? ` to ${lenderName}` : ""} on ${refOf(caseRow)}: ${items.length} item${items.length === 1 ? "" : "s"} provided and sent`,
    actorName: actor.displayName,
  });
  return updated!;
}

/**
 * "Underwriting complete" needs every lender's latest round finished: for
 * each submission that has rounds (and the case-level bucket), the latest
 * round is sent or all its required items are ticked.
 */
export async function underwritingRoundsComplete(caseId: number) {
  const rounds = await db.select().from(underwritingRoundsTable).where(eq(underwritingRoundsTable.caseId, caseId));
  if (!rounds.length) return { hasRounds: false, complete: false, openLenders: [] as string[] };
  const latestBySubmission = new Map<number | null, typeof rounds[number]>();
  for (const row of rounds) {
    const current = latestBySubmission.get(row.submissionId);
    if (!current || row.round > current.round) latestBySubmission.set(row.submissionId, row);
  }
  const requirements = await db
    .select({ submissionId: requirementsTable.submissionId, round: requirementsTable.round, complete: requirementsTable.complete, required: requirementsTable.required })
    .from(requirementsTable)
    .where(and(eq(requirementsTable.caseId, caseId), eq(requirementsTable.stageIndex, UNDERWRITING_STAGE_INDEX)));
  const openLenders: string[] = [];
  for (const [submissionId, latest] of latestBySubmission) {
    if (latest.sentAt) continue;
    const items = requirements.filter((r) => r.submissionId === submissionId && r.round === latest.round);
    if (items.every((r) => !r.required || r.complete)) continue;
    openLenders.push((await lenderNameForSubmission(submissionId)) ?? "the lender");
  }
  return { hasRounds: true, complete: openLenders.length === 0, openLenders };
}

/** Rounds with their requirements, for the case page (every lender; the page filters by the one in view). */
export async function underwritingRoundsView(caseId: number) {
  const rounds = await db
    .select()
    .from(underwritingRoundsTable)
    .where(eq(underwritingRoundsTable.caseId, caseId))
    .orderBy(asc(underwritingRoundsTable.submissionId), asc(underwritingRoundsTable.round), asc(underwritingRoundsTable.createdAt));
  if (!rounds.length) return [];
  const requirements = await db
    .select({ id: requirementsTable.id, label: requirementsTable.label, complete: requirementsTable.complete, round: requirementsTable.round, submissionId: requirementsTable.submissionId })
    .from(requirementsTable)
    .where(and(eq(requirementsTable.caseId, caseId), eq(requirementsTable.stageIndex, UNDERWRITING_STAGE_INDEX)))
    .orderBy(asc(requirementsTable.id));
  const userIds = [...new Set(rounds.map((r) => r.sentByUserId).filter((id): id is number => id != null))];
  const names = new Map(userIds.length
    ? (await db.select({ id: appUsersTable.id, displayName: appUsersTable.displayName }).from(appUsersTable).where(inArray(appUsersTable.id, userIds))).map((u) => [u.id, u.displayName])
    : []);
  const submissionIds = [...new Set(rounds.map((r) => r.submissionId).filter((id): id is number => id != null))];
  const lenderNames = new Map(submissionIds.length
    ? (await db
        .select({ id: caseSubmissionsTable.id, name: lendersTable.name })
        .from(caseSubmissionsTable)
        .innerJoin(lendersTable, eq(lendersTable.id, caseSubmissionsTable.lenderId))
        .where(inArray(caseSubmissionsTable.id, submissionIds))).map((sub) => [sub.id, sub.name])
    : []);
  return rounds.map((row) => ({
    id: row.id,
    round: row.round,
    submissionId: row.submissionId ?? null,
    lenderName: row.submissionId != null ? lenderNames.get(row.submissionId) ?? null : null,
    emailText: row.emailText,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    sentBy: row.sentByUserId != null ? names.get(row.sentByUserId) ?? null : null,
    taskId: row.taskId ?? null,
    requirements: requirements
      .filter((item) => item.round === row.round && item.submissionId === row.submissionId)
      .map((item) => ({ id: item.id, label: item.label, complete: item.complete })),
  }));
}
