import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  ConfirmCaseServiceLevelParams,
  ConfirmCaseServiceLevelResponse,
  GetCaseAdviceParams,
  GetCaseAdviceResponse,
  GetCaseSubmissionDetailsParams,
  GetCaseSubmissionDetailsResponse,
  PrefillCaseFromPreviousParams,
  PrefillCaseFromPreviousResponse,
  RecordCaseApprovalBody,
  RecordCaseApprovalParams,
  RecordCaseApprovalResponse,
  SendCaseAdviceParams,
  SendCaseAdviceResponse,
  UpdateCaseAdviceBody,
  UpdateCaseAdviceParams,
  UpdateCaseAdviceResponse,
  ExtractCaseInstructionBody,
  ExtractCaseInstructionParams,
  ExtractCaseInstructionResponse,
} from "@workspace/api-zod";
import { activitiesTable, casesTable, db } from "@workspace/db";
import { requireStaff } from "../auth/session";
import { isFullAccess } from "../auth/roles";
import {
  ADVICE_STAGE_INDEX,
  AdviceError,
  SERVICE_LEVEL_LABEL,
  adviceState,
  approvalForCase,
  approvalView,
  respondToApproval,
  saveAdvice,
  sendAdvice,
  setRequirement,
} from "../services/case-advice";
import { prefillFromPrevious, submissionDetailsState } from "../services/submission-details";
import { needsAdvice, serviceTypeLabel } from "../services/service-types";
import { extractInstruction } from "../services/instruction-extraction";
import { syncCaseChecklists } from "../services/task-checklists";
import { caseDetailView } from "./operations";

const router: IRouter = Router();
router.use(requireStaff);

async function loadCase(id: number) {
  const [row] = await db.select().from(casesTable).where(eq(casesTable.id, id));
  return row ?? null;
}

const actorOf = (res: Response) => ({
  id: res.locals.authUser.id as number,
  displayName: res.locals.authUser.displayName as string,
});

/** Step 5 — only the adviser (an administrator) confirms the level the case runs at. */
router.post("/cases/:id/service-level/confirm", async (req, res): Promise<void> => {
  if (!isFullAccess(res.locals.authUser.role)) {
    res.status(403).json({ error: "Only an administrator can confirm the service level" });
    return;
  }
  const params = ConfirmCaseServiceLevelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const caseRow = await loadCase(params.data.id);
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const actor = actorOf(res);
  const [updated] = await db
    .update(casesTable)
    .set({ serviceLevelConfirmedAt: new Date(), serviceLevelConfirmedByUserId: actor.id })
    .where(eq(casesTable.id, caseRow.id))
    .returning();
  await setRequirement(caseRow.id, ADVICE_STAGE_INDEX, SERVICE_LEVEL_LABEL, true, actor.displayName);
  await db.insert(activitiesTable).values({
    caseId: caseRow.id,
    title: "Service level confirmed",
    detail: `${caseRow.displayReference || caseRow.reference}: ${serviceTypeLabel(caseRow.serviceType)} confirmed by ${actor.displayName}`,
    actorName: actor.displayName,
  });
  await syncCaseChecklists(caseRow.id);
  res.json(ConfirmCaseServiceLevelResponse.parse(await caseDetailView(updated!)));
});

router.get("/cases/:id/advice", async (req, res): Promise<void> => {
  const params = GetCaseAdviceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const caseRow = await loadCase(params.data.id);
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.json(GetCaseAdviceResponse.parse(await adviceState(caseRow)));
});

router.put("/cases/:id/advice", async (req, res): Promise<void> => {
  const params = UpdateCaseAdviceParams.safeParse(req.params);
  const body = UpdateCaseAdviceBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid advice" });
    return;
  }
  const caseRow = await loadCase(params.data.id);
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  // Written advice is the adviser's (an administrator); an execution-only
  // instruction is the client's own choice and any staff member may record it.
  if (needsAdvice(caseRow.serviceType) && !isFullAccess(res.locals.authUser.role)) {
    res.status(403).json({ error: "Only an administrator can write the advice" });
    return;
  }
  await saveAdvice(caseRow.id, body.data, res.locals.authUser.id, caseRow);
  await syncCaseChecklists(caseRow.id);
  res.json(UpdateCaseAdviceResponse.parse(await adviceState(caseRow)));
});

/** Execution-only: read the client's instruction out of their email. Nothing is saved. */
router.post("/cases/:id/advice/extract", async (req, res): Promise<void> => {
  const params = ExtractCaseInstructionParams.safeParse(req.params);
  const body = ExtractCaseInstructionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid email text" });
    return;
  }
  const caseRow = await loadCase(params.data.id);
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.json(ExtractCaseInstructionResponse.parse(await extractInstruction(body.data.emailText)));
});

router.post("/cases/:id/advice/send", async (req, res): Promise<void> => {
  if (!isFullAccess(res.locals.authUser.role)) {
    res.status(403).json({ error: "Only an administrator can send the advice" });
    return;
  }
  const params = SendCaseAdviceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const caseRow = await loadCase(params.data.id);
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  try {
    await sendAdvice(caseRow, actorOf(res));
  } catch (error) {
    if (error instanceof AdviceError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
  await syncCaseChecklists(caseRow.id);
  res.json(SendCaseAdviceResponse.parse(await adviceState(caseRow)));
});

/** Any staff member records an answer the client gave by phone or reply. */
router.post("/cases/:id/approvals/:approvalId/record", async (req, res): Promise<void> => {
  const params = RecordCaseApprovalParams.safeParse(req.params);
  const body = RecordCaseApprovalBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid approval" });
    return;
  }
  const row = await approvalForCase(params.data.id, params.data.approvalId);
  if (!row) {
    res.status(404).json({ error: "Approval request not found" });
    return;
  }
  const result = await respondToApproval(row, { response: body.data.response, via: "staff", note: body.data.note, actor: actorOf(res) });
  if (result.alreadyRecorded) {
    res.status(409).json({ error: "The client's answer to this request was already recorded" });
    return;
  }
  await syncCaseChecklists(row.caseId);
  res.json(RecordCaseApprovalResponse.parse(await approvalView(result.row)));
});

router.get("/cases/:id/submission-details", async (req, res): Promise<void> => {
  const params = GetCaseSubmissionDetailsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const caseRow = await loadCase(params.data.id);
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.json(GetCaseSubmissionDetailsResponse.parse(await submissionDetailsState(caseRow)));
});

router.post("/cases/:id/prefill-from-previous", async (req, res): Promise<void> => {
  const params = PrefillCaseFromPreviousParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const caseRow = await loadCase(params.data.id);
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const result = await prefillFromPrevious(caseRow, actorOf(res));
  if (!result) {
    res.status(404).json({ error: "This client has no previous case to copy from" });
    return;
  }
  await syncCaseChecklists(caseRow.id);
  res.json(PrefillCaseFromPreviousResponse.parse(result));
});

export default router;
