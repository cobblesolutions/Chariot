import express, { Router, type IRouter } from "express";
import { desc, and, eq, ne } from "drizzle-orm";
import {
  ListPortalCasesResponse,
  ListPortalDocumentsResponse,
  ListPortalPropertiesResponse,
  RespondPortalApprovalBody,
  RespondPortalApprovalParams,
  RespondPortalApprovalResponse,
  GetPortalCaseTermsOfBusinessParams,
  GetPortalCaseTermsOfBusinessResponse,
  UpdatePortalPropertyBody,
  UpdatePortalPropertyParams,
  UpdatePortalPropertyResponse,
  UpdatePortalOnboardingItemBody,
  UpdatePortalOnboardingItemParams,
} from "@workspace/api-zod";
import {
  casesTable,
  clientsTable,
  appUsersTable,
  clientPortalUsersTable,
  db,
  documentsTable,
  lendersTable,
  propertiesTable,
} from "@workspace/db";
import { requireAuthenticated } from "../auth/session";
import { documentStorage } from "../services/document-storage";
import { queueDocumentReading } from "../services/document-reading";
import { getClientOnboarding, syncClientOnboardingDocument, updateClientOnboardingItem } from "../services/client-onboarding";
import { STAGES } from "../services/stages";
import { approvalForCase, approvalView, pendingApprovalsFor, respondToApproval } from "../services/case-advice";
import { syncCaseChecklists } from "../services/task-checklists";
import { latestAgreement, portalTermsView, readAgreementDocument } from "../services/terms-agreements";

const router: IRouter = Router();
router.use(requireAuthenticated);

async function portalClientId(userId: number) {
  const [link] = await db.select().from(clientPortalUsersTable)
    .where(eq(clientPortalUsersTable.userId, userId));
  if (link?.clientId) return link.clientId;

  // Keep older client accounts usable if their explicit portal link was not
  // created during activation.
  const [user] = await db.select({ email: appUsersTable.email })
    .from(appUsersTable)
    .where(eq(appUsersTable.id, userId));
  if (!user?.email) return undefined;
  const [client] = await db.select({ id: clientsTable.id })
    .from(clientsTable)
    .where(eq(clientsTable.email, user.email));
  return client?.id;
}

/**
 * What a client may see of their own case: progress, key dates and anything
 * waiting for their answer. Fees, internal notes and lender correspondence
 * stay staff-only.
 */
router.get("/portal/cases", async (_req, res): Promise<void> => {
  const user = res.locals.authUser;
  if (user.role !== "client") {
    res.status(403).json({ error: "Client portal access required" });
    return;
  }
  const clientId = await portalClientId(user.id);
  if (!clientId) {
    res.status(403).json({ error: "Client account is not linked" });
    return;
  }
  const rows = await db.select().from(casesTable)
    .where(and(eq(casesTable.clientId, clientId), ne(casesTable.status, "completed")))
    .orderBy(desc(casesTable.updatedAt));
  const pending = await pendingApprovalsFor(rows.map((row) => row.id));
  const views = await Promise.all(rows.map(async (row) => {
    const [lender] = row.lenderId
      ? await db.select({ name: lendersTable.name }).from(lendersTable).where(eq(lendersTable.id, row.lenderId))
      : [];
    const stageIndex = row.stageIndex >= STAGES.length ? STAGES.length - 1 : row.stageIndex;
    return {
      id: row.id,
      reference: row.displayReference || row.reference,
      propertyAddress: row.propertyAddress,
      matterType: row.matterType,
      serviceType: row.serviceType,
      stage: STAGES[stageIndex]!,
      stageIndex,
      stages: [...STAGES],
      status: row.status,
      loanAmount: row.loanAmount,
      propertyValue: row.propertyValue,
      updatedAt: row.updatedAt.toISOString(),
      skippedStageIndexes: (row.skippedStageIndexes as number[] | null) ?? [],
      lenderName: lender?.name ?? null,
      valuationDate: row.valuationDate ? row.valuationDate.toISOString() : null,
      expectedCompletionDate: row.expectedCompletionDate ? row.expectedCompletionDate.toISOString() : null,
      pendingApprovals: pending.get(row.id) ?? [],
      termsOfBusiness: await portalTermsView(row.id),
    };
  }));
  res.json(ListPortalCasesResponse.parse(views));
});

/** The client approves, or asks to discuss, advice or submission details sent to them. */
router.post("/portal/approvals/:id/respond", async (req, res): Promise<void> => {
  const user = res.locals.authUser;
  const clientId = user.role === "client" ? await portalClientId(user.id) : undefined;
  const params = RespondPortalApprovalParams.safeParse(req.params);
  const body = RespondPortalApprovalBody.safeParse(req.body);
  if (!clientId) {
    res.status(403).json({ error: "Client portal access required" });
    return;
  }
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid response" });
    return;
  }
  // The approval must belong to one of this client's cases.
  const ownCases = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.clientId, clientId));
  let row = null;
  for (const item of ownCases) {
    row = await approvalForCase(item.id, params.data.id);
    if (row) break;
  }
  if (!row) {
    res.status(404).json({ error: "Nothing to approve" });
    return;
  }
  if (!row.respondedAt && row.expiresAt.getTime() < Date.now()) {
    res.status(409).json({ error: "This request has expired — your adviser will send it again" });
    return;
  }
  const result = await respondToApproval(row, { response: body.data.response, via: "portal", note: body.data.note });
  if (result.alreadyRecorded) {
    res.status(409).json({ error: "Your answer was already recorded" });
    return;
  }
  await syncCaseChecklists(row.caseId);
  res.json(RespondPortalApprovalResponse.parse(await approvalView(result.row)));
});

/** A case the signed-in client owns, or null (403 already sent). */
async function portalCase(req: express.Request, res: express.Response) {
  const user = res.locals.authUser;
  const clientId = user.role === "client" ? await portalClientId(user.id) : undefined;
  if (!clientId) {
    res.status(403).json({ error: "Client portal access required" });
    return null;
  }
  const params = GetPortalCaseTermsOfBusinessParams.safeParse(req.params);
  const [caseRow] = params.success
    ? await db.select().from(casesTable).where(and(eq(casesTable.id, params.data.id), eq(casesTable.clientId, clientId)))
    : [];
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return null;
  }
  return caseRow;
}

/** Where the case's Terms of Business are: waiting for the client's signature (DocuSign emails them) or signed. */
router.get("/portal/cases/:id/terms-of-business", async (req, res): Promise<void> => {
  const caseRow = await portalCase(req, res);
  if (!caseRow) return;
  res.json(GetPortalCaseTermsOfBusinessResponse.parse(await portalTermsView(caseRow.id)));
});

/** The client reads their own copy — the signed one once it exists, otherwise the document as sent. */
router.get("/portal/cases/:id/terms-of-business/document", async (req, res): Promise<void> => {
  const caseRow = await portalCase(req, res);
  if (!caseRow) return;
  const latest = await latestAgreement(caseRow.id);
  const found = latest ? await readAgreementDocument(latest, true) : null;
  if (!found) {
    res.status(404).json({ error: "The Terms of Business have not been sent yet" });
    return;
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${found.filename.replace(/[\r\n\\"]/g, "_")}"`);
  res.send(found.bytes);
});

router.get("/portal/documents", async (_req, res): Promise<void> => {
  const user = res.locals.authUser;
  if (user.role !== "client") {
    res.status(403).json({ error: "Client portal access required" });
    return;
  }
  const clientId = await portalClientId(user.id);
  if (!clientId) { res.status(403).json({ error: "Client account is not linked" }); return; }
  const rows = await db.select().from(documentsTable).where(eq(documentsTable.clientId, clientId));
  // Object keys, local paths, bucket names, and uploader identities are never exposed.
  res.json(ListPortalDocumentsResponse.parse(rows.map((item) => ({
    id: item.id, name: item.name, category: item.category, status: item.status,
  }))));
});

router.get("/portal/properties", async (_req, res): Promise<void> => {
  const user = res.locals.authUser;
  if (user.role !== "client") {
    res.status(403).json({ error: "Client portal access required" });
    return;
  }
  const clientId = await portalClientId(user.id);
  if (!clientId) {
    res.status(403).json({ error: "Client account is not linked" });
    return;
  }
  const rows = await db.select().from(propertiesTable)
    .where(eq(propertiesTable.clientId, clientId))
    .orderBy(desc(propertiesTable.updatedAt));
  res.json(ListPortalPropertiesResponse.parse(rows));
});

router.patch("/portal/properties/:id", async (req, res): Promise<void> => {
  const user = res.locals.authUser;
  if (user.role !== "client") {
    res.status(403).json({ error: "Client portal access required" });
    return;
  }
  const clientId = await portalClientId(user.id);
  const params = UpdatePortalPropertyParams.safeParse(req.params);
  const body = UpdatePortalPropertyBody.safeParse(req.body);
  if (!clientId) {
    res.status(403).json({ error: "Client account is not linked" });
    return;
  }
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid property update" });
    return;
  }
  const [updated] = await db.update(propertiesTable).set({
    address: body.data.address,
    city: body.data.city?.trim() || null,
    postcode: body.data.postcode?.trim() || null,
    matterType: body.data.matterType,
    value: body.data.value,
    loanAmount: body.data.loanAmount,
    rent: body.data.rent ?? null,
    gdv: body.data.gdv ?? null,
  }).where(and(
    eq(propertiesTable.id, params.data.id),
    eq(propertiesTable.clientId, clientId),
  )).returning();
  if (!updated) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  res.json(UpdatePortalPropertyResponse.parse(updated));
});

router.get("/portal/onboarding", async (_req, res): Promise<void> => {
  const user = res.locals.authUser;
  const clientId = user.role === "client" ? await portalClientId(user.id) : undefined;
  if (!clientId) {
    res.status(403).json({ error: "Client portal access required" });
    return;
  }
  res.json(await getClientOnboarding(clientId));
});

router.patch("/portal/onboarding/:key", async (req, res): Promise<void> => {
  const user = res.locals.authUser;
  const clientId = user.role === "client" ? await portalClientId(user.id) : undefined;
  const params = UpdatePortalOnboardingItemParams.safeParse(req.params);
  const body = UpdatePortalOnboardingItemBody.safeParse(req.body);
  if (!clientId || !params.success || !body.success) {
    res.status(clientId ? 400 : 403).json({ error: clientId ? "Invalid onboarding update" : "Client portal access required" });
    return;
  }
  try {
    const updated = await updateClientOnboardingItem({
      clientId,
      key: params.data.key,
      value: body.data.value,
      status: body.data.status,
      actorUserId: user.id,
      allowNotApplicable: false,
    });
    if (!updated) {
      res.status(404).json({ error: "Onboarding item not found" });
      return;
    }
    res.json(await getClientOnboarding(clientId));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Onboarding update failed" });
  }
});

async function servePortalDocument(req: any, res: any, disposition: "inline" | "attachment") {
  const user = res.locals.authUser; const clientId = user.role === "client" ? await portalClientId(user.id) : undefined;
  const id = Number(req.params.id); const [document] = Number.isInteger(id) ? await db.select().from(documentsTable).where(eq(documentsTable.id, id)) : [];
  if (!clientId || !document || document.clientId !== clientId || !document.objectPath) { res.status(404).json({ error: "Document not found" }); return; }
  try {
    res.setHeader("Content-Type", document.contentType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `${disposition}; filename="${document.name.replace(/[\r\n\\"]/g, "_")}"`);
    res.send(await documentStorage.get(document.objectPath));
  } catch {
    res.status(404).json({ error: "Document object not found" });
  }
}

router.get("/portal/documents/:id/view", async (req, res): Promise<void> => {
  await servePortalDocument(req, res, "inline");
});

router.get("/portal/documents/:id/download", async (req, res): Promise<void> => {
  await servePortalDocument(req, res, "attachment");
});

router.post("/portal/documents/upload", express.raw({ type: "*/*", limit: "50mb" }), async (req, res): Promise<void> => {
  const user = res.locals.authUser;
  const clientId = user.role === "client" ? await portalClientId(user.id) : undefined;
  const name = (req.header("x-filename") ?? "").replace(/[\r\n\\/]/g, "_").slice(0, 255);
  const category = req.header("x-document-category") ?? "general";
  const contentType = (req.header("x-content-type") ?? req.header("content-type") ?? "").split(";")[0].toLowerCase();
  const permitted = new Set(["application/pdf", "image/jpeg", "image/png", "image/tiff", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain", "text/csv"]);
  if (!clientId || !name || !permitted.has(contentType) || !Buffer.isBuffer(req.body)) { res.status(400).json({ error: "A filename and permitted business document MIME type are required" }); return; }
  try {
    const stored = await documentStorage.put(req.body);
    const [document] = await db.insert(documentsTable).values({ clientId, name, category, status: "uploaded", objectPath: stored.key, contentType, byteSize: stored.size, uploadedByUserId: user.id, uploadedAt: new Date() }).returning();
    await syncClientOnboardingDocument(clientId, category, user.id);
    queueDocumentReading(document!.id, "Client portal");
    const api = await import("@workspace/api-zod");
    res.status(201).json(api.UploadPortalDocumentResponse.parse({ id: document!.id, name: document!.name, category: document!.category, status: document!.status, clientId, caseId: null, contentType, byteSize: stored.size, uploadedAt: document!.uploadedAt!.toISOString() }));
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Document upload failed" }); }
});

export default router;
