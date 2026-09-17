import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  DiscardCaseTermsOfBusinessResponse,
  GetCaseTermsOfBusinessParams,
  GetCaseTermsOfBusinessResponse,
  GetTermsOfBusinessResponse,
  MarkCaseTermsOfBusinessSignedBody,
  MarkCaseTermsOfBusinessSignedResponse,
  MockSignCaseTermsOfBusinessBody,
  MockSignCaseTermsOfBusinessResponse,
  PreviewCaseTermsOfBusinessBody,
  PreviewTermsOfBusinessBody,
  PublishTermsOfBusinessBody,
  PublishTermsOfBusinessResponse,
  RefreshCaseTermsOfBusinessResponse,
  SaveCaseTermsOfBusinessBody,
  SaveCaseTermsOfBusinessResponse,
  SendCaseTermsOfBusinessBody,
  SendCaseTermsOfBusinessResponse,
  TestDocusignConnectionResponse,
  DisconnectDocusignResponse,
  VoidCaseTermsOfBusinessBody,
  VoidCaseTermsOfBusinessResponse,
} from "@workspace/api-zod";
import { casesTable, db } from "@workspace/db";
import { requireStaff } from "../auth/session";
import { isFullAccess } from "../auth/roles";
import { logger } from "../lib/logger";
import {
  beginConnection,
  completeConnection,
  disconnectDocusign,
  mockSignature,
  signatureConfig,
  signatureMode,
  testDocusignConnection,
} from "../integrations/docusign";
import {
  AUTO_TOKENS,
  DEFAULT_TEMPLATE,
  getTermsTemplate,
  listTermsTemplates,
  publishTermsTemplate,
  SAMPLE_AUTO_VALUES,
  sampleFieldValues,
  termsTemplateView,
  validateTemplateInput,
} from "../services/terms-template";
import { renderTermsPdf } from "../services/terms-pdf";
import {
  AgreementError,
  agreementState,
  discardAgreementDraft,
  latestAgreement,
  markAgreementSigned,
  previewAgreement,
  readAgreementDocument,
  saveAgreementDraft,
  sendAgreement,
  syncAgreement,
  TERMS_SIGNED_LABEL,
  voidAgreement,
} from "../services/terms-agreements";
import { ADVICE_STAGE_INDEX, DETAILS_STAGE_INDEX, ensureRequirement } from "../services/case-advice";

const router: IRouter = Router();
router.use(requireStaff);

// ---------------------------------------------------------------------------
// Settings: the firm's template

const termsState = async () => {
  const versions = await listTermsTemplates();
  const config = await signatureConfig();
  return {
    template: termsTemplateView(versions[0] ?? null),
    versions: versions.map((template) => termsTemplateView(template)),
    placeholders: AUTO_TOKENS.map((item) => ({ token: item.token, description: item.description, group: item.group, sample: SAMPLE_AUTO_VALUES[item.token] })),
    defaults: DEFAULT_TEMPLATE,
    signature: { ...config, missing: [...config.missing] },
  };
};

const sendPdf = (res: Response, bytes: Buffer, filename: string) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/[\r\n\\"]/g, "_")}"`);
  res.send(bytes);
};

const requireAdmin = (req: Request, res: Response, what: string) => {
  if (isFullAccess(res.locals.authUser.role)) return true;
  res.status(403).json({ error: `Only an administrator can ${what}` });
  return false;
};

router.get("/settings/terms-of-business", async (_req, res): Promise<void> => {
  res.json(GetTermsOfBusinessResponse.parse(await termsState()));
});

router.put("/settings/terms-of-business", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res, "publish the Terms of Business template")) return;
  const body = PublishTermsOfBusinessBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid template" });
    return;
  }
  try {
    await publishTermsTemplate(body.data, res.locals.authUser.id, res.locals.authUser.displayName);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "The template could not be published" });
    return;
  }
  res.json(PublishTermsOfBusinessResponse.parse(await termsState()));
});

/** A sample render of an unsaved template. Uses the next version number so the footer reads right. */
router.post("/settings/terms-of-business/preview", async (req, res): Promise<void> => {
  const body = PreviewTermsOfBusinessBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid template" });
    return;
  }
  let input;
  try {
    input = validateTemplateInput(body.data);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid template" });
    return;
  }
  const current = await getTermsTemplate();
  const version = (current?.version ?? 0) + 1;
  const bytes = await renderTermsPdf({
    ...input,
    version,
    auto: { ...SAMPLE_AUTO_VALUES, templateVersion: String(version) },
    values: sampleFieldValues(input.fields),
    signerName: SAMPLE_AUTO_VALUES.clientName,
  });
  sendPdf(res, bytes, `${input.title}-preview.pdf`);
});

/** `?version=N` renders a published version with sample values; a bad value falls back to the current one. */
router.get("/settings/terms-of-business/document", async (req, res): Promise<void> => {
  const parsed = typeof req.query.version === "string" ? Number.parseInt(req.query.version, 10) : NaN;
  const template = await getTermsTemplate(Number.isInteger(parsed) && parsed > 0 ? parsed : undefined);
  if (!template) {
    res.status(404).json({ error: "No Terms of Business template is published" });
    return;
  }
  const bytes = await renderTermsPdf({
    title: template.title,
    body: template.body,
    fields: template.fields,
    version: template.version,
    auto: { ...SAMPLE_AUTO_VALUES, templateVersion: String(template.version) },
    values: sampleFieldValues(template.fields),
    signerName: SAMPLE_AUTO_VALUES.clientName,
  });
  sendPdf(res, bytes, `${template.title}-v${template.version}-sample.pdf`);
});

// ---------------------------------------------------------------------------
// DocuSign: the administrator signs in to the firm's account

const STATE_COOKIE = "chariot_docusign_state";
const settingsUrl = (query: string) => `${(process.env.PORTAL_URL ?? "").replace(/\/$/, "")}/settings?tab=terms-of-business&${query}`;

/** Browser navigation: remember a nonce in a short-lived cookie and send the admin to DocuSign. */
router.get("/settings/docusign/connect", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res, "connect DocuSign")) return;
  try {
    const { state, verifier, url } = beginConnection();
    res.cookie(STATE_COOKIE, `${state}.${verifier}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true", maxAge: 10 * 60 * 1000, path: "/api/settings/docusign" });
    res.redirect(url);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "DocuSign is not set up" });
  }
});

/** DocuSign sends the admin back here; the session cookie is still theirs, so the admin check applies. */
router.get("/settings/docusign/callback", async (req, res): Promise<void> => {
  const back = (query: string) => res.redirect(settingsUrl(query));
  if (!isFullAccess(res.locals.authUser.role)) {
    back("docusign=error&reason=" + encodeURIComponent("Only an administrator can connect DocuSign"));
    return;
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const [expected, verifier] = ((req.cookies as Record<string, string | undefined>)[STATE_COOKIE] ?? "").split(".");
  res.clearCookie(STATE_COOKIE, { path: "/api/settings/docusign" });
  if (typeof req.query.error === "string") {
    back("docusign=error&reason=" + encodeURIComponent(String(req.query.error_description ?? req.query.error)));
    return;
  }
  if (!code || !state || !expected || !verifier || state !== expected) {
    back("docusign=error&reason=" + encodeURIComponent("The sign-in did not come back the way it left (state mismatch) — try again"));
    return;
  }
  try {
    const connected = await completeConnection(code, verifier, res.locals.authUser.id);
    logger.info({ account: connected.accountName, email: connected.email }, "DocuSign connected");
    back("docusign=connected");
  } catch (error) {
    back("docusign=error&reason=" + encodeURIComponent(error instanceof Error ? error.message : "DocuSign sign-in failed"));
  }
});

router.post("/settings/docusign/disconnect", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res, "disconnect DocuSign")) return;
  await disconnectDocusign();
  const config = await signatureConfig();
  res.json(DisconnectDocusignResponse.parse({ ...config, missing: [...config.missing] }));
});

router.post("/settings/terms-of-business/docusign/test", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res, "test the DocuSign connection")) return;
  res.json(TestDocusignConnectionResponse.parse(await testDocusignConnection()));
});

// ---------------------------------------------------------------------------
// Per case: fill, send, track

async function loadCase(req: Request, res: Response) {
  const params = GetCaseTermsOfBusinessParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid case id" });
    return null;
  }
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return null;
  }
  // Cases opened before the requirement existed pick it up while still in the opening stages.
  if (caseRow.stageIndex <= DETAILS_STAGE_INDEX) await ensureRequirement(caseRow.id, ADVICE_STAGE_INDEX, TERMS_SIGNED_LABEL);
  return caseRow;
}

const actorOf = (res: Response) => ({ id: res.locals.authUser.id as number, displayName: res.locals.authUser.displayName as string });

const fail = (res: Response, error: unknown) => {
  if (error instanceof AgreementError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  throw error;
};

router.get("/cases/:id/terms-of-business", async (req, res): Promise<void> => {
  const caseRow = await loadCase(req, res);
  if (!caseRow) return;
  res.json(GetCaseTermsOfBusinessResponse.parse(await agreementState(caseRow)));
});

router.put("/cases/:id/terms-of-business", async (req, res): Promise<void> => {
  const caseRow = await loadCase(req, res);
  if (!caseRow) return;
  const body = SaveCaseTermsOfBusinessBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid values" });
    return;
  }
  try {
    await saveAgreementDraft(caseRow, body.data.values, res.locals.authUser.id);
  } catch (error) {
    fail(res, error);
    return;
  }
  res.json(SaveCaseTermsOfBusinessResponse.parse(await agreementState(caseRow)));
});

router.delete("/cases/:id/terms-of-business", async (req, res): Promise<void> => {
  const caseRow = await loadCase(req, res);
  if (!caseRow) return;
  await discardAgreementDraft(caseRow.id);
  res.json(DiscardCaseTermsOfBusinessResponse.parse(await agreementState(caseRow)));
});

router.post("/cases/:id/terms-of-business/preview", async (req, res): Promise<void> => {
  const caseRow = await loadCase(req, res);
  if (!caseRow) return;
  const body = PreviewCaseTermsOfBusinessBody.safeParse(req.body ?? {});
  try {
    const preview = await previewAgreement(caseRow, body.success ? body.data.values : null);
    sendPdf(res, preview.bytes, preview.filename);
  } catch (error) {
    fail(res, error);
  }
});

router.post("/cases/:id/terms-of-business/send", async (req, res): Promise<void> => {
  const caseRow = await loadCase(req, res);
  if (!caseRow) return;
  const body = SendCaseTermsOfBusinessBody.safeParse(req.body ?? {});
  try {
    await sendAgreement(caseRow, actorOf(res), body.success ? body.data.values : undefined);
  } catch (error) {
    fail(res, error);
    return;
  }
  res.json(SendCaseTermsOfBusinessResponse.parse(await agreementState(caseRow)));
});

router.get("/cases/:id/terms-of-business/document", async (req, res): Promise<void> => {
  const caseRow = await loadCase(req, res);
  if (!caseRow) return;
  const latest = await latestAgreement(caseRow.id);
  const found = latest ? await readAgreementDocument(latest) : null;
  if (!found) {
    res.status(404).json({ error: "No Terms of Business document has been generated for this case yet" });
    return;
  }
  sendPdf(res, found.bytes, found.filename);
});

router.post("/cases/:id/terms-of-business/refresh", async (req, res): Promise<void> => {
  const caseRow = await loadCase(req, res);
  if (!caseRow) return;
  const latest = await latestAgreement(caseRow.id);
  try {
    if (latest) await syncAgreement(latest);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "DocuSign did not answer" });
    return;
  }
  res.json(RefreshCaseTermsOfBusinessResponse.parse(await agreementState(caseRow)));
});

router.post("/cases/:id/terms-of-business/void", async (req, res): Promise<void> => {
  const caseRow = await loadCase(req, res);
  if (!caseRow) return;
  const body = VoidCaseTermsOfBusinessBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Give a reason" });
    return;
  }
  const latest = await latestAgreement(caseRow.id);
  try {
    if (!latest) throw new AgreementError("Nothing has been sent yet");
    await voidAgreement(latest, body.data.reason, actorOf(res));
  } catch (error) {
    fail(res, error);
    return;
  }
  res.json(VoidCaseTermsOfBusinessResponse.parse(await agreementState(caseRow)));
});

router.post("/cases/:id/terms-of-business/mark-signed", async (req, res): Promise<void> => {
  const caseRow = await loadCase(req, res);
  if (!caseRow) return;
  const body = MarkCaseTermsOfBusinessSignedBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    await markAgreementSigned(caseRow, { via: body.data.via, note: body.data.note ?? null, documentId: body.data.documentId ?? null }, actorOf(res));
  } catch (error) {
    fail(res, error);
    return;
  }
  res.json(MarkCaseTermsOfBusinessSignedResponse.parse(await agreementState(caseRow)));
});

/** Development only: stands in for the client signing (or declining) in DocuSign. */
router.post("/cases/:id/terms-of-business/mock-sign", async (req, res): Promise<void> => {
  if (signatureMode() !== "mock") {
    res.status(404).json({ error: "Only available with DOCUSIGN_MOCK=true" });
    return;
  }
  const caseRow = await loadCase(req, res);
  if (!caseRow) return;
  const body = MockSignCaseTermsOfBusinessBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const latest = await latestAgreement(caseRow.id);
  if (!latest || latest.status !== "sent" || !latest.envelopeId) {
    res.status(409).json({ error: "Nothing is out for signature" });
    return;
  }
  if (body.data.outcome === "signed") mockSignature.sign(latest.envelopeId);
  else if (body.data.outcome === "bounced") mockSignature.bounce(latest.envelopeId);
  else mockSignature.decline(latest.envelopeId, body.data.reason?.trim() || "Declined in the mock");
  await syncAgreement(latest);
  res.json(MockSignCaseTermsOfBusinessResponse.parse(await agreementState(caseRow)));
});

export default router;
