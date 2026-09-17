import { Router, type IRouter, type RequestHandler } from "express";
import { requireStaff } from "../auth/session";
import { isFullAccess, isStaffRole, STAFF_ROLES } from "../auth/roles";
import {
  AddCaseRequirementBody,
  AddCaseRequirementResponse,
  AddUnderwritingRoundBody,
  AddUnderwritingRoundParams,
  AddUnderwritingRoundResponse,
  AdvanceCaseBody,
  AdvanceCaseParams,
  AdvanceCaseResponse,
  ArchiveCaseResponse,
  RestoreCaseResponse,
  CreateCaseBody,
  CreateCaseResponse,
  CreateCaseSubmissionBody,
  CreateCaseSubmissionParams,
  CreateCaseSubmissionResponse,
  DeleteCaseSubmissionParams,
  UpdateCaseSubmissionBody,
  UpdateCaseSubmissionParams,
  UpdateCaseSubmissionResponse,
  CreateClientBody,
  CreateClientResponse,
  CreateMessageBody,
  CreateMessageResponse,
  ExtractUnderwritingRequirementsBody,
  ExtractUnderwritingRequirementsParams,
  ExtractUnderwritingRequirementsResponse,
  ExtractCaseLenderOfferDetailsBody,
  ExtractCaseLenderOfferDetailsParams,
  ExtractCaseLenderOfferDetailsResponse,
  PrepareCaseCompletionParams,
  PrepareCaseCompletionResponse,
  GetCaseParams,
  GetCaseResponse,
  GetCaseLenderOfferReviewParams,
  GetCaseLenderOfferReviewResponse,
  GetCaseStressTestParams,
  GetCaseStressTestResponse,
  GetClientParams,
  GetClientResponse,
  GetDashboardResponse,
  GetIntegrationStatusResponse,
  ListActivitiesResponse,
  ListCalendarEventsResponse,
  ListCasesResponse,
  ListClientsResponse,
  ListClientsQueryParams,
  GetEmailTemplateParams,
  GetEmailTemplateResponse,
  UpdateEmailTemplateParams,
  UpdateEmailTemplateBody,
  UpdateEmailTemplateResponse,
  ResetEmailTemplateParams,
  ResetEmailTemplateResponse,
  PreviewEmailTemplateParams,
  PreviewEmailTemplateBody,
  PreviewEmailTemplateResponse,
  ExtractClientEnquiryBody,
  ExtractClientEnquiryResponse,
  FindClientMatchesBody,
  FindClientMatchesResponse,
  AcceptClientEnquiryParams,
  AcceptClientEnquiryResponse,
  DeclineClientEnquiryParams,
  DeclineClientEnquiryBody,
  DeclineClientEnquiryResponse,
  ReopenClientEnquiryParams,
  ReopenClientEnquiryResponse,
  RecordRepeatEnquiryParams,
  RecordRepeatEnquiryBody,
  RecordRepeatEnquiryResponse,
  ListDefaultAssigneesResponse,
  ListLendersResponse,
  ListMessagesResponse,
  ListStaffResponse,
  ListStageThresholdsResponse,
  UpdateCaseBody,
  SetCaseValuationCompletedParams,
  SetCaseValuationCompletedBody,
  SetCaseValuationCompletedResponse,
  UpdateCaseParams,
  UpdateCaseRequirementBody,
  UpdateCaseRequirementParams,
  UpdateCaseRequirementResponse,
  UpdateCaseResponse,
  UpdateCaseStressTestBody,
  UpdateCaseStressTestParams,
  UpdateCaseStressTestResponse,
  ReviewCaseLenderOfferBody,
  ReviewCaseLenderOfferParams,
  ReviewCaseLenderOfferResponse,
  UpdateClientBody,
  UpdateClientOnboardingItemBody,
  UpdateClientOnboardingItemParams,
  UpdateDefaultAssigneeBody,
  UpdateDefaultAssigneeParams,
  UpdateDefaultAssigneeResponse,
  UpdateStageThresholdBody,
  UpdateStageThresholdParams,
  UpdateStageThresholdResponse,
  MarkUnderwritingRoundSentParams,
  MarkUnderwritingRoundSentResponse,
} from "@workspace/api-zod";
import {
  activitiesTable,
  appUsersTable,
  calendarEventsTable,
  caseStageThresholdsTable,
  caseStressTestsTable,
  caseSubmissionsTable,
  casesTable,
  clientsTable,
  db,
  documentsTable,
  lenderOfferReviewsTable,
  lendersTable,
  messagesTable,
  propertiesTable,
  requirementsTable,
  renewalsTable,
  sectionDefaultAssigneesTable,
  tasksTable,
  underwritingRoundsTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import { sendChariotEmail } from "../integrations/resend";
import { renderChariotEmail } from "../integrations/email-template";
import { logger } from "../lib/logger";
import { ensureClientOnboarding, getClientOnboarding, updateClientOnboardingItem } from "../services/client-onboarding";
import { portfolioRequirementLabel, reconcileCasePortfolioRequirement } from "../services/case-portfolio-requirement";
import { documentStorage } from "../services/document-storage";
import { documentChecks, readingsForDocuments } from "../services/document-reading";
import { runOpenRouterWorkflow } from "../integrations/openrouter";
import { renewalReminderDates, syncRenewalCalendarEvents } from "../services/renewal-calendar";
import {
  DEFAULT_ASSIGNEE_SECTIONS,
  SUBMISSION_STEPS,
  activeStaffUser, activeStaffUserByName,
  configuredAssignee,
  createAssignmentTask,
  getDefaultAssignees,
  isDefaultAssigneeSection,
  resolveAssignee,
  stageSection,
  type DefaultAssigneeMap,
} from "../services/assignment";
import { markCompletionMirrorsDone, setValuationCompleted, syncCaseDate } from "../services/case-dates";
import { taskViews } from "../services/tasks";
import { STAGES, stageName, stageOwnerRole } from "../services/stages";
import { createUnderwritingRound, extractUnderwritingRequirements, markRoundSent, RoundIncompleteError, RoundStillOpenError, underwritingRoundsView } from "../services/underwriting";
import { classifyActivityTitle } from "../services/activity-kinds";
import { recordEnquiry } from "../services/client-enquiries";
import {
  CLIENT_PROFILE_KEYS,
  PROPERTY_DETAIL_KEYS,
  clientProfile,
  pickProvided,
  propertyDetails,
} from "../services/profile-fields";
import { syncCaseChecklists, syncClientChecklists } from "../services/task-checklists";
import {
  ADVANCED_CASE_KIND,
  ADVANCED_KINDS,
  EMPTY_CLIENT_EXTRAS,
  acceptClient,
  clientExtras,
  completeClientTasks,
  clientExtrasFor,
  clientView,
  createEnquiryReviewTask,
  declineClient,
  findClientMatches,
  recordRepeatEnquiry,
  reopenClient,
  resendWelcome,
} from "../services/clients";
import { extractEnquiry, type ExtractedEnquiry } from "../services/enquiry-extraction";
import {
  ADVICE_APPROVED_LABEL,
  ADVICE_SENT_LABEL,
  INSTRUCTION_LABEL,
  SERVICE_LEVEL_LABEL,
  adviceBlockHtml,
  displayNameFor,
  removeRequirement,
  setRequirement,
} from "../services/case-advice";
import { buildSubmissionPack } from "../services/submission-details";
import { TERMS_SIGNED_LABEL, caseTermsAcceptance } from "../services/terms-agreements";
import { needsAdvice, serviceTypeLabel } from "../services/service-types";
import {
  SAMPLE_VARS,
  TEMPLATE_PLACEHOLDERS,
  getEmailTemplate,
  isEmailTemplateKey,
  renderEmailTemplate,
  resetEmailTemplate,
  saveEmailTemplate,
  templateVarsFor,
} from "../services/email-templates";
import { formatAddress } from "../lib/address";
import {
  addSubmission,
  ensureSubmissionForCaseLender,
  listSubmissions,
  mirrorCaseIntoPrimarySubmission,
  submissionIsBlank,
  submissionView,
  submissionViews,
  syncCaseFromSubmissions,
} from "../services/case-submissions";

const router: IRouter = Router();

const stages: string[] = [...STAGES];

const SUBMISSION_STAGE_INDEX = stages.indexOf("Submission");
const UNDERWRITING_STAGE_INDEX = stages.indexOf("Underwriting");

const STRESS_TEST_STAGE_INDEX = stages.indexOf("Stress test");
const ADVICE_STAGE_INDEX = stages.indexOf("Advice & approval");
const DETAILS_STAGE_INDEX = stages.indexOf("Submission details");
const AWAITING_COMPLETION_STAGE_INDEX = stages.indexOf("Completion");
const COMPLETION_ACTION_LABEL = "Mark completed and add to client portfolio";
const DEFAULT_PROC_FEE_PCT = 1;

/**
 * Stage-advance handoff: the task goes to the stage's Settings default, then
 * the Case default, then the first active user in the stage owner role.
 * (Case creation resolves its assignee explicitly — see POST /cases.)
 */
async function createHandoffTask(options: {
  caseId: number;
  reference: string;
  title: string;
  notes: string;
  stageIndex: number;
  defaults: DefaultAssigneeMap;
  clientId?: number | null;
}) {
  const resolved = await resolveAssignee({
    section: stageSection(options.stageIndex),
    fallbackRole: stageOwnerRole[options.stageIndex],
    defaults: options.defaults,
  });
  if (!resolved.ok) return;
  await createAssignmentTask({
    staffUser: resolved.staffUser,
    title: options.title,
    notes: options.notes,
    caseId: options.caseId,
    clientId: options.clientId ?? null,
    kind: "stage_handoff",
    stageIndex: options.stageIndex,
  });
}

/**
 * Submission is made of structured steps rather than checklist items. Each
 * step with its own default assignee in Settings gets a dedicated task when
 * the case enters Submission; steps left on "same as stage" are covered by
 * the stage handoff task. The portfolio step only applies when the lender
 * requires a portfolio at submission, so its task is skipped otherwise.
 */
async function createSubmissionStepTasks(options: {
  caseId: number;
  clientId?: number | null;
  reference: string;
  notes: string;
  defaults: DefaultAssigneeMap;
}) {
  const [portfolioRequirement] = await db
    .select({ id: requirementsTable.id })
    .from(requirementsTable)
    .where(
      and(
        eq(requirementsTable.caseId, options.caseId),
        eq(requirementsTable.stageIndex, SUBMISSION_STAGE_INDEX),
        eq(requirementsTable.label, portfolioRequirementLabel),
      ),
    )
    .limit(1);
  for (const step of SUBMISSION_STEPS) {
    const staffUser = options.defaults[step.section];
    if (!staffUser) continue;
    if (step.section === "submission_portfolio" && !portfolioRequirement) continue;
    await createAssignmentTask({
      staffUser,
      title: `Submission: ${step.label} — ${options.reference}`,
      notes: options.notes,
      caseId: options.caseId,
      clientId: options.clientId ?? null,
      kind: "submission_step",
    });
  }
}

/** A new lender case number renames the case everywhere: open task titles and an activity entry. */
async function applyCaseReferenceChange(caseId: number, oldRef: string, newRef: string, actorName: string) {
  if (oldRef === newRef) return;
  await db
    .update(tasksTable)
    .set({ title: sql`replace(${tasksTable.title}, ${oldRef}, ${newRef})` })
    .where(and(eq(tasksTable.caseId, caseId), like(tasksTable.title, `%${oldRef}%`)));
  await db.insert(activitiesTable).values({
    caseId,
    title: "Case number set",
    detail: `Reference updated from ${oldRef} to ${newRef} across tasks`,
    actorName,
  });
}

/** Reference shown across the app: the lender case number once set, otherwise the internal reference. */
export function refOf(caseRow: { reference: string; displayReference: string | null }) {
  return caseRow.displayReference || caseRow.reference;
}

/** Leaving a stage closes the system tasks that stage opened: its hand-off and any "client answered — proceed" follow-ups. */
async function completeAutoHandoffTasks(caseId: number, reference: string, completedByUserId: number, leavingStageIndex?: number) {
  const openTasks = await db
    .select({ id: tasksTable.id, title: tasksTable.title, notes: tasksTable.notes, kind: tasksTable.kind, stageIndex: tasksTable.stageIndex })
    .from(tasksTable)
    .where(and(eq(tasksTable.caseId, caseId), ne(tasksTable.status, "done")));
  const autoTaskIds = openTasks
    .filter((task) =>
      task.title === `New case: gather submission details — ${reference}` ||
      task.title === `New case: set up advice — ${reference}` ||
      task.title === `New enquiry: begin onboarding — ${reference}` ||
      task.notes.startsWith("Handed off after completing ") ||
      (leavingStageIndex != null && task.kind === "stage_handoff" && task.stageIndex === leavingStageIndex),
    )
    .map((task) => task.id);
  if (autoTaskIds.length === 0) return;
  await db
    .update(tasksTable)
    .set({ status: "done", completedAt: new Date(), completedByUserId })
    .where(inArray(tasksTable.id, autoTaskIds));
}

const DEFAULT_BROKER_FEE_PCT = 0.5;

// Advice (index 0): the adviser confirms the level; advised levels also send
// the written advice and wait for the client's approval — ticked by the
// system as the emails go out and the answers come back.
const ADVICE_ONLY_LABELS = [ADVICE_SENT_LABEL, ADVICE_APPROVED_LABEL];
const INSTRUCTION_ONLY_LABELS = [INSTRUCTION_LABEL];
const stageRequirements: Record<number, string[]> = {
  // The Terms of Business are signed per case and ticked by the signature flow (services/terms-agreements.ts).
  0: [SERVICE_LEVEL_LABEL, ...ADVICE_ONLY_LABELS, ...INSTRUCTION_ONLY_LABELS, TERMS_SIGNED_LABEL],
  // Submission details (index 1) is display-only: the pack has to be complete
  // (checked in the advance gate), nothing is put to the client.
  1: [],
  // Submission (index 2) has no plain checklist items — its steps (lender, DIP,
  // case number, portfolio, fee, valuation date, decision requested) are
  // structured fields handled directly on the case, not generic requirements.
  2: [],
  // Underwriting (index 3) requirements are generated per round from pasted
  // bank emails (see the /underwriting/extract and /underwriting/rounds
  // routes) rather than being a fixed checklist.
  3: [],
  4: ["Stress test completed"],
  5: ["Lender offer uploaded", "Offer details checked", "Offer sent to client"],
  6: ["Invoice issued", "Payment marked as received"],
  7: [COMPLETION_ACTION_LABEL],
};

router.use(requireStaff);

const iso = (value: Date) => value.toISOString();
const dayDiff = (value: Date) =>
  Math.max(0, Math.floor((Date.now() - value.getTime()) / 86_400_000));

async function clientName(clientId: number) {
  const [client] = await db
    .select({ name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  return client?.name ?? "Unknown client";
}

async function clientContact(clientId: number) {
  const [client] = await db
    .select({ name: clientsTable.name, email: clientsTable.email })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  return client ?? null;
}

async function ensureCompletionActionRequirement(caseId: number) {
  const [legacy] = await db
    .select({ id: requirementsTable.id })
    .from(requirementsTable)
    .where(
      and(
        eq(requirementsTable.caseId, caseId),
        eq(requirementsTable.stageIndex, AWAITING_COMPLETION_STAGE_INDEX),
        eq(requirementsTable.label, "Completion date confirmed"),
      ),
    );
  if (legacy) {
    await db
      .update(requirementsTable)
      .set({ label: COMPLETION_ACTION_LABEL })
      .where(eq(requirementsTable.id, legacy.id));
    return;
  }
  const [current] = await db
    .select({ id: requirementsTable.id })
    .from(requirementsTable)
    .where(
      and(
        eq(requirementsTable.caseId, caseId),
        eq(requirementsTable.stageIndex, AWAITING_COMPLETION_STAGE_INDEX),
        eq(requirementsTable.label, COMPLETION_ACTION_LABEL),
      ),
    );
  if (!current) {
    await db.insert(requirementsTable).values({
      caseId,
      stageIndex: AWAITING_COMPLETION_STAGE_INDEX,
      label: COMPLETION_ACTION_LABEL,
      round: 1,
    });
  }
}

async function completeCaseAndAddToPortfolio(
  caseRow: typeof casesTable.$inferSelect,
  completedByUserId: number,
  actorName: string,
  completion: {
    renewalType: "fixed_rate" | "bridging";
    rateEndDate: Date | null;
    completionDate: Date | null;
    offerSummary: string;
  },
) {
  const completedAt = new Date();
  const result = await db.transaction(async (tx) => {
    const rateEndDate = completion.renewalType === "bridging" ? null : completion.rateEndDate;
    const completionDate = completion.completionDate;
    const rateEndDateText = rateEndDate ? rateEndDate.toISOString().slice(0, 10) : null;
    const completionDateText = completionDate ? completionDate.toISOString().slice(0, 10) : null;
    const reminderDates = renewalReminderDates(completion.renewalType, rateEndDateText, completionDateText);
    if (!reminderDates.length) throw new Error("A valid renewal date is required");
    const renewalValues = {
      clientId: caseRow.clientId,
      caseId: caseRow.id,
      type: completion.renewalType,
      status: "upcoming",
      rateEndDate: rateEndDateText,
      completionDate: completionDateText,
      dueDate: reminderDates[0]!,
      nextReminderDate: reminderDates[0]!,
      notes: completion.offerSummary.trim(),
    };
    const [existingRenewal] = await tx
      .select()
      .from(renewalsTable)
      .where(eq(renewalsTable.caseId, caseRow.id))
      .limit(1);
    const [renewal] = existingRenewal
      ? await tx.update(renewalsTable).set(renewalValues).where(eq(renewalsTable.id, existingRenewal.id)).returning()
      : await tx.insert(renewalsTable).values(renewalValues).returning();
    if (!renewal) throw new Error("Renewal reminder could not be saved");
    let portfolioPropertyId = caseRow.propertyId;
    const [existingProperty] = caseRow.propertyId
      ? await tx.select().from(propertiesTable).where(eq(propertiesTable.id, caseRow.propertyId))
      : [];

    if (!existingProperty || (existingProperty.clientId !== null && existingProperty.clientId !== caseRow.clientId)) {
      const [createdProperty] = await tx
        .insert(propertiesTable)
        .values({
          clientId: caseRow.clientId,
          address: caseRow.propertyAddress,
          matterType: caseRow.matterType,
          value: caseRow.propertyValue,
          loanAmount: caseRow.loanAmount,
          rent: caseRow.rent,
          gdv: caseRow.gdv,
        })
        .returning();
      if (!createdProperty) throw new Error("Client portfolio property was not created");
      portfolioPropertyId = createdProperty.id;
    } else {
      const [updatedProperty] = await tx
        .update(propertiesTable)
        .set({
          clientId: caseRow.clientId,
          address: caseRow.propertyAddress,
          matterType: caseRow.matterType,
          value: caseRow.propertyValue,
          loanAmount: caseRow.loanAmount,
          rent: caseRow.rent,
          gdv: caseRow.gdv,
        })
        .where(eq(propertiesTable.id, existingProperty.id))
        .returning();
      if (!updatedProperty) throw new Error("Client portfolio property could not be updated");
      portfolioPropertyId = updatedProperty.id;
    }

    const [updatedCase] = await tx
      .update(casesTable)
      .set({
        propertyId: portfolioPropertyId,
        stageIndex: AWAITING_COMPLETION_STAGE_INDEX,
        stageStartedAt: completedAt,
        status: "completed",
      })
      .where(eq(casesTable.id, caseRow.id))
      .returning();
    if (!updatedCase) throw new Error("Case could not be marked completed");

    await tx
      .update(requirementsTable)
      .set({ complete: true, completedAt })
      .where(
        and(
          eq(requirementsTable.caseId, caseRow.id),
          eq(requirementsTable.stageIndex, AWAITING_COMPLETION_STAGE_INDEX),
          eq(requirementsTable.label, COMPLETION_ACTION_LABEL),
        ),
      );
    await tx.insert(activitiesTable).values({
      caseId: caseRow.id,
      title: "Case completed and added to client portfolio",
      detail: `${refOf(updatedCase)} was marked completed and added to the client's property portfolio`,
      actorName,
    });
    return { updatedCase, renewal };
  });

  await syncRenewalCalendarEvents(result.renewal);
  await completeAutoHandoffTasks(caseRow.id, refOf(caseRow), completedByUserId);
  await markCompletionMirrorsDone(caseRow.id, completedByUserId);
  return result.updatedCase;
}

const stageEntryEmail: Partial<Record<string, { purpose: import("../integrations/resend").EmailPurpose; subject: (reference: string) => string; body: (name: string, reference: string) => string }>> = {
  "Submission": {
    purpose: "valuation_reminder",
    subject: (reference) => `Your case ${reference} has been submitted to the lender`,
    body: (name, reference) =>
      renderChariotEmail({
        preheader: `Case ${reference} has been submitted to the lender.`,
        heading: "Your case has been submitted to the lender",
        paragraphs: [
          `Dear ${name},`,
          `Your case, reference <strong>${reference}</strong>, has now been submitted to the lender. We will arrange the valuation and keep you informed as this progresses.`,
          `Should you have any questions in the meantime, please contact your case handler.`,
        ],
      }),
  },
  "Underwriting": {
    purpose: "underwriting_requirements",
    subject: (reference) => `Your case ${reference} has advanced to underwriting`,
    body: (name, reference) =>
      renderChariotEmail({
        preheader: `Case ${reference} is now with underwriting.`,
        heading: "Your case has advanced to underwriting",
        paragraphs: [
          `Dear ${name},`,
          `Your case, reference <strong>${reference}</strong>, is now under review by the lender's underwriting team. Please check your client portal periodically, as further documentation may be requested to support your application.`,
          `We appreciate your prompt attention to any such requests, as this helps avoid delays.`,
        ],
      }),
  },
  "Lender offer": {
    purpose: "lender_offer",
    subject: (reference) => `Your case ${reference} has reached the lender offer stage`,
    body: (name, reference) =>
      renderChariotEmail({
        preheader: `Case ${reference} has reached the lender offer stage.`,
        heading: "We have received a lender offer on your case",
        paragraphs: [
          `Dear ${name},`,
          `We are delighted to inform you that your case, reference <strong>${reference}</strong>, has reached the lender offer stage. Our team will be in touch shortly with the full details of the offer.`,
          `Please do not hesitate to reach out to your case handler with any questions in the interim.`,
        ],
      }),
  },
};

async function getStageThresholdsMap(): Promise<Map<number, number | null>> {
  const rows = await db.select().from(caseStageThresholdsTable);
  const map = new Map<number, number | null>();
  rows.forEach((row) => map.set(row.stageIndex, row.thresholdDays));
  return map;
}

export async function caseView(
  caseRow: typeof casesTable.$inferSelect,
  thresholdsMap?: Map<number, number | null>,
) {
  const thresholds = thresholdsMap ?? (await getStageThresholdsMap());
  // The label is derived from the index — there is no separate stage column to drift.
  const displayStageIndex = caseRow.stageIndex >= stages.length ? AWAITING_COMPLETION_STAGE_INDEX : caseRow.stageIndex;
  const displayStage = stageName(displayStageIndex);
  const stageThresholdDays = thresholds.get(displayStageIndex) ?? null;
  const stageDays = dayDiff(caseRow.stageStartedAt);
  const procFee = caseRow.loanAmount * (caseRow.procFeePct / 100);
  const brokerFee = caseRow.loanAmount * (caseRow.brokerFeePct / 100);
  let lenderName: string | null = null;
  if (caseRow.lenderId) {
    const [lender] = await db.select({ name: lendersTable.name }).from(lendersTable)
      .where(eq(lendersTable.id, caseRow.lenderId));
    lenderName = lender?.name ?? null;
  }
  // The case follows its primary lender submission: prefer that lender's DIP,
  // falling back to any DIP on the case (pre-multi-lender uploads).
  const [primarySubmission] = await db
    .select({ id: caseSubmissionsTable.id })
    .from(caseSubmissionsTable)
    .where(and(eq(caseSubmissionsTable.caseId, caseRow.id), eq(caseSubmissionsTable.isPrimary, true)))
    .limit(1);
  const dipRows = await db
    .select({ id: documentsTable.id, name: documentsTable.name, uploadedAt: documentsTable.uploadedAt, submissionId: documentsTable.submissionId })
    .from(documentsTable)
    .where(and(eq(documentsTable.caseId, caseRow.id), eq(documentsTable.category, "DIP")))
    .orderBy(desc(documentsTable.uploadedAt));
  const dipDoc =
    (primarySubmission ? dipRows.find((row) => row.submissionId === primarySubmission.id) : undefined) ??
    dipRows.find((row) => row.submissionId == null) ??
    dipRows[0];
  const underwritingRounds = await underwritingRoundsView(caseRow.id);
  return {
    id: caseRow.id,
    reference: refOf(caseRow),
    clientId: caseRow.clientId,
    clientName: await clientName(caseRow.clientId),
    propertyId: caseRow.propertyId,
    rent: caseRow.rent ?? null,
    gdv: caseRow.gdv ?? null,
    propertyAddress: caseRow.propertyAddress,
    matterType: caseRow.matterType,
    serviceType: caseRow.serviceType,
    serviceLevelConfirmedAt: caseRow.serviceLevelConfirmedAt ? iso(caseRow.serviceLevelConfirmedAt) : null,
    serviceLevelConfirmedBy: await displayNameFor(caseRow.serviceLevelConfirmedByUserId),
    stage: displayStage,
    stageIndex: displayStageIndex,
    stageDays,
    stageThresholdDays,
    stageFlagged: stageThresholdDays != null && stageDays >= stageThresholdDays,
    status: caseRow.status,
    loanAmount: caseRow.loanAmount,
    propertyValue: caseRow.propertyValue,
    assignedTo: caseRow.assignedTo,
    assignedUserId: caseRow.assignedUserId ?? null,
    updatedAt: iso(caseRow.updatedAt),
    skippedStageIndexes: (caseRow.skippedStageIndexes as number[] | null) ?? [],
    procFeePct: caseRow.procFeePct,
    brokerFeePct: caseRow.brokerFeePct,
    brokerFeeBasis: (caseRow.brokerFeeBasis as "percent" | "flat") ?? "percent",
    brokerFeeFlat: caseRow.brokerFeeFlat ?? null,
    procFee,
    brokerFee,
    revenue: procFee + brokerFee,
    archivedAt: caseRow.archivedAt ? iso(caseRow.archivedAt) : null,
    lenderId: caseRow.lenderId,
    lenderName,
    caseNumber: caseRow.lenderCaseNumber,
    dipDocument: dipDoc ? { id: dipDoc.id, name: dipDoc.name } : null,
    valuationDate: caseRow.valuationDate ? iso(caseRow.valuationDate) : null,
    valuationCompletedAt: caseRow.valuationCompletedAt ? iso(caseRow.valuationCompletedAt) : null,
    valuationAmount: caseRow.valuationAmount,
    expectedCompletionDate: caseRow.expectedCompletionDate ? iso(caseRow.expectedCompletionDate) : null,
    applicationFeeConfirmed: caseRow.applicationFeeConfirmed,
    bankDecisionRequested: caseRow.bankDecisionRequested,
    underwritingCleared: caseRow.underwritingCleared,
    underwritingRounds,
  };
}

/** Requirements for a case at a given stage, grouped so the latest round can be checked for completeness. */
async function latestStageRound(caseId: number, stageIndex: number) {
  const items = await db
    .select()
    .from(requirementsTable)
    .where(and(eq(requirementsTable.caseId, caseId), eq(requirementsTable.stageIndex, stageIndex)));
  const maxRound = items.reduce((max, item) => Math.max(max, item.round), 0);
  const latestRoundItems = items.filter((item) => item.round === maxRound);
  return { maxRound, latestRoundItems };
}


/** All staff can view the case pipeline. Task visibility remains limited separately. */
async function visibleAssignedToNames(user: { id: number; role: string }): Promise<string[] | null> {
  return null;
}

async function stressTestView(row: typeof caseStressTestsTable.$inferSelect) {
  let lenderName: string | null = null;
  if (row.lenderId) {
    const [lender] = await db
      .select({ name: lendersTable.name })
      .from(lendersTable)
      .where(eq(lendersTable.id, row.lenderId));
    lenderName = lender?.name ?? null;
  }
  return {
    id: row.id,
    caseId: row.caseId,
    lenderId: row.lenderId,
    lenderName,
    monthlyRent: row.monthlyRent,
    propertyValue: row.propertyValue,
    stressRate: row.stressRate,
    payRate: row.payRate,
    stressAtPayRate: row.stressAtPayRate,
    stressMargin: row.stressMargin,
    icrMultiplier: row.icrMultiplier,
    targetLtv: row.targetLtv,
    arrFeeMode: row.arrFeeMode as "none" | "pct" | "fixed",
    arrFeePct: row.arrFeePct,
    arrFeeFixed: row.arrFeeFixed,
    stressBasis: row.stressBasis as "total" | "net",
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function stressTestPasses(row: typeof caseStressTestsTable.$inferSelect): boolean {
  const rent = Number(row.monthlyRent ?? 0);
  const propertyValue = Number(row.propertyValue ?? 0);
  const payRate = Number(row.payRate ?? 0);
  const stressRate = Number(row.stressRate ?? 0);
  const margin = Number(row.stressMargin ?? 0);
  const rate = payRate > 0
    ? (row.stressAtPayRate ? payRate : payRate + margin)
    : stressRate;
  const icrMultiplier = Number(row.icrMultiplier ?? 0);
  const targetLtv = Number(row.targetLtv ?? 0);
  if (rent <= 0 || propertyValue <= 0 || rate <= 0 || icrMultiplier <= 0 || targetLtv <= 0) {
    return false;
  }

  const targetGrossLoan = propertyValue * targetLtv / 100;
  const targetArrangementFee = row.arrFeeMode === "pct"
    ? targetGrossLoan * Number(row.arrFeePct ?? 0) / 100
    : row.arrFeeMode === "fixed"
      ? Number(row.arrFeeFixed ?? 0)
      : 0;
  const stressedTarget = row.stressBasis === "net"
    ? targetGrossLoan
    : targetGrossLoan + targetArrangementFee;
  const requiredRent = stressedTarget * rate / 100 / 12 * icrMultiplier;
  return rent >= requiredRent;
}

async function ensureCaseStressTest(caseRow: typeof casesTable.$inferSelect) {
  const [existing] = await db
    .select()
    .from(caseStressTestsTable)
    .where(eq(caseStressTestsTable.caseId, caseRow.id));
  if (existing) return existing;
  await db
    .insert(caseStressTestsTable)
    .values({
      caseId: caseRow.id,
      lenderId: caseRow.lenderId,
      monthlyRent: caseRow.rent,
      propertyValue: caseRow.propertyValue,
      // Target the LTV the case is actually asking for, when both figures exist.
      ...(caseRow.loanAmount > 0 && caseRow.propertyValue > 0
        ? { targetLtv: Math.min(100, Math.round((caseRow.loanAmount / caseRow.propertyValue) * 1000) / 10) }
        : {}),
    })
    .onConflictDoNothing();
  const [created] = await db
    .select()
    .from(caseStressTestsTable)
    .where(eq(caseStressTestsTable.caseId, caseRow.id));
  if (!created) throw new Error("Stress test was not created");
  return created;
}

function normalizeOfferText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

async function lenderOfferReviewView(
  caseRow: typeof casesTable.$inferSelect,
  review: typeof lenderOfferReviewsTable.$inferSelect | null,
) {
  const [document] = await db
    .select({ id: documentsTable.id, name: documentsTable.name })
    .from(documentsTable)
    .where(and(eq(documentsTable.caseId, caseRow.id), eq(documentsTable.category, "LENDER_OFFER")))
    .orderBy(desc(documentsTable.uploadedAt))
    .limit(1);
  const activeReview = review && document?.id === review.documentId ? review : null;
  return {
    document: document ?? null,
    expectedAddress: caseRow.propertyAddress,
    expectedClientName: await clientName(caseRow.clientId),
    expectedPropertyValue: caseRow.propertyValue,
    offerAddress: activeReview?.offerAddress ?? null,
    offerClientName: activeReview?.offerClientName ?? null,
    offerPropertyValue: activeReview?.offerPropertyValue ?? null,
    addressMatches: activeReview?.addressMatches ?? false,
    nameMatches: activeReview?.nameMatches ?? false,
    valueMatches: activeReview?.valueMatches ?? false,
    allMatched: Boolean(activeReview?.addressMatches && activeReview?.nameMatches && activeReview?.valueMatches),
    reviewedAt: activeReview?.reviewedAt ? iso(activeReview.reviewedAt) : null,
  };
}


router.get("/dashboard", async (_req, res): Promise<void> => {
  const caseRows = (await db.select().from(casesTable)).filter((item) => !item.archivedAt);
  const taskRows = await db.select().from(tasksTable);
  const [{ awaitingAcceptance }] = await db
    .select({ awaitingAcceptance: sql<number>`count(*)::int` })
    .from(clientsTable)
    .where(eq(clientsTable.lifecycle, "enquiry"));
  const activityRows = await db
    .select()
    .from(activitiesTable)
    .orderBy(desc(activitiesTable.occurredAt))
    .limit(8);
  const stageMap = new Map<string, number>();
  for (const item of caseRows.filter((item) => item.status !== "completed")) {
    const label = stageName(item.stageIndex);
    stageMap.set(label, (stageMap.get(label) ?? 0) + 1);
  }
  const now = new Date();
  const data = {
    activeCases: caseRows.filter((item) => item.status === "active").length,
    awaitingAcceptance,
    urgentTasks: taskRows.filter(
      (item) => item.status !== "done" && item.priority === "urgent",
    ).length,
    awaitingClient: caseRows.filter((item) => item.status === "awaiting_client")
      .length,
    completionsThisMonth: caseRows.filter(
      (item) =>
        item.status === "completed" &&
        item.updatedAt.getMonth() === now.getMonth() &&
        item.updatedAt.getFullYear() === now.getFullYear(),
    ).length,
    pipelineValue: caseRows
      .filter((item) => item.status !== "completed")
      .reduce((total, item) => total + item.loanAmount, 0),
    totalProcFee: caseRows.reduce(
      (total, item) => total + (item.loanAmount * Number(item.procFeePct)) / 100,
      0,
    ),
    totalBrokerFee: caseRows.reduce(
      (total, item) => total + (item.loanAmount * Number(item.brokerFeePct)) / 100,
      0,
    ),
    totalRevenue: caseRows.reduce(
      (total, item) =>
        total + (item.loanAmount * (Number(item.procFeePct) + Number(item.brokerFeePct))) / 100,
      0,
    ),
    stageCounts: [...stageMap.entries()].map(([stage, count]) => ({
      stage,
      count,
    })),
    recentActivity: await Promise.all(activityRows.map(async (item) => ({
      id: item.id,
      title: item.title,
      detail: await resolveActivityDetail(item),
      actorName: item.actorName,
      occurredAt: iso(item.occurredAt),
    }))),
  };
  res.json(GetDashboardResponse.parse(data));
});

async function resolveActivityDetail(item: { detail: string }): Promise<string> {
  const legacyClientId = item.detail.match(/ was linked to client ([0-9]+)$/)?.[1];
  if (!legacyClientId) return item.detail;
  const [client] = await db.select({ name: clientsTable.name }).from(clientsTable)
    .where(eq(clientsTable.id, Number(legacyClientId)));
  return client ? item.detail.replace(/client [0-9]+$/, client.name) : item.detail;
}

/**
 * Rows written before `entity_type`/`entity_id` existed only carry a name in the
 * detail text; recover the client or property from it so old notifications still
 * deep-link.
 */
async function resolveActivityEntity(item: {
  title: string;
  detail: string;
  entityType: string | null;
  entityId: number | null;
}): Promise<{ type: string; id: number } | null> {
  if (item.entityType && item.entityId) return { type: item.entityType, id: item.entityId };
  if (/^client/i.test(item.title)) {
    const name = item.detail.match(/^(.+?) (?:was added to the client register|added)$/)?.[1];
    if (!name) return null;
    const [client] = await db.select({ id: clientsTable.id }).from(clientsTable)
      .where(eq(clientsTable.name, name)).limit(1);
    return client ? { type: "client", id: client.id } : null;
  }
  if (/^property added/i.test(item.title)) {
    const address = item.detail.match(/^(.+?) was (?:linked to|added without)/)?.[1];
    if (!address) return null;
    // The detail carries the full display address (street, city, postcode).
    const [property] = await db.select({ id: propertiesTable.id }).from(propertiesTable)
      .where(or(eq(propertiesTable.address, address), sql`${address} LIKE ${propertiesTable.address} || ', %'`)).limit(1);
    return property ? { type: "property", id: property.id } : null;
  }
  return null;
}

router.get("/activities", async (req, res): Promise<void> => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(25, Math.max(1, Number(req.query.pageSize) || 25));
  const propertyId = req.query.propertyId ? Number(req.query.propertyId) : null;
  let activityFilter;
  if (propertyId) {
    const propertyCases = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.propertyId, propertyId));
    const caseIds = propertyCases.map((c) => c.id);
    activityFilter = or(
      and(eq(activitiesTable.entityType, "property"), eq(activitiesTable.entityId, propertyId)),
      caseIds.length ? inArray(activitiesTable.caseId, caseIds) : sql`false`,
    );
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(activitiesTable).where(activityFilter);
  const rows = await db
    .select({
      id: activitiesTable.id,
      title: activitiesTable.title,
      detail: activitiesTable.detail,
      actorName: activitiesTable.actorName,
      kind: activitiesTable.kind,
      occurredAt: activitiesTable.occurredAt,
      caseId: activitiesTable.caseId,
      caseReference: sql<string | null>`coalesce(${casesTable.displayReference}, ${casesTable.reference})`,
      entityType: activitiesTable.entityType,
      entityId: activitiesTable.entityId,
    })
    .from(activitiesTable)
    .leftJoin(casesTable, eq(casesTable.id, activitiesTable.caseId))
    .where(activityFilter)
    .orderBy(desc(activitiesTable.occurredAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const items = await Promise.all(
    rows.map(async (item) => {
      const entity = await resolveActivityEntity(item);
      return {
        id: item.id,
        title: item.title,
        detail: await resolveActivityDetail(item),
        actorName: item.actorName,
        kind: item.kind ?? classifyActivityTitle(item.title),
        occurredAt: iso(item.occurredAt),
        caseId: item.caseId,
        caseReference: item.caseReference ?? null,
        entityType: entity?.type ?? null,
        entityId: entity?.id ?? null,
      };
    }),
  );
  res.json(
    ListActivitiesResponse.parse({
      items,
      page,
      pageSize,
      total: count,
      hasMore: page * pageSize < count,
    }),
  );
});

router.get("/staff", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: appUsersTable.id,
      displayName: appUsersTable.displayName,
      email: appUsersTable.email,
      role: appUsersTable.role,
    })
    .from(appUsersTable)
    .where(and(eq(appUsersTable.active, true), inArray(appUsersTable.role, STAFF_ROLES)))
    .orderBy(asc(appUsersTable.displayName));
  res.json(ListStaffResponse.parse(rows));
});

const CLIENT_ENQUIRY_KEYS = [
  "source",
  "introducerName",
  "introducerContact",
  "enquiryType",
  "enquirySummary",
  "enquiryTimescale",
] as const;

/** The full ClientDetail response for one client row. */
export async function clientDetailView(client: typeof clientsTable.$inferSelect) {
  const [documents, properties, clientCases, onboarding, extras] = await Promise.all([
    db.select().from(documentsTable).where(eq(documentsTable.clientId, client.id)),
    db.select().from(propertiesTable).where(eq(propertiesTable.clientId, client.id)),
    db.select().from(casesTable).where(eq(casesTable.clientId, client.id)),
    getClientOnboarding(client.id),
    clientExtras(client),
  ]);
  const readings = await readingsForDocuments(documents.map((item) => item.id));
  return {
    ...clientView(client, extras, onboarding.status as "not_started" | "in_progress" | "complete"),
    documents: documents.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      status: item.status,
      uploadedAt: item.uploadedAt?.toISOString() ?? null,
      reading: readings.get(item.id) ?? null,
    })),
    documentChecks: documentChecks(client, [...readings.values()]),
    properties: properties.map((item) => ({
      id: item.id,
      clientId: item.clientId,
      address: item.address,
      matterType: item.matterType,
      value: item.value,
      loanAmount: item.loanAmount,
      rent: item.rent,
      gdv: item.gdv,
      ...propertyDetails(item),
    })),
    cases: await Promise.all(clientCases.map((c) => caseView(c))),
    onboarding,
  };
}

async function loadClient(id: number) {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  return client ?? null;
}

const matchViews = async (matches: Awaited<ReturnType<typeof findClientMatches>>) => {
  const extras = await clientExtrasFor(matches.map((match) => match.client));
  return matches.map((match) => ({
    client: clientView(match.client, extras.get(match.client.id) ?? EMPTY_CLIENT_EXTRAS),
    reason: match.reason,
  }));
};

router.get("/clients", async (req, res): Promise<void> => {
  const query = ListClientsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const lifecycle = query.data.lifecycle;
  const where = lifecycle === "open"
    ? inArray(clientsTable.lifecycle, ["enquiry", "onboarding", "active"])
    : lifecycle === "closed"
      ? inArray(clientsTable.lifecycle, ["declined", "lost"])
      : lifecycle
        ? eq(clientsTable.lifecycle, lifecycle)
        : undefined;
  const rows = await db
    .select()
    .from(clientsTable)
    .where(where)
    .orderBy(desc(clientsTable.createdAt));
  const extras = await clientExtrasFor(rows);
  res.json(
    ListClientsResponse.parse(
      rows.map((item) => clientView(item, extras.get(item.id) ?? EMPTY_CLIENT_EXTRAS)),
    ),
  );
});

/**
 * Step 1 of the Add page: a client starts as an enquiry with basic details.
 * No welcome email yet — that is sent when the enquiry is accepted.
 */
router.post("/clients", async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Resolve before inserting so a bad explicit assignee never leaves an orphan client.
  const assignee = await resolveAssignee({ section: "client", explicitUserId: parsed.data.assignedUserId });
  if (!assignee.ok) {
    res.status(400).json({ error: assignee.error });
    return;
  }
  let created;
  try {
    [created] = await db
      .insert(clientsTable)
      .values({
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone ?? "",
        companyName: parsed.data.companyName ?? "",
        onboardingStatus: "not_started",
        lifecycle: "enquiry",
        assignedUserId: assignee.staffUser?.id ?? null,
        enquiryEmailText: parsed.data.enquiryEmailText ?? null,
        enquiryEmailSubject: parsed.data.enquiryEmailSubject ?? null,
        enquiryEmailFrom: parsed.data.enquiryEmailFrom ?? null,
        enquiryExtracted: parsed.data.enquiryExtracted ?? null,
        enquiryExtractionModel: parsed.data.enquiryExtractionModel ?? null,
        ...pickProvided(parsed.data, CLIENT_ENQUIRY_KEYS),
        ...pickProvided(parsed.data, CLIENT_PROFILE_KEYS),
      })
      .returning();
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code
      ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "A client with this email already exists" });
      return;
    }
    throw error;
  }
  if (!created) {
    res.status(500).json({ error: "Client was not created" });
    return;
  }
  await recordEnquiry(created.id, {
    source: created.source,
    enquiryType: created.enquiryType,
    summary: created.enquirySummary,
    timescale: created.enquiryTimescale,
    emailFrom: created.enquiryEmailFrom,
    emailSubject: created.enquiryEmailSubject,
    emailText: created.enquiryEmailText,
    extracted: created.enquiryExtracted,
    extractionModel: created.enquiryExtractionModel,
    receivedAt: created.enquiryReceivedAt,
    createdByUserId: res.locals.authUser?.id ?? null,
  });
  await ensureClientOnboarding(created.id);
  if (parsed.data.property?.address) {
    const property = parsed.data.property;
    await db.insert(propertiesTable).values({
      clientId: created.id,
      address: property.address!,
      city: property.city ?? null,
      postcode: property.postcode ?? null,
      matterType: property.matterType ?? "Unspecified",
      value: property.value ?? property.purchasePrice ?? 0,
      loanAmount: property.loanAmount ?? property.currentBalance ?? 0,
      rent: property.rent,
      gdv: property.gdv,
      propertyType: property.propertyType ?? null,
      purchasePrice: property.purchasePrice ?? null,
      currentLender: property.currentLender ?? null,
      currentBalance: property.currentBalance ?? null,
      currentRatePct: property.currentRatePct ?? null,
      currentRateEndDate: property.currentRateEndDate ?? null,
    });
  }
  // Values the email reader supplied and staff left as they were are marked as
  // document-filled, so the Add page shows them in yellow like the other readers' fills.
  const extractedClient = (parsed.data.enquiryExtracted as { client?: Record<string, unknown>; enquiry?: Record<string, unknown> } | null)?.client;
  const extractedEnquiry = (parsed.data.enquiryExtracted as { enquiry?: Record<string, unknown> } | null)?.enquiry;
  if (extractedClient || extractedEnquiry) {
    const body = parsed.data as Record<string, unknown>;
    const filled = [...CLIENT_PROFILE_KEYS, ...CLIENT_ENQUIRY_KEYS].filter((key) => {
      const value = body[key];
      if (value == null || value === "") return false;
      const fromEmail = extractedClient?.[key] ?? (key === "enquirySummary" ? extractedEnquiry?.summary : key === "enquiryTimescale" ? extractedEnquiry?.timescale : key === "enquiryType" ? extractedEnquiry?.type : extractedEnquiry?.[key]);
      return fromEmail != null && String(fromEmail) === String(value);
    });
    if (filled.length > 0) {
      await db.update(clientsTable).set({ documentFilledFields: filled }).where(eq(clientsTable.id, created.id));
    }
  }
  await db.insert(activitiesTable).values({
    title: "Enquiry received",
    detail: created.enquirySummary
      ? `${created.name}: ${created.enquirySummary}`
      : `${created.name} was added as a new enquiry`,
    actorName: res.locals.authUser.displayName,
    entityType: "client",
    entityId: created.id,
  });
  await createEnquiryReviewTask(created, assignee)
    .catch((error) => logger.warn({ err: error, clientId: created.id }, "Enquiry review task was not created"));
  res.status(201).json(CreateClientResponse.parse(clientView(created, await clientExtras(created))));
});

router.post("/clients/extract", async (req, res): Promise<void> => {
  const body = ExtractClientEnquiryBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid email text" });
    return;
  }
  const { extracted, model } = await extractEnquiry({
    emailText: body.data.emailText,
    subject: body.data.subject ?? null,
    from: body.data.from ?? null,
  });
  const matches = await findClientMatches({
    email: extracted.client.email,
    phone: extracted.client.phone,
    companyNumber: extracted.client.companyNumber,
    name: extracted.client.name,
  });
  res.json(ExtractClientEnquiryResponse.parse({ extracted, model, matches: await matchViews(matches) }));
});

router.post("/clients/matches", async (req, res): Promise<void> => {
  const body = FindClientMatchesBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const matches = await findClientMatches(body.data);
  res.json(FindClientMatchesResponse.parse({ matches: await matchViews(matches) }));
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const client = await loadClient(params.data.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(GetClientResponse.parse(await clientDetailView(client)));
});

router.patch("/clients/:id", async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await loadClient(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const email = parsed.data.email ?? existing.email;
  const [emailOwner] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(eq(clientsTable.email, email));
  if (emailOwner && emailOwner.id !== params.data.id) {
    res.status(409).json({ error: "Another client already uses this email" });
    return;
  }
  let assignedUserId: number | null | undefined;
  if (parsed.data.assignedUserId !== undefined) {
    if (parsed.data.assignedUserId === null) {
      assignedUserId = null;
    } else {
      const staffUser = await activeStaffUser(parsed.data.assignedUserId);
      if (!staffUser) {
        res.status(400).json({ error: "Assignee must be an active staff user" });
        return;
      }
      assignedUserId = staffUser.id;
    }
  }
  // Partial update: anything the caller left out keeps its current value.
  const profilePatch = pickProvided(parsed.data, CLIENT_PROFILE_KEYS);
  // A field the document reader filled stops being "from a document" once staff save something else in it.
  const enquiryPatch = pickProvided(parsed.data, CLIENT_ENQUIRY_KEYS);
  const filledBefore = Array.isArray(existing.documentFilledFields) ? (existing.documentFilledFields as string[]) : [];
  const unfilled = filledBefore.filter((field) => {
    if (!(field in profilePatch) && !(field in enquiryPatch)) return false;
    const next = field in profilePatch ? (profilePatch as Record<string, unknown>)[field] : (enquiryPatch as Record<string, unknown>)[field];
    const current = (existing as Record<string, unknown>)[field];
    return String(next ?? "") !== String(current ?? "");
  });
  const [updated] = await db
    .update(clientsTable)
    .set({
      name: parsed.data.name ?? existing.name,
      email,
      phone: parsed.data.phone ?? existing.phone,
      companyName: parsed.data.companyName ?? existing.companyName,
      ...(assignedUserId !== undefined ? { assignedUserId } : {}),
      ...(parsed.data.nextFollowUpAt !== undefined ? { nextFollowUpAt: parsed.data.nextFollowUpAt } : {}),
      ...pickProvided(parsed.data, CLIENT_ENQUIRY_KEYS),
      ...profilePatch,
      // Removed in SQL so a reader appending at the same moment is not overwritten.
      ...(unfilled.length > 0
        ? { documentFilledFields: unfilled.reduce((expr, field) => sql`${expr} - ${field}::text`, sql`coalesce(${clientsTable.documentFilledFields}, '[]'::jsonb)`) }
        : {}),
    })
    .where(eq(clientsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(500).json({ error: "Client was not updated" });
    return;
  }
  if (assignedUserId !== undefined && assignedUserId !== existing.assignedUserId) {
    const owner = assignedUserId == null ? null : await activeStaffUser(assignedUserId);
    await db.insert(activitiesTable).values({
      title: owner ? "Client reassigned" : "Client unassigned",
      detail: owner ? `${updated.name} is now owned by ${owner.displayName}` : `${updated.name} no longer has an owner`,
      actorName: res.locals.authUser.displayName,
      entityType: "client",
      entityId: updated.id,
    });
  }
  await syncClientChecklists(updated.id);
  res.json(GetClientResponse.parse(await clientDetailView(updated)));
});

/** Step 2 of the Add page: accept the enquiry. Also re-sends a failed welcome email. */
router.post("/clients/:id/accept", async (req, res): Promise<void> => {
  const params = AcceptClientEnquiryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const client = await loadClient(params.data.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const actor = { id: res.locals.authUser.id as number, displayName: res.locals.authUser.displayName as string };
  if (client.lifecycle === "enquiry") {
    const { client: accepted } = await acceptClient(client, actor);
    res.json(AcceptClientEnquiryResponse.parse(await clientDetailView(accepted)));
    return;
  }
  if (client.lifecycle === "onboarding" || client.lifecycle === "active") {
    const extras = await clientExtras(client);
    if (extras.welcomeDelivery && extras.welcomeDelivery.status === "sent") {
      res.status(409).json({ error: "This client has already been accepted and welcomed" });
      return;
    }
    await resendWelcome(client, actor);
    res.json(AcceptClientEnquiryResponse.parse(await clientDetailView(client)));
    return;
  }
  res.status(409).json({ error: "Reopen the enquiry before accepting it" });
});

router.post("/clients/:id/decline", async (req, res): Promise<void> => {
  const params = DeclineClientEnquiryParams.safeParse(req.params);
  const body = DeclineClientEnquiryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid decline request" });
    return;
  }
  const client = await loadClient(params.data.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  if (client.lifecycle === "declined" || client.lifecycle === "lost") {
    res.status(409).json({ error: "This client is already closed" });
    return;
  }
  const updated = await declineClient(client, body.data, {
    id: res.locals.authUser.id,
    displayName: res.locals.authUser.displayName,
  });
  res.json(DeclineClientEnquiryResponse.parse(await clientDetailView(updated)));
});

router.post("/clients/:id/reopen", async (req, res): Promise<void> => {
  const params = ReopenClientEnquiryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const client = await loadClient(params.data.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  if (client.lifecycle !== "declined" && client.lifecycle !== "lost") {
    res.status(409).json({ error: "This client is not closed" });
    return;
  }
  const updated = await reopenClient(client, {
    id: res.locals.authUser.id,
    displayName: res.locals.authUser.displayName,
  });
  res.json(ReopenClientEnquiryResponse.parse(await clientDetailView(updated)));
});

router.post("/clients/:id/repeat-enquiry", async (req, res): Promise<void> => {
  const params = RecordRepeatEnquiryParams.safeParse(req.params);
  const body = RecordRepeatEnquiryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid repeat enquiry" });
    return;
  }
  const client = await loadClient(params.data.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const { propertyId } = await recordRepeatEnquiry(client, {
    emailText: body.data.emailText ?? null,
    subject: body.data.subject ?? null,
    from: body.data.from ?? null,
    extracted: (body.data.extracted as ExtractedEnquiry | null | undefined) ?? null,
  }, { displayName: res.locals.authUser.displayName });
  res.json(RecordRepeatEnquiryResponse.parse({ clientId: client.id, propertyId }));
});

router.patch("/clients/:id/onboarding/:key", async (req, res): Promise<void> => {
  const params = UpdateClientOnboardingItemParams.safeParse(req.params);
  const body = UpdateClientOnboardingItemBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid onboarding update" });
    return;
  }
  const [client] = await db.select({ id: clientsTable.id }).from(clientsTable)
    .where(eq(clientsTable.id, params.data.id));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  try {
    const updated = await updateClientOnboardingItem({
      clientId: client.id,
      key: params.data.key,
      value: body.data.value,
      status: body.data.status,
      actorUserId: res.locals.authUser.id,
      allowNotApplicable: true,
    });
    if (!updated) {
      res.status(404).json({ error: "Onboarding item not found" });
      return;
    }
    await syncClientChecklists(client.id);
    res.json(await getClientOnboarding(client.id));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Onboarding update failed" });
  }
});

router.get("/cases", async (req, res): Promise<void> => {
  const showArchived = req.query.archived === "true";
  const names = await visibleAssignedToNames(res.locals.authUser);
  const conditions = [
    showArchived ? sql`${casesTable.archivedAt} is not null` : isNull(casesTable.archivedAt),
  ];
  if (names) conditions.push(names.length ? inArray(casesTable.assignedTo, names) : sql`false`);
  const rows = await db
    .select()
    .from(casesTable)
    .where(and(...conditions))
    .orderBy(desc(casesTable.updatedAt));
  const thresholds = await getStageThresholdsMap();
  res.json(
    ListCasesResponse.parse(
      await Promise.all(rows.map((row) => caseView(row, thresholds))),
    ),
  );
});

const templateView = (template: Awaited<ReturnType<typeof getEmailTemplate>>) => ({
  ...template,
  placeholders: TEMPLATE_PLACEHOLDERS[template.key].map((item) => ({ token: `{{${item.token}}}`, description: item.description })),
});

router.get("/settings/email-templates/:key", async (req, res): Promise<void> => {
  const params = GetEmailTemplateParams.safeParse(req.params);
  if (!params.success || !isEmailTemplateKey(params.data.key)) {
    res.status(404).json({ error: "Unknown email template" });
    return;
  }
  res.json(GetEmailTemplateResponse.parse(templateView(await getEmailTemplate(params.data.key))));
});

router.put("/settings/email-templates/:key", async (req, res): Promise<void> => {
  if (!isFullAccess(res.locals.authUser.role)) {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  const params = UpdateEmailTemplateParams.safeParse(req.params);
  const body = UpdateEmailTemplateBody.safeParse(req.body);
  if (!params.success || !isEmailTemplateKey(params.data.key)) {
    res.status(404).json({ error: "Unknown email template" });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const saved = await saveEmailTemplate(params.data.key, {
    subject: body.data.subject.trim(),
    heading: body.data.heading.trim(),
    body: body.data.body.trim(),
  }, res.locals.authUser.id);
  await db.insert(activitiesTable).values({
    title: "Email template updated",
    detail: `The ${params.data.key.replace(/_/g, " ")} email text was changed`,
    actorName: res.locals.authUser.displayName,
  });
  res.json(UpdateEmailTemplateResponse.parse(templateView(saved)));
});

router.delete("/settings/email-templates/:key", async (req, res): Promise<void> => {
  if (!isFullAccess(res.locals.authUser.role)) {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  const params = ResetEmailTemplateParams.safeParse(req.params);
  if (!params.success || !isEmailTemplateKey(params.data.key)) {
    res.status(404).json({ error: "Unknown email template" });
    return;
  }
  res.json(ResetEmailTemplateResponse.parse(templateView(await resetEmailTemplate(params.data.key))));
});

router.post("/settings/email-templates/:key/preview", async (req, res): Promise<void> => {
  const params = PreviewEmailTemplateParams.safeParse(req.params);
  const body = PreviewEmailTemplateBody.safeParse(req.body);
  if (!params.success || !isEmailTemplateKey(params.data.key)) {
    res.status(404).json({ error: "Unknown email template" });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const client = body.data.clientId ? await loadClient(body.data.clientId) : null;
  const key = params.data.key;
  const vars = {
    ...SAMPLE_VARS[key],
    ...templateVarsFor(
      client ?? { name: "Alex Morgan", email: "alex.morgan@example.co.uk", companyName: "Morgan Property Ltd" },
      res.locals.authUser.displayName,
    ),
  };
  const rendered = renderEmailTemplate(body.data, vars);
  // Each template's fixed part: the block and buttons the words wrap around.
  const sample = SAMPLE_VARS.advice_email;
  const fixed = key === "advice_email"
    ? {
        rawBody: adviceBlockHtml({
          reference: sample.reference!, lender: sample.lender!, product: sample.product!, ratePct: 4.85, termYears: 25,
          monthlyPayment: 1214, arrangementFee: 999, summary: sample.summary!,
        }) + `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px 0;"><tr><td style="border-radius:6px;background-color:#C46B2B;"><a href="#" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Approve</a></td><td style="width:12px;"></td><td style="border-radius:6px;border:1px solid #C46B2B;"><a href="#" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#C46B2B;text-decoration:none;border-radius:6px;">Further discussion</a></td></tr></table>`,
      }
    : { cta: { label: "Set up portal access", url: "#" } };
  res.json(PreviewEmailTemplateResponse.parse({
    subject: rendered.subject,
    html: renderChariotEmail({ heading: rendered.heading, paragraphs: rendered.paragraphs, ...fixed }),
  }));
});

router.get("/settings/stage-thresholds", async (_req, res): Promise<void> => {
  const thresholds = await getStageThresholdsMap();
  res.json(
    ListStageThresholdsResponse.parse(
      stages.map((stage, stageIndex) => ({
        stageIndex,
        stage,
        thresholdDays: thresholds.get(stageIndex) ?? null,
      })),
    ),
  );
});

router.patch(
  "/settings/stage-thresholds/:stageIndex",
  async (req, res): Promise<void> => {
    if (!isFullAccess(res.locals.authUser.role)) {
      res.status(403).json({ error: "Administrator access required" });
      return;
    }
    const params = UpdateStageThresholdParams.safeParse(req.params);
    if (!params.success || params.data.stageIndex < 0 || params.data.stageIndex >= stages.length) {
      res.status(400).json({ error: "Invalid stage index" });
      return;
    }
    const body = UpdateStageThresholdBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const { stageIndex } = params.data;
    await db
      .insert(caseStageThresholdsTable)
      .values({ stageIndex, thresholdDays: body.data.thresholdDays })
      .onConflictDoUpdate({
        target: caseStageThresholdsTable.stageIndex,
        set: { thresholdDays: body.data.thresholdDays, updatedAt: new Date() },
      });
    res.json(
      UpdateStageThresholdResponse.parse({
        stageIndex,
        stage: stages[stageIndex],
        thresholdDays: body.data.thresholdDays,
      }),
    );
  },
);

router.get("/settings/default-assignees", async (_req, res): Promise<void> => {
  const defaults = await getDefaultAssignees();
  res.json(
    ListDefaultAssigneesResponse.parse(
      DEFAULT_ASSIGNEE_SECTIONS.map((section) => ({
        section,
        userId: defaults[section]?.id ?? null,
        displayName: defaults[section]?.displayName ?? null,
      })),
    ),
  );
});

router.patch("/settings/default-assignees/:section", async (req, res): Promise<void> => {
  if (!isFullAccess(res.locals.authUser.role)) {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  const params = UpdateDefaultAssigneeParams.safeParse(req.params);
  if (!params.success || !isDefaultAssigneeSection(params.data.section)) {
    res.status(400).json({ error: "Invalid section" });
    return;
  }
  const body = UpdateDefaultAssigneeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const staffUser = body.data.userId == null ? null : await activeStaffUser(body.data.userId);
  if (body.data.userId != null && !staffUser) {
    res.status(400).json({ error: "Default assignee must be an active staff user" });
    return;
  }
  const { section } = params.data;
  await db
    .insert(sectionDefaultAssigneesTable)
    .values({ section, userId: staffUser?.id ?? null })
    .onConflictDoUpdate({
      target: sectionDefaultAssigneesTable.section,
      set: { userId: staffUser?.id ?? null, updatedAt: new Date() },
    });
  res.json(
    UpdateDefaultAssigneeResponse.parse({
      section,
      userId: staffUser?.id ?? null,
      displayName: staffUser?.displayName ?? null,
    }),
  );
});

router.post("/cases", async (req, res): Promise<void> => {
  const parsed = CreateCaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const clientExists = await clientName(parsed.data.clientId);
  if (clientExists === "Unknown client") {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const [property] = await db.select().from(propertiesTable)
    .where(eq(propertiesTable.id, parsed.data.propertyId));
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  if (property.clientId !== parsed.data.clientId) {
    res.status(409).json({ error: "Selected property does not belong to the selected client" });
    return;
  }
  if (parsed.data.lenderId) {
    const [lender] = await db.select({ id: lendersTable.id }).from(lendersTable)
      .where(eq(lendersTable.id, parsed.data.lenderId));
    if (!lender) {
      res.status(404).json({ error: "Lender not found" });
      return;
    }
  }
  // Explicit pick → Settings default → first active case manager. (The
  // advice stage itself is owned by the adviser; see the stage-0 task below.)
  const assignee = await resolveAssignee({
    section: "case",
    explicitUserId: parsed.data.assignedUserId,
    fallbackRole: "case_manager",
  });
  if (!assignee.ok) {
    res.status(400).json({ error: assignee.error });
    return;
  }
  // Legacy clients still send a free-text assignedTo; prefer the resolved user's
  // display name whenever an explicit assignee was chosen.
  const assignedTo = parsed.data.assignedUserId != null
    ? assignee.staffUser?.displayName
    : (parsed.data.assignedTo ?? assignee.staffUser?.displayName);
  if (!assignedTo) {
    res.status(400).json({ error: "No assignee available for this case" });
    return;
  }
  const assignedUserId = parsed.data.assignedUserId != null || !parsed.data.assignedTo
    ? assignee.staffUser?.id ?? null
    : (await activeStaffUserByName(parsed.data.assignedTo))?.id ?? null;
  const reference = `CH-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const [created] = await db
    .insert(casesTable)
    .values({
      reference,
      clientId: parsed.data.clientId,
      propertyId: property.id,
      propertyAddress: formatAddress(property),
      matterType: property.matterType,
      serviceType: parsed.data.serviceType,
      loanAmount: parsed.data.loanAmount,
      propertyValue: parsed.data.propertyValue,
      rent: parsed.data.rent,
      gdv: parsed.data.gdv,
      assignedTo,
      assignedUserId,
      lenderId: parsed.data.lenderId,
      stageIndex: 0,
      procFeePct: parsed.data.procFeePct ?? DEFAULT_PROC_FEE_PCT,
      brokerFeePct: parsed.data.brokerFeePct ?? DEFAULT_BROKER_FEE_PCT,
      brokerFeeBasis: parsed.data.brokerFeeBasis ?? "percent",
      brokerFeeFlat: parsed.data.brokerFeeFlat ?? null,
    })
    .returning();
  if (!created) {
    res.status(500).json({ error: "Case was not created" });
    return;
  }
  await db.insert(requirementsTable).values(
    Object.entries(stageRequirements).flatMap(([stageIndex, labels]) =>
      labels
        // Advised cases send written advice; execution-only cases record the client's instruction instead.
        .filter((label) => needsAdvice(created.serviceType)
          ? !INSTRUCTION_ONLY_LABELS.includes(label)
          : !ADVICE_ONLY_LABELS.includes(label))
        .map((label) => ({
          caseId: created.id,
          stageIndex: Number(stageIndex),
          label,
        })),
    ),
  );
  await ensureSubmissionForCaseLender(created.id, created.lenderId);
  await reconcileCasePortfolioRequirement(created.id, created.lenderId);
  await db.insert(activitiesTable).values({
    caseId: created.id,
    title: "Case created",
    detail: `${reference} opened for ${clientExists}`,
    actorName: res.locals.authUser.displayName,
  });
  await completeClientTasks(created.clientId, [ADVANCED_CASE_KIND], res.locals.authUser.id);
  // Two tasks open with the case: the owner's field checklist (gathers the
  // submission details), and the adviser's stage-0 task to confirm the service
  // level and write the advice — routed to the Advice stage default in Settings.
  const assigneeDefaults = await getDefaultAssignees();
  await createAssignmentTask({
    staffUser: assignee.staffUser,
    caseId: created.id,
    clientId: parsed.data.clientId,
    kind: "case_submission",
    title: `New case: gather submission details — ${reference}`,
    notes: `${clientExists} — ${formatAddress(property)}`,
  }).catch((error) => logger.warn({ err: error, caseId: created.id }, "Case checklist task was not created"));
  await createHandoffTask({
    caseId: created.id,
    clientId: parsed.data.clientId,
    reference,
    stageIndex: 0,
    defaults: assigneeDefaults,
    title: `New case: set up advice — ${reference}`,
    notes: `${clientExists} — ${formatAddress(property)} (${serviceTypeLabel(created.serviceType)}). Confirm the service level${needsAdvice(created.serviceType) ? ", write the recommendation and send it to the client" : ""}.`,
  }).catch((error) => logger.warn({ err: error, caseId: created.id }, "Advice task was not created"));
  res.status(201).json(CreateCaseResponse.parse(await caseView(created)));
});

/** The full CaseDetail payload for one case row (GET /cases/:id and the actions that return it). */
export async function caseDetailView(caseRow: typeof casesTable.$inferSelect) {
  await ensureCompletionActionRequirement(caseRow.id);
  await reconcileCasePortfolioRequirement(caseRow.id, caseRow.lenderId);
  // Cases created before multi-lender submissions existed get a row for their lender.
  await ensureSubmissionForCaseLender(caseRow.id, caseRow.lenderId);
  const [requirements, tasks, messages, submissions] = await Promise.all([
    db
      .select()
      .from(requirementsTable)
      .where(eq(requirementsTable.caseId, caseRow.id))
      .orderBy(asc(requirementsTable.stageIndex), asc(requirementsTable.id)),
    db.select().from(tasksTable).where(eq(tasksTable.caseId, caseRow.id)),
    db
      .select()
      .from(messagesTable)
      .where(and(
        eq(messagesTable.caseId, caseRow.id),
        isNull(messagesTable.conversationId),
      ))
      .orderBy(asc(messagesTable.createdAt)),
    listSubmissions(caseRow.id).then(submissionViews),
  ]);
  const base = await caseView(caseRow);
  return {
    ...base,
    submissions,
    termsOfBusiness: await caseTermsAcceptance(caseRow.id),
    stages,
    requirements: requirements.map((item) => ({
      id: item.id,
      stageIndex: item.stageIndex,
      label: item.label,
      complete: item.complete,
      required: item.required,
      round: item.round,
    })),
    tasks: await taskViews(tasks),
    messages: messages.map((item) => ({
      id: item.id,
      caseId: item.caseId,
      caseReference: refOf(caseRow),
      sender: item.sender,
      senderRole: item.senderRole,
      body: item.body,
      createdAt: iso(item.createdAt),
    })),
    draftNotes: caseRow.draftNotes,
  };
}

router.get("/cases/:id", async (req, res): Promise<void> => {
  const params = GetCaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [caseRow] = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.json(GetCaseResponse.parse(await caseDetailView(caseRow)));
});

router.post("/cases/:id/submissions", async (req, res): Promise<void> => {
  const params = CreateCaseSubmissionParams.safeParse(req.params);
  const body = CreateCaseSubmissionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid submission" });
    return;
  }
  const [caseRow] = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const [lender] = await db.select({ id: lendersTable.id, name: lendersTable.name }).from(lendersTable).where(eq(lendersTable.id, body.data.lenderId));
  if (!lender) {
    res.status(404).json({ error: "Lender not found" });
    return;
  }
  const created = await addSubmission(caseRow.id, lender.id);
  if (!created) {
    res.status(409).json({ error: `Already submitted to ${lender.name}` });
    return;
  }
  await reconcileCasePortfolioRequirement(caseRow.id, (await db.select({ lenderId: casesTable.lenderId }).from(casesTable).where(eq(casesTable.id, caseRow.id)))[0]?.lenderId ?? null);
  await db.insert(activitiesTable).values({
    caseId: caseRow.id,
    title: "Submitted to lender",
    detail: `Case submitted to ${lender.name}`,
    actorName: res.locals.authUser.displayName,
  });
  await syncCaseChecklists(caseRow.id);
  res.status(201).json(CreateCaseSubmissionResponse.parse(await submissionView(created)));
});

router.patch("/cases/:id/submissions/:submissionId", async (req, res): Promise<void> => {
  const params = UpdateCaseSubmissionParams.safeParse(req.params);
  const body = UpdateCaseSubmissionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid submission update" });
    return;
  }
  const [existing] = await db
    .select()
    .from(caseSubmissionsTable)
    .where(and(eq(caseSubmissionsTable.id, params.data.submissionId), eq(caseSubmissionsTable.caseId, params.data.id)));
  if (!existing) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  const closing = body.data.status !== undefined && (body.data.status === "withdrawn" || body.data.status === "declined");
  const reopening = body.data.status !== undefined && !closing && (existing.status === "withdrawn" || existing.status === "declined");
  if (body.data.isPrimary === true && (closing || (existing.status !== "active" && existing.status !== "offered" && !reopening))) {
    res.status(409).json({ error: "Only an open submission can be primary" });
    return;
  }
  const [updated] = await db
    .update(caseSubmissionsTable)
    .set({
      lenderCaseNumber: body.data.lenderCaseNumber !== undefined ? (body.data.lenderCaseNumber?.trim() || null) : undefined,
      applicationFeeConfirmed: body.data.applicationFeeConfirmed,
      applicationFeeConfirmedAt: body.data.applicationFeeConfirmed === true
        ? (existing.applicationFeeConfirmedAt ?? new Date())
        : body.data.applicationFeeConfirmed === false ? null : undefined,
      valuationDate: body.data.valuationDate !== undefined
        ? (body.data.valuationDate ? new Date(body.data.valuationDate) : null)
        : undefined,
      valuationCompletedAt: body.data.valuationCompletedAt !== undefined
        ? (body.data.valuationCompletedAt ? new Date(body.data.valuationCompletedAt) : null)
        : undefined,
      bankDecisionRequested: body.data.bankDecisionRequested,
      bankDecisionRequestedAt: body.data.bankDecisionRequested === true
        ? (existing.bankDecisionRequestedAt ?? new Date())
        : body.data.bankDecisionRequested === false ? null : undefined,
      notes: body.data.notes,
      status: body.data.status,
      closedAt: closing ? new Date() : reopening ? null : undefined,
      closeReason: closing ? (body.data.closeReason?.trim() || null) : reopening ? null : body.data.closeReason,
      isPrimary: body.data.isPrimary === true ? true : undefined,
    })
    .where(eq(caseSubmissionsTable.id, existing.id))
    .returning();
  if (body.data.isPrimary === true) {
    await db
      .update(caseSubmissionsTable)
      .set({ isPrimary: false })
      .where(and(eq(caseSubmissionsTable.caseId, existing.caseId), ne(caseSubmissionsTable.id, existing.id)));
  }
  const [caseBefore] = await db.select().from(casesTable).where(eq(casesTable.id, existing.caseId));
  const primary = await syncCaseFromSubmissions(existing.caseId);
  await reconcileCasePortfolioRequirement(existing.caseId, primary?.lenderId ?? null);
  const [caseAfter] = await db.select().from(casesTable).where(eq(casesTable.id, existing.caseId));
  if (caseBefore && caseAfter) {
    await applyCaseReferenceChange(existing.caseId, refOf(caseBefore), refOf(caseAfter), res.locals.authUser.displayName);
  }
  const [lender] = await db.select({ name: lendersTable.name }).from(lendersTable).where(eq(lendersTable.id, existing.lenderId));
  const lenderName = lender?.name ?? "Lender";
  const actorName = res.locals.authUser.displayName;
  if (body.data.status !== undefined && body.data.status !== existing.status) {
    const label = body.data.status === "withdrawn" ? "Submission withdrawn"
      : body.data.status === "declined" ? "Lender declined"
      : body.data.status === "offered" ? "Offer received"
      : "Submission reopened";
    await db.insert(activitiesTable).values({
      caseId: existing.caseId,
      title: label,
      detail: `${lenderName}${body.data.closeReason ? ` — ${body.data.closeReason}` : ""}`,
      actorName,
    });
  }
  if (body.data.isPrimary === true && !existing.isPrimary) {
    await db.insert(activitiesTable).values({
      caseId: existing.caseId, title: "Lender chosen", detail: `${refOf(caseAfter ?? caseBefore!)} now proceeds with ${lenderName}`, actorName,
    });
  }
  if (body.data.applicationFeeConfirmed === true && !existing.applicationFeeConfirmed) {
    await db.insert(activitiesTable).values({
      caseId: existing.caseId, title: "Fee confirmed", detail: `Application & valuation fee confirmed with ${lenderName}`, actorName,
    });
  }
  if (body.data.bankDecisionRequested === true && !existing.bankDecisionRequested) {
    await db.insert(activitiesTable).values({
      caseId: existing.caseId, title: "Decision requested", detail: `Decision requested from ${lenderName}`, actorName,
    });
  }
  await syncCaseChecklists(existing.caseId);
  res.json(UpdateCaseSubmissionResponse.parse(await submissionView(updated!)));
});

router.delete("/cases/:id/submissions/:submissionId", async (req, res): Promise<void> => {
  const params = DeleteCaseSubmissionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid submission" });
    return;
  }
  const [existing] = await db
    .select()
    .from(caseSubmissionsTable)
    .where(and(eq(caseSubmissionsTable.id, params.data.submissionId), eq(caseSubmissionsTable.caseId, params.data.id)));
  if (!existing) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  const [dip] = await db.select({ id: documentsTable.id }).from(documentsTable)
    .where(and(eq(documentsTable.submissionId, existing.id), eq(documentsTable.category, "DIP"))).limit(1);
  if (!submissionIsBlank(existing, !!dip)) {
    res.status(409).json({ error: "This submission has tracking recorded. Withdraw it instead of deleting it." });
    return;
  }
  await db.delete(caseSubmissionsTable).where(eq(caseSubmissionsTable.id, existing.id));
  const primary = await syncCaseFromSubmissions(existing.caseId);
  await reconcileCasePortfolioRequirement(existing.caseId, primary?.lenderId ?? null);
  await syncCaseChecklists(existing.caseId);
  res.status(204).end();
});


router.patch("/cases/:id", async (req, res): Promise<void> => {
  const params = UpdateCaseParams.safeParse(req.params);
  const body = UpdateCaseBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid case update" });
    return;
  }
  const [existingCase] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!existingCase) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  if (body.data.lenderId !== undefined) {
    const [lender] = await db.select({ id: lendersTable.id }).from(lendersTable)
      .where(eq(lendersTable.id, body.data.lenderId));
    if (!lender) {
      res.status(404).json({ error: "Lender not found" });
      return;
    }
  }
  if (body.data.underwritingCleared === true) {
    const { maxRound, latestRoundItems } = await latestStageRound(existingCase.id, UNDERWRITING_STAGE_INDEX);
    const latestRoundComplete = maxRound > 0 && latestRoundItems.every((item) => !item.required || item.complete);
    if (!latestRoundComplete) {
      res.status(409).json({ error: "Complete all of the current round's requirements before marking underwriting as complete" });
      return;
    }
  }
  // Reassigning by user id keeps assignedTo (a display name) in step with the staff directory;
  // a legacy display-name change is resolved back to the user so the id link is never stale.
  let assignedTo = body.data.assignedTo;
  let assignedUserId: number | null | undefined;
  if (body.data.assignedUserId !== undefined) {
    const staffUser = await activeStaffUser(body.data.assignedUserId);
    if (!staffUser) {
      res.status(400).json({ error: "Assignee must be an active staff user" });
      return;
    }
    assignedTo = staffUser.displayName;
    assignedUserId = staffUser.id;
  } else if (body.data.assignedTo !== undefined) {
    assignedUserId = (await activeStaffUserByName(body.data.assignedTo))?.id ?? null;
  }
  const oldRef = refOf(existingCase);
  const trimmedCaseNumber = body.data.caseNumber !== undefined ? body.data.caseNumber.trim() : undefined;
  const newDisplayReference = trimmedCaseNumber !== undefined
    ? (trimmedCaseNumber || null)
    : undefined;
  const [updated] = await db
    .update(casesTable)
    .set({
      assignedTo,
      assignedUserId,
      status: body.data.status,
      lenderId: body.data.lenderId,
      lenderCaseNumber: trimmedCaseNumber !== undefined ? (trimmedCaseNumber || null) : undefined,
      displayReference: newDisplayReference,
      draftNotes: body.data.draftNotes,
      serviceType: body.data.serviceType,
      loanAmount: body.data.loanAmount,
      propertyValue: body.data.propertyValue,
      rent: body.data.rent,
      gdv: body.data.gdv,
      procFeePct: body.data.procFeePct,
      brokerFeePct: body.data.brokerFeePct,
      brokerFeeBasis: body.data.brokerFeeBasis,
      brokerFeeFlat: body.data.brokerFeeFlat,
      valuationDate: body.data.valuationDate !== undefined
        ? (body.data.valuationDate ? new Date(body.data.valuationDate) : null)
        : undefined,
      // A new (or cleared) valuation date means the valuation has not happened yet.
      valuationCompletedAt: body.data.valuationDate !== undefined ? null : undefined,
      expectedCompletionDate: body.data.expectedCompletionDate !== undefined
        ? (body.data.expectedCompletionDate ? new Date(body.data.expectedCompletionDate) : null)
        : undefined,
      applicationFeeConfirmed: body.data.applicationFeeConfirmed,
      applicationFeeConfirmedAt: body.data.applicationFeeConfirmed === true
        ? new Date()
        : body.data.applicationFeeConfirmed === false ? null : undefined,
      bankDecisionRequested: body.data.bankDecisionRequested,
      bankDecisionRequestedAt: body.data.bankDecisionRequested === true
        ? new Date()
        : body.data.bankDecisionRequested === false ? null : undefined,
      underwritingCleared: body.data.underwritingCleared,
      underwritingClearedAt: body.data.underwritingCleared === true
        ? new Date()
        : body.data.underwritingCleared === false ? null : undefined,
    })
    .where(eq(casesTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  if (body.data.lenderId !== undefined) {
    await reconcileCasePortfolioRequirement(updated.id, updated.lenderId);
  }
  // Legacy single-lender writes stay in step with the per-lender submissions.
  if (body.data.lenderId !== undefined) await ensureSubmissionForCaseLender(updated.id, updated.lenderId);
  await mirrorCaseIntoPrimarySubmission(updated);
  if (body.data.serviceType !== undefined && body.data.serviceType !== existingCase.serviceType) {
    // The adviser confirmed a different level: start that decision again.
    await db.update(casesTable)
      .set({ serviceLevelConfirmedAt: null, serviceLevelConfirmedByUserId: null })
      .where(eq(casesTable.id, updated.id));
    await setRequirement(updated.id, ADVICE_STAGE_INDEX, SERVICE_LEVEL_LABEL, false, null);
    if (needsAdvice(updated.serviceType)) {
      for (const label of ADVICE_ONLY_LABELS) await setRequirement(updated.id, ADVICE_STAGE_INDEX, label, false, null);
      for (const label of INSTRUCTION_ONLY_LABELS) await removeRequirement(updated.id, label);
    } else {
      for (const label of ADVICE_ONLY_LABELS) await removeRequirement(updated.id, label);
      for (const label of INSTRUCTION_ONLY_LABELS) await setRequirement(updated.id, ADVICE_STAGE_INDEX, label, false, null);
    }
  }
  await syncCaseChecklists(updated.id);
  const newRef = refOf(updated);
  if (newDisplayReference !== undefined && newRef !== oldRef) {
    await applyCaseReferenceChange(updated.id, oldRef, newRef, res.locals.authUser.displayName);
  }
  const actorId = res.locals.authUser.id;
  if (body.data.valuationDate !== undefined || newRef !== oldRef) {
    await syncCaseDate(updated, "valuation", updated.valuationDate, actorId);
  }
  if (body.data.expectedCompletionDate !== undefined || newRef !== oldRef) {
    await syncCaseDate(updated, "completion", updated.expectedCompletionDate, actorId);
  }
  res.json(UpdateCaseResponse.parse(await caseView(updated)));
});

router.post("/cases/:id/requirements", async (req, res): Promise<void> => {
  const params = GetCaseParams.safeParse(req.params);
  const body = AddCaseRequirementBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid requirement" });
    return;
  }
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const existing = await db
    .select()
    .from(requirementsTable)
    .where(
      and(
        eq(requirementsTable.caseId, caseRow.id),
        eq(requirementsTable.stageIndex, caseRow.stageIndex),
      ),
    );
  const maxRound = existing.reduce((max, item) => Math.max(max, item.round), 0);
  // A new round starts once every requirement in the current (max) round is complete;
  // otherwise the new item joins that still-open round.
  const currentRoundItems = existing.filter((item) => item.round === maxRound);
  const currentRoundComplete = maxRound > 0 && currentRoundItems.every((item) => item.complete);
  const round = maxRound === 0 || currentRoundComplete ? maxRound + 1 : maxRound;
  const [created] = await db
    .insert(requirementsTable)
    .values({
      caseId: caseRow.id,
      stageIndex: caseRow.stageIndex,
      label: body.data.label,
      required: body.data.required ?? true,
      round,
    })
    .returning();
  if (!created) {
    res.status(500).json({ error: "Requirement was not created" });
    return;
  }
  await db.insert(activitiesTable).values({
    caseId: caseRow.id,
    title: "Requirement added",
    detail: `"${created.label}" added to ${refOf(caseRow)} (round ${round})`,
    actorName: res.locals.authUser.displayName,
  });
  await syncCaseChecklists(caseRow.id);
  res.status(201).json(
    AddCaseRequirementResponse.parse({
      id: created.id,
      stageIndex: created.stageIndex,
      label: created.label,
      complete: created.complete,
      required: created.required,
      round: created.round,
    }),
  );
});

router.patch("/cases/:id/requirements/:reqId", async (req, res): Promise<void> => {
  const params = UpdateCaseRequirementParams.safeParse(req.params);
  const body = UpdateCaseRequirementBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid requirement update" });
    return;
  }
  const [requirement] = await db.select().from(requirementsTable)
    .where(and(eq(requirementsTable.id, params.data.reqId), eq(requirementsTable.caseId, params.data.id)));
  if (!requirement) {
    res.status(404).json({ error: "Requirement not found" });
    return;
  }
  const [updated] = await db
    .update(requirementsTable)
    .set({
      complete: body.data.complete,
      completedAt: body.data.complete ? new Date() : null,
      completedBy: body.data.complete ? res.locals.authUser.displayName : null,
    })
    .where(eq(requirementsTable.id, requirement.id))
    .returning();
  if (!updated) {
    res.status(500).json({ error: "Requirement was not updated" });
    return;
  }
  await syncCaseChecklists(updated.caseId);
  res.json(
    UpdateCaseRequirementResponse.parse({
      id: updated.id,
      stageIndex: updated.stageIndex,
      label: updated.label,
      complete: updated.complete,
      required: updated.required,
      round: updated.round,
    }),
  );
});

router.post("/cases/:id/underwriting/extract", async (req, res): Promise<void> => {
  const params = ExtractUnderwritingRequirementsParams.safeParse(req.params);
  const body = ExtractUnderwritingRequirementsBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid email text" });
    return;
  }
  const [caseRow] = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.json(ExtractUnderwritingRequirementsResponse.parse(await extractUnderwritingRequirements(body.data.emailText)));
});

router.post("/cases/:id/underwriting/rounds", async (req, res): Promise<void> => {
  const params = AddUnderwritingRoundParams.safeParse(req.params);
  const body = AddUnderwritingRoundBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid underwriting round" });
    return;
  }
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  try {
    await createUnderwritingRound(
      caseRow,
      { emailText: body.data.emailText, labels: body.data.requirementLabels },
      { id: res.locals.authUser.id, displayName: res.locals.authUser.displayName },
    );
  } catch (error) {
    if (error instanceof RoundStillOpenError) {
      res.status(409).json({ error: `Round ${error.round} is still open - mark it as sent to the lender before starting a new one` });
      return;
    }
    if (error instanceof Error && error.message === "At least one requirement is required") {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
  const [refreshedCase] = await db.select().from(casesTable).where(eq(casesTable.id, caseRow.id));
  res.status(201).json(AddUnderwritingRoundResponse.parse(await caseDetailView(refreshedCase!)));
});

/** Everything the lender asked for is provided and sent back: closes the round and its task. */
router.post("/cases/:id/underwriting/rounds/:round/sent", async (req, res): Promise<void> => {
  const params = MarkUnderwritingRoundSentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid round" });
    return;
  }
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  try {
    const row = await markRoundSent(caseRow, params.data.round, { id: res.locals.authUser.id, displayName: res.locals.authUser.displayName });
    if (!row) {
      res.status(404).json({ error: "Round not found" });
      return;
    }
  } catch (error) {
    if (error instanceof RoundIncompleteError) {
      res.status(409).json({ error: `${error.open} item${error.open === 1 ? " is" : "s are"} still open in round ${error.round} - tick everything the lender asked for first` });
      return;
    }
    throw error;
  }
  await syncCaseChecklists(caseRow.id);
  const [refreshedCase] = await db.select().from(casesTable).where(eq(casesTable.id, caseRow.id));
  res.json(MarkUnderwritingRoundSentResponse.parse(await caseDetailView(refreshedCase!)));
});

router.post("/cases/:id/archive", async (req, res): Promise<void> => {
  const params = GetCaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid case" });
    return;
  }
  const [updated] = await db
    .update(casesTable)
    .set({ archivedAt: new Date() })
    .where(and(eq(casesTable.id, params.data.id), isNull(casesTable.archivedAt)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Case not found or already archived" });
    return;
  }
  await db.insert(activitiesTable).values({
    caseId: updated.id,
    title: "Case archived",
    detail: `${refOf(updated)} was archived`,
    actorName: res.locals.authUser.displayName,
  });
  res.json(ArchiveCaseResponse.parse(await caseView(updated)));
});

router.post("/cases/:id/restore", async (req, res): Promise<void> => {
  const params = GetCaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid case" });
    return;
  }
  const [updated] = await db
    .update(casesTable)
    .set({ archivedAt: null })
    .where(eq(casesTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  await db.insert(activitiesTable).values({
    caseId: updated.id,
    title: "Case restored",
    detail: `${refOf(updated)} was restored from the archive`,
    actorName: res.locals.authUser.displayName,
  });
  res.json(RestoreCaseResponse.parse(await caseView(updated)));
});

router.get("/cases/:id/stress-test", async (req, res): Promise<void> => {
  const params = GetCaseStressTestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid case" });
    return;
  }
  const [caseRow] = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const row = await ensureCaseStressTest(caseRow);
  res.json(GetCaseStressTestResponse.parse(await stressTestView(row)));
});

router.patch("/cases/:id/stress-test", async (req, res): Promise<void> => {
  const params = UpdateCaseStressTestParams.safeParse(req.params);
  const body = UpdateCaseStressTestBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid stress test update" });
    return;
  }
  const [caseRow] = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  if (body.data.lenderId) {
    const [lender] = await db.select({ id: lendersTable.id }).from(lendersTable)
      .where(eq(lendersTable.id, body.data.lenderId));
    if (!lender) {
      res.status(404).json({ error: "Lender not found" });
      return;
    }
  }
  await ensureCaseStressTest(caseRow);
  const [updated] = await db
    .update(caseStressTestsTable)
    .set(body.data)
    .where(eq(caseStressTestsTable.caseId, caseRow.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Stress test not found" });
    return;
  }
  res.json(UpdateCaseStressTestResponse.parse(await stressTestView(updated)));
});

router.post("/cases/:id/stress-test/apply-property-value", async (req, res): Promise<void> => {
  const params = GetCaseStressTestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid case" });
    return;
  }
  const [caseRow] = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }

  const stressTest = await ensureCaseStressTest(caseRow);
  const propertyValue = Number(stressTest.propertyValue ?? 0);
  if (propertyValue <= 0 || !stressTestPasses(stressTest)) {
    res.status(409).json({ error: "Only a passing stress test can set the case property value" });
    return;
  }

  const updated = await db.transaction(async (tx) => {
    const [updatedCase] = await tx
      .update(casesTable)
      .set({ propertyValue })
      .where(eq(casesTable.id, caseRow.id))
      .returning();
    if (!updatedCase) return null;

    if (updatedCase.propertyId) {
      await tx
        .update(propertiesTable)
        .set({ value: propertyValue })
        .where(eq(propertiesTable.id, updatedCase.propertyId));
    }

    await tx.insert(activitiesTable).values({
      caseId: updatedCase.id,
      title: "Stress test property value applied",
      detail: `${refOf(updatedCase)} property value updated to £${propertyValue.toLocaleString("en-GB")}`,
      actorName: res.locals.authUser.displayName,
    });
    return updatedCase;
  });

  if (!updated) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.json(UpdateCaseResponse.parse(await caseView(updated)));
});

router.post("/cases/:id/lender-offer/extract", async (req, res): Promise<void> => {
  const params = ExtractCaseLenderOfferDetailsParams.safeParse(req.params);
  const body = ExtractCaseLenderOfferDetailsBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid lender offer extraction request" });
    return;
  }
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const [document] = await db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.id, body.data.documentId),
        eq(documentsTable.caseId, caseRow.id),
        eq(documentsTable.category, "LENDER_OFFER"),
      ),
    );
  if (!document?.objectPath) {
    res.status(404).json({ error: "Lender offer document not found for this case" });
    return;
  }

  let bytes: Buffer;
  try {
    bytes = await documentStorage.get(document.objectPath);
  } catch {
    res.status(404).json({ error: "Lender offer document is unavailable" });
    return;
  }

  try {
    const result = await runOpenRouterWorkflow<
      { filename: string; contentType: string },
      { offerAddress?: unknown; offerClientName?: unknown; offerPropertyValue?: unknown }
    >({
      workflow: "extract_lender_offer_details",
      schemaName: "LenderOfferExtractionResponse",
      context: { filename: document.name, contentType: document.contentType ?? "application/octet-stream" },
      systemInstruction: [
        "Read the attached lender offer document and extract the offer's property address, client name, and property value.",
        "Return only a JSON object with exactly these keys: offerAddress, offerClientName, offerPropertyValue.",
        "offerAddress and offerClientName must be strings. offerPropertyValue must be a number in the document's currency, without symbols or thousands separators.",
        "Do not infer missing values. If a value cannot be read confidently, return an empty string for text or null for the numeric value.",
      ].join(" "),
      document: {
        filename: document.name,
        contentType: document.contentType ?? "application/octet-stream",
        bytes,
      },
    });
    if (result.status === "disabled") {
      res.status(503).json({ error: "OpenRouter extraction is not configured" });
      return;
    }
    const data = result.data;
    const offerAddress = typeof data?.offerAddress === "string" ? data.offerAddress.trim() : "";
    const offerClientName = typeof data?.offerClientName === "string" ? data.offerClientName.trim() : "";
    const offerPropertyValue = typeof data?.offerPropertyValue === "number"
      ? data.offerPropertyValue
      : Number(data?.offerPropertyValue);
    if (!offerAddress || !offerClientName || !Number.isFinite(offerPropertyValue) || offerPropertyValue <= 0) {
      res.status(422).json({ error: "The lender offer did not contain all three required values" });
      return;
    }
    res.json(ExtractCaseLenderOfferDetailsResponse.parse({
      offerAddress,
      offerClientName,
      offerPropertyValue,
      model: result.model ?? null,
    }));
  } catch (error) {
    logger.error({ err: error, caseId: caseRow.id }, "Lender offer extraction failed");
    res.status(502).json({ error: "The lender offer could not be read automatically" });
  }
});

router.post("/cases/:id/completion/prepare", async (req, res): Promise<void> => {
  const params = PrepareCaseCompletionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid case" });
    return;
  }
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  if (caseRow.stageIndex !== AWAITING_COMPLETION_STAGE_INDEX) {
    res.status(409).json({ error: "Case is not at the Completion stage" });
    return;
  }
  const [document] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.caseId, caseRow.id), eq(documentsTable.category, "LENDER_OFFER")))
    .orderBy(desc(documentsTable.uploadedAt))
    .limit(1);
  if (!document?.objectPath) {
    res.status(404).json({ error: "Lender offer document not found for this case" });
    return;
  }
  let bytes: Buffer;
  try {
    bytes = await documentStorage.get(document.objectPath);
  } catch {
    res.status(404).json({ error: "Lender offer document is unavailable" });
    return;
  }
  try {
    const result = await runOpenRouterWorkflow<
      { filename: string; contentType: string; caseMatterType: string },
      { summary?: unknown; renewalType?: unknown; rateEndDate?: unknown; completionDate?: unknown }
    >({
      workflow: "summarise_lender_offer",
      schemaName: "CompletionPreparationResponse",
      context: {
        filename: document.name,
        contentType: document.contentType ?? "application/octet-stream",
        caseMatterType: caseRow.matterType,
      },
      systemInstruction: [
        "Read the attached lender offer and summarise the key terms relevant to post-completion follow-up.",
        "Extract whether this is a bridging mortgage or a normal mortgage, the fixed/rate end date, and the mortgage completion date if stated.",
        "Return only JSON with exactly these keys: summary, renewalType, rateEndDate, completionDate.",
        "renewalType must be fixed_rate or bridging. Dates must be ISO YYYY-MM-DD strings or null. Do not invent a rate end date.",
        "The summary should be concise plain text for staff notes and must not claim certainty where the document is unclear.",
      ].join(" "),
      document: {
        filename: document.name,
        contentType: document.contentType ?? "application/octet-stream",
        bytes,
      },
    });
    if (result.status === "disabled") {
      res.status(503).json({ error: "OpenRouter extraction is not configured" });
      return;
    }
    const data = result.data;
    const renewalType = data?.renewalType === "bridging" ? "bridging" : "fixed_rate";
    const cleanDate = (value: unknown) =>
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    const rateEndDate = cleanDate(data?.rateEndDate);
    // Prefer the expected completion date already recorded on the case over the model's guess.
    const expected = caseRow.expectedCompletionDate ? caseRow.expectedCompletionDate.toISOString().slice(0, 10) : null;
    const completionDate = expected ?? cleanDate(data?.completionDate) ?? (renewalType === "bridging" ? new Date().toISOString().slice(0, 10) : null);
    const summary = typeof data?.summary === "string" ? data.summary.trim() : "";
    if (!summary) {
      res.status(422).json({ error: "The lender offer summary was empty" });
      return;
    }
    res.json(PrepareCaseCompletionResponse.parse({
      summary,
      renewalType,
      rateEndDate,
      completionDate,
      model: result.model ?? null,
    }));
  } catch (error) {
    logger.error({ err: error, caseId: caseRow.id }, "Lender offer completion summary failed");
    res.status(502).json({ error: "The lender offer could not be summarised automatically" });
  }
});

router.get("/cases/:id/lender-offer", async (req, res): Promise<void> => {
  const params = GetCaseLenderOfferReviewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid case" });
    return;
  }
  const [caseRow] = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const [review] = await db
    .select()
    .from(lenderOfferReviewsTable)
    .where(eq(lenderOfferReviewsTable.caseId, caseRow.id));
  res.json(GetCaseLenderOfferReviewResponse.parse(await lenderOfferReviewView(caseRow, review ?? null)));
});

router.post("/cases/:id/lender-offer", async (req, res): Promise<void> => {
  const params = ReviewCaseLenderOfferParams.safeParse(req.params);
  const body = ReviewCaseLenderOfferBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid lender offer review" });
    return;
  }
  const [caseRow] = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const [document] = await db
    .select({ id: documentsTable.id })
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.id, body.data.documentId),
        eq(documentsTable.caseId, caseRow.id),
        eq(documentsTable.category, "LENDER_OFFER"),
      ),
    );
  if (!document) {
    res.status(404).json({ error: "Lender offer document not found for this case" });
    return;
  }

  const offerAddress = body.data.offerAddress.trim();
  const offerClientName = body.data.offerClientName.trim();
  const offerPropertyValue = body.data.offerPropertyValue;
  const expectedClientName = await clientName(caseRow.clientId);
  const addressMatches = normalizeOfferText(offerAddress) === normalizeOfferText(caseRow.propertyAddress);
  const nameMatches = normalizeOfferText(offerClientName) === normalizeOfferText(expectedClientName);
  const valueMatches = Math.abs(offerPropertyValue - caseRow.propertyValue) < 0.01;
  const allMatched = addressMatches && nameMatches && valueMatches;
  const reviewedAt = new Date();

  await db
    .insert(lenderOfferReviewsTable)
    .values({
      caseId: caseRow.id,
      documentId: document.id,
      offerAddress,
      offerClientName,
      offerPropertyValue,
      addressMatches,
      nameMatches,
      valueMatches,
      reviewedAt,
    })
    .onConflictDoUpdate({
      target: lenderOfferReviewsTable.caseId,
      set: {
        documentId: document.id,
        offerAddress,
        offerClientName,
        offerPropertyValue,
        addressMatches,
        nameMatches,
        valueMatches,
        reviewedAt,
        updatedAt: new Date(),
      },
    });

  await db
    .update(requirementsTable)
    .set({ complete: allMatched, completedAt: allMatched ? reviewedAt : null })
    .where(
      and(
        eq(requirementsTable.caseId, caseRow.id),
        eq(requirementsTable.stageIndex, stages.indexOf("Lender offer")),
        eq(requirementsTable.label, "Offer details checked"),
      ),
    );
  await db.insert(activitiesTable).values({
    caseId: caseRow.id,
    title: allMatched ? "Lender offer details matched" : "Lender offer details reviewed",
    detail: allMatched
      ? `${refOf(caseRow)} offer address, client name and property value matched the case`
      : `${refOf(caseRow)} offer review found one or more mismatched details`,
    actorName: res.locals.authUser.displayName,
  });

  const [savedReview] = await db
    .select()
    .from(lenderOfferReviewsTable)
    .where(eq(lenderOfferReviewsTable.caseId, caseRow.id));
  res.json(ReviewCaseLenderOfferResponse.parse(await lenderOfferReviewView(caseRow, savedReview ?? null)));
});

router.post("/cases/:id/valuation", async (req, res): Promise<void> => {
  const params = SetCaseValuationCompletedParams.safeParse(req.params);
  const body = SetCaseValuationCompletedBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  if (!caseRow.valuationDate) {
    res.status(409).json({ error: "Set a valuation date first" });
    return;
  }
  const updated = await setValuationCompleted(
    caseRow.id,
    body.data.completed,
    { userId: res.locals.authUser.id, displayName: res.locals.authUser.displayName },
    body.data.amount,
  );
  res.json(SetCaseValuationCompletedResponse.parse(await caseView(updated ?? caseRow)));
});

export type AdvanceActor = { id: number; displayName: string };
export type AdvanceInput = import("zod").infer<typeof AdvanceCaseBody>;
export type AdvanceOutcome =
  | { ok: true; caseRow: typeof casesTable.$inferSelect }
  | { ok: false; status: 400 | 409 | 422; error: string; incomplete?: string[] };

/**
 * Everything that still blocks the case from leaving its current stage, in
 * the words the Advance button shows. `suppliedRequirementIds` are the
 * requirements being ticked as part of this very advance.
 */
export async function stageBlockers(
  caseRow: typeof casesTable.$inferSelect,
  suppliedRequirementIds: number[] = [],
): Promise<{ incomplete: string[]; allowedCompletedRequirementIds: number[] }> {
  await ensureCompletionActionRequirement(caseRow.id);
  await reconcileCasePortfolioRequirement(caseRow.id, caseRow.lenderId);
  const requirements = await db
    .select()
    .from(requirementsTable)
    .where(
      and(
        eq(requirementsTable.caseId, caseRow.id),
        eq(requirementsTable.stageIndex, caseRow.stageIndex),
      ),
    );
  const supplied = new Set(suppliedRequirementIds);
  const currentRequirementIds = new Set(requirements.map((item) => item.id));
  const allowedCompletedRequirementIds = suppliedRequirementIds.filter((id) => currentRequirementIds.has(id));
  const incomplete = requirements.filter(
    (item) => item.required && !item.complete && !supplied.has(item.id),
  );
  const incompleteLabels = incomplete.map((item) => item.label);
  // The Terms of Business must actually be signed before the case leaves the
  // opening stages — ticking the requirement by hand does not stand in for it.
  if (caseRow.stageIndex <= DETAILS_STAGE_INDEX && !(await caseTermsAcceptance(caseRow.id))) {
    if (!incompleteLabels.includes(TERMS_SIGNED_LABEL)) incompleteLabels.push(TERMS_SIGNED_LABEL);
  }
  // Leaving Submission details: everything the lender needs must be filled in.
  if (caseRow.stageIndex === DETAILS_STAGE_INDEX) {
    const pack = await buildSubmissionPack(caseRow);
    incompleteLabels.push(...pack.missing);
  }
  if (caseRow.stageIndex === SUBMISSION_STAGE_INDEX) {
    if (!caseRow.lenderId) incompleteLabels.push("Select a lender");
    const [dipDoc] = await db.select({ id: documentsTable.id }).from(documentsTable)
      .where(and(eq(documentsTable.caseId, caseRow.id), eq(documentsTable.category, "DIP")))
      .limit(1);
    if (!dipDoc) incompleteLabels.push("Upload the decision in principle (DIP)");
    if (!caseRow.lenderCaseNumber) incompleteLabels.push("Add the lender's case number");
    if (!caseRow.applicationFeeConfirmed) incompleteLabels.push("Confirm the application & valuation fee");
    if (!caseRow.valuationDate) incompleteLabels.push("Set the valuation date");
    else if (!caseRow.valuationCompletedAt) incompleteLabels.push("Confirm the valuation took place");
    if (!caseRow.bankDecisionRequested) incompleteLabels.push("Request the lender's decision");
  }
  if (caseRow.stageIndex === UNDERWRITING_STAGE_INDEX && !caseRow.underwritingCleared) {
    incompleteLabels.push("Mark underwriting as complete");
  }
  if (caseRow.stageIndex === STRESS_TEST_STAGE_INDEX) {
    const stressTest = await ensureCaseStressTest(caseRow);
    if (!stressTestPasses(stressTest)) {
      incompleteLabels.push("Pass the stress test");
    }
  }
  return { incomplete: incompleteLabels, allowedCompletedRequirementIds };
}

/**
 * Move the case to its next stage — the one gate shared by the Advance
 * button and by completing the stage's hand-off task, so the two can never
 * disagree. Closes the stage's system tasks, opens the next stage's, and
 * sends the stage-entry email.
 */
export async function advanceCaseStage(
  caseRow: typeof casesTable.$inferSelect,
  actor: AdvanceActor,
  input: AdvanceInput,
  log: Pick<typeof logger, "warn"> = logger,
): Promise<AdvanceOutcome> {
  const { incomplete, allowedCompletedRequirementIds } = await stageBlockers(caseRow, input.completedRequirementIds);
  if (incomplete.length > 0) {
    return { ok: false, status: 409, error: "Complete all required items before advancing", incomplete };
  }
  if (caseRow.stageIndex === AWAITING_COMPLETION_STAGE_INDEX) {
    const completion = input.completion;
    if (!completion) {
      return { ok: false, status: 400, error: "Completion renewal details are required" };
    }
    if (completion.renewalType === "bridging" ? !completion.completionDate : !completion.rateEndDate) {
      return {
        ok: false,
        status: 422,
        error: completion.renewalType === "bridging"
          ? "Mortgage completion date is required for a bridging follow-up"
          : "Rate end date is required for renewal reminders",
      };
    }
    if (!completion.offerSummary.trim()) {
      return { ok: false, status: 422, error: "Lender offer summary is required" };
    }
    const updated = await completeCaseAndAddToPortfolio(caseRow, actor.id, actor.displayName, completion);
    return { ok: true, caseRow: updated };
  }
  if (allowedCompletedRequirementIds.length) {
    await db
      .update(requirementsTable)
      .set({ complete: true, completedAt: new Date() })
      .where(
        and(
          eq(requirementsTable.caseId, caseRow.id),
          eq(requirementsTable.stageIndex, caseRow.stageIndex),
          inArray(requirementsTable.id, allowedCompletedRequirementIds),
        ),
      );
  }
  const caseRef = refOf(caseRow);
  await completeAutoHandoffTasks(caseRow.id, caseRef, actor.id, caseRow.stageIndex);
  const nextIndex = Math.min(caseRow.stageIndex + 1, stages.length - 1);
  const skippedStageIndexes = new Set<number>((caseRow.skippedStageIndexes as number[] | null) ?? []);
  const [updated] = await db
    .update(casesTable)
    .set({
      stageIndex: nextIndex,
      stageStartedAt: new Date(),
      status: "active",
      skippedStageIndexes: [...skippedStageIndexes],
    })
    .where(eq(casesTable.id, caseRow.id))
    .returning();
  if (updated && nextIndex === STRESS_TEST_STAGE_INDEX) {
    await ensureCaseStressTest(updated);
  }
  // Leaving Submission details means advanced information is done: the client is now active
  // and any step-3 placeholder tasks still open are closed.
  if (caseRow.stageIndex === DETAILS_STAGE_INDEX) {
    await db.update(clientsTable)
      .set({ lifecycle: "active" })
      .where(and(eq(clientsTable.id, caseRow.clientId), eq(clientsTable.lifecycle, "onboarding")));
    await completeClientTasks(caseRow.clientId, ADVANCED_KINDS, actor.id);
  }
  await db.insert(activitiesTable).values({
    caseId: caseRow.id,
    title: "Stage completed",
    detail: `${caseRef} advanced to ${stages[nextIndex]}`,
    actorName: actor.displayName,
  });
  const handoffNotes = `Handed off after completing ${stages[caseRow.stageIndex]}.`;
  const assigneeDefaults = await getDefaultAssignees();
  await createHandoffTask({
    caseId: caseRow.id,
    clientId: caseRow.clientId,
    reference: caseRef,
    stageIndex: nextIndex,
    defaults: assigneeDefaults,
    title: `${stages[nextIndex]} — ${caseRef}`,
    notes: handoffNotes,
  }).catch((error) => log.warn({ err: error, caseId: caseRow.id }, "Stage task was not created"));
  if (nextIndex === SUBMISSION_STAGE_INDEX) {
    await createSubmissionStepTasks({
      caseId: caseRow.id,
      clientId: caseRow.clientId,
      reference: caseRef,
      notes: handoffNotes,
      defaults: assigneeDefaults,
    }).catch((error) => log.warn({ err: error, caseId: caseRow.id }, "Submission step tasks were not created"));
  }
  const entryEmail = stageEntryEmail[stages[nextIndex]];
  if (entryEmail) {
    const client = await clientContact(caseRow.clientId);
    if (client) {
      sendChariotEmail({
        purpose: entryEmail.purpose,
        to: [client.email],
        subject: entryEmail.subject(caseRef),
        html: entryEmail.body(client.name, caseRef),
      }).catch((error) => log.warn({ err: error, caseId: caseRow.id }, "Stage-entry email was not delivered"));
    }
  }
  return { ok: true, caseRow: updated! };
}

router.post("/cases/:id/advance", async (req, res): Promise<void> => {
  const params = AdvanceCaseParams.safeParse(req.params);
  const body = AdvanceCaseBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid stage request" });
    return;
  }
  const [caseRow] = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const outcome = await advanceCaseStage(
    caseRow,
    { id: res.locals.authUser.id, displayName: res.locals.authUser.displayName },
    body.data,
    req.log,
  );
  if (!outcome.ok) {
    res.status(outcome.status).json(outcome.incomplete ? { error: outcome.error, incomplete: outcome.incomplete } : { error: outcome.error });
    return;
  }
  res.json(AdvanceCaseResponse.parse(await caseDetailView(outcome.caseRow)));
});




router.get("/lenders", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: lendersTable.id,
      name: lendersTable.name,
      portfolioStage: lendersTable.portfolioStage,
      avgDecisionDays: lendersTable.avgDecisionDays,
      status: lendersTable.status,
      activeCases: sql<number>`count(${casesTable.id})::int`,
    })
    .from(lendersTable)
    .leftJoin(
      casesTable,
      and(
        eq(casesTable.lenderId, lendersTable.id),
        eq(casesTable.status, "active"),
      ),
    )
    .groupBy(lendersTable.id)
    .orderBy(asc(lendersTable.name));
  res.json(ListLendersResponse.parse(rows));
});

router.get("/calendar", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: calendarEventsTable.id,
      title: calendarEventsTable.title,
      eventType: calendarEventsTable.eventType,
      eventDate: calendarEventsTable.eventDate,
      caseId: calendarEventsTable.caseId,
      renewalId: calendarEventsTable.renewalId,
      completed: calendarEventsTable.completed,
      source: calendarEventsTable.source,
      taskId: tasksTable.id,
      caseReference: sql<string | null>`coalesce(${casesTable.displayReference}, ${casesTable.reference})`,
      clientId: casesTable.clientId,
    })
    .from(calendarEventsTable)
    .leftJoin(casesTable, eq(calendarEventsTable.caseId, casesTable.id))
    .leftJoin(tasksTable, eq(tasksTable.calendarEventId, calendarEventsTable.id))
    .orderBy(asc(calendarEventsTable.eventDate));
  res.json(
    ListCalendarEventsResponse.parse(
      await Promise.all(
        rows.map(async (item) => ({
          id: item.id,
          title: item.title,
          eventType: item.eventType,
          eventDate: iso(item.eventDate),
          caseId: item.caseId,
          renewalId: item.renewalId,
          completed: item.completed,
          source: item.source,
          taskId: item.taskId ?? null,
          caseReference: item.caseReference ?? null,
          clientName: item.clientId ? await clientName(item.clientId) : null,
        })),
      ),
    ),
  );
});

router.get("/messages", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: messagesTable.id,
      caseId: messagesTable.caseId,
      caseReference: sql<string>`coalesce(${casesTable.displayReference}, ${casesTable.reference})`,
      sender: messagesTable.sender,
      senderRole: messagesTable.senderRole,
      body: messagesTable.body,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .innerJoin(casesTable, eq(messagesTable.caseId, casesTable.id))
    .where(isNull(messagesTable.conversationId))
    .orderBy(desc(messagesTable.createdAt));
  res.json(
    ListMessagesResponse.parse(
      rows.map((item) => ({ ...item, createdAt: iso(item.createdAt) })),
    ),
  );
});

router.post("/messages", async (req, res): Promise<void> => {
  const parsed = CreateMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [caseRow] = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.id, parsed.data.caseId));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const sender =
    typeof res.locals.authUser?.displayName === "string"
      ? res.locals.authUser.displayName
      : "Staff user";
  const [created] = await db
    .insert(messagesTable)
    .values({
      caseId: parsed.data.caseId,
      body: parsed.data.body,
      sender,
      senderRole: "staff",
      senderUserId: res.locals.authUser.id,
    })
    .returning();
  res.status(201).json(
    CreateMessageResponse.parse({
      id: created!.id,
      caseId: created!.caseId,
      caseReference: refOf(caseRow),
      sender: created!.sender,
      senderRole: created!.senderRole,
      body: created!.body,
      createdAt: iso(created!.createdAt),
    }),
  );
});

router.get("/integrations/status", (_req, res) => {
  res.json(
    GetIntegrationStatusResponse.parse({
      resend: {
        implemented: true,
        active: false,
        label: "Configured in standby — no email will be sent",
      },
      openRouter: {
        implemented: true,
        active: false,
        label: "Configured in standby — no AI request will run",
      },
    }),
  );
});

export default router;