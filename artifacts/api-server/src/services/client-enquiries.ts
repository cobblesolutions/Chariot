import { and, desc, eq } from "drizzle-orm";
import { clientEnquiriesTable, db } from "@workspace/db";

/**
 * One row per enquiry a client has made. The `enquiry_*` columns on the
 * client stay the *latest* enquiry (what the Add page and CRM read); these
 * rows are the history, so a repeat enquiry no longer erases the last email.
 */
export interface EnquiryInput {
  source?: string | null;
  enquiryType?: string | null;
  summary?: string | null;
  timescale?: string | null;
  emailFrom?: string | null;
  emailSubject?: string | null;
  emailText?: string | null;
  extracted?: unknown;
  extractionModel?: string | null;
  receivedAt?: Date | null;
  createdByUserId?: number | null;
  /** A repeat enquiry from an already-accepted client needs no review. */
  status?: "open" | "accepted";
}

export type EnquiryStatus = "open" | "accepted" | "declined" | "lost";

export async function recordEnquiry(clientId: number, input: EnquiryInput) {
  const [row] = await db
    .insert(clientEnquiriesTable)
    .values({
      clientId,
      receivedAt: input.receivedAt ?? new Date(),
      source: input.source ?? null,
      enquiryType: input.enquiryType ?? null,
      summary: input.summary ?? null,
      timescale: input.timescale ?? null,
      emailFrom: input.emailFrom ?? null,
      emailSubject: input.emailSubject ?? null,
      emailText: input.emailText ?? null,
      extracted: input.extracted ?? null,
      extractionModel: input.extractionModel ?? null,
      status: input.status ?? "open",
      resolvedAt: input.status === "accepted" ? new Date() : null,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning();
  return row!;
}

/** Close every open enquiry of the client with the outcome of the review. */
export async function resolveOpenEnquiries(clientId: number, status: Exclude<EnquiryStatus, "open">, reason?: string | null) {
  await db
    .update(clientEnquiriesTable)
    .set({ status, resolvedAt: new Date(), outcomeReason: reason ?? null })
    .where(and(eq(clientEnquiriesTable.clientId, clientId), eq(clientEnquiriesTable.status, "open")));
}

/** Reopening a closed client puts their latest enquiry back under review. */
export async function reopenLatestEnquiry(clientId: number) {
  const [latest] = await db
    .select({ id: clientEnquiriesTable.id })
    .from(clientEnquiriesTable)
    .where(eq(clientEnquiriesTable.clientId, clientId))
    .orderBy(desc(clientEnquiriesTable.receivedAt))
    .limit(1);
  if (!latest) return;
  await db
    .update(clientEnquiriesTable)
    .set({ status: "open", resolvedAt: null, outcomeReason: null })
    .where(eq(clientEnquiriesTable.id, latest.id));
}

export async function listEnquiries(clientId: number) {
  return db
    .select()
    .from(clientEnquiriesTable)
    .where(eq(clientEnquiriesTable.clientId, clientId))
    .orderBy(desc(clientEnquiriesTable.receivedAt));
}
