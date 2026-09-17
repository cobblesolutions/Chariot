import { and, eq, ne, sql } from "drizzle-orm";
import { casesTable, db, invoiceLineItemsTable, invoiceSequencesTable, invoicesTable } from "@workspace/db";
import { logActivity } from "./activities";

type CaseRow = typeof casesTable.$inferSelect;

const money = (value: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);

/**
 * The broker fee the client agreed under the Terms of Business, as an invoice
 * line: a percentage of the loan or a flat amount (`cases.broker_fee_basis`).
 * Null when no fee is set on the case.
 */
export function feeLineFor(caseRow: CaseRow, loanOverride?: number | null): { description: string; unitAmount: number; summary: string } | null {
  // Scope step 13: the percentage is taken from the offer's loan when the offer states one.
  const loan = loanOverride != null && loanOverride > 0 ? Number(loanOverride) : Number(caseRow.loanAmount);
  if (caseRow.brokerFeeBasis === "flat") {
    const amount = Number(caseRow.brokerFeeFlat ?? 0);
    if (amount <= 0) return null;
    return { description: "Broker fee (agreed flat fee)", unitAmount: amount, summary: `${money(amount)} flat fee` };
  }
  const pct = Number(caseRow.brokerFeePct ?? 0);
  const amount = Math.round((loan * pct) / 100 * 100) / 100;
  if (pct <= 0 || amount <= 0) return null;
  const source = loanOverride != null && loanOverride > 0 ? " (on the offer)" : "";
  return {
    description: `Broker fee — ${pct}% of the £${loan.toLocaleString("en-GB")} loan${source}`,
    unitAmount: amount,
    summary: `${pct}% of ${money(loan)}${source} = ${money(amount)}`,
  };
}

/** Allocate the next number and create a draft invoice with its lines. */
export async function createInvoice(input: {
  clientId: number;
  caseId: number | null;
  notes?: string;
  lineItems: Array<{ description: string; quantity: number; unitAmount: number }>;
  createdByUserId: number;
  actorName: string;
}) {
  const created = await db.transaction(async (tx) => {
    await tx.insert(invoiceSequencesTable).values({ id: 1, lastNumber: 0 }).onConflictDoNothing();
    const sequence = await tx.execute(sql`UPDATE invoice_sequences SET last_number = last_number + 1 WHERE id = 1 RETURNING last_number`);
    const number = Number(sequence.rows[0]?.last_number);
    if (!number) throw new Error("Unable to allocate invoice number");
    const [invoice] = await tx
      .insert(invoicesTable)
      .values({
        invoiceNumber: `CFS-${String(number).padStart(5, "0")}`,
        clientId: input.clientId,
        caseId: input.caseId,
        dueDate: new Date().toISOString().slice(0, 10),
        notes: input.notes ?? "",
        createdByUserId: input.createdByUserId,
      })
      .returning();
    if (!invoice) throw new Error("Invoice was not created");
    if (input.lineItems.length) {
      await tx.insert(invoiceLineItemsTable).values(input.lineItems.map((line, sortOrder) => ({ invoiceId: invoice.id, ...line, sortOrder })));
    }
    return invoice;
  });
  await logActivity({
    kind: "invoice",
    caseId: created.caseId,
    title: "Invoice created",
    detail: `${created.invoiceNumber} created as draft`,
    actorName: input.actorName,
    entityType: "invoice",
    entityId: created.id,
  });
  return created;
}

/** The case's live invoice (draft or issued, not void), if there is one. */
export async function openInvoiceForCase(caseId: number) {
  const [row] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.caseId, caseId), ne(invoicesTable.status, "void")))
    .orderBy(invoicesTable.createdAt);
  return row ?? null;
}

export async function invoiceTotal(invoiceId: number) {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${invoiceLineItemsTable.quantity} * ${invoiceLineItemsTable.unitAmount}), 0)` })
    .from(invoiceLineItemsTable)
    .where(eq(invoiceLineItemsTable.invoiceId, invoiceId));
  return Number(row?.total ?? 0);
}
