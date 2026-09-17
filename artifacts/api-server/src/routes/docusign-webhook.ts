import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { signatureMode, verifyWebhookSignature } from "../integrations/docusign";
import { syncAgreementByEnvelope } from "../services/terms-agreements";

const router: IRouter = Router();

/**
 * DocuSign Connect, envelope-level (set on each envelope we create). The body
 * only tells us which envelope changed; the status is re-read from DocuSign
 * before anything is filed, so the worst a forged call can do is trigger a
 * check. Mounted with the other public routes, ahead of the portal router.
 */
router.post("/webhooks/docusign", async (req, res): Promise<void> => {
  if (signatureMode() !== "docusign") {
    res.status(404).json({ error: "DocuSign is not active" });
    return;
  }
  const raw = (req as typeof req & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  if (!verifyWebhookSignature(raw, req.headers)) {
    logger.warn("DocuSign webhook rejected: HMAC did not match");
    res.status(401).json({ error: "Bad signature" });
    return;
  }
  const body = (req.body ?? {}) as { event?: string; data?: { envelopeId?: string }; envelopeId?: string };
  const envelopeId = body.data?.envelopeId ?? body.envelopeId;
  if (!envelopeId || typeof envelopeId !== "string") {
    res.status(400).json({ error: "No envelopeId" });
    return;
  }
  // Acknowledge first: DocuSign retries slow endpoints, and the sync talks back to DocuSign.
  res.status(200).json({ ok: true });
  try {
    const row = await syncAgreementByEnvelope(envelopeId);
    logger.info({ envelopeId, event: body.event, status: row?.status ?? "unknown envelope" }, "DocuSign webhook processed");
  } catch (error) {
    logger.error({ err: error, envelopeId }, "DocuSign webhook processing failed");
  }
});

export default router;
