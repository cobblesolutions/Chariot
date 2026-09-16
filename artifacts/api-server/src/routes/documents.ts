import express, { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as api from "@workspace/api-zod";
import { activitiesTable, caseSubmissionsTable, casesTable, db, documentsTable, requirementsTable } from "@workspace/db";
import { requireStaff } from "../auth/session";
import { documentStorage } from "../services/document-storage";
import { syncClientOnboardingDocument } from "../services/client-onboarding";
import { syncCaseChecklists, syncClientChecklists } from "../services/task-checklists";

const router: IRouter = Router();
const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/tiff", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain", "text/csv", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/aac", "audio/x-m4a"]);
const safeName = (name: string) => name.replace(/[\r\n\\/]/g, "_").slice(0, 255) || "document";
function validMime(value: string) { return allowed.has(value.toLowerCase()) && !/(executable|javascript|x-msdownload|x-sh)/i.test(value); }
function view(row: typeof documentsTable.$inferSelect) { return { id: row.id, name: row.name, category: row.category, status: row.status, clientId: row.clientId, caseId: row.caseId, contentType: row.contentType, byteSize: row.byteSize, uploadedAt: row.uploadedAt?.toISOString() ?? null }; }
async function upload(req: any, res: any, clientOnly = false) {
  const clientId = Number(req.header("x-client-id")); const caseIdValue = req.header("x-case-id"); const category = req.header("x-document-category") ?? "general"; const filename = safeName(req.header("x-filename") ?? "upload"); const contentType = (req.header("x-content-type") ?? req.header("content-type") ?? "").split(";")[0];
  if (!Number.isInteger(clientId) || clientId < 1 || !validMime(contentType) || !Buffer.isBuffer(req.body)) { res.status(400).json({ error: "Valid client id, filename and business document MIME type are required" }); return; }
  if (clientOnly && res.locals.portalClientId !== clientId) { res.status(403).json({ error: "Document client does not match portal account" }); return; }
  const caseId = caseIdValue ? Number(caseIdValue) : null;
  if (caseId) {
    const [caseRow] = await db.select({ clientId: casesTable.clientId }).from(casesTable).where(eq(casesTable.id, caseId));
    if (caseRow?.clientId !== clientId) { res.status(409).json({ error: "Selected case does not belong to the selected client" }); return; }
  }
  // A per-lender document (e.g. a DIP) is pinned to that lender's submission.
  const submissionIdValue = req.header("x-submission-id");
  let submissionId: number | null = submissionIdValue ? Number(submissionIdValue) : null;
  if (submissionId) {
    const [submission] = await db.select({ caseId: caseSubmissionsTable.caseId }).from(caseSubmissionsTable).where(eq(caseSubmissionsTable.id, submissionId));
    if (!submission || submission.caseId !== caseId) { res.status(409).json({ error: "Selected submission does not belong to the selected case" }); return; }
  } else if (caseId && category === "DIP") {
    // No submission named: attach the DIP to the case's primary submission so the per-lender view sees it.
    const [primary] = await db.select({ id: caseSubmissionsTable.id }).from(caseSubmissionsTable)
      .where(and(eq(caseSubmissionsTable.caseId, caseId), eq(caseSubmissionsTable.isPrimary, true))).limit(1);
    submissionId = primary?.id ?? null;
  }
  try {
    const stored = await documentStorage.put(req.body);
    const [row] = await db.insert(documentsTable).values({ clientId, caseId, submissionId, name: filename, category, status: "uploaded", objectPath: stored.key, contentType, byteSize: stored.size, uploadedByUserId: res.locals.authUser.id, uploadedAt: new Date() }).returning();
    await db.insert(activitiesTable).values({ caseId: row!.caseId, title: "Document uploaded", detail: `${row!.name} (${documentStorage.publicReference(stored.key)})`, actorName: res.locals.authUser.displayName, entityType: "document", entityId: row!.id });
    if (row?.caseId && category === "LENDER_OFFER") {
      await db.update(requirementsTable)
        .set({ complete: true, completedAt: new Date() })
        .where(and(
          eq(requirementsTable.caseId, row.caseId),
          eq(requirementsTable.stageIndex, 5),
          eq(requirementsTable.label, "Lender offer uploaded"),
        ));
    }
    await syncClientOnboardingDocument(clientId, category, res.locals.authUser.id);
    await syncClientChecklists(clientId);
    if (caseId) await syncCaseChecklists(caseId);
    res.status(201).json(api.UploadDocumentResponse.parse(view(row!)));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Document upload failed" });
  }
}
router.use(requireStaff);
router.get("/documents", async (req, res) => {
  const q = api.ListDocumentsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  let propertyCaseIds: number[] | null = null;
  if (q.data.propertyId) {
    const rows = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.propertyId, q.data.propertyId));
    propertyCaseIds = rows.map((r) => r.id);
  }
  const filters = [
    q.data.clientId ? eq(documentsTable.clientId, q.data.clientId) : undefined,
    q.data.caseId ? eq(documentsTable.caseId, q.data.caseId) : undefined,
    propertyCaseIds ? (propertyCaseIds.length ? inArray(documentsTable.caseId, propertyCaseIds) : sql`false`) : undefined,
    q.data.category ? eq(documentsTable.category, q.data.category) : undefined,
    q.data.status ? eq(documentsTable.status, q.data.status) : undefined,
  ].filter(Boolean) as any[];
  const rows = await db.select().from(documentsTable).where(filters.length ? and(...filters) : undefined).orderBy(desc(documentsTable.uploadedAt));
  res.json(api.ListDocumentsResponse.parse(rows.map(view)));
});
router.post("/documents", async (req, res): Promise<void> => { const b = api.CreateDocumentMetadataBody.safeParse(req.body); if (!b.success) { res.status(400).json({ error: b.error.message }); return; } if (b.data.caseId) { const [caseRow] = await db.select({ clientId: casesTable.clientId }).from(casesTable).where(eq(casesTable.id, b.data.caseId)); if (caseRow?.clientId !== b.data.clientId) { res.status(409).json({ error: "Selected case does not belong to the selected client" }); return; } } const [row] = await db.insert(documentsTable).values({ ...b.data, caseId: b.data.caseId ?? null, status: b.data.status ?? "required" }).returning(); res.status(201).json(api.CreateDocumentMetadataResponse.parse(view(row!))); });
router.post("/documents/upload", express.raw({ type: "*/*", limit: "50mb" }), (req, res) => upload(req, res));
router.patch("/documents/:id", async (req, res): Promise<void> => { const p = api.UpdateDocumentParams.safeParse(req.params), b = api.UpdateDocumentBody.safeParse(req.body); if (!p.success || !b.success) { res.status(400).json({ error: "Invalid document update" }); return; } const [row] = await db.update(documentsTable).set(b.data).where(eq(documentsTable.id, p.data.id)).returning(); if (!row) { res.status(404).json({ error: "Document not found" }); return; } res.json(api.UpdateDocumentResponse.parse(view(row))); });
 async function serveDocument(req: any, res: any, disposition: "inline" | "attachment") { const id = Number(req.params.id); const [row] = await db.select().from(documentsTable).where(eq(documentsTable.id, id)); if (!row || !row.objectPath) { res.status(404).json({ error: "Document not found" }); return; } try { const bytes = await documentStorage.get(row.objectPath); res.setHeader("Content-Type", row.contentType ?? "application/octet-stream"); res.setHeader("Content-Disposition", `${disposition}; filename="${safeName(row.name).replace(/"/g, "")}"`); res.send(bytes); } catch { res.status(404).json({ error: "Document object not found" }); } }
 router.get("/documents/:id/view", (req, res) => serveDocument(req, res, "inline"));
 router.get("/documents/:id/download", (req, res) => serveDocument(req, res, "attachment"));
router.delete("/documents/:id", async (req, res) => { const id = Number(req.params.id); const [row] = await db.delete(documentsTable).where(eq(documentsTable.id, id)).returning(); if (!row) { res.status(404).json({ error: "Document not found" }); return; } if (row.objectPath) await documentStorage.delete(row.objectPath); await syncClientOnboardingDocument(row.clientId, row.category, res.locals.authUser.id); await syncClientChecklists(row.clientId); if (row.caseId) await syncCaseChecklists(row.caseId); res.status(204).end(); });
export default router;