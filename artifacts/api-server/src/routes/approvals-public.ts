import { Router, type IRouter } from "express";
import { RespondApprovalByTokenBody, RespondApprovalByTokenParams, RespondApprovalByTokenResponse } from "@workspace/api-zod";
import { casesTable, clientsTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { approvalByToken, respondToApproval } from "../services/case-advice";

const router: IRouter = Router();

/**
 * The one-click answer from an email button. No session: the token in the
 * link is the credential, it works once, and it expires with the request.
 */
router.post("/approvals/:token", async (req, res): Promise<void> => {
  const params = RespondApprovalByTokenParams.safeParse(req.params);
  const body = RespondApprovalByTokenBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid approval link" });
    return;
  }
  const row = await approvalByToken(params.data.token);
  if (!row) {
    res.status(404).json({ error: "This link is not valid" });
    return;
  }
  if (!row.respondedAt && row.expiresAt.getTime() < Date.now()) {
    res.status(404).json({ error: "This link has expired — please ask your adviser to send it again" });
    return;
  }
  const result = await respondToApproval(row, { response: body.data.response, via: "email" });
  const [caseRow] = await db.select({ clientId: casesTable.clientId }).from(casesTable).where(eq(casesTable.id, row.caseId));
  const [client] = caseRow
    ? await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, caseRow.clientId))
    : [];
  res.json(RespondApprovalByTokenResponse.parse({
    status: result.alreadyRecorded ? "already_recorded" : "recorded",
    kind: row.kind,
    firstName: client?.name.trim().split(/\s+/)[0] ?? "",
  }));
});

export default router;
