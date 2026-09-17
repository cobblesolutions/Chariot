import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { InboundClientEnquiryBody, InboundClientEnquiryResponse } from "@workspace/api-zod";
import { activitiesTable, clientsTable, db, propertiesTable } from "@workspace/db";
import { recordEnquiry } from "../services/client-enquiries";
import { logger } from "../lib/logger";
import { resolveAssignee } from "../services/assignment";
import { ensureClientOnboarding } from "../services/client-onboarding";
import { createEnquiryReviewTask, findClientMatches, recordRepeatEnquiry } from "../services/clients";
import { extractEnquiry } from "../services/enquiry-extraction";

const router: IRouter = Router();

/**
 * Forward-in enquiries. An email provider (or a mailbox rule) posts the
 * message here as JSON; the shared secret in `x-enquiry-inbound-secret` is the
 * only authentication, so the endpoint is disabled until the secret is set.
 */
router.post("/clients/inbound", async (req, res): Promise<void> => {
  const secret = process.env.ENQUIRY_INBOUND_SECRET;
  if (!secret) {
    res.status(503).json({ error: "Inbound enquiries are not configured" });
    return;
  }
  const provided = req.header("x-enquiry-inbound-secret") ?? "";
  const expected = Buffer.from(secret);
  const given = Buffer.from(provided);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    res.status(401).json({ error: "Invalid inbound secret" });
    return;
  }
  const body = InboundClientEnquiryBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { extracted, model } = await extractEnquiry({
    emailText: body.data.text,
    subject: body.data.subject ?? null,
    from: body.data.from ?? null,
  });

  // A known sender is a repeat enquiry, never a duplicate client.
  const [existing] = await findClientMatches({ email: extracted.client.email });
  if (existing && existing.reason === "email") {
    await recordRepeatEnquiry(existing.client, {
      emailText: body.data.text,
      subject: body.data.subject ?? null,
      from: body.data.from ?? null,
      extracted,
    }, { displayName: "Inbound email" });
    res.status(202).json(InboundClientEnquiryResponse.parse({ outcome: "repeat", clientId: existing.client.id }));
    return;
  }

  if (!extracted.client.email) {
    res.status(400).json({ error: "No sender email address could be read from the message" });
    return;
  }
  const assignee = await resolveAssignee({ section: "client" });
  const [created] = await db.insert(clientsTable).values({
    name: extracted.client.name ?? extracted.client.email,
    email: extracted.client.email,
    phone: extracted.client.phone ?? "",
    companyName: extracted.client.companyName ?? "",
    companyNumber: extracted.client.companyNumber ?? null,
    onboardingStatus: "not_started",
    lifecycle: "enquiry",
    source: "email",
    assignedUserId: assignee.ok ? assignee.staffUser?.id ?? null : null,
    enquiryType: extracted.enquiry.type,
    enquirySummary: extracted.enquiry.summary,
    enquiryTimescale: extracted.enquiry.timescale,
    enquiryEmailText: body.data.text,
    enquiryEmailSubject: body.data.subject ?? null,
    enquiryEmailFrom: body.data.from ?? null,
    enquiryExtracted: extracted,
    enquiryExtractionModel: model,
  }).returning();
  if (!created) {
    res.status(500).json({ error: "Enquiry was not created" });
    return;
  }
  await ensureClientOnboarding(created.id);
  await recordEnquiry(created.id, {
    source: "email",
    enquiryType: extracted.enquiry.type,
    summary: extracted.enquiry.summary,
    timescale: extracted.enquiry.timescale,
    emailFrom: body.data.from ?? null,
    emailSubject: body.data.subject ?? null,
    emailText: body.data.text,
    extracted,
    extractionModel: model,
  });
  const property = extracted.property;
  if (property.address || property.value || property.loanAmount) {
    await db.insert(propertiesTable).values({
      clientId: created.id,
      address: property.address ?? "Address to confirm",
      matterType: property.matterType ?? "Unspecified",
      value: property.value ?? 0,
      loanAmount: property.loanAmount ?? 0,
      rent: property.rent ?? null,
    });
  }
  await db.insert(activitiesTable).values({
    title: "Enquiry received",
    detail: created.enquirySummary
      ? `${created.name}: ${created.enquirySummary}`
      : `${created.name} sent an enquiry by email`,
    actorName: "Inbound email",
    entityType: "client",
    entityId: created.id,
  });
  await createEnquiryReviewTask(created, assignee)
    .catch((error) => logger.warn({ err: error, clientId: created.id }, "Enquiry review task was not created"));
  res.status(202).json(InboundClientEnquiryResponse.parse({ outcome: "created", clientId: created.id }));
});

export default router;
