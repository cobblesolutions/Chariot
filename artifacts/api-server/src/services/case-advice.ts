import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  activitiesTable,
  appUsersTable,
  caseAdviceTable,
  casesTable,
  clientApprovalsTable,
  clientsTable,
  db,
  lendersTable,
  requirementsTable,
  tasksTable,
} from "@workspace/db";
import { sendChariotEmail } from "../integrations/resend";
import { renderChariotEmail } from "../integrations/email-template";
import { logger } from "../lib/logger";
import { createAssignmentTask, addDays, resolveAssignee } from "./assignment";
import { escapeHtml, getEmailTemplate, renderEmailTemplate, templateVarsFor, type TemplateVars } from "./email-templates";
import { STAGES, stageOwnerRole } from "./stages";
import { stageSection } from "./assignment";
import { needsAdvice, serviceTypeLabel } from "./service-types";
import { caseTermsAcceptance } from "./terms-agreements";

export type CaseRow = typeof casesTable.$inferSelect;
export type ApprovalRow = typeof clientApprovalsTable.$inferSelect;
export type AdviceRow = typeof caseAdviceTable.$inferSelect;

export const ADVICE_STAGE_INDEX = STAGES.indexOf("Advice & approval");
export const DETAILS_STAGE_INDEX = STAGES.indexOf("Submission details");

/** Requirement labels seeded on the first two stages (scope steps 5–7). */
export const SERVICE_LEVEL_LABEL = "Service level confirmed";
export const ADVICE_SENT_LABEL = "Advice sent to client";
export const ADVICE_APPROVED_LABEL = "Client approved advice";
/** Execution-only: the client's own instruction (lender + product) is on file. */
export const INSTRUCTION_LABEL = "Client instruction recorded";

/** Only the advice is put to the client; the submission details are display-only. */
export type ApprovalKind = "advice";
export const APPROVAL_EXPIRY_DAYS = 14;

/** Task kinds for "waiting on the client" work; closed automatically when the answer arrives. */
export const responseTaskKind = (kind: ApprovalKind) => `${kind}_response`;

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
const money = (value: number | null | undefined) =>
  value == null ? null : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);

// ---------------------------------------------------------------------------
// Requirements

/** Insert the label for this stage if the case does not have it yet. */
export async function ensureRequirement(caseId: number, stageIndex: number, label: string) {
  const [existing] = await db
    .select({ id: requirementsTable.id })
    .from(requirementsTable)
    .where(and(eq(requirementsTable.caseId, caseId), eq(requirementsTable.label, label), eq(requirementsTable.round, 1)));
  if (existing) return existing.id;
  const [created] = await db.insert(requirementsTable).values({ caseId, stageIndex, label, round: 1 }).returning({ id: requirementsTable.id });
  return created!.id;
}

/** Tick (or untick) a stage requirement by its label. */
export async function setRequirement(caseId: number, stageIndex: number, label: string, complete: boolean, by: string | null) {
  await ensureRequirement(caseId, stageIndex, label);
  await db
    .update(requirementsTable)
    .set({ complete, completedAt: complete ? new Date() : null, completedBy: complete ? by : null })
    .where(and(eq(requirementsTable.caseId, caseId), eq(requirementsTable.label, label)));
}

export async function removeRequirement(caseId: number, label: string) {
  await db.delete(requirementsTable).where(and(eq(requirementsTable.caseId, caseId), eq(requirementsTable.label, label)));
}

// ---------------------------------------------------------------------------
// Advice draft

export async function getAdviceRow(caseId: number): Promise<AdviceRow | null> {
  const [row] = await db.select().from(caseAdviceTable).where(eq(caseAdviceTable.caseId, caseId));
  return row ?? null;
}

async function lenderNameFor(lenderId: number | null | undefined) {
  if (!lenderId) return null;
  const [lender] = await db.select({ name: lendersTable.name }).from(lendersTable).where(eq(lendersTable.id, lenderId));
  return lender?.name ?? null;
}

export async function displayNameFor(userId: number | null | undefined) {
  if (!userId) return null;
  const [user] = await db.select({ displayName: appUsersTable.displayName }).from(appUsersTable).where(eq(appUsersTable.id, userId));
  return user?.displayName ?? null;
}

export async function adviceView(caseId: number, row: AdviceRow | null) {
  return {
    caseId,
    lenderId: row?.lenderId ?? null,
    lenderName: await lenderNameFor(row?.lenderId),
    product: row?.product ?? null,
    ratePct: row?.ratePct ?? null,
    termYears: row?.termYears ?? null,
    monthlyPayment: row?.monthlyPayment ?? null,
    arrangementFee: row?.arrangementFee ?? null,
    summary: row?.summary ?? null,
    reasoning: row?.reasoning ?? null,
    source: (row?.source as "adviser" | "client_email" | "staff" | null) ?? null,
    instructionEmailText: row?.instructionEmailText ?? null,
    updatedAt: iso(row?.updatedAt),
    updatedBy: await displayNameFor(row?.updatedByUserId),
  };
}

export type AdviceInput = Partial<{
  lenderId: number | null;
  product: string | null;
  ratePct: number | null;
  termYears: number | null;
  monthlyPayment: number | null;
  arrangementFee: number | null;
  summary: string | null;
  reasoning: string | null;
  source: "adviser" | "client_email" | "staff" | null;
  instructionEmailText: string | null;
}>;

export async function saveAdvice(caseId: number, input: AdviceInput, userId: number, caseRow?: CaseRow) {
  const clean = <T>(value: T | undefined) => (value === undefined ? undefined : value);
  const text = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim() || null);
  const values = {
    lenderId: clean(input.lenderId),
    product: text(input.product),
    ratePct: clean(input.ratePct),
    termYears: clean(input.termYears),
    monthlyPayment: clean(input.monthlyPayment),
    arrangementFee: clean(input.arrangementFee),
    summary: text(input.summary),
    reasoning: text(input.reasoning),
    source: clean(input.source),
    instructionEmailText: text(input.instructionEmailText),
    updatedByUserId: userId,
  };
  const existing = await getAdviceRow(caseId);
  const [row] = existing
    ? await db.update(caseAdviceTable).set(values).where(eq(caseAdviceTable.id, existing.id)).returning()
    : await db.insert(caseAdviceTable).values({ caseId, ...values }).returning();
  // Execution-only: the instruction counts as recorded once a lender and product are on file.
  if (caseRow && !needsAdvice(caseRow.serviceType)) {
    const recorded = !!row!.lenderId && !!row!.product?.trim();
    await setRequirement(caseId, ADVICE_STAGE_INDEX, INSTRUCTION_LABEL, recorded, recorded ? await displayNameFor(userId) : null);
  }
  return row!;
}

export const instructionRecorded = (advice: AdviceRow | null) => !!advice?.lenderId && !!advice?.product?.trim();

/** What still stops the advice going out (advised) or the instruction counting as recorded (execution-only). */
export function adviceMissing(caseRow: CaseRow, advice: AdviceRow | null): string[] {
  const missing: string[] = [];
  if (!caseRow.serviceLevelConfirmedAt) missing.push("Confirm the service level");
  if (!advice?.lenderId) missing.push("Lender");
  if (!advice?.product?.trim()) missing.push("Product");
  if (needsAdvice(caseRow.serviceType)) {
    if (advice?.ratePct == null) missing.push("Rate");
    if (!advice?.summary?.trim()) missing.push("Recommendation summary");
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Approvals

export async function approvalView(row: ApprovalRow) {
  return {
    id: row.id,
    caseId: row.caseId,
    kind: row.kind as ApprovalKind,
    version: row.version,
    sentAt: row.sentAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    sentBy: await displayNameFor(row.sentByUserId),
    deliveryStatus: row.deliveryStatus as "pending" | "sent" | "disabled" | "failed",
    deliveryError: row.deliveryError ?? null,
    response: (row.response as "approved" | "discuss" | null) ?? null,
    respondedAt: iso(row.respondedAt),
    respondedVia: (row.respondedVia as "email" | "portal" | "staff" | null) ?? null,
    note: row.note ?? null,
    snapshot: (row.snapshot as Record<string, unknown>) ?? {},
  };
}

export async function listApprovals(caseId: number, kind?: ApprovalKind) {
  const rows = await db
    .select()
    .from(clientApprovalsTable)
    .where(kind ? and(eq(clientApprovalsTable.caseId, caseId), eq(clientApprovalsTable.kind, kind)) : eq(clientApprovalsTable.caseId, caseId))
    .orderBy(desc(clientApprovalsTable.version), desc(clientApprovalsTable.sentAt));
  return Promise.all(rows.map(approvalView));
}

export async function latestApproval(caseId: number, kind: ApprovalKind): Promise<ApprovalRow | null> {
  const [row] = await db
    .select()
    .from(clientApprovalsTable)
    .where(and(eq(clientApprovalsTable.caseId, caseId), eq(clientApprovalsTable.kind, kind)))
    .orderBy(desc(clientApprovalsTable.version))
    .limit(1);
  return row ?? null;
}

/** Everything the client has not answered yet and can still answer. */
export async function pendingApprovals(caseId: number) {
  const rows = await db
    .select()
    .from(clientApprovalsTable)
    .where(and(
      eq(clientApprovalsTable.caseId, caseId),
      isNull(clientApprovalsTable.respondedAt),
      sql`${clientApprovalsTable.expiresAt} > now()`,
    ))
    .orderBy(asc(clientApprovalsTable.sentAt));
  return Promise.all(rows.map(approvalView));
}

/**
 * A new versioned approval request. Earlier unanswered requests of the same
 * kind expire immediately so an old email link can no longer be used.
 */
async function createApproval(options: { caseId: number; kind: ApprovalKind; snapshot: unknown; userId: number }) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const previous = await latestApproval(options.caseId, options.kind);
  await db
    .update(clientApprovalsTable)
    .set({ expiresAt: new Date() })
    .where(and(
      eq(clientApprovalsTable.caseId, options.caseId),
      eq(clientApprovalsTable.kind, options.kind),
      isNull(clientApprovalsTable.respondedAt),
    ));
  const [row] = await db
    .insert(clientApprovalsTable)
    .values({
      caseId: options.caseId,
      kind: options.kind,
      version: (previous?.version ?? 0) + 1,
      snapshot: options.snapshot as object,
      tokenHash,
      expiresAt: new Date(Date.now() + APPROVAL_EXPIRY_DAYS * 86_400_000),
      sentByUserId: options.userId,
      deliveryStatus: "pending",
    })
    .returning();
  return { row: row!, token };
}

async function markDelivery(id: number, status: "sent" | "disabled" | "failed", error?: string) {
  await db.update(clientApprovalsTable).set({ deliveryStatus: status, deliveryError: error ?? null }).where(eq(clientApprovalsTable.id, id));
}

const approveUrl = (token: string) => `${(process.env.PORTAL_URL ?? "").replace(/\/$/, "")}/approve?token=${encodeURIComponent(token)}`;

/** Two buttons side by side: a filled Approve/Confirm and an outlined "reply" action. */
function buttonsHtml(primary: { label: string; url: string }, secondary?: { label: string; url: string }) {
  const filled = `<td style="border-radius:6px;background-color:#C46B2B;"><a href="${primary.url}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(primary.label)}</a></td>`;
  const outlined = secondary
    ? `<td style="width:12px;"></td><td style="border-radius:6px;border:1px solid #C46B2B;"><a href="${secondary.url}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#C46B2B;text-decoration:none;border-radius:6px;">${escapeHtml(secondary.label)}</a></td>`
    : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px 0;"><tr>${filled}${outlined}</tr></table>`;
}

function factsTable(rows: Array<[string, string | null]>) {
  const cells = rows
    .filter((row): row is [string, string] => !!row[1])
    .map(([label, value]) =>
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #EDEFEC;font-size:13px;color:#6B7570;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:8px 12px;border-bottom:1px solid #EDEFEC;font-size:14px;color:#2B2E2C;font-weight:600;">${escapeHtml(value)}</td></tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px 0;border:1px solid #E3E7E4;border-radius:8px;overflow:hidden;">${cells}</table>`;
}

export interface AdviceSnapshot {
  reference: string;
  lender: string | null;
  product: string | null;
  ratePct: number | null;
  termYears: number | null;
  monthlyPayment: number | null;
  arrangementFee: number | null;
  summary: string;
}

/** The HTML block the advice email and its preview share. */
export function adviceBlockHtml(snapshot: AdviceSnapshot) {
  return (
    factsTable([
      ["Lender", snapshot.lender],
      ["Product", snapshot.product],
      ["Rate", snapshot.ratePct != null ? `${snapshot.ratePct}%` : null],
      ["Term", snapshot.termYears != null ? `${snapshot.termYears} years` : null],
      ["Monthly payment", money(snapshot.monthlyPayment)],
      ["Arrangement fee", money(snapshot.arrangementFee)],
    ]) +
    `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#2B2E2C;">${escapeHtml(snapshot.summary).replace(/\n/g, "<br />")}</p>`
  );
}

async function clientFor(caseRow: CaseRow) {
  const [client] = await db
    .select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email, companyName: clientsTable.companyName })
    .from(clientsTable)
    .where(eq(clientsTable.id, caseRow.clientId));
  return client ?? null;
}

async function staffEmail(userId: number) {
  const [user] = await db.select({ email: appUsersTable.email, displayName: appUsersTable.displayName }).from(appUsersTable).where(eq(appUsersTable.id, userId));
  return user ?? null;
}

const refOf = (caseRow: CaseRow) => caseRow.displayReference || caseRow.reference;

/**
 * Step 6: snapshot the advice, email it with Approve / Further discussion,
 * tick "Advice sent", and open a waiting-on-client task for the adviser.
 */
export async function sendAdvice(caseRow: CaseRow, actor: { id: number; displayName: string }) {
  const advice = await getAdviceRow(caseRow.id);
  const missing = adviceMissing(caseRow, advice);
  if (missing.length) throw new AdviceError(`Complete the advice first: ${missing.join(", ")}`);
  if (!needsAdvice(caseRow.serviceType)) throw new AdviceError(`${serviceTypeLabel(caseRow.serviceType)} cases do not send written advice`);
  const client = await clientFor(caseRow);
  if (!client) throw new AdviceError("Client not found");
  const adviser = await staffEmail(actor.id);
  const reference = refOf(caseRow);
  const snapshot: AdviceSnapshot = {
    reference,
    lender: await lenderNameFor(advice!.lenderId),
    product: advice!.product,
    ratePct: advice!.ratePct,
    termYears: advice!.termYears,
    monthlyPayment: advice!.monthlyPayment,
    arrangementFee: advice!.arrangementFee,
    summary: advice!.summary ?? "",
  };
  const { row, token } = await createApproval({ caseId: caseRow.id, kind: "advice", snapshot, userId: actor.id });

  const template = await getEmailTemplate("advice_email");
  const vars: TemplateVars = {
    ...templateVarsFor(client, actor.displayName),
    reference,
    lender: snapshot.lender ?? "",
    product: snapshot.product ?? "",
    rate: snapshot.ratePct != null ? `${snapshot.ratePct}%` : "",
    term: snapshot.termYears != null ? `${snapshot.termYears} years` : "",
    monthlyPayment: money(snapshot.monthlyPayment) ?? "",
    summary: snapshot.summary,
  };
  const rendered = renderEmailTemplate(template, vars);
  const discussHref = adviser
    ? `mailto:${adviser.email}?subject=${encodeURIComponent(`Re: ${rendered.subject}`)}`
    : `mailto:?subject=${encodeURIComponent(`Re: ${rendered.subject}`)}`;
  await deliver(row.id, {
    purpose: "advice_email",
    to: client.email,
    replyTo: adviser?.email,
    subject: rendered.subject,
    html: renderChariotEmail({
      preheader: `Our recommendation for ${reference}`,
      heading: rendered.heading,
      paragraphs: rendered.paragraphs,
      rawBody: adviceBlockHtml(snapshot) + buttonsHtml({ label: "Approve", url: approveUrl(token) }, { label: "Further discussion", url: discussHref }),
    }),
  });

  await setRequirement(caseRow.id, ADVICE_STAGE_INDEX, ADVICE_SENT_LABEL, true, actor.displayName);
  await setRequirement(caseRow.id, ADVICE_STAGE_INDEX, ADVICE_APPROVED_LABEL, false, null);
  await db.insert(activitiesTable).values({
    caseId: caseRow.id,
    title: row.version > 1 ? "Advice re-sent" : "Advice sent",
    detail: `${reference}: ${snapshot.lender ?? "recommendation"}${snapshot.product ? ` — ${snapshot.product}` : ""} sent to ${client.name} for approval (v${row.version})`,
    actorName: actor.displayName,
  });
  await closeResponseTasks(caseRow.id, "advice");
  await createAssignmentTask({
    staffUser: adviser ? { id: actor.id, displayName: adviser.displayName, email: adviser.email } : null,
    title: `Awaiting client response on advice — ${reference}`,
    notes: `Advice v${row.version} was sent to ${client.name}. Chase if there is no answer.`,
    caseId: caseRow.id,
    clientId: caseRow.clientId,
    kind: responseTaskKind("advice"),
    dueDate: addDays(3),
  }).catch((error) => logger.warn({ err: error, caseId: caseRow.id }, "Advice response task was not created"));
  return row;
}

async function deliver(approvalId: number, email: { purpose: "advice_email"; to: string; replyTo?: string; subject: string; html: string }) {
  try {
    const result = await sendChariotEmail({ purpose: email.purpose, to: [email.to], replyTo: email.replyTo, subject: email.subject, html: email.html });
    await markDelivery(approvalId, result.status === "sent" ? "sent" : "disabled");
  } catch (error) {
    await markDelivery(approvalId, "failed", error instanceof Error ? error.message : "Delivery failed");
    logger.warn({ err: error, approvalId }, "Approval email was not delivered");
  }
}

async function closeResponseTasks(caseId: number, kind: ApprovalKind, completedByUserId: number | null = null) {
  await db
    .update(tasksTable)
    .set({ status: "done", completedAt: new Date(), completedByUserId })
    .where(and(eq(tasksTable.caseId, caseId), eq(tasksTable.kind, responseTaskKind(kind)), ne(tasksTable.status, "done")));
}

export class AdviceError extends Error {}

/**
 * Record the client's answer however it arrived, tick the matching
 * requirement, close the waiting task and hand the next step to the stage
 * owner. Idempotent: an already-answered approval is returned unchanged.
 */
export async function respondToApproval(
  row: ApprovalRow,
  answer: { response: "approved" | "discuss"; via: "email" | "portal" | "staff"; note?: string | null; actor?: { id: number; displayName: string } | null },
) {
  if (row.respondedAt) return { row, alreadyRecorded: true as const };
  const [updated] = await db
    .update(clientApprovalsTable)
    .set({
      response: answer.response,
      respondedAt: new Date(),
      respondedVia: answer.via,
      note: answer.note?.trim() || null,
      recordedByUserId: answer.actor?.id ?? null,
    })
    .where(and(eq(clientApprovalsTable.id, row.id), isNull(clientApprovalsTable.respondedAt)))
    .returning();
  if (!updated) {
    const [current] = await db.select().from(clientApprovalsTable).where(eq(clientApprovalsTable.id, row.id));
    return { row: current ?? row, alreadyRecorded: true as const };
  }
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, row.id === updated.id ? updated.caseId : row.caseId));
  if (!caseRow) return { row: updated, alreadyRecorded: false as const };
  const client = await clientFor(caseRow);
  const kind: ApprovalKind = "advice";
  const reference = refOf(caseRow);
  const stageIndex = ADVICE_STAGE_INDEX;
  const label = ADVICE_APPROVED_LABEL;
  const what = "the advice";
  const viaText = answer.via === "email" ? "by email link" : answer.via === "portal" ? "in the portal" : `— recorded by ${answer.actor?.displayName ?? "staff"}`;
  const actorName = answer.via === "staff" ? (answer.actor?.displayName ?? "Staff") : (client?.name ?? "Client");

  if (answer.response === "approved") {
    await setRequirement(caseRow.id, stageIndex, label, true, client?.name ?? "Client");
  }
  await db.insert(activitiesTable).values({
    caseId: caseRow.id,
    title: answer.response === "approved" ? "Client approved advice" : "Client asked to discuss the advice",
    detail: `${reference}: ${client?.name ?? "the client"} ${answer.response === "approved" ? "approved" : "asked to discuss"} ${what} ${viaText}${updated.note ? ` — "${updated.note}"` : ""}`,
    actorName,
  });
  await closeResponseTasks(caseRow.id, kind, answer.actor?.id ?? null);

  // The next move belongs to the stage owner: proceed, or pick up the discussion.
  const owner = await resolveAssignee({ section: stageSection(stageIndex), fallbackRole: stageOwnerRole[stageIndex] });
  if (owner.ok) {
    await createAssignmentTask({
      staffUser: owner.staffUser,
      title: answer.response === "approved"
        ? `Advice approved — proceed with ${reference}`
        : `Client wants to discuss the advice — ${reference}`,
      notes: updated.note?.trim() || (answer.response === "approved"
        ? `${client?.name ?? "The client"} approved ${what} ${viaText}.`
        : `${client?.name ?? "The client"} asked to discuss ${what} ${viaText}. Contact them, then re-send.`),
      caseId: caseRow.id,
      clientId: caseRow.clientId,
      kind: "stage_handoff",
      stageIndex,
      dueDate: addDays(answer.response === "approved" ? 2 : 1),
    }).catch((error) => logger.warn({ err: error, caseId: caseRow.id }, "Follow-up task was not created"));
  }
  return { row: updated, alreadyRecorded: false as const };
}

/** The email link: one row per token, usable while unanswered and unexpired. */
export async function approvalByToken(token: string): Promise<ApprovalRow | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [row] = await db.select().from(clientApprovalsTable).where(eq(clientApprovalsTable.tokenHash, tokenHash));
  return row ?? null;
}

export async function approvalForCase(caseId: number, approvalId: number): Promise<ApprovalRow | null> {
  const [row] = await db
    .select()
    .from(clientApprovalsTable)
    .where(and(eq(clientApprovalsTable.id, approvalId), eq(clientApprovalsTable.caseId, caseId)));
  return row ?? null;
}

/** Everything the stage-0 panel needs. */
export async function adviceState(caseRow: CaseRow) {
  const advice = await getAdviceRow(caseRow.id);
  const approvals = await listApprovals(caseRow.id, "advice");
  const latest = approvals[0] ?? null;
  const missing = adviceMissing(caseRow, advice);
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, caseRow.clientId));
  return {
    advice: await adviceView(caseRow.id, advice),
    approvals,
    latest,
    needsAdvice: needsAdvice(caseRow.serviceType),
    mode: needsAdvice(caseRow.serviceType) ? ("advice" as const) : ("instruction" as const),
    instructionRecorded: instructionRecorded(advice),
    termsOfBusiness: await caseTermsAcceptance(caseRow.id),
    serviceLevelConfirmedAt: iso(caseRow.serviceLevelConfirmedAt),
    serviceLevelConfirmedBy: await displayNameFor(caseRow.serviceLevelConfirmedByUserId),
    readyToSend: missing.length === 0 && needsAdvice(caseRow.serviceType),
    missing,
  };
}

/** Unanswered, unexpired requests for several cases at once (portal listing). */
export async function pendingApprovalsFor(caseIds: number[]) {
  if (caseIds.length === 0) return new Map<number, Awaited<ReturnType<typeof approvalView>>[]>();
  const rows = await db
    .select()
    .from(clientApprovalsTable)
    .where(and(
      inArray(clientApprovalsTable.caseId, caseIds),
      isNull(clientApprovalsTable.respondedAt),
      sql`${clientApprovalsTable.expiresAt} > now()`,
    ))
    .orderBy(asc(clientApprovalsTable.sentAt));
  const map = new Map<number, Awaited<ReturnType<typeof approvalView>>[]>();
  for (const row of rows) {
    const list = map.get(row.caseId) ?? [];
    list.push(await approvalView(row));
    map.set(row.caseId, list);
  }
  return map;
}
