import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import {
  alertsTable,
  appUsersTable,
  caseStageThresholdsTable,
  caseSubmissionsTable,
  casesTable,
  caseTermsAgreementsTable,
  clientApprovalsTable,
  clientsTable,
  db,
  documentsTable,
  invoiceLineItemsTable,
  invoicePaymentsTable,
  invoicesTable,
  renewalsTable,
  requirementsTable,
  tasksTable,
} from "@workspace/db";
import { sendChariotEmail } from "../integrations/resend";
import { renderChariotEmail } from "../integrations/email-template";
import { logger } from "../lib/logger";
import { stageName } from "./stages";
import { ENQUIRY_STALE_DAYS } from "./clients";
import { listSubmissions, submissionViews } from "./case-submissions";
import { DELIVERY_FAILED, SIGNATURE_WAIT_DAYS, TERMS_SIGNED_LABEL } from "./terms-agreements";

/**
 * Alerts: things that need a person's attention, found by rules the scheduler
 * runs every few minutes. Each rule produces candidates keyed by `dedupeKey`;
 * a candidate that is not yet open is raised (once), an open alert whose
 * condition has gone away is resolved. Red alerts email their assignee the
 * first time they are raised; amber ones just wait on the Alerts page.
 */
export type AlertSeverity = "red" | "amber";

export const ALERT_KINDS = {
  stage_overdue: { label: "Stage overdue", severity: "red" },
  task_overdue: { label: "Task overdue", severity: "red" },
  enquiry_stale: { label: "Enquiry waiting", severity: "red" },
  approval_unanswered: { label: "No answer from client", severity: "red" },
  valuation_passed: { label: "Valuation date passed", severity: "red" },
  invoice_overdue: { label: "Invoice overdue", severity: "red" },
  submission_step_overdue: { label: "Submission step overdue", severity: "red" },
  renewal_due: { label: "Renewal coming up", severity: "amber" },
  onboarding_stalled: { label: "Onboarding stalled", severity: "amber" },
  unassigned_case: { label: "No case handler", severity: "amber" },
  terms_not_accepted: { label: "Terms not signed", severity: "amber" },
  terms_declined: { label: "Terms declined", severity: "red" },
  terms_bounced: { label: "Terms email bounced", severity: "red" },
  terms_waiting: { label: "Terms awaiting signature", severity: "amber" },
} as const satisfies Record<string, { label: string; severity: AlertSeverity }>;

export type AlertKind = keyof typeof ALERT_KINDS;

interface Candidate {
  kind: AlertKind;
  dedupeKey: string;
  title: string;
  detail: string;
  caseId?: number | null;
  clientId?: number | null;
  taskId?: number | null;
  renewalId?: number | null;
  invoiceId?: number | null;
  assignedUserId?: number | null;
}

const APPROVAL_WAIT_DAYS = 5;
const ONBOARDING_STALL_DAYS = 7;
const RENEWAL_WINDOW_DAYS = 180;
const DAY = 86_400_000;
const daysAgo = (value: Date | string) => Math.floor((Date.now() - new Date(value).getTime()) / DAY);
const todayIso = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);

/** Rules, each reading the live records. Kept small on purpose. */
export async function findAlertCandidates(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const openCases = await db
    .select({
      id: casesTable.id, reference: casesTable.reference, displayReference: casesTable.displayReference, clientId: casesTable.clientId,
      stageIndex: casesTable.stageIndex, stageStartedAt: casesTable.stageStartedAt, status: casesTable.status, assignedUserId: casesTable.assignedUserId,
      clientName: clientsTable.name,
    })
    .from(casesTable)
    .innerJoin(clientsTable, eq(clientsTable.id, casesTable.clientId))
    .where(and(isNull(casesTable.archivedAt), ne(casesTable.status, "completed")));
  const caseById = new Map(openCases.map((row) => [row.id, row]));
  const ref = (row: { reference: string; displayReference: string | null }) => row.displayReference || row.reference;

  // 1. Stage overdue — the Settings thresholds, per stage.
  const thresholds = new Map((await db.select().from(caseStageThresholdsTable)).map((row) => [row.stageIndex, row.thresholdDays]));
  for (const row of openCases) {
    const limit = thresholds.get(row.stageIndex);
    if (limit == null) continue;
    const days = daysAgo(row.stageStartedAt);
    if (days < limit) continue;
    out.push({
      kind: "stage_overdue", dedupeKey: `stage_overdue:case:${row.id}:stage:${row.stageIndex}`,
      title: `${ref(row)} has been in ${stageName(row.stageIndex)} for ${days} days`,
      detail: `${row.clientName} · limit ${limit} days`,
      caseId: row.id, clientId: row.clientId, assignedUserId: row.assignedUserId,
    });
  }
  // 10. Past the advice stage while the case's Terms of Business are still unsigned (stage-0 requirement).
  const unsignedTerms = new Set(
    (await db
      .select({ caseId: requirementsTable.caseId })
      .from(requirementsTable)
      .where(and(eq(requirementsTable.label, TERMS_SIGNED_LABEL), eq(requirementsTable.complete, false))))
      .map((row) => row.caseId),
  );
  for (const row of openCases) {
    // 9. No case handler.
    if (row.assignedUserId == null) {
      out.push({ kind: "unassigned_case", dedupeKey: `unassigned_case:case:${row.id}`, title: `${ref(row)} has no case handler`, detail: row.clientName, caseId: row.id, clientId: row.clientId });
    }
    if (row.stageIndex >= 1 && unsignedTerms.has(row.id)) {
      out.push({ kind: "terms_not_accepted", dedupeKey: `terms_not_accepted:case:${row.id}`, title: `${row.clientName} has not signed the Terms of Business`, detail: `${ref(row)} is at ${stageName(row.stageIndex)} — send or chase the agreement from the case`, caseId: row.id, clientId: row.clientId, assignedUserId: row.assignedUserId });
    }
  }

  // 11. The Terms of Business signature request went wrong. These go to the
  // administrator (the adviser), not just the case handler: the red ones email.
  const [admin] = await db
    .select({ id: appUsersTable.id })
    .from(appUsersTable)
    .where(and(eq(appUsersTable.role, "broker_ceo"), eq(appUsersTable.active, true)))
    .orderBy(asc(appUsersTable.id))
    .limit(1);
  const agreements = await db
    .select()
    .from(caseTermsAgreementsTable)
    .where(inArray(caseTermsAgreementsTable.caseId, [...caseById.keys(), -1]))
    .orderBy(desc(caseTermsAgreementsTable.createdAt), desc(caseTermsAgreementsTable.id));
  const latestByCase = new Map<number, (typeof agreements)[number]>();
  for (const row of agreements) if (!latestByCase.has(row.caseId)) latestByCase.set(row.caseId, row);
  for (const [caseId, agreement] of latestByCase) {
    const kase = caseById.get(caseId);
    if (!kase) continue;
    const owner = admin?.id ?? kase.assignedUserId;
    if (agreement.status === "declined") {
      out.push({
        kind: "terms_declined", dedupeKey: `terms_declined:agreement:${agreement.id}`,
        title: `${kase.clientName} declined to sign the Terms of Business`,
        detail: `${ref(kase)}${agreement.declineReason ? ` — "${agreement.declineReason}"` : ""} · speak to the client, then send a new document from the case`,
        caseId, clientId: kase.clientId, assignedUserId: owner,
      });
    } else if (agreement.status === "sent" && agreement.envelopeStatus === DELIVERY_FAILED) {
      out.push({
        kind: "terms_bounced", dedupeKey: `terms_bounced:agreement:${agreement.id}`,
        title: `The Terms of Business email to ${kase.clientName} bounced`,
        detail: `${ref(kase)} · DocuSign could not deliver to ${agreement.recipientEmail} — check the address, void the request and send it again`,
        caseId, clientId: kase.clientId, assignedUserId: owner,
      });
    } else if (agreement.status === "sent" && agreement.sentAt && daysAgo(agreement.sentAt) >= SIGNATURE_WAIT_DAYS) {
      out.push({
        kind: "terms_waiting", dedupeKey: `terms_waiting:agreement:${agreement.id}`,
        title: `${kase.clientName} has not signed the Terms of Business`,
        detail: `${ref(kase)} · sent ${daysAgo(agreement.sentAt)} days ago${agreement.envelopeStatus === "delivered" ? ", opened but not signed" : ", not yet opened"} — chase the client`,
        caseId, clientId: kase.clientId, assignedUserId: owner,
      });
    }
  }

  // 1b. A lender submission sitting too long at one step (per-step thresholds in Settings).
  for (const row of openCases) {
    const views = await submissionViews(await listSubmissions(row.id));
    for (const sub of views) {
      if (!sub.stepFlagged || !sub.currentStep) continue;
      out.push({
        kind: "submission_step_overdue", dedupeKey: `submission_step_overdue:submission:${sub.id}:step:${sub.currentStep}`,
        title: `${ref(row)} · ${sub.lenderName}: ${sub.stepDays} days waiting for "${sub.currentStepLabel}"`,
        detail: `${row.clientName} · limit ${sub.stepThresholdDays} days`,
        caseId: row.id, clientId: row.clientId, assignedUserId: row.assignedUserId,
      });
    }
  }

  // 2. Overdue tasks.
  const overdueTasks = await db
    .select({ id: tasksTable.id, title: tasksTable.title, dueDate: tasksTable.dueDate, caseId: tasksTable.caseId, clientId: tasksTable.clientId, assignedUserId: tasksTable.assignedUserId })
    .from(tasksTable)
    .where(and(ne(tasksTable.status, "done"), lt(tasksTable.dueDate, todayIso())));
  for (const task of overdueTasks) {
    const days = daysAgo(`${task.dueDate}T00:00:00Z`);
    out.push({
      kind: "task_overdue", dedupeKey: `task_overdue:task:${task.id}`, title: task.title,
      detail: `${days} day${days === 1 ? "" : "s"} overdue`, taskId: task.id, caseId: task.caseId, clientId: task.clientId, assignedUserId: task.assignedUserId,
    });
  }

  // 3. Enquiries nobody has decided on.
  const enquiries = await db
    .select({ id: clientsTable.id, name: clientsTable.name, receivedAt: clientsTable.enquiryReceivedAt, assignedUserId: clientsTable.assignedUserId })
    .from(clientsTable)
    .where(eq(clientsTable.lifecycle, "enquiry"));
  for (const client of enquiries) {
    const days = daysAgo(client.receivedAt);
    if (days < ENQUIRY_STALE_DAYS) continue;
    out.push({ kind: "enquiry_stale", dedupeKey: `enquiry_stale:client:${client.id}`, title: `${client.name}'s enquiry has waited ${days} days`, detail: "Accept or decline it on the Add page", clientId: client.id, assignedUserId: client.assignedUserId });
  }

  // 4. Advice sent, no answer.
  const pending = await db
    .select({ id: clientApprovalsTable.id, caseId: clientApprovalsTable.caseId, sentAt: clientApprovalsTable.sentAt, expiresAt: clientApprovalsTable.expiresAt, version: clientApprovalsTable.version })
    .from(clientApprovalsTable)
    .where(and(eq(clientApprovalsTable.kind, "advice"), isNull(clientApprovalsTable.response)));
  const latestPending = new Map<number, typeof pending[number]>();
  for (const row of pending) {
    const current = latestPending.get(row.caseId);
    if (!current || row.version > current.version) latestPending.set(row.caseId, row);
  }
  for (const row of latestPending.values()) {
    const kase = caseById.get(row.caseId);
    if (!kase) continue;
    const expired = row.expiresAt.getTime() < Date.now();
    const days = daysAgo(row.sentAt);
    if (!expired && days < APPROVAL_WAIT_DAYS) continue;
    out.push({
      kind: "approval_unanswered", dedupeKey: `approval_unanswered:case:${row.caseId}`,
      title: `${kase.clientName} has not answered the advice`,
      detail: expired ? `Sent ${days} days ago — the link has expired, resend it` : `Sent ${days} days ago (${ref(kase)})`,
      caseId: row.caseId, clientId: kase.clientId, assignedUserId: kase.assignedUserId,
    });
  }

  // 5. Valuation booked, date passed, no result.
  const valuations = await db
    .select({ id: caseSubmissionsTable.id, caseId: caseSubmissionsTable.caseId, valuationDate: caseSubmissionsTable.valuationDate })
    .from(caseSubmissionsTable)
    .where(and(eq(caseSubmissionsTable.status, "active"), isNull(caseSubmissionsTable.valuationCompletedAt), lt(caseSubmissionsTable.valuationDate, new Date())));
  for (const row of valuations) {
    const kase = caseById.get(row.caseId);
    if (!kase || !row.valuationDate) continue;
    out.push({ kind: "valuation_passed", dedupeKey: `valuation_passed:submission:${row.id}`, title: `${ref(kase)}: valuation was due ${row.valuationDate.toLocaleDateString("en-GB")}`, detail: `${kase.clientName} · record the result or rebook`, caseId: kase.id, clientId: kase.clientId, assignedUserId: kase.assignedUserId });
  }

  // 6. Issued invoices past their due date with money outstanding.
  const invoices = await db
    .select({
      id: invoicesTable.id, number: invoicesTable.invoiceNumber, clientId: invoicesTable.clientId, caseId: invoicesTable.caseId, dueDate: invoicesTable.dueDate,
      total: sql<number>`coalesce((select sum(li.quantity * li.unit_amount) from invoice_line_items li where li.invoice_id = ${invoicesTable.id}), 0)`,
      paid: sql<number>`coalesce((select sum(p.amount) from invoice_payments p where p.invoice_id = ${invoicesTable.id}), 0)`,
      clientName: clientsTable.name,
    })
    .from(invoicesTable)
    .innerJoin(clientsTable, eq(clientsTable.id, invoicesTable.clientId))
    .where(and(eq(invoicesTable.status, "issued"), lt(invoicesTable.dueDate, todayIso())));
  for (const inv of invoices) {
    const outstanding = Number(inv.total) - Number(inv.paid);
    if (outstanding <= 0) continue;
    const kase = inv.caseId ? caseById.get(inv.caseId) : undefined;
    out.push({ kind: "invoice_overdue", dedupeKey: `invoice_overdue:invoice:${inv.id}`, title: `Invoice ${inv.number} is ${daysAgo(`${inv.dueDate}T00:00:00Z`)} days overdue`, detail: `${inv.clientName} · ${money(outstanding)} outstanding`, invoiceId: inv.id, clientId: inv.clientId, caseId: inv.caseId, assignedUserId: kase?.assignedUserId ?? null });
  }

  // 7. Renewals inside the window.
  const horizon = new Date(Date.now() + RENEWAL_WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const renewals = await db
    .select({ id: renewalsTable.id, clientId: renewalsTable.clientId, caseId: renewalsTable.caseId, dueDate: renewalsTable.dueDate, type: renewalsTable.type, clientName: clientsTable.name })
    .from(renewalsTable)
    .innerJoin(clientsTable, eq(clientsTable.id, renewalsTable.clientId))
    .where(and(sql`${renewalsTable.status} not in ('completed', 'lost')`, lt(renewalsTable.dueDate, horizon)));
  for (const row of renewals) {
    const days = -daysAgo(`${row.dueDate}T00:00:00Z`);
    const kase = row.caseId ? caseById.get(row.caseId) : undefined;
    out.push({
      kind: "renewal_due", dedupeKey: `renewal_due:renewal:${row.id}`,
      title: `${row.clientName}: ${row.type.replace(/_/g, " ")} renewal ${days < 0 ? `${-days} days overdue` : `due in ${days} days`}`,
      detail: `Due ${new Date(`${row.dueDate}T00:00:00Z`).toLocaleDateString("en-GB")}`,
      renewalId: row.id, clientId: row.clientId, caseId: row.caseId, assignedUserId: kase?.assignedUserId ?? null,
    });
  }

  // 8. Accepted a while ago, onboarding incomplete, nothing uploaded lately.
  const onboarding = await db
    .select({
      id: clientsTable.id, name: clientsTable.name, acceptedAt: clientsTable.acceptedAt, assignedUserId: clientsTable.assignedUserId,
      lastUpload: sql<Date | null>`(select max(d.uploaded_at) from documents d where d.client_id = ${clientsTable.id})`,
    })
    .from(clientsTable)
    .where(and(eq(clientsTable.lifecycle, "onboarding"), ne(clientsTable.onboardingStatus, "complete")));
  for (const client of onboarding) {
    if (!client.acceptedAt || daysAgo(client.acceptedAt) < ONBOARDING_STALL_DAYS) continue;
    const last = client.lastUpload ? daysAgo(client.lastUpload) : null;
    if (last != null && last < ONBOARDING_STALL_DAYS) continue;
    out.push({ kind: "onboarding_stalled", dedupeKey: `onboarding_stalled:client:${client.id}`, title: `${client.name}'s onboarding has stalled`, detail: last == null ? `Accepted ${daysAgo(client.acceptedAt)} days ago, nothing uploaded yet` : `Last upload ${last} days ago`, clientId: client.id, assignedUserId: client.assignedUserId });
  }
  void documentsTable; void asc;
  return out;
}

/** Raise new alerts, refresh open ones, resolve the ones whose condition has cleared. */
export async function evaluateAlerts() {
  const candidates = await findAlertCandidates();
  const byKey = new Map(candidates.map((c) => [c.dedupeKey, c]));
  const existing = await db.select().from(alertsTable).where(inArray(alertsTable.dedupeKey, [...byKey.keys(), "__none__"]));
  const existingByKey = new Map(existing.map((row) => [row.dedupeKey, row]));
  let raised = 0;
  for (const c of candidates) {
    const row = existingByKey.get(c.dedupeKey);
    const values = {
      kind: c.kind, severity: ALERT_KINDS[c.kind].severity, title: c.title, detail: c.detail,
      caseId: c.caseId ?? null, clientId: c.clientId ?? null, taskId: c.taskId ?? null, renewalId: c.renewalId ?? null, invoiceId: c.invoiceId ?? null,
      assignedUserId: c.assignedUserId ?? null,
    };
    if (!row) {
      await db.insert(alertsTable).values({ ...values, dedupeKey: c.dedupeKey });
      raised += 1;
    } else if (row.resolvedAt) {
      // The condition came back: it is a new event, so it is unread and notifies again.
      await db.update(alertsTable).set({ ...values, raisedAt: new Date(), acknowledgedAt: null, acknowledgedByUserId: null, resolvedAt: null, notifiedAt: null }).where(eq(alertsTable.id, row.id));
      raised += 1;
    } else {
      await db.update(alertsTable).set(values).where(eq(alertsTable.id, row.id));
    }
  }
  const open = await db.select({ id: alertsTable.id, dedupeKey: alertsTable.dedupeKey }).from(alertsTable).where(isNull(alertsTable.resolvedAt));
  const gone = open.filter((row) => !byKey.has(row.dedupeKey)).map((row) => row.id);
  if (gone.length) await db.update(alertsTable).set({ resolvedAt: new Date() }).where(inArray(alertsTable.id, gone));
  return { raised, resolved: gone.length, open: open.length - gone.length };
}

/** Email each assignee their newly raised red alerts, once. Amber alerts never email. */
export async function notifyNewAlerts() {
  const fresh = await db
    .select()
    .from(alertsTable)
    .where(and(isNull(alertsTable.resolvedAt), isNull(alertsTable.notifiedAt)));
  if (!fresh.length) return 0;
  const byUser = new Map<number, typeof fresh>();
  for (const alert of fresh) {
    if (alert.severity === "red" && alert.assignedUserId != null) {
      byUser.set(alert.assignedUserId, [...(byUser.get(alert.assignedUserId) ?? []), alert]);
    }
  }
  const users = byUser.size
    ? await db.select({ id: appUsersTable.id, email: appUsersTable.email, displayName: appUsersTable.displayName, active: appUsersTable.active }).from(appUsersTable).where(inArray(appUsersTable.id, [...byUser.keys()]))
    : [];
  const portalUrl = process.env.PORTAL_URL?.replace(/\/$/, "");
  let sent = 0;
  for (const user of users) {
    if (!user.active) continue;
    const alerts = byUser.get(user.id)!;
    try {
      const result = await sendChariotEmail({
        purpose: "alert",
        to: [user.email],
        subject: alerts.length === 1 ? `Needs you: ${alerts[0]!.title}` : `${alerts.length} things need your attention`,
        html: renderChariotEmail({
          heading: alerts.length === 1 ? "Something needs your attention" : `${alerts.length} things need your attention`,
          paragraphs: [`Dear ${user.displayName},`, ...alerts.map((a) => `• ${a.title} — ${a.detail}`)],
          cta: portalUrl ? { label: "Open alerts", url: `${portalUrl}/alerts` } : undefined,
        }),
      });
      if (result.status === "sent") sent += 1;
    } catch (error) {
      logger.warn({ err: error, userId: user.id }, "Alert email was not delivered");
    }
  }
  // Everything fresh is now "handled" for notification purposes, whether emailed or not.
  await db.update(alertsTable).set({ notifiedAt: new Date() }).where(inArray(alertsTable.id, fresh.map((a) => a.id)));
  return sent;
}

export type AlertScope = "mine" | "all";
export type AlertStatus = "open" | "acknowledged" | "resolved";

export async function listAlerts(options: { userId: number; isAdmin: boolean; scope: AlertScope; status: AlertStatus }) {
  const scopeMine = options.scope === "mine" || !options.isAdmin;
  const rows = await db
    .select({
      alert: alertsTable,
      caseReference: sql<string | null>`coalesce(${casesTable.displayReference}, ${casesTable.reference})`,
      clientName: clientsTable.name,
      assignedTo: appUsersTable.displayName,
    })
    .from(alertsTable)
    .leftJoin(casesTable, eq(casesTable.id, alertsTable.caseId))
    .leftJoin(clientsTable, eq(clientsTable.id, alertsTable.clientId))
    .leftJoin(appUsersTable, eq(appUsersTable.id, alertsTable.assignedUserId))
    .where(and(
      options.status === "resolved" ? sql`${alertsTable.resolvedAt} is not null` : isNull(alertsTable.resolvedAt),
      options.status === "open" ? isNull(alertsTable.acknowledgedAt) : options.status === "acknowledged" ? sql`${alertsTable.acknowledgedAt} is not null` : sql`true`,
      scopeMine ? eq(alertsTable.assignedUserId, options.userId) : sql`true`,
    ))
    .orderBy(desc(alertsTable.raisedAt))
    .limit(200);
  const ackIds = [...new Set(rows.map((r) => r.alert.acknowledgedByUserId).filter((id): id is number => id != null))];
  const ackNames = new Map(ackIds.length ? (await db.select({ id: appUsersTable.id, displayName: appUsersTable.displayName }).from(appUsersTable).where(inArray(appUsersTable.id, ackIds))).map((u) => [u.id, u.displayName]) : []);
  return rows.map(({ alert, caseReference, clientName, assignedTo }) => alertView(alert, { caseReference, clientName, assignedTo, acknowledgedBy: alert.acknowledgedByUserId != null ? ackNames.get(alert.acknowledgedByUserId) ?? null : null }));
}

export function alertView(
  row: typeof alertsTable.$inferSelect,
  extras: { caseReference: string | null; clientName: string | null; assignedTo: string | null; acknowledgedBy: string | null },
) {
  // The most specific record first: the task itself, the invoice, then the case.
  const href = row.taskId != null ? `/tasks?task=${row.taskId}`
    : row.invoiceId != null ? `/invoices/${row.invoiceId}`
    : row.caseId != null ? `/cases/${row.caseId}`
    : row.renewalId != null ? "/renewals"
    : row.clientId != null ? (row.kind === "enquiry_stale" ? `/add/${row.clientId}` : `/clients/${row.clientId}`)
    : "/alerts";
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: ALERT_KINDS[row.kind as AlertKind]?.label ?? row.kind,
    severity: row.severity as AlertSeverity,
    title: row.title,
    detail: row.detail,
    caseId: row.caseId,
    caseReference: extras.caseReference,
    clientId: row.clientId,
    clientName: extras.clientName,
    taskId: row.taskId,
    renewalId: row.renewalId,
    invoiceId: row.invoiceId,
    // The submission a valuation alert is about lives in the key (no column needed for one kind).
    submissionId: row.kind === "valuation_passed" ? Number(row.dedupeKey.split(":").pop()) || null : null,
    assignedUserId: row.assignedUserId,
    assignedTo: extras.assignedTo,
    raisedAt: row.raisedAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: extras.acknowledgedBy,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    href,
  };
}

/** Open, unacknowledged counts for the menu badge: admins see everything, others their own. */
/** Counts the caller's own open alerts — the same set the alerts page opens on ("Mine"), so the badge matches what they see. */
export async function alertSummary(userId: number) {
  const rows = await db
    .select({ severity: alertsTable.severity, count: sql<number>`count(*)::int` })
    .from(alertsTable)
    .where(and(isNull(alertsTable.resolvedAt), isNull(alertsTable.acknowledgedAt), eq(alertsTable.assignedUserId, userId)))
    .groupBy(alertsTable.severity);
  const red = rows.find((r) => r.severity === "red")?.count ?? 0;
  const amber = rows.find((r) => r.severity === "amber")?.count ?? 0;
  return { red, amber, total: red + amber };
}

/**
 * Re-run the rules for one alert after someone fixed it from the card, so it
 * clears now rather than at the next scheduled run. Returns the current row.
 */
export async function recheckAlert(id: number) {
  const [row] = await db.select().from(alertsTable).where(eq(alertsTable.id, id));
  if (!row) return null;
  if (row.resolvedAt) return row;
  const candidate = (await findAlertCandidates()).find((c) => c.dedupeKey === row.dedupeKey);
  const [updated] = candidate
    ? await db.update(alertsTable).set({ title: candidate.title, detail: candidate.detail, assignedUserId: candidate.assignedUserId ?? null }).where(eq(alertsTable.id, id)).returning()
    : await db.update(alertsTable).set({ resolvedAt: new Date() }).where(eq(alertsTable.id, id)).returning();
  return updated ?? row;
}

export async function acknowledgeAlert(id: number, userId: number) {
  const [row] = await db
    .update(alertsTable)
    .set({ acknowledgedAt: new Date(), acknowledgedByUserId: userId })
    .where(and(eq(alertsTable.id, id), isNull(alertsTable.acknowledgedAt)))
    .returning();
  return row ?? null;
}
