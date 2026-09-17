import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  appUsersTable,
  casesTable,
  caseTermsAgreementsTable,
  clientsTable,
  db,
  documentsTable,
  type TermsAgreementStatus,
  type TermsSignedVia,
} from "@workspace/db";
import { documentStorage } from "./document-storage";
import { logActivity } from "./activities";
import { logger } from "../lib/logger";
import { signatureClient, signatureConfig, type EnvelopeState } from "../integrations/docusign";
import { renderTermsPdf } from "./terms-pdf";
import {
  autoValuesFor,
  cleanFieldValues,
  defaultFieldValues,
  FIRM_NAME,
  getTermsTemplate,
  missingFieldLabels,
  termsTemplateView,
  type TermsTemplate,
} from "./terms-template";

/**
 * A case's Terms of Business: staff fill the template's fields, the document
 * is generated and sent for signature, and when the signature comes back the
 * signed copy is filed in the case and the stage requirement ticked — with no
 * one having to mark anything. One row per attempt; the newest is current.
 * Every case signs its own terms; nothing is recorded on the client.
 */

export type AgreementRow = typeof caseTermsAgreementsTable.$inferSelect;
type CaseRow = typeof casesTable.$inferSelect;
type ClientRow = typeof clientsTable.$inferSelect;

/** Document category the signed copy is filed under. */
export const TERMS_DOCUMENT_CATEGORY = "terms_business";
/** Stage-0 requirement the signature ticks (see routes/operations.ts stageRequirements). */
export const TERMS_SIGNED_LABEL = "Terms of Business signed";
/** `envelopeStatus` when DocuSign reports the email bounced (the row stays `sent`). */
export const DELIVERY_FAILED = "delivery_failed";
/** After this long unsigned, the alerts page flags the request. */
export const SIGNATURE_WAIT_DAYS = 5;

export class AgreementError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 503 = 409) {
    super(message);
  }
}

const OPEN: TermsAgreementStatus[] = ["draft", "sent"];

export async function latestAgreement(caseId: number) {
  const [row] = await db
    .select()
    .from(caseTermsAgreementsTable)
    .where(eq(caseTermsAgreementsTable.caseId, caseId))
    .orderBy(desc(caseTermsAgreementsTable.createdAt), desc(caseTermsAgreementsTable.id))
    .limit(1);
  return row ?? null;
}

async function clientOf(caseRow: CaseRow) {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, caseRow.clientId));
  if (!client) throw new AgreementError("The case's client no longer exists", 404);
  return client;
}

async function displayNames(ids: Array<number | null | undefined>) {
  const wanted = [...new Set(ids.filter((id): id is number => id != null))];
  if (!wanted.length) return new Map<number, string>();
  const rows = await db.select({ id: appUsersTable.id, displayName: appUsersTable.displayName }).from(appUsersTable).where(inArray(appUsersTable.id, wanted));
  return new Map(rows.map((row) => [row.id, row.displayName]));
}

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

export async function agreementView(row: AgreementRow) {
  const names = await displayNames([row.sentByUserId, row.voidedByUserId, row.signedByUserId]);
  return {
    id: row.id,
    caseId: row.caseId,
    status: row.status,
    templateVersion: row.templateVersion,
    values: row.values,
    filename: row.filename,
    hasDocument: !!row.objectPath,
    provider: row.provider,
    envelopeId: row.envelopeId,
    envelopeStatus: row.envelopeStatus,
    lastCheckedAt: iso(row.lastCheckedAt),
    recipientName: row.recipientName,
    recipientEmail: row.recipientEmail,
    sentAt: iso(row.sentAt),
    sentBy: row.sentByUserId != null ? names.get(row.sentByUserId) ?? null : null,
    signedAt: iso(row.signedAt),
    signedVia: row.signedVia,
    signedNote: row.signedNote,
    signedBy: row.signedByUserId != null ? names.get(row.signedByUserId) ?? null : null,
    signedDocumentId: row.signedDocumentId,
    declinedAt: iso(row.declinedAt),
    declineReason: row.declineReason,
    voidedAt: iso(row.voidedAt),
    voidReason: row.voidReason,
    voidedBy: row.voidedByUserId != null ? names.get(row.voidedByUserId) ?? null : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const HOW: Record<TermsSignedVia, string> = {
  docusign: "Signed via DocuSign",
  signed_upload: "Signed copy received",
  staff: "Recorded by staff",
};

/** The short acceptance summary other views carry (case detail, advice state): null until signed. */
export async function caseTermsAcceptance(caseId: number) {
  const latest = await latestAgreement(caseId);
  if (!latest || latest.status !== "signed" || !latest.signedAt) return null;
  const names = await displayNames([latest.signedByUserId]);
  return {
    signedAt: latest.signedAt.toISOString(),
    via: latest.signedVia ?? "staff",
    version: latest.templateVersion,
    note: latest.signedNote,
    signedBy: latest.signedByUserId != null ? names.get(latest.signedByUserId) ?? null : null,
    signedDocumentId: latest.signedDocumentId,
  };
}

/** What the client sees in their portal for a case: nothing sent, waiting for their signature, or signed. */
export async function portalTermsView(caseId: number) {
  const latest = await latestAgreement(caseId);
  const shown = latest && latest.status !== "draft" ? latest : null;
  const template = shown ? await getTermsTemplate(shown.templateVersion) : null;
  return {
    status: shown?.status ?? null,
    title: template?.title ?? null,
    version: shown?.templateVersion ?? null,
    sentAt: iso(shown?.sentAt),
    signedAt: iso(shown?.signedAt),
    hasDocument: !!(shown?.objectPath || shown?.signedDocumentId),
    provider: shown?.provider ?? null,
  };
}

export function termsAcceptanceText(acceptance: Awaited<ReturnType<typeof caseTermsAcceptance>>, currentVersion?: number | null) {
  if (!acceptance) return null;
  const when = new Date(acceptance.signedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const newer = currentVersion != null && currentVersion > acceptance.version ? ` · current template is v${currentVersion}` : "";
  return `${HOW[acceptance.via as TermsSignedVia] ?? HOW.staff} · ${when} · v${acceptance.version}${newer}`;
}

/**
 * Everything the case's Terms of Business section needs. The template shown
 * is the version the current agreement was generated from (so a sent document
 * keeps matching its fields); a fresh draft uses the current version.
 */
export async function agreementState(caseRow: CaseRow) {
  const client = await clientOf(caseRow);
  const current = await getTermsTemplate();
  const latest = await latestAgreement(caseRow.id);
  const template = latest && latest.templateVersion !== current?.version ? await getTermsTemplate(latest.templateVersion) ?? current : current;
  const fields = template?.fields ?? [];
  const values = latest ? { ...defaultFieldValues(fields), ...latest.values } : defaultFieldValues(fields);
  const auto = template ? await autoValuesFor(caseRow, client, template.version) : {};
  const history = await db
    .select()
    .from(caseTermsAgreementsTable)
    .where(eq(caseTermsAgreementsTable.caseId, caseRow.id))
    .orderBy(desc(caseTermsAgreementsTable.createdAt), desc(caseTermsAgreementsTable.id));
  const config = await signatureConfig();
  return {
    template: termsTemplateView(template),
    currentVersion: current?.version ?? null,
    agreement: latest ? await agreementView(latest) : null,
    history: await Promise.all(history.filter((row) => row.id !== latest?.id).map((row) => agreementView(row))),
    values,
    auto,
    missing: template ? missingFieldLabels(fields, values) : [],
    acceptance: await caseTermsAcceptance(caseRow.id),
    recipient: { name: client.name, email: client.email },
    signature: { mode: config.mode, configured: config.configured, missing: config.missing },
  };
}

/** Saves the field values on the open draft, starting a new one when the last attempt ended (declined / voided) or none exists. */
export async function saveAgreementDraft(caseRow: CaseRow, rawValues: Record<string, unknown>, actorUserId: number) {
  const latest = await latestAgreement(caseRow.id);
  if (latest && (latest.status === "sent" || latest.status === "signed")) {
    throw new AgreementError(latest.status === "sent" ? "The document is out for signature — void it before changing the details" : "The Terms of Business for this case are already signed");
  }
  const template = latest?.status === "draft" ? await getTermsTemplate(latest.templateVersion) ?? await getTermsTemplate() : await getTermsTemplate();
  if (!template) throw new AgreementError("Publish a Terms of Business template in Settings first", 409);
  let values: Record<string, string>;
  try {
    values = cleanFieldValues(template.fields, rawValues);
  } catch (error) {
    throw new AgreementError(error instanceof Error ? error.message : "Invalid values", 400);
  }
  if (latest?.status === "draft") {
    const [row] = await db
      .update(caseTermsAgreementsTable)
      .set({ values, templateVersion: template.version })
      .where(eq(caseTermsAgreementsTable.id, latest.id))
      .returning();
    return row!;
  }
  const [row] = await db
    .insert(caseTermsAgreementsTable)
    .values({ caseId: caseRow.id, clientId: caseRow.clientId, templateVersion: template.version, values, status: "draft", createdByUserId: actorUserId })
    .returning();
  return row!;
}

/** Discards the open draft so the section goes back to a blank form. */
export async function discardAgreementDraft(caseId: number) {
  const latest = await latestAgreement(caseId);
  if (!latest || latest.status !== "draft") return;
  if (latest.objectPath) await documentStorage.delete(latest.objectPath).catch(() => undefined);
  await db.delete(caseTermsAgreementsTable).where(eq(caseTermsAgreementsTable.id, latest.id));
}

async function renderFor(caseRow: CaseRow, client: ClientRow, template: TermsTemplate, values: Record<string, string>) {
  return renderTermsPdf({
    title: template.title,
    body: template.body,
    fields: template.fields,
    version: template.version,
    auto: await autoValuesFor(caseRow, client, template.version),
    values,
    signerName: client.name,
  });
}

const safeName = (name: string) => name.replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "case";
const agreementFilename = (caseRow: CaseRow, template: TermsTemplate) =>
  `${safeName(template.title)}-${safeName(caseRow.displayReference?.trim() || caseRow.reference)}-v${template.version}.pdf`;

/** The document as it would be sent with the given values — nothing is stored. */
export async function previewAgreement(caseRow: CaseRow, rawValues: Record<string, unknown> | null) {
  const client = await clientOf(caseRow);
  const latest = await latestAgreement(caseRow.id);
  const template = latest?.status === "draft" ? await getTermsTemplate(latest.templateVersion) ?? await getTermsTemplate() : await getTermsTemplate();
  if (!template) throw new AgreementError("Publish a Terms of Business template in Settings first", 409);
  let values: Record<string, string>;
  try {
    values = rawValues ? cleanFieldValues(template.fields, rawValues) : { ...defaultFieldValues(template.fields), ...(latest?.values ?? {}) };
  } catch (error) {
    throw new AgreementError(error instanceof Error ? error.message : "Invalid values", 400);
  }
  return { bytes: await renderFor(caseRow, client, template, values), filename: agreementFilename(caseRow, template) };
}

const caseRef = (caseRow: CaseRow) => caseRow.displayReference?.trim() || caseRow.reference;

/**
 * Generates the document from the saved values and sends it to the client for
 * signature. The row moves to `sent` with the envelope id; from here the
 * webhook / poll (`syncAgreement`) drives it.
 */
export async function sendAgreement(caseRow: CaseRow, actor: { id: number; displayName: string }, rawValues?: Record<string, unknown>) {
  const provider = signatureClient();
  if (!provider) throw new AgreementError("DocuSign is not connected — set DOCUSIGN_ACTIVE=true with the integration credentials (see Settings → Terms of Business)", 503);
  const config = await signatureConfig();
  if (!config.configured) throw new AgreementError(`DocuSign is missing ${config.missing.join(", ")}`, 503);
  const client = await clientOf(caseRow);
  if (!client.email?.trim()) throw new AgreementError("The client needs an email address to receive the signature request", 400);

  let draft = await latestAgreement(caseRow.id);
  if (draft?.status === "signed") throw new AgreementError("The Terms of Business for this case are already signed");
  if (draft?.status === "sent") throw new AgreementError("A document is already out for signature — resend it, or void it to start again");
  if (rawValues || !draft || draft.status !== "draft") draft = await saveAgreementDraft(caseRow, rawValues ?? draft?.values ?? {}, actor.id);
  const template = await getTermsTemplate(draft.templateVersion);
  if (!template) throw new AgreementError("The template version this draft used no longer exists", 409);
  const missing = missingFieldLabels(template.fields, draft.values);
  if (missing.length) throw new AgreementError(`Fill in ${missing.join(", ")} before sending`, 400);

  const pdf = await renderFor(caseRow, client, template, draft.values);
  const stored = await documentStorage.put(pdf);
  const filename = agreementFilename(caseRow, template);
  let envelopeId: string;
  try {
    ({ envelopeId } = await provider.createEnvelope({
      pdf,
      documentName: `${template.title} — ${caseRef(caseRow)}`,
      signer: { name: client.name, email: client.email },
      emailSubject: `Please sign: ${template.title} — ${FIRM_NAME} (${caseRef(caseRow)})`,
      emailMessage: `Dear ${client.name.trim().split(/\s+/)[0] || client.name},\n\nPlease review and sign the attached ${template.title} for ${caseRow.propertyAddress} so we can proceed with your case. If anything is unclear, reply to ${actor.displayName} before signing.\n\n${FIRM_NAME}`,
    }));
  } catch (error) {
    await documentStorage.delete(stored.key).catch(() => undefined);
    throw new AgreementError(error instanceof Error ? error.message : "DocuSign rejected the envelope", 503);
  }
  const [row] = await db
    .update(caseTermsAgreementsTable)
    .set({
      status: "sent",
      objectPath: stored.key,
      filename,
      byteSize: stored.size,
      provider: provider.mode === "mock" ? "docusign_mock" : "docusign",
      envelopeId,
      envelopeStatus: "sent",
      recipientName: client.name,
      recipientEmail: client.email,
      sentAt: new Date(),
      sentByUserId: actor.id,
      lastCheckedAt: new Date(),
    })
    .where(eq(caseTermsAgreementsTable.id, draft.id))
    .returning();
  await logActivity({
    kind: "terms",
    title: "Terms of Business sent for signature",
    detail: `${caseRef(caseRow)}: ${template.title} v${template.version} sent to ${client.email}${provider.mode === "mock" ? " (mock DocuSign)" : " via DocuSign"}`,
    actorName: actor.displayName,
    caseId: caseRow.id,
  });
  return row!;
}

/** The unsigned PDF that was sent, or the signed copy once filed when `signed` is asked for. */
export async function readAgreementDocument(row: AgreementRow, signed = false) {
  if (signed && row.signedDocumentId) {
    const [document] = await db.select().from(documentsTable).where(eq(documentsTable.id, row.signedDocumentId));
    if (document?.objectPath) return { bytes: await documentStorage.get(document.objectPath), filename: document.name };
  }
  if (!row.objectPath) return null;
  return { bytes: await documentStorage.get(row.objectPath), filename: row.filename ?? "terms-of-business.pdf" };
}

/** Files the signed copy in the case's documents. */
async function fileSignedCopy(row: AgreementRow, bytes: Buffer, uploadedByUserId: number | null) {
  const stored = await documentStorage.put(bytes);
  const [document] = await db
    .insert(documentsTable)
    .values({
      clientId: row.clientId,
      caseId: row.caseId,
      name: (row.filename ?? "terms-of-business.pdf").replace(/\.pdf$/i, "") + "-signed.pdf",
      category: TERMS_DOCUMENT_CATEGORY,
      status: "uploaded",
      objectPath: stored.key,
      contentType: "application/pdf",
      byteSize: stored.size,
      uploadedByUserId,
      uploadedAt: new Date(),
    })
    .returning();
  return document!.id;
}

/** What happens after any signature: the stage requirement ticks and the case checklist refreshes. */
async function afterSigned(row: AgreementRow, by: string) {
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, row.caseId));
  if (!caseRow) return;
  // Loaded here, not at the top: case-advice imports this file for the acceptance view.
  const { ADVICE_STAGE_INDEX, setRequirement } = await import("./case-advice");
  await setRequirement(caseRow.id, ADVICE_STAGE_INDEX, TERMS_SIGNED_LABEL, true, by);
  const { syncCaseChecklists } = await import("./task-checklists");
  await syncCaseChecklists(caseRow.id).catch((error) => logger.warn({ err: error, caseId: caseRow.id }, "Checklist sync after signature failed"));
}

/**
 * DocuSign completed the envelope: file the signed copy, mark the row signed.
 * Idempotent — a second completion event changes nothing.
 */
async function completeAgreement(row: AgreementRow, state: EnvelopeState, signedPdf: Buffer | null) {
  const bytes = signedPdf ?? (row.objectPath ? await documentStorage.get(row.objectPath) : null);
  let signedDocumentId = row.signedDocumentId;
  if (bytes && !signedDocumentId) signedDocumentId = await fileSignedCopy(row, bytes, null);
  const signedAt = state.completedAt ? new Date(state.completedAt) : new Date();
  const [claimed] = await db
    .update(caseTermsAgreementsTable)
    .set({
      status: "signed",
      envelopeStatus: state.status,
      signedAt,
      signedVia: "docusign",
      signedNote: row.provider === "docusign_mock" ? "Mock DocuSign (development)" : null,
      signedDocumentId,
      lastCheckedAt: new Date(),
    })
    .where(and(eq(caseTermsAgreementsTable.id, row.id), inArray(caseTermsAgreementsTable.status, OPEN)))
    .returning();
  if (!claimed) return row;
  await logActivity({
    kind: "terms",
    title: "Terms of Business signed",
    detail: `${row.recipientName ?? "The client"} signed via DocuSign (v${row.templateVersion}); the signed copy is filed in the case`,
    actorName: row.recipientName ?? "Client",
    caseId: row.caseId,
  });
  await afterSigned(claimed, row.recipientName ?? "Client");
  return claimed;
}

/**
 * Staff fallback: the client signed on paper (upload the copy first) or
 * agreed in person. An envelope still out for signature is voided so a later
 * DocuSign completion cannot overwrite this record.
 */
export async function markAgreementSigned(
  caseRow: CaseRow,
  options: { via: Exclude<TermsSignedVia, "docusign">; note?: string | null; documentId?: number | null },
  actor: { id: number; displayName: string },
) {
  let latest = await latestAgreement(caseRow.id);
  if (latest?.status === "signed") throw new AgreementError("The Terms of Business for this case are already signed");
  if (latest?.status === "sent" && latest.envelopeId) {
    const provider = signatureClient();
    if (provider && (latest.provider === "docusign_mock") === (provider.mode === "mock")) {
      await provider.void(latest.envelopeId, "Signed outside DocuSign").catch((error) =>
        logger.warn({ err: error, envelopeId: latest?.envelopeId }, "Could not void the envelope after a manual signature"));
    }
  }
  if (!latest || latest.status === "declined" || latest.status === "voided") {
    const template = await getTermsTemplate();
    if (!template) throw new AgreementError("Publish a Terms of Business template in Settings first", 409);
    latest = await saveAgreementDraft(caseRow, {}, actor.id);
  }
  let signedDocumentId: number | null = null;
  if (options.documentId != null) {
    const [document] = await db.select({ id: documentsTable.id }).from(documentsTable)
      .where(and(eq(documentsTable.id, options.documentId), eq(documentsTable.caseId, caseRow.id)));
    if (!document) throw new AgreementError("That document is not on this case", 400);
    signedDocumentId = document.id;
  }
  const [row] = await db
    .update(caseTermsAgreementsTable)
    .set({
      status: "signed",
      signedAt: new Date(),
      signedVia: options.via,
      signedNote: options.note?.trim() || null,
      signedByUserId: actor.id,
      signedDocumentId,
      ...(latest.status === "sent" ? { envelopeStatus: "voided", voidedAt: new Date(), voidReason: "Signed outside DocuSign", voidedByUserId: actor.id } : {}),
    })
    .where(eq(caseTermsAgreementsTable.id, latest.id))
    .returning();
  await logActivity({
    kind: "terms",
    title: "Terms of Business signed",
    detail: `${caseRef(caseRow)}: ${HOW[options.via].toLowerCase()} (v${row!.templateVersion})${options.note?.trim() ? ` — ${options.note.trim()}` : ""}`,
    actorName: actor.displayName,
    caseId: caseRow.id,
  });
  await afterSigned(row!, actor.displayName);
  return row!;
}

/**
 * Reads the envelope from the provider and applies whatever changed. Both
 * the webhook and the poll come through here, so a forged webhook can at
 * most trigger a check — never a completion.
 */
export async function syncAgreement(row: AgreementRow): Promise<AgreementRow> {
  if (!row.envelopeId || row.status !== "sent") return row;
  const provider = signatureClient();
  if (!provider) return row;
  if ((row.provider === "docusign_mock") !== (provider.mode === "mock")) return row;
  const state = await provider.getEnvelope(row.envelopeId);
  if (state.status === "completed") {
    const signed = await provider.downloadSigned(row.envelopeId).catch((error) => {
      logger.warn({ err: error, envelopeId: row.envelopeId }, "Signed document download failed; filing the sent copy");
      return null;
    });
    return completeAgreement(row, state, signed);
  }
  if (state.status === "declined") {
    const [updated] = await db
      .update(caseTermsAgreementsTable)
      .set({ status: "declined", envelopeStatus: state.status, declinedAt: state.declinedAt ? new Date(state.declinedAt) : new Date(), declineReason: state.declineReason, lastCheckedAt: new Date() })
      .where(and(eq(caseTermsAgreementsTable.id, row.id), eq(caseTermsAgreementsTable.status, "sent")))
      .returning();
    if (updated) {
      await logActivity({
        kind: "terms",
        title: "Terms of Business declined",
        detail: `${row.recipientName ?? "The client"} declined to sign${state.declineReason ? `: ${state.declineReason}` : ""}`,
        actorName: row.recipientName ?? "Client",
        caseId: row.caseId,
      });
    }
    return updated ?? row;
  }
  if (state.status === "voided") {
    const [updated] = await db
      .update(caseTermsAgreementsTable)
      .set({ status: "voided", envelopeStatus: state.status, voidedAt: state.voidedAt ? new Date(state.voidedAt) : new Date(), voidReason: row.voidReason ?? state.voidReason, lastCheckedAt: new Date() })
      .where(and(eq(caseTermsAgreementsTable.id, row.id), eq(caseTermsAgreementsTable.status, "sent")))
      .returning();
    return updated ?? row;
  }
  // Still out. A bounced email is recorded as its own status so the alerts (and the case) can say so.
  const envelopeStatus = state.deliveryFailed ? DELIVERY_FAILED : state.status;
  const [updated] = await db
    .update(caseTermsAgreementsTable)
    .set({ envelopeStatus, lastCheckedAt: new Date() })
    .where(eq(caseTermsAgreementsTable.id, row.id))
    .returning();
  if (state.deliveryFailed && row.envelopeStatus !== DELIVERY_FAILED) {
    await logActivity({
      kind: "terms",
      title: "Terms of Business email bounced",
      detail: `DocuSign could not deliver the signature request to ${row.recipientEmail} — check the client's email address, void the request and send it again`,
      actorName: "DocuSign",
      caseId: row.caseId,
    });
  }
  return updated ?? row;
}

export async function voidAgreement(row: AgreementRow, reason: string, actor: { id: number; displayName: string }) {
  if (row.status !== "sent" || !row.envelopeId) throw new AgreementError("Only a document that is out for signature can be voided");
  const provider = signatureClient();
  if (!provider) throw new AgreementError("DocuSign is not connected", 503);
  const why = reason.trim() || "Withdrawn by the firm";
  await provider.void(row.envelopeId, why);
  const [updated] = await db
    .update(caseTermsAgreementsTable)
    .set({ status: "voided", envelopeStatus: "voided", voidedAt: new Date(), voidReason: why, voidedByUserId: actor.id, lastCheckedAt: new Date() })
    .where(eq(caseTermsAgreementsTable.id, row.id))
    .returning();
  await logActivity({
    kind: "terms",
    title: "Terms of Business signature request voided",
    detail: why,
    actorName: actor.displayName,
    caseId: row.caseId,
  });
  return updated!;
}

/** Webhook entry point: find the agreement for the envelope and sync it. Unknown envelopes are ignored. */
export async function syncAgreementByEnvelope(envelopeId: string) {
  const [row] = await db.select().from(caseTermsAgreementsTable).where(eq(caseTermsAgreementsTable.envelopeId, envelopeId)).limit(1);
  if (!row) return null;
  return syncAgreement(row);
}

const POLL_AFTER_MS = 10 * 60 * 1000;

/**
 * Safety net for the webhook (and the only path when the API has no public
 * URL): re-check every sent envelope not looked at in the last ten minutes.
 */
export async function pollSentAgreements() {
  if (!signatureClient()) return;
  const rows = await db
    .select()
    .from(caseTermsAgreementsTable)
    .where(and(
      eq(caseTermsAgreementsTable.status, "sent"),
      or(isNull(caseTermsAgreementsTable.lastCheckedAt), lt(caseTermsAgreementsTable.lastCheckedAt, new Date(Date.now() - POLL_AFTER_MS))),
    ))
    .limit(50);
  for (const row of rows) {
    await syncAgreement(row).catch((error) => logger.warn({ err: error, agreementId: row.id }, "Terms agreement poll failed"));
  }
}
