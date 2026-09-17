import { and, eq, isNotNull } from "drizzle-orm";
import {
  appUsersTable,
  caseSubmissionsTable,
  casesTable,
  clientsTable,
  db,
  documentsTable,
  invoicesTable,
  lenderContactsTable,
  lendersTable,
  lenderOfferReviewsTable,
  requirementsTable,
} from "@workspace/db";
import { sendChariotEmail } from "../integrations/resend";
import { escapeHtml } from "./email-templates";
import { renderChariotEmail } from "../integrations/email-template";
import { logger } from "../lib/logger";
import { logActivity } from "./activities";
import { documentStorage } from "./document-storage";
import { createInvoice, feeLineFor, invoiceTotal, openInvoiceForCase } from "./invoices";
import { STAGES } from "./stages";
import { syncCaseChecklists } from "./task-checklists";
import { submissionScope } from "./underwriting";

/**
 * Scope step 12 — "the system sends emails on the spot": once the offer has
 * been checked against the case, one action issues the client's invoice from
 * the agreed fee, emails the client the offer (attached) with the invoice, and
 * lets the lender's contact know we have it. Reviews are per lender submission.
 */
type CaseRow = typeof casesTable.$inferSelect;
type ReviewRow = typeof lenderOfferReviewsTable.$inferSelect;
export const OFFER_STAGE_INDEX = STAGES.indexOf("Lender offer");
export const OFFER_SENT_LABEL = "Offer sent to client";
const refOf = (row: CaseRow) => row.displayReference || row.reference;
const money = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 }).format(value);

export class OfferNotReadyError extends Error {}

/** The lender an offer review is about: the submission's lender, else the case's. */
export async function lenderIdForReview(caseRow: CaseRow, submissionId: number | null) {
  if (submissionId == null) return caseRow.lenderId;
  const [row] = await db.select({ lenderId: caseSubmissionsTable.lenderId }).from(caseSubmissionsTable).where(eq(caseSubmissionsTable.id, submissionId));
  return row?.lenderId ?? caseRow.lenderId;
}

export async function lenderContactsFor(lenderId: number | null) {
  if (lenderId == null) return [];
  return db
    .select({ name: lenderContactsTable.name, email: lenderContactsTable.email })
    .from(lenderContactsTable)
    .where(and(eq(lenderContactsTable.lenderId, lenderId), isNotNull(lenderContactsTable.email)));
}

export async function reviewFor(caseId: number, submissionId: number | null) {
  const [row] = await db
    .select()
    .from(lenderOfferReviewsTable)
    .where(and(eq(lenderOfferReviewsTable.caseId, caseId), submissionScope(lenderOfferReviewsTable, submissionId)));
  return row ?? null;
}

/** The extra fields the offer panel shows: who gets what, and whether it has gone. */
export async function offerNotificationView(caseRow: CaseRow, review: ReviewRow | null, submissionId: number | null) {
  const lenderId = await lenderIdForReview(caseRow, submissionId);
  const contacts = (await lenderContactsFor(lenderId)).map((c) => ({ name: c.name, email: c.email! }));
  const fee = feeLineFor(caseRow, review?.offerLoanAmount ?? null);
  const invoiceRow = review?.invoiceId != null
    ? (await db.select().from(invoicesTable).where(eq(invoicesTable.id, review.invoiceId)))[0] ?? null
    : await openInvoiceForCase(caseRow.id);
  let notifiedBy: string | null = null;
  if (review?.notifiedByUserId != null) {
    const [user] = await db.select({ displayName: appUsersTable.displayName }).from(appUsersTable).where(eq(appUsersTable.id, review.notifiedByUserId));
    notifiedBy = user?.displayName ?? null;
  }
  return {
    submissionId,
    offerLoanAmount: review?.offerLoanAmount ?? null,
    expectedLoanAmount: caseRow.loanAmount,
    notifiedAt: review?.notifiedAt?.toISOString() ?? null,
    notifiedBy,
    clientEmailStatus: review?.clientEmailStatus ?? null,
    lenderEmailStatus: review?.lenderEmailStatus ?? null,
    lenderContacts: contacts,
    feeSummary: fee?.summary ?? null,
    invoice: invoiceRow
      ? { id: invoiceRow.id, invoiceNumber: invoiceRow.invoiceNumber, status: invoiceRow.status, total: await invoiceTotal(invoiceRow.id) }
      : null,
  };
}

/**
 * Issue the invoice (drafting it from the fee basis if the case has none),
 * email the client the offer + invoice, email the lender contacts, and
 * record it all on the review. Idempotent per review: a second call resends.
 */
export async function notifyLenderOffer(caseRow: CaseRow, actor: { id: number; displayName: string }, submissionId: number | null) {
  const review = await reviewFor(caseRow.id, submissionId);
  if (!review) throw new OfferNotReadyError("Upload and check the lender's offer first");
  if (!(review.addressMatches && review.nameMatches && review.valueMatches)) {
    throw new OfferNotReadyError("The offer details do not all match the case — resolve that before sending");
  }
  const [document] = await db.select().from(documentsTable).where(eq(documentsTable.id, review.documentId));
  if (!document?.objectPath) throw new OfferNotReadyError("The offer document is missing");
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, caseRow.clientId));
  if (!client) throw new OfferNotReadyError("Client not found");
  const lenderId = await lenderIdForReview(caseRow, submissionId);

  // 1. The invoice from the agreed fee (a percentage of the offer's loan when the offer states one).
  let invoice = await openInvoiceForCase(caseRow.id);
  if (!invoice) {
    const fee = feeLineFor(caseRow, review.offerLoanAmount ?? null);
    if (!fee) throw new OfferNotReadyError("No fee is agreed on the case — set \"Our fee\" on the deal before sending the offer");
    invoice = await createInvoice({
      clientId: client.id,
      caseId: caseRow.id,
      notes: `Broker fee for ${refOf(caseRow)} as agreed in the Terms of Business.`,
      lineItems: [{ description: fee.description, quantity: 1, unitAmount: fee.unitAmount }],
      createdByUserId: actor.id,
      actorName: actor.displayName,
    });
  }
  if (invoice.status === "draft") {
    const [issued] = await db
      .update(invoicesTable)
      .set({ status: "issued", issuedAt: new Date(), dueDate: new Date().toISOString().slice(0, 10) })
      .where(eq(invoicesTable.id, invoice.id))
      .returning();
    invoice = issued ?? invoice;
    await logActivity({ kind: "invoice", caseId: caseRow.id, title: "Invoice issued", detail: `${invoice.invoiceNumber} issued with the lender offer`, actorName: actor.displayName, entityType: "invoice", entityId: invoice.id });
  }
  const total = await invoiceTotal(invoice.id);

  // 2. The client: offer attached, invoice summarised.
  const firstName = client.name.trim().split(/\s+/)[0] || client.name;
  const portalUrl = process.env.PORTAL_URL?.replace(/\/$/, "");
  const [lender] = lenderId != null ? await db.select({ name: lendersTable.name }).from(lendersTable).where(eq(lendersTable.id, lenderId)) : [];
  let clientStatus = "failed";
  try {
    const bytes = await documentStorage.get(document.objectPath);
    const result = await sendChariotEmail({
      purpose: "lender_offer",
      to: [client.email],
      subject: `Your mortgage offer has arrived — ${refOf(caseRow)}`,
      html: renderChariotEmail({
        preheader: `${lender?.name ?? "The lender"} has issued your mortgage offer.`,
        heading: "Your mortgage offer has arrived",
        paragraphs: [
          `Dear ${escapeHtml(firstName)},`,
          `Good news — ${escapeHtml(lender?.name ?? "the lender")} has issued the mortgage offer for <strong>${escapeHtml(caseRow.propertyAddress)}</strong>. The offer document is attached; please read it carefully and let your case handler know if anything is unclear.`,
          `As agreed in our Terms of Business, our invoice <strong>${invoice.invoiceNumber}</strong> for <strong>${money(total)}</strong> is now due. Payment is arranged directly with your case handler.`,
        ],
        cta: portalUrl ? { label: "Open your portal", url: `${portalUrl}/portal` } : undefined,
      }),
      attachments: [{ filename: document.name, content: bytes.toString("base64") }],
    });
    clientStatus = result.status;
  } catch (error) {
    logger.warn({ err: error, caseId: caseRow.id }, "Offer email to the client failed");
  }

  // 3. The lender's contacts: we have it, we're proceeding.
  const contacts = await lenderContactsFor(lenderId);
  let lenderStatus = "no_contact";
  if (contacts.length) {
    try {
      const result = await sendChariotEmail({
        purpose: "lender_offer",
        to: contacts.map((c) => c.email!),
        subject: `Offer received — ${escapeHtml(client.name)}, ${caseRow.propertyAddress}${caseRow.lenderCaseNumber ? ` (your ref ${caseRow.lenderCaseNumber})` : ""}`,
        html: renderChariotEmail({
          heading: "Thank you — offer received",
          paragraphs: [
            `Dear ${escapeHtml(contacts.length === 1 ? contacts[0]!.name : "team")},`,
            `We confirm receipt of the mortgage offer for <strong>${escapeHtml(client.name)}</strong> at <strong>${escapeHtml(caseRow.propertyAddress)}</strong>${caseRow.lenderCaseNumber ? ` (your reference ${escapeHtml(caseRow.lenderCaseNumber)})` : ""}. The details have been checked against the application and passed to the client.`,
            `We are now proceeding to completion and will send the solicitor's details and any conditions as they are satisfied. Please send anything further to this address quoting our reference ${escapeHtml(refOf(caseRow))}.`,
          ],
        }),
      });
      lenderStatus = result.status;
    } catch (error) {
      logger.warn({ err: error, caseId: caseRow.id }, "Offer email to the lender failed");
    }
  }

  // 4. Record it, tick the stage requirement, log it.
  const [updated] = await db
    .update(lenderOfferReviewsTable)
    .set({ notifiedAt: new Date(), notifiedByUserId: actor.id, clientEmailStatus: clientStatus, lenderEmailStatus: lenderStatus, invoiceId: invoice.id, updatedAt: new Date() })
    .where(eq(lenderOfferReviewsTable.id, review.id))
    .returning();
  await db
    .update(requirementsTable)
    .set({ complete: true, completedAt: new Date(), completedBy: actor.displayName })
    .where(and(eq(requirementsTable.caseId, caseRow.id), eq(requirementsTable.stageIndex, OFFER_STAGE_INDEX), eq(requirementsTable.label, OFFER_SENT_LABEL)));
  await logActivity({
    kind: "lender_offer",
    caseId: caseRow.id,
    title: "Lender offer sent to client",
    detail: `${refOf(caseRow)}: offer emailed to ${client.name} with invoice ${invoice.invoiceNumber} (${money(total)})${contacts.length ? `; ${lender?.name ?? "lender"} notified (${contacts.length} contact${contacts.length === 1 ? "" : "s"})` : "; no lender contact on file"}${clientStatus !== "sent" ? ` — client email ${clientStatus}` : ""}`,
    actorName: actor.displayName,
  });
  await syncCaseChecklists(caseRow.id);
  return updated!;
}
