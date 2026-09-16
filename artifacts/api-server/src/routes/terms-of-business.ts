import express, { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  AcceptClientTermsBody,
  AcceptClientTermsParams,
  AcceptClientTermsResponse,
  GetTermsOfBusinessResponse,
  UploadTermsOfBusinessResponse,
} from "@workspace/api-zod";
import { clientsTable, db } from "@workspace/db";
import { requireStaff } from "../auth/session";
import { isFullAccess } from "../auth/roles";
import { acceptTerms, getTermsDocument, publishTermsDocument, readTermsDocument, termsDocumentView } from "../services/terms-of-business";
import { clientDetailView } from "./operations";

const router: IRouter = Router();
router.use(requireStaff);

router.get("/settings/terms-of-business", async (_req, res): Promise<void> => {
  res.json(GetTermsOfBusinessResponse.parse({ document: termsDocumentView(await getTermsDocument()) }));
});

/** Administrator only: publish / replace the firm-wide PDF. Body is the file; name and type come in headers. */
router.put("/settings/terms-of-business", express.raw({ type: "*/*", limit: "25mb" }), async (req, res): Promise<void> => {
  if (!isFullAccess(res.locals.authUser.role)) {
    res.status(403).json({ error: "Only an administrator can publish the Terms of Business" });
    return;
  }
  const filename = (req.header("x-filename") ?? "terms-of-business.pdf").replace(/[\r\n\\/]/g, "_").slice(0, 255);
  const contentType = (req.header("x-content-type") ?? req.header("content-type") ?? "").split(";")[0].toLowerCase();
  if (contentType !== "application/pdf" || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: "Upload the Terms of Business as a PDF" });
    return;
  }
  const doc = await publishTermsDocument(req.body, filename, contentType, res.locals.authUser.id, res.locals.authUser.displayName);
  res.json(UploadTermsOfBusinessResponse.parse({ document: termsDocumentView(doc) }));
});

router.get("/settings/terms-of-business/document", async (_req, res): Promise<void> => {
  const found = await readTermsDocument();
  if (!found) {
    res.status(404).json({ error: "No Terms of Business document is published" });
    return;
  }
  res.setHeader("Content-Type", found.doc.contentType);
  res.setHeader("Content-Disposition", `inline; filename="${found.doc.filename.replace(/[\r\n\\"]/g, "_")}"`);
  res.send(found.bytes);
});

/** Staff record acceptance given outside the portal: a signed copy received, or agreed by phone. */
router.post("/clients/:id/terms-of-business/accept", async (req, res): Promise<void> => {
  const params = AcceptClientTermsParams.safeParse(req.params);
  const body = AcceptClientTermsBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [client] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.id, params.data.id));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const updated = await acceptTerms(client.id, {
    via: body.data.via,
    note: body.data.note ?? null,
    actor: { id: res.locals.authUser.id, displayName: res.locals.authUser.displayName },
  });
  res.json(AcceptClientTermsResponse.parse(await clientDetailView(updated!)));
});

export default router;
