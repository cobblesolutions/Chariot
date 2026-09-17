import { Router, type IRouter, type RequestHandler } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { requireStaff } from "../auth/session";
import { isFullAccess } from "../auth/roles";
import * as api from "@workspace/api-zod";
import { activitiesTable, calendarEventsTable, casesTable, clientsTable, db, invoiceLineItemsTable, invoicePaymentsTable, invoiceSequencesTable, invoicesTable, renewalsTable } from "@workspace/db";
import { sendChariotEmail } from "../integrations/resend";
import { renderChariotEmail } from "../integrations/email-template";
import { renewalReminderDates, syncRenewalCalendarEvents } from "../services/renewal-calendar";
import { createInvoice } from "../services/invoices";

const router: IRouter = Router();
router.use(requireStaff);
const requireAdminBilling: RequestHandler = (_req, res, next) => {
  if (!isFullAccess(res.locals.authUser.role)) {
    res.status(403).json({ error: "Administrator access required for billing changes" });
    return;
  }
  next();
};
const day = (value: Date) => value.toISOString().slice(0, 10);
const shiftUtcMonthsClamped = (dateValue: string, months: number) => {
  const [year, month, date] = dateValue.split("-").map(Number);
  const targetMonthStart = new Date(Date.UTC(year!, month! - 1 + months, 1));
  const targetMonthEnd = new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth(), Math.min(date!, targetMonthEnd)));
};
const reminderDate = (type: string, rateEnd: string | null, completion: string | null) => {
  return renewalReminderDates(type, rateEnd, completion)[0] ?? null;
};
async function validateCaseClient(clientId: number, caseId: number | null | undefined) {
  if (!caseId) return true;
  const [caseRow] = await db.select({ clientId: casesTable.clientId }).from(casesTable).where(eq(casesTable.id, caseId));
  return caseRow?.clientId === clientId;
}
async function invoiceView(invoice: typeof invoicesTable.$inferSelect) {
  const [lines, payments] = await Promise.all([db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoice.id)).orderBy(asc(invoiceLineItemsTable.sortOrder)), db.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, invoice.id)).orderBy(asc(invoicePaymentsTable.receivedAt))]);
  const total = lines.reduce((sum, item) => sum + item.quantity * item.unitAmount, 0);
  const paid = payments.reduce((sum, item) => sum + item.amount, 0);
  const outstanding = Math.max(0, total - paid);
  const status = invoice.status === "issued" && outstanding === 0 ? "paid" : invoice.status;
  const overdueReminderDue = status === "issued" && outstanding > 0 && !invoice.reminderSentAt && Date.now() >= new Date(`${invoice.dueDate}T00:00:00Z`).getTime() + 7 * 86400000;
  return { id: invoice.id, invoiceNumber: invoice.invoiceNumber, clientId: invoice.clientId, caseId: invoice.caseId, status, dueDate: invoice.dueDate, total, paid, outstanding, overdueReminderDue, notes: invoice.notes, lineItems: lines.map(x => ({ description: x.description, quantity: x.quantity, unitAmount: x.unitAmount })), payments: payments.map(x => ({ id: x.id, amount: x.amount, receivedAt: x.receivedAt.toISOString(), reference: x.reference, notes: x.notes })) };
}
function renewalView(row: typeof renewalsTable.$inferSelect) { return { ...row, rateEndDate: row.rateEndDate, completionDate: row.completionDate, dueDate: row.dueDate, nextReminderDate: row.nextReminderDate }; }

router.get("/invoices", async (_req, res) => { const rows = await db.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt)); res.json(api.ListInvoicesResponse.parse(await Promise.all(rows.map(invoiceView)))); });
router.post("/invoices", requireAdminBilling, async (req, res): Promise<void> => {
  const body = api.CreateInvoiceBody.safeParse(req.body); if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  if (!(await validateCaseClient(body.data.clientId, body.data.caseId))) { res.status(409).json({ error: "Selected case does not belong to the selected client" }); return; }
  const created = await createInvoice({
    clientId: body.data.clientId,
    caseId: body.data.caseId ?? null,
    notes: body.data.notes,
    lineItems: body.data.lineItems,
    createdByUserId: res.locals.authUser.id,
    actorName: res.locals.authUser.displayName,
  });
  res.status(201).json(api.CreateInvoiceResponse.parse(await invoiceView(created)));
});
router.get("/invoices/:id", async (req, res): Promise<void> => { const p = api.GetInvoiceParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: "Invalid invoice id" }); return; } const [row] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, p.data.id)); if (!row) { res.status(404).json({ error: "Invoice not found" }); return; } res.json(api.GetInvoiceResponse.parse(await invoiceView(row))); });
router.patch("/invoices/:id", requireAdminBilling, async (req, res): Promise<void> => { const p = api.UpdateInvoiceParams.safeParse(req.params), b = api.UpdateInvoiceBody.safeParse(req.body); if (!p.success || !b.success) { res.status(400).json({ error: "Invalid invoice" }); return; } if (!(await validateCaseClient(b.data.clientId, b.data.caseId))) { res.status(409).json({ error: "Selected case does not belong to the selected client" }); return; } const [old] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, p.data.id)); if (!old) { res.status(404).json({ error: "Invoice not found" }); return; } if (old.status !== "draft") { res.status(409).json({ error: "Only draft invoices can be edited" }); return; } const [row] = await db.transaction(async tx => { const [updated] = await tx.update(invoicesTable).set({ clientId: b.data.clientId, caseId: b.data.caseId ?? null, notes: b.data.notes ?? "" }).where(eq(invoicesTable.id, old.id)).returning(); await tx.delete(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, old.id)); if (b.data.lineItems.length) await tx.insert(invoiceLineItemsTable).values(b.data.lineItems.map((line, sortOrder) => ({ invoiceId: old.id, ...line, sortOrder }))); return [updated!]; }); res.json(api.UpdateInvoiceResponse.parse(await invoiceView(row))); });
router.post("/invoices/:id/issue", requireAdminBilling, async (req, res): Promise<void> => {
  const p = api.IssueInvoiceParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid invoice id" }); return; }
  const [row] = await db.update(invoicesTable).set({ status: "issued", issuedAt: new Date(), dueDate: day(new Date()) }).where(and(eq(invoicesTable.id, p.data.id), eq(invoicesTable.status, "draft"))).returning();
  if (!row) { res.status(409).json({ error: "Invoice must exist and be draft" }); return; }
  await db.insert(activitiesTable).values({ caseId: row.caseId, title: "Invoice issued", detail: row.invoiceNumber, actorName: res.locals.authUser.displayName, entityType: "invoice", entityId: row.id });
  const view = await invoiceView(row);
  const [client] = await db.select({ name: clientsTable.name, email: clientsTable.email }).from(clientsTable).where(eq(clientsTable.id, row.clientId));
  if (client) {
    sendChariotEmail({
      purpose: "invoice",
      to: [client.email],
      subject: `Invoice ${row.invoiceNumber} from Chariot Financial Solutions`,
      html: renderChariotEmail({
        preheader: `Invoice ${row.invoiceNumber} for £${view.total.toFixed(2)} is now due.`,
        heading: "A new invoice has been issued",
        paragraphs: [
          `Dear ${client.name},`,
          `Please find below the details of an invoice issued to your account:`,
        ],
        rawBody: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px 0;border:1px solid #EDEFEC;border-radius:6px;overflow:hidden;">
          <tr>
            <td style="padding:12px 16px;background-color:#F7F8F6;font-size:13px;color:#6B7570;border-bottom:1px solid #EDEFEC;">Invoice number</td>
            <td style="padding:12px 16px;background-color:#F7F8F6;font-size:13px;color:#2B2E2C;font-weight:600;text-align:right;border-bottom:1px solid #EDEFEC;">${row.invoiceNumber}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-size:13px;color:#6B7570;border-bottom:1px solid #EDEFEC;">Amount due</td>
            <td style="padding:12px 16px;font-size:13px;color:#2B2E2C;font-weight:600;text-align:right;border-bottom:1px solid #EDEFEC;">£${view.total.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-size:13px;color:#6B7570;">Due date</td>
            <td style="padding:12px 16px;font-size:13px;color:#2B2E2C;font-weight:600;text-align:right;">${row.dueDate}</td>
          </tr>
        </table>${row.notes ? `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#2B2E2C;">${row.notes}</p>` : ""}<p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#2B2E2C;">You may view this invoice at any time from your client portal. Please note that payments are arranged directly with your case handler and are not processed through the portal — kindly contact them to arrange settlement by the due date.</p>`,
      }),
    }).catch((error) => req.log.warn({ err: error, invoiceId: row.id }, "Invoice email was not delivered"));
  }
  res.json(api.IssueInvoiceResponse.parse(view));
});
router.post("/invoices/:id/void", requireAdminBilling, async (req, res): Promise<void> => { const p = api.VoidInvoiceParams.safeParse(req.params), b = api.VoidInvoiceBody.safeParse(req.body); if (!p.success || !b.success) { res.status(400).json({ error: "Invalid void request" }); return; } const [row] = await db.update(invoicesTable).set({ status: "void", voidedAt: new Date(), voidReason: b.data.reason }).where(and(eq(invoicesTable.id, p.data.id), sql`${invoicesTable.status} <> 'void'`)).returning(); if (!row) { res.status(404).json({ error: "Invoice not found or already voided" }); return; } res.json(api.VoidInvoiceResponse.parse(await invoiceView(row))); });
router.get("/invoices/:id/payments", async (req, res) => { const p = api.ListInvoicePaymentsParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: "Invalid invoice id" }); return; } const rows = await db.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, p.data.id)); res.json(api.ListInvoicePaymentsResponse.parse(rows.map(x => ({ id: x.id, amount: x.amount, receivedAt: x.receivedAt, reference: x.reference, notes: x.notes })))); });
router.post("/invoices/:id/payments", requireAdminBilling, async (req, res): Promise<void> => {
  const p = api.RecordInvoicePaymentParams.safeParse(req.params);
  const b = api.RecordInvoicePaymentBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: "Invalid payment" });
    return;
  }
  try {
    const payment = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM invoices WHERE id = ${p.data.id} FOR UPDATE`);
      const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, p.data.id));
      if (!invoice || invoice.status !== "issued") {
        throw new Error("Payments can only be recorded against issued invoices");
      }
      const [lines, payments] = await Promise.all([
        tx.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoice.id)),
        tx.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, invoice.id)),
      ]);
      const totalPence = Math.round(lines.reduce((sum, item) => sum + item.quantity * item.unitAmount, 0) * 100);
      const paidPence = Math.round(payments.reduce((sum, item) => sum + item.amount, 0) * 100);
      const amountPence = Math.round(b.data.amount * 100);
      if (amountPence > totalPence - paidPence) {
        throw new Error("Payment exceeds the invoice outstanding balance");
      }
      const [created] = await tx.insert(invoicePaymentsTable).values({
        invoiceId: invoice.id,
        ...b.data,
        receivedAt: b.data.receivedAt,
        recordedByUserId: res.locals.authUser.id,
        reference: b.data.reference ?? "",
        notes: b.data.notes ?? "",
      }).returning();
      return created!;
    });
    res.status(201).json(api.RecordInvoicePaymentResponse.parse({
      id: payment.id,
      amount: payment.amount,
      receivedAt: payment.receivedAt,
      reference: payment.reference,
      notes: payment.notes,
    }));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Payment could not be recorded" });
  }
});
router.delete("/invoices/:id/payments/:paymentId", requireAdminBilling, async (req, res): Promise<void> => { const p = api.DeleteInvoicePaymentParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: "Invalid payment id" }); return; } await db.delete(invoicePaymentsTable).where(and(eq(invoicePaymentsTable.id, p.data.paymentId), eq(invoicePaymentsTable.invoiceId, p.data.id))); res.status(204).end(); });

router.get("/renewals", async (_req, res) => res.json(api.ListRenewalsResponse.parse((await db.select().from(renewalsTable).orderBy(asc(renewalsTable.dueDate))).map(renewalView))));
async function saveRenewal(req: any, res: any, id?: number) {
  const body = (id ? api.UpdateRenewalBody : api.CreateRenewalBody).safeParse(req.body); if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const d = body.data; const rate = d.rateEndDate ? day(d.rateEndDate) : null, completion = d.completionDate ? day(d.completionDate) : null;
  if (d.type === "bridging" ? !completion : !rate) { res.status(400).json({ error: d.type === "bridging" ? "Completion date is required for bridging follow-up" : "Rate end date is required for mortgage renewal" }); return; }
  if (!(await validateCaseClient(d.clientId, d.caseId))) { res.status(409).json({ error: "Selected case does not belong to the selected client" }); return; }
  const due = d.dueDate ? day(d.dueDate) : (rate ?? completion!); const values = { clientId: d.clientId, caseId: d.caseId ?? null, type: d.type, status: d.status ?? "upcoming", rateEndDate: rate, completionDate: completion, dueDate: due, nextReminderDate: reminderDate(d.type, rate, completion), notes: d.notes ?? "" };
  const [row] = id ? await db.update(renewalsTable).set(values).where(eq(renewalsTable.id, id)).returning() : await db.insert(renewalsTable).values(values).returning(); if (!row) { res.status(404).json({ error: "Renewal not found" }); return; } await db.insert(activitiesTable).values({ caseId: row.caseId, title: id ? "Renewal updated" : "Renewal created", detail: `${row.type} renewal`, actorName: res.locals.authUser.displayName, entityType: "renewal", entityId: row.id }); await syncRenewalCalendarEvents(row); res.status(id ? 200 : 201).json((id ? api.UpdateRenewalResponse : api.CreateRenewalResponse).parse(renewalView(row)));
}
router.post("/renewals", (req, res) => saveRenewal(req, res));
router.get("/renewals/:id", async (req, res): Promise<void> => { const p = api.GetRenewalParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: "Invalid renewal id" }); return; } const [row] = await db.select().from(renewalsTable).where(eq(renewalsTable.id, p.data.id)); if (!row) { res.status(404).json({ error: "Renewal not found" }); return; } res.json(api.GetRenewalResponse.parse(renewalView(row))); });
router.patch("/renewals/:id", async (req, res) => { const p = api.UpdateRenewalParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: "Invalid renewal id" }); return; } await saveRenewal(req, res, p.data.id); });
router.delete("/renewals/:id", async (req, res) => { const p = api.DeleteRenewalParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: "Invalid renewal id" }); return; } await db.delete(calendarEventsTable).where(eq(calendarEventsTable.renewalId, p.data.id)); await db.delete(renewalsTable).where(eq(renewalsTable.id, p.data.id)); res.status(204).end(); });
router.post("/renewals/:id/status", async (req, res): Promise<void> => { const p = api.UpdateRenewalStatusParams.safeParse(req.params), b = api.UpdateRenewalStatusBody.safeParse(req.body); if (!p.success || !b.success) { res.status(400).json({ error: "Invalid renewal status" }); return; } const [row] = await db.update(renewalsTable).set({ status: b.data.status, nextReminderDate: b.data.status === "completed" ? null : undefined }).where(eq(renewalsTable.id, p.data.id)).returning(); if (!row) { res.status(404).json({ error: "Renewal not found" }); return; } await syncRenewalCalendarEvents(row); res.json(api.UpdateRenewalStatusResponse.parse(renewalView(row))); });
export default router;