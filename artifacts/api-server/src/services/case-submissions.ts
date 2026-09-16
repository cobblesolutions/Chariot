import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  caseSubmissionsTable,
  casesTable,
  db,
  documentsTable,
  lendersTable,
} from "@workspace/db";

/**
 * Multi-lender submissions. A case may be submitted to several lenders at
 * once; each `case_submissions` row tracks its own DIP, case number, fee,
 * valuation and decision, and can be withdrawn or declined independently.
 *
 * The case row keeps single-lender columns (lenderId, lenderCaseNumber,
 * valuationDate, …) which the rest of the pipeline reads. They are a mirror
 * of the *primary* submission, refreshed by `syncCaseFromSubmissions` after
 * every change, so the stage gate, stress test, offer review and task
 * checklists all keep working unchanged.
 */

export type SubmissionRow = typeof caseSubmissionsTable.$inferSelect;
export const SUBMISSION_STATUSES = ["active", "withdrawn", "declined", "offered"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
const OPEN_STATUSES: SubmissionStatus[] = ["active", "offered"];

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

export async function listSubmissions(caseId: number): Promise<SubmissionRow[]> {
  return db
    .select()
    .from(caseSubmissionsTable)
    .where(eq(caseSubmissionsTable.caseId, caseId))
    .orderBy(desc(caseSubmissionsTable.isPrimary), asc(caseSubmissionsTable.createdAt), asc(caseSubmissionsTable.id));
}

/** API shape for a list of submissions (primary first), with lender names and per-submission DIPs. */
export async function submissionViews(rows: SubmissionRow[]) {
  if (rows.length === 0) return [];
  const lenderIds = [...new Set(rows.map((row) => row.lenderId))];
  const [lenders, dips] = await Promise.all([
    db.select({ id: lendersTable.id, name: lendersTable.name }).from(lendersTable).where(inArray(lendersTable.id, lenderIds)),
    db
      .select({ id: documentsTable.id, name: documentsTable.name, submissionId: documentsTable.submissionId })
      .from(documentsTable)
      .where(and(inArray(documentsTable.submissionId, rows.map((row) => row.id)), eq(documentsTable.category, "DIP")))
      .orderBy(desc(documentsTable.uploadedAt), desc(documentsTable.id)),
  ]);
  const lenderName = new Map(lenders.map((lender) => [lender.id, lender.name]));
  const dipFor = new Map<number, { id: number; name: string }>();
  for (const dip of dips) if (dip.submissionId != null && !dipFor.has(dip.submissionId)) dipFor.set(dip.submissionId, { id: dip.id, name: dip.name });
  return rows.map((row) => ({
    id: row.id,
    caseId: row.caseId,
    lenderId: row.lenderId,
    lenderName: lenderName.get(row.lenderId) ?? "Unknown lender",
    status: row.status as SubmissionStatus,
    isPrimary: row.isPrimary,
    lenderCaseNumber: row.lenderCaseNumber ?? null,
    dipDocument: dipFor.get(row.id) ?? null,
    applicationFeeConfirmed: row.applicationFeeConfirmed,
    valuationDate: iso(row.valuationDate),
    valuationCompletedAt: iso(row.valuationCompletedAt),
    bankDecisionRequested: row.bankDecisionRequested,
    notes: row.notes,
    closedAt: iso(row.closedAt),
    closeReason: row.closeReason ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function submissionView(row: SubmissionRow) {
  const [view] = await submissionViews([row]);
  return view!;
}

/**
 * Pick the submission the case should follow: the flagged primary if it is
 * still open, else the earliest open one. Returns null when nothing is open.
 */
function choosePrimary(rows: SubmissionRow[]): SubmissionRow | null {
  const open = rows.filter((row) => OPEN_STATUSES.includes(row.status as SubmissionStatus));
  return open.find((row) => row.isPrimary) ?? open[0] ?? null;
}

/**
 * Make exactly one open submission primary and copy its tracking onto the
 * case row. When every submission is closed the case keeps its last mirrored
 * values but its lender is cleared, so the stage gate asks for a lender again.
 */
export async function syncCaseFromSubmissions(caseId: number) {
  const rows = await listSubmissions(caseId);
  const primary = choosePrimary(rows);
  const wrongFlags = rows.filter((row) => row.isPrimary !== (primary?.id === row.id));
  for (const row of wrongFlags) {
    await db.update(caseSubmissionsTable).set({ isPrimary: primary?.id === row.id }).where(eq(caseSubmissionsTable.id, row.id));
  }
  if (primary) {
    await db
      .update(casesTable)
      .set({
        lenderId: primary.lenderId,
        lenderCaseNumber: primary.lenderCaseNumber,
        displayReference: primary.lenderCaseNumber || null,
        applicationFeeConfirmed: primary.applicationFeeConfirmed,
        applicationFeeConfirmedAt: primary.applicationFeeConfirmedAt,
        valuationDate: primary.valuationDate,
        valuationCompletedAt: primary.valuationCompletedAt,
        bankDecisionRequested: primary.bankDecisionRequested,
        bankDecisionRequestedAt: primary.bankDecisionRequestedAt,
      })
      .where(eq(casesTable.id, caseId));
  } else if (rows.length > 0) {
    await db.update(casesTable).set({ lenderId: null }).where(eq(casesTable.id, caseId));
  }
  return primary;
}

/**
 * Create (or reopen) a submission for a lender. The first open submission on
 * a case becomes primary. Returns null when an open submission already exists.
 */
export async function addSubmission(caseId: number, lenderId: number): Promise<SubmissionRow | null> {
  const [existing] = await db
    .select()
    .from(caseSubmissionsTable)
    .where(and(eq(caseSubmissionsTable.caseId, caseId), eq(caseSubmissionsTable.lenderId, lenderId)));
  if (existing) {
    if (OPEN_STATUSES.includes(existing.status as SubmissionStatus)) return null;
    const [reopened] = await db
      .update(caseSubmissionsTable)
      .set({ status: "active", closedAt: null, closeReason: null })
      .where(eq(caseSubmissionsTable.id, existing.id))
      .returning();
    await syncCaseFromSubmissions(caseId);
    return reopened!;
  }
  const [created] = await db.insert(caseSubmissionsTable).values({ caseId, lenderId }).returning();
  await syncCaseFromSubmissions(caseId);
  return created!;
}

/**
 * Legacy single-lender writes (POST /cases lenderId, PATCH /cases lenderId,
 * the case page's lender select) land here so a submission row always exists
 * for the case's lender and the two views never disagree.
 */
export async function ensureSubmissionForCaseLender(caseId: number, lenderId: number | null | undefined) {
  if (!lenderId) return;
  const [existing] = await db
    .select({ id: caseSubmissionsTable.id, status: caseSubmissionsTable.status })
    .from(caseSubmissionsTable)
    .where(and(eq(caseSubmissionsTable.caseId, caseId), eq(caseSubmissionsTable.lenderId, lenderId)));
  if (!existing) {
    await db.insert(caseSubmissionsTable).values({ caseId, lenderId, isPrimary: true });
  } else if (!OPEN_STATUSES.includes(existing.status as SubmissionStatus)) {
    await db.update(caseSubmissionsTable).set({ status: "active", closedAt: null, closeReason: null }).where(eq(caseSubmissionsTable.id, existing.id));
  }
  // Legacy writes name the lender the case follows: make it primary.
  await db.update(caseSubmissionsTable).set({ isPrimary: false }).where(eq(caseSubmissionsTable.caseId, caseId));
  await db
    .update(caseSubmissionsTable)
    .set({ isPrimary: true })
    .where(and(eq(caseSubmissionsTable.caseId, caseId), eq(caseSubmissionsTable.lenderId, lenderId)));
}

/**
 * Mirror the case's single-lender tracking columns onto its primary
 * submission after a legacy PATCH /cases write, so the per-lender tab shows
 * what the case page saved.
 */
export async function mirrorCaseIntoPrimarySubmission(caseRow: typeof casesTable.$inferSelect) {
  if (!caseRow.lenderId) return;
  await db
    .update(caseSubmissionsTable)
    .set({
      lenderCaseNumber: caseRow.lenderCaseNumber,
      applicationFeeConfirmed: caseRow.applicationFeeConfirmed,
      applicationFeeConfirmedAt: caseRow.applicationFeeConfirmedAt,
      valuationDate: caseRow.valuationDate,
      valuationCompletedAt: caseRow.valuationCompletedAt,
      bankDecisionRequested: caseRow.bankDecisionRequested,
      bankDecisionRequestedAt: caseRow.bankDecisionRequestedAt,
    })
    .where(and(eq(caseSubmissionsTable.caseId, caseRow.id), eq(caseSubmissionsTable.lenderId, caseRow.lenderId)));
}

/** True when nothing has been recorded against the submission yet. */
export function submissionIsBlank(row: SubmissionRow, hasDip: boolean) {
  return (
    !hasDip &&
    !row.lenderCaseNumber &&
    !row.applicationFeeConfirmed &&
    !row.valuationDate &&
    !row.bankDecisionRequested &&
    !row.notes.trim()
  );
}
