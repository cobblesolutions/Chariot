import {
  useGetCase,
  useAdvanceCase,
  getGetCaseQueryKey,
  useAddCaseRequirement,
  useArchiveCase,
  useRestoreCase,
  useSetCaseValuationCompleted,
  useUpdateCase,
  useUpdateCaseRequirement,
  useExtractUnderwritingRequirements,
  useAddUnderwritingRound,
  usePrepareCaseCompletion,
  getListTasksQueryKey,
  getListCalendarEventsQueryKey,
  getListCasesQueryKey,
  getListPropertiesQueryKey,
} from "@workspace/api-client-react";
import { useParams } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { SubmissionLenders } from "@/components/case/submission-lenders";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import { useNavTitle } from "@/lib/nav-history";
import { stageClasses } from "@/lib/stages";
import {
  CheckSquare,
  Plus,
  Archive,
  ArchiveRestore,
  ArrowRight,
  Briefcase,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/date-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/components/auth-provider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { StressTestPanel } from "@/components/stress-test-panel";
import { LenderOfferPanel } from "@/components/lender-offer-panel";
import { AdviceStagePanel } from "@/components/case/advice-stage-panel";
import { SubmissionDetailsPanel } from "@/components/case/submission-details-panel";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CaseKeyDates } from "@/components/case/key-dates";
import { CaseChatRail } from "@/components/case/case-chat-rail";
import { CaseTasksPanel } from "@/components/case/case-tasks-panel";
import { CaseDocumentsPanel } from "@/components/case/case-documents-panel";
import {
  CASE_SECTIONS,
  CaseSideMenu,
  isCaseSection,
  type CaseSection,
} from "@/components/case/case-side-menu";
import type { QuickAddHandle } from "@/components/tasks/quick-add";
import { useMediaQuery } from "@/hooks/use-media-query";
import { CaseHeader } from "@/components/case/case-header";
import { isFullAccess } from "@/lib/roles";

function CompletionPanel({
  caseId,
  disabled,
  isPending,
  onComplete,
}: {
  caseId: number;
  disabled: boolean;
  isPending: boolean;
  onComplete: (data: {
    renewalType: "fixed_rate" | "bridging";
    rateEndDate: string | null;
    completionDate: string | null;
    offerSummary: string;
  }) => void;
}) {
  const prepare = usePrepareCaseCompletion();
  const [prepared, setPrepared] = useState(false);
  const [renewalType, setRenewalType] = useState<"fixed_rate" | "bridging">(
    "fixed_rate",
  );
  const [rateEndDate, setRateEndDate] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  const [offerSummary, setOfferSummary] = useState("");
  const [validationError, setValidationError] = useState("");

  const requestSummary = () => {
    prepare.mutate(
      { id: caseId },
      {
        onSuccess: (data) => {
          setRenewalType(data.renewalType);
          setRateEndDate(data.rateEndDate ?? "");
          setCompletionDate(data.completionDate ?? "");
          setOfferSummary(data.summary);
        },
      },
    );
  };

  useEffect(() => {
    if (!disabled && !prepared) {
      setPrepared(true);
      requestSummary();
    }
  }, [disabled, prepared]);

  const handleSubmit = () => {
    if (renewalType === "bridging" ? !completionDate : !rateEndDate) {
      setValidationError(
        renewalType === "bridging"
          ? "Enter the mortgage completion date."
          : "Enter the rate end date.",
      );
      return;
    }
    if (!offerSummary.trim()) {
      setValidationError("Add a lender offer summary.");
      return;
    }
    setValidationError("");
    onComplete({
      renewalType,
      rateEndDate: renewalType === "bridging" ? null : rateEndDate || null,
      completionDate: completionDate || null,
      offerSummary: offerSummary.trim(),
    });
  };

  return (
    <div className="p-5 max-h-[560px] overflow-y-auto">
      <div className="rounded-lg border bg-muted/20 p-5 space-y-5">
        <div>
          <h4 className="font-semibold text-foreground">
            Completion follow-up
          </h4>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border bg-background p-3">
          <div>
            <p className="text-sm font-medium">Lender offer summary</p>
            <p className="text-xs text-muted-foreground">
              {prepare.isPending
                ? "Reading the lender offer..."
                : prepare.isError
                  ? "Automatic summary unavailable; enter the details manually."
                  : "Editable staff review"}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={requestSummary}
            disabled={disabled || prepare.isPending}
          >
            {prepare.isPending ? "Reading..." : "Read offer again"}
          </Button>
        </div>

        <Field>
          <FieldLabel className="text-sm font-medium">Mortgage type</FieldLabel>
          <Select
            value={renewalType}
            onValueChange={(value) =>
              setRenewalType(value as "fixed_rate" | "bridging")
            }
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed_rate">
                Mortgage renewal at rate end
              </SelectItem>
              <SelectItem value="bridging">
                Bridge mortgage follow-up
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {renewalType === "fixed_rate" ? (
          <Field>
            <FieldLabel className="text-sm font-medium">
              Rate end date
            </FieldLabel>
            <DatePicker
              value={rateEndDate}
              onChange={setRateEndDate}
              disabled={disabled}
            />
          </Field>
        ) : (
          <Field>
            <FieldLabel className="text-sm font-medium">
              Mortgage completion date
            </FieldLabel>
            <DatePicker
              value={completionDate}
              onChange={setCompletionDate}
              disabled={disabled}
            />
          </Field>
        )}

        <Field>
          <FieldLabel className="text-sm font-medium">
            Lender offer summary
          </FieldLabel>
          <Textarea
            value={offerSummary}
            onChange={(event) => setOfferSummary(event.target.value)}
            disabled={disabled}
            rows={5}
            placeholder="Summarise the lender offer and any relevant follow-up terms..."
          />
        </Field>

        {validationError && (
          <p className="text-sm text-destructive">{validationError}</p>
        )}
        <Button
          className="w-full sm:w-auto"
          onClick={handleSubmit}
          disabled={disabled || isPending || prepare.isPending}
        >
          {isPending
            ? "Completing..."
            : "Mark completed & add to client portfolio"}
        </Button>
      </div>
    </div>
  );
}

const SIDE_PANEL_KEY = "chariot.case.sidePanel";

/** Which side panel was open last time (or null for collapsed). */
function readSidePanel(): CaseSection | null {
  try {
    const value = window.localStorage.getItem(SIDE_PANEL_KEY);
    if (value === "closed") return null;
    return isCaseSection(value) ? value : "tasks";
  } catch {
    return "tasks";
  }
}

const isTypingTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable
  );
};

export default function CaseDetail() {
  const params = useParams();
  const id = params.id ? parseInt(params.id, 10) : 0;
  const qc = useQueryClient();
  const { data: caseItem, isLoading } = useGetCase(id, {
    query: { enabled: !!id, queryKey: getGetCaseQueryKey(id) },
  });
  useNavTitle(`/cases/${id}`, caseItem?.reference);
  const advance = useAdvanceCase();
  const archiveCase = useArchiveCase();
  const restoreCase = useRestoreCase();

  const [checkedReqs, setCheckedReqs] = useState<Set<number>>(new Set());
  const requirementsInitForId = useRef<number | null>(null);
  const [viewingStageIndex, setViewingStageIndex] = useState<number>(0);
  const [lastStageIndex, setLastStageIndex] = useState<number | null>(null);

  const [isAddReqOpen, setIsAddReqOpen] = useState(false);
  const [newReqLabel, setNewReqLabel] = useState("");
  const addRequirement = useAddCaseRequirement();
  const updateRequirement = useUpdateCaseRequirement();
  const extractUnderwriting = useExtractUnderwritingRequirements();
  const addUnderwritingRound = useAddUnderwritingRound();
  const [underwritingEmail, setUnderwritingEmail] = useState("");
  const [underwritingSuggestions, setUnderwritingSuggestions] = useState<
    string[] | null
  >(null);

  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);

  // Tasks, messages and documents live in a side panel picked from the icon
  // menu on the right edge: docked beside the case on wide screens (choice
  // remembered), a slide-over sheet below that.
  const isWide = useMediaQuery("(min-width: 1280px)");
  const [dockedSection, setDockedSection] = useState<CaseSection | null>(
    readSidePanel,
  );
  const [sheetSection, setSheetSection] = useState<CaseSection | null>(null);
  const activeSection = isWide ? dockedSection : sheetSection;
  const selectSection = (section: CaseSection) => {
    if (isWide) setDockedSection((s) => (s === section ? null : section));
    else setSheetSection(section);
  };
  const closeSection = () => {
    if (isWide) setDockedSection(null);
    else setSheetSection(null);
  };
  const tasksRef = useRef<QuickAddHandle>(null);
  const newTask = () => {
    if (isWide) setDockedSection("tasks");
    else setSheetSection("tasks");
    // The panel may only mount on this commit; focus once it is there.
    window.setTimeout(() => tasksRef.current?.focus(), 0);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDE_PANEL_KEY, dockedSection ?? "closed");
    } catch {
      /* ignore */
    }
  }, [dockedSection]);

  // Keyboard: n → new task (same as the Tasks page).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "n") {
        event.preventDefault();
        newTask();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWide]);

  const updateCase = useUpdateCase();
  const setValuationCompleted = useSetCaseValuationCompleted();
  const [valuationDateInput, setValuationDateInput] = useState("");
  const [valuationAmountInput, setValuationAmountInput] = useState("");
  const caseNumberInitForId = useRef<number | null>(null);

  useEffect(() => {
    if (caseItem && requirementsInitForId.current !== caseItem.id) {
      requirementsInitForId.current = caseItem.id;
      const initial = new Set<number>();
      caseItem.requirements.forEach((r) => {
        if (r.complete) initial.add(r.id);
      });
      setCheckedReqs(initial);
    }
  }, [caseItem]);

  useEffect(() => {
    if (caseItem && caseItem.stageIndex !== lastStageIndex) {
      setViewingStageIndex(caseItem.stageIndex);
      setLastStageIndex(caseItem.stageIndex);
    }
  }, [caseItem, lastStageIndex]);

  useEffect(() => {
    if (caseItem && caseNumberInitForId.current !== caseItem.id) {
      caseNumberInitForId.current = caseItem.id;
      setValuationDateInput(
        caseItem.valuationDate ? caseItem.valuationDate.slice(0, 10) : "",
      );
      setValuationAmountInput(
        caseItem.valuationAmount
          ? String(Math.round(caseItem.valuationAmount))
          : "",
      );
    }
  }, [caseItem]);

  if (isLoading)
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!caseItem)
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Briefcase />
            </EmptyMedia>
            <EmptyTitle>Case not found</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <BackButton
              variant="outline"
              size="default"
              fallback={{ href: "/cases", label: "Cases" }}
            />
          </EmptyContent>
        </Empty>
      </div>
    );

  const isViewingCurrentStage = viewingStageIndex === caseItem.stageIndex;
  const openTaskCount = caseItem.tasks.filter(
    (t) => t.status !== "done",
  ).length;
  const stageReqs = caseItem.requirements.filter(
    (r) => r.stageIndex === viewingStageIndex,
  );
  const stageReqRounds = Array.from(
    new Set(stageReqs.map((r) => r.round)),
  ).sort((a, b) => a - b);
  const adviceStageIndex = caseItem.stages.indexOf("Advice & approval");
  const isAdviceStage = viewingStageIndex === adviceStageIndex;
  const detailsStageIndex = caseItem.stages.indexOf("Submission details");
  const isDetailsStage = viewingStageIndex === detailsStageIndex;
  const stressTestStageIndex = caseItem.stages.indexOf("Stress test");
  const isStressTestStage = viewingStageIndex === stressTestStageIndex;
  const stressTestRequirement = stageReqs.find(
    (r) => r.label === "Stress test completed",
  );
  const lenderOfferStageIndex = caseItem.stages.indexOf("Lender offer");
  const isLenderOfferStage = viewingStageIndex === lenderOfferStageIndex;
  const offerSentRequirement = stageReqs.find(
    (r) => r.label === "Offer sent to client",
  );
  const awaitingCompletionStageIndex = caseItem.stages.indexOf("Completion");
  const isAwaitingCompletionStage =
    viewingStageIndex === awaitingCompletionStageIndex;
  const completionRequirement = stageReqs.find(
    (r) =>
      r.label === "Mark completed and add to client portfolio" ||
      r.label === "Completion date confirmed",
  );

  const toggleReq = (reqId: number) => {
    if (
      !isViewingCurrentStage ||
      caseItem.status === "completed" ||
      isStressTestStage
    )
      return;
    const next = new Set(checkedReqs);
    if (next.has(reqId)) next.delete(reqId);
    else next.add(reqId);
    setCheckedReqs(next);
  };

  const handleAdvance = () => {
    if (advance.isPending) return;
    const currentStageRequirementIds =
      isStressTestStage && stressTestRequirement
        ? [stressTestRequirement.id]
        : stageReqs
            .filter((requirement) => checkedReqs.has(requirement.id))
            .map((requirement) => requirement.id);
    advance.mutate(
      { id, data: { completedRequirementIds: currentStageRequirementIds } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
        },
        onError: (error: any) => {
          const incomplete: string[] | undefined =
            error?.response?.data?.incomplete;
          toast.add({
            title: "Complete all required items before advancing",
            description: incomplete?.length ? incomplete.join(", ") : undefined,
            type: "error",
          });
        },
      },
    );
  };

  const handleMarkCompleted = (completion: {
    renewalType: "fixed_rate" | "bridging";
    rateEndDate: string | null;
    completionDate: string | null;
    offerSummary: string;
  }) => {
    if (advance.isPending) return;
    advance.mutate(
      {
        id,
        data: {
          completedRequirementIds: completionRequirement
            ? [completionRequirement.id]
            : [],
          completion,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
          qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
          toast.add({
            title: "Case completed and added to client portfolio",
            type: "success",
          });
        },
        onError: (error: any) => {
          const incomplete: string[] | undefined =
            error?.response?.data?.incomplete;
          toast.add({
            title: "Could not complete the case",
            description: incomplete?.length
              ? incomplete.join(", ")
              : error?.response?.data?.error,
            type: "error",
          });
        },
      },
    );
  };

  const submissionStageIndex = caseItem.stages.indexOf("Submission");
  const isSubmissionStage = viewingStageIndex === submissionStageIndex;
  const underwritingStageIndex = caseItem.stages.indexOf("Underwriting");
  const isUnderwritingStage = viewingStageIndex === underwritingStageIndex;
  const underwritingLatestRound = stageReqRounds.length
    ? stageReqRounds[stageReqRounds.length - 1]
    : null;
  const underwritingLatestRoundComplete =
    underwritingLatestRound !== null &&
    stageReqs
      .filter((r) => r.round === underwritingLatestRound && r.required)
      .every((r) => r.complete);

  const handleToggleUnderwritingReq = (reqId: number, checked: boolean) => {
    if (
      !isViewingCurrentStage ||
      caseItem.status === "completed" ||
      updateRequirement.isPending
    )
      return;
    updateRequirement.mutate(
      { id, reqId, data: { complete: checked } },
      {
        onSuccess: () =>
          qc.invalidateQueries({ queryKey: getGetCaseQueryKey(id) }),
        onError: () =>
          toast.add({ title: "Failed to update requirement", type: "error" }),
      },
    );
  };

  const handleToggleUnderwritingCleared = (checked: boolean) => {
    updateCase.mutate(
      { id, data: { underwritingCleared: checked } },
      {
        onSuccess: () =>
          qc.invalidateQueries({ queryKey: getGetCaseQueryKey(id) }),
        onError: () =>
          toast.add({
            title: "Failed to update underwriting status",
            type: "error",
          }),
      },
    );
  };

  const handleAnalyzeUnderwritingEmail = () => {
    if (!underwritingEmail.trim() || extractUnderwriting.isPending) return;
    extractUnderwriting.mutate(
      { id, data: { emailText: underwritingEmail } },
      {
        onSuccess: (data) => setUnderwritingSuggestions(data.suggestions),
        onError: () =>
          toast.add({ title: "Failed to analyze email", type: "error" }),
      },
    );
  };

  const handleRemoveUnderwritingSuggestion = (index: number) => {
    setUnderwritingSuggestions((current) =>
      current ? current.filter((_, i) => i !== index) : current,
    );
  };

  const handleConfirmUnderwritingRound = () => {
    if (!underwritingSuggestions?.length || addUnderwritingRound.isPending)
      return;
    addUnderwritingRound.mutate(
      {
        id,
        data: {
          emailText: underwritingEmail,
          requirementLabels: underwritingSuggestions,
        },
      },
      {
        onSuccess: () => {
          toast.add({ title: "Requirements added", type: "success" });
          setUnderwritingEmail("");
          setUnderwritingSuggestions(null);
          qc.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
        },
        onError: () =>
          toast.add({ title: "Failed to add requirements", type: "error" }),
      },
    );
  };

  // Case dates are stored at 09:00 local so the mirrored calendar event lands
  // at a sensible time rather than midnight UTC.
  const caseDateIso = (value: string) =>
    value ? new Date(`${value}T09:00`).toISOString() : null;
  const invalidateCaseDates = () => {
    qc.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
    qc.invalidateQueries({ queryKey: getListCalendarEventsQueryKey() });
  };

  const handleSaveValuationDate = (value: string) => {
    setValuationDateInput(value);
    updateCase.mutate(
      { id, data: { valuationDate: caseDateIso(value) } },
      {
        onSuccess: () => {
          if (value) {
            toast.add({
              title: "Valuation date set",
              description:
                "Added to the calendar with a follow-up task for the valuation assignee.",
              type: "success",
            });
          }
          invalidateCaseDates();
        },
        onError: () =>
          toast.add({ title: "Failed to save valuation date", type: "error" }),
      },
    );
  };

  const handleSetValuationCompleted = (completed: boolean, amount?: number) => {
    setValuationCompleted.mutate(
      { id, data: { completed, ...(completed && amount ? { amount } : {}) } },
      {
        onSuccess: () => {
          toast.add({
            title: completed ? "Valuation confirmed" : "Valuation reopened",
            description: completed
              ? "The calendar event and follow-up task are marked done."
              : undefined,
            type: "success",
          });
          invalidateCaseDates();
        },
        onError: (err) =>
          toast.add({
            title: "Failed to update the valuation",
            description: err instanceof Error ? err.message : undefined,
            type: "error",
          }),
      },
    );
  };

  const handleSaveExpectedCompletionDate = (value: string) => {
    updateCase.mutate(
      { id, data: { expectedCompletionDate: caseDateIso(value) } },
      {
        onSuccess: () => {
          if (value) {
            toast.add({
              title: "Completion date set",
              description:
                "Added to the calendar with a follow-up task for the completions assignee.",
              type: "success",
            });
          }
          invalidateCaseDates();
        },
        onError: () =>
          toast.add({ title: "Failed to save completion date", type: "error" }),
      },
    );
  };

  const valuationConfirmed = Boolean(caseItem.valuationCompletedAt);
  const portfolioRequirement = stageReqs.find(
    (r) => r.label === "Required portfolio sent",
  );
  // The case must have chosen one lender to proceed with; its tracking is
  // mirrored onto the case fields checked below.
  const lenderChosen = caseItem.submissions.some(
    (s) => s.isPrimary && (s.status === "active" || s.status === "offered"),
  );
  const submissionComplete = Boolean(
    lenderChosen &&
    caseItem.lenderId &&
    caseItem.dipDocument &&
    caseItem.caseNumber &&
    caseItem.applicationFeeConfirmed &&
    caseItem.valuationDate &&
    valuationConfirmed &&
    caseItem.bankDecisionRequested &&
    (!portfolioRequirement || checkedReqs.has(portfolioRequirement.id)),
  );

  const allRequiredChecked = isSubmissionStage
    ? submissionComplete
    : isUnderwritingStage
      ? caseItem.underwritingCleared
      : isLenderOfferStage
        ? stageReqs
            .filter((r) => r.required)
            .every((r) => r.complete || checkedReqs.has(r.id))
        : isAdviceStage || isDetailsStage
          ? stageReqs.filter((r) => r.required).every((r) => r.complete)
          : stageReqs
              .filter((r) => r.required)
              .every((r) => checkedReqs.has(r.id));

  const handleAddRequirement = () => {
    if (!newReqLabel.trim() || addRequirement.isPending) return;
    addRequirement.mutate(
      { id, data: { label: newReqLabel.trim(), required: true } },
      {
        onSuccess: () => {
          setNewReqLabel("");
          setIsAddReqOpen(false);
          qc.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
        },
      },
    );
  };

  const handleArchive = () => {
    if (archiveCase.isPending) return;
    archiveCase.mutate(
      { id },
      {
        onSuccess: () => {
          toast.add({ title: "Case archived", type: "success" });
          qc.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
        },
      },
    );
  };

  const handleRestore = () => {
    if (restoreCase.isPending) return;
    restoreCase.mutate(
      { id },
      {
        onSuccess: () => {
          toast.add({ title: "Case restored", type: "success" });
          qc.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
        },
      },
    );
  };

  const sidePanel =
    activeSection === "tasks" ? (
      <CaseTasksPanel
        ref={tasksRef}
        caseItem={caseItem}
        isAdmin={isAdmin}
        onClose={closeSection}
      />
    ) : activeSection === "messages" ? (
      <CaseChatRail caseItem={caseItem} onClose={closeSection} />
    ) : activeSection === "documents" ? (
      <CaseDocumentsPanel caseItem={caseItem} onClose={closeSection} />
    ) : null;

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-page md:h-[100dvh]">
      <CaseHeader
        caseItem={caseItem}
        viewingStageIndex={viewingStageIndex}
        onSelectStage={setViewingStageIndex}
        actions={
          <>
            <CaseKeyDates
              caseItem={caseItem}
              onSetValuationCompleted={handleSetValuationCompleted}
              onSaveExpectedCompletionDate={handleSaveExpectedCompletionDate}
              pending={updateCase.isPending || setValuationCompleted.isPending}
            />
            <Button
              variant="outline"
              onClick={caseItem.archivedAt ? handleRestore : handleArchive}
              disabled={archiveCase.isPending || restoreCase.isPending}
            >
              {caseItem.archivedAt ? (
                <>
                  <ArchiveRestore /> Restore
                </>
              ) : (
                <>
                  <Archive /> Archive
                </>
              )}
            </Button>
            <div className="flex items-center gap-2 md:hidden">
              <Separator
                orientation="vertical"
                className="mx-1 h-6 bg-white/30"
              />
              {CASE_SECTIONS.map(({ key, label, icon: Icon }) => (
                <Button
                  key={key}
                  variant="outline"
                  size="icon"
                  onClick={() => selectSection(key)}
                  aria-label={label}
                  className="relative"
                >
                  <Icon />
                  {key === "tasks" && openTaskCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="absolute -top-2 -right-2 h-5 min-w-5 px-1 tabular-nums"
                    >
                      {openTaskCount}
                    </Badge>
                  )}
                </Button>
              ))}
            </div>
          </>
        }
      />

      {/* Main Content Area */}
      <div className="mx-auto flex w-full max-w-page flex-1 min-h-0 gap-4 p-6 md:gap-6 md:p-8">
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto lg:overflow-hidden",
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-6">
            {/* Stage card — the only thing that scrolls on wide screens. The
                Stress test stage is just the calculator, with its own advance. */}
            {!isStressTestStage && (
              <Card className="gap-0 py-0 lg:min-h-0 lg:flex-1">
                <CardHeader className="border-b px-5 py-3 [.border-b]:pb-3">
                  {!isSubmissionStage && (
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <CheckSquare
                        className={`size-4 ${stageClasses(viewingStageIndex).text}`}
                      />
                      {isLenderOfferStage
                        ? "Lender Offer Review"
                        : isAdviceStage
                          ? "Advice & approval"
                          : isDetailsStage
                            ? "Submission details"
                            : "Stage Requirements"}
                    </CardTitle>
                  )}
                  <CardAction className="flex flex-wrap items-center justify-end gap-2">
                    {isViewingCurrentStage &&
                      caseItem.status !== "completed" &&
                      !isSubmissionStage && !isAdviceStage && !isDetailsStage && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setIsAddReqOpen(true)}
                        >
                          <Plus /> Add
                        </Button>
                      )}
                    {isViewingCurrentStage &&
                      caseItem.status !== "completed" &&
                      !isAwaitingCompletionStage && (
                        <Button
                          size="sm"
                          onClick={handleAdvance}
                          disabled={
                            (isStressTestStage
                              ? !stressTestRequirement
                              : !allRequiredChecked) || advance.isPending
                          }
                          title={
                            isSubmissionStage && !lenderChosen
                              ? "Choose the lender to proceed with"
                              : undefined
                          }
                        >
                          {advance.isPending ? "Advancing..." : "Advance Stage"}
                        </Button>
                      )}
                  </CardAction>
                </CardHeader>
                <CardContent className="px-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                  {isSubmissionStage ? (
                    <SubmissionLenders
                      caseItem={caseItem}
                      canEdit={
                        isViewingCurrentStage && caseItem.status !== "completed"
                      }
                      stageIndex={submissionStageIndex}
                      valuation={{
                        dateInput: valuationDateInput,
                        onSaveDate: handleSaveValuationDate,
                        amountInput: valuationAmountInput,
                        onAmountChange: setValuationAmountInput,
                        onSetCompleted: handleSetValuationCompleted,
                        pending: setValuationCompleted.isPending,
                      }}
                      portfolio={{
                        requirement: portfolioRequirement,
                        checked: portfolioRequirement
                          ? checkedReqs.has(portfolioRequirement.id)
                          : false,
                        onToggle: () =>
                          portfolioRequirement &&
                          toggleReq(portfolioRequirement.id),
                      }}
                    />
                  ) : isAdviceStage ? (
                    <AdviceStagePanel
                      caseId={id}
                      serviceType={caseItem.serviceType}
                      disabled={!isViewingCurrentStage || caseItem.status === "completed"}
                    />
                  ) : isDetailsStage ? (
                    <SubmissionDetailsPanel
                      caseId={id}
                      clientId={caseItem.clientId}
                      disabled={!isViewingCurrentStage || caseItem.status === "completed"}
                    />
                  ) : isLenderOfferStage ? (
                    <LenderOfferPanel
                      caseId={id}
                      clientId={caseItem.clientId}
                      offerSent={Boolean(
                        offerSentRequirement?.complete ||
                        (offerSentRequirement &&
                          checkedReqs.has(offerSentRequirement.id)),
                      )}
                      onToggleOfferSent={() => {
                        if (offerSentRequirement)
                          toggleReq(offerSentRequirement.id);
                      }}
                      disabled={
                        !isViewingCurrentStage ||
                        caseItem.status === "completed"
                      }
                    />
                  ) : isAwaitingCompletionStage ? (
                    <CompletionPanel
                      caseId={id}
                      disabled={
                        !isViewingCurrentStage ||
                        caseItem.status === "completed"
                      }
                      isPending={advance.isPending}
                      onComplete={handleMarkCompleted}
                    />
                  ) : (
                    <div>
                      {isUnderwritingStage &&
                        isViewingCurrentStage &&
                        caseItem.status !== "completed" && (
                          <div className="p-4 border-b space-y-2 bg-muted/20">
                            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Paste bank requirements email
                            </label>
                            <Textarea
                              value={underwritingEmail}
                              onChange={(e) =>
                                setUnderwritingEmail(e.target.value)
                              }
                              placeholder="Paste the lender's underwriting email here..."
                              className="min-h-[100px]"
                            />
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={handleAnalyzeUnderwritingEmail}
                                disabled={
                                  !underwritingEmail.trim() ||
                                  extractUnderwriting.isPending
                                }
                              >
                                {extractUnderwriting.isPending
                                  ? "Analyzing..."
                                  : "Analyze"}
                              </Button>
                            </div>
                            {underwritingSuggestions !== null && (
                              <div className="rounded-md border bg-card p-3 space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Review suggested requirements
                                </p>
                                {underwritingSuggestions.length === 0 ? (
                                  <p className="text-sm text-muted-foreground italic">
                                    No requirements detected — edit the text or
                                    add them manually below.
                                  </p>
                                ) : (
                                  <ul className="space-y-1.5">
                                    {underwritingSuggestions.map(
                                      (suggestion, index) => (
                                        <li
                                          key={index}
                                          className="flex items-center gap-2 text-sm"
                                        >
                                          <Input
                                            value={suggestion}
                                            onChange={(e) =>
                                              setUnderwritingSuggestions(
                                                (current) =>
                                                  current
                                                    ? current.map((item, i) =>
                                                        i === index
                                                          ? e.target.value
                                                          : item,
                                                      )
                                                    : current,
                                              )
                                            }
                                          />
                                          <Button
                                            size="icon-sm"
                                            variant="ghost"
                                            className="shrink-0"
                                            onClick={() =>
                                              handleRemoveUnderwritingSuggestion(
                                                index,
                                              )
                                            }
                                          >
                                            <Plus className="rotate-45" />
                                          </Button>
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                )}
                                <div className="flex justify-end gap-2 pt-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setUnderwritingSuggestions(null)
                                    }
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={handleConfirmUnderwritingRound}
                                    disabled={
                                      !underwritingSuggestions.length ||
                                      addUnderwritingRound.isPending
                                    }
                                  >
                                    {addUnderwritingRound.isPending
                                      ? "Adding..."
                                      : "Confirm & add round"}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      {stageReqs.length === 0 ? (
                        <Empty>
                          <EmptyHeader>
                            <EmptyDescription>
                              No requirements configured for this stage.
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      ) : (
                        <div className="flex flex-col">
                          {stageReqRounds.map((round) => (
                            <div key={round}>
                              {stageReqRounds.length > 1 && (
                                <div className="px-4 py-1.5 bg-muted/40 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border/50">
                                  Round {round}
                                </div>
                              )}
                              {stageReqs
                                .filter((r) => r.round === round)
                                .map((req) => {
                                  const isChecked = isUnderwritingStage
                                    ? req.complete
                                    : checkedReqs.has(req.id);
                                  return (
                                    <label
                                      key={req.id}
                                      className={`flex items-start gap-3 px-5 py-3 border-b border-border/50 last:border-0 ${
                                        isViewingCurrentStage &&
                                        caseItem.status !== "completed"
                                          ? "cursor-pointer"
                                          : "opacity-80"
                                      }`}
                                    >
                                      <Checkbox
                                        className="mt-0.5"
                                        checked={isChecked}
                                        onCheckedChange={(checked) =>
                                          isUnderwritingStage
                                            ? handleToggleUnderwritingReq(
                                                req.id,
                                                checked === true,
                                              )
                                            : toggleReq(req.id)
                                        }
                                        disabled={
                                          !isViewingCurrentStage ||
                                          caseItem.status === "completed" ||
                                          isStressTestStage
                                        }
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div
                                          className={`text-sm font-medium leading-snug mb-1 ${
                                            isChecked
                                              ? "text-muted-foreground"
                                              : "text-foreground"
                                          }`}
                                        >
                                          {req.label}
                                        </div>
                                      </div>
                                    </label>
                                  );
                                })}
                            </div>
                          ))}
                        </div>
                      )}
                      {isUnderwritingStage && stageReqs.length > 0 && (
                        <label
                          className={`flex items-start gap-3 p-4 border-t ${
                            isViewingCurrentStage &&
                            caseItem.status !== "completed" &&
                            underwritingLatestRoundComplete
                              ? "cursor-pointer"
                              : "opacity-70"
                          }`}
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={caseItem.underwritingCleared}
                            onCheckedChange={(checked) =>
                              handleToggleUnderwritingCleared(checked === true)
                            }
                            disabled={
                              !isViewingCurrentStage ||
                              caseItem.status === "completed" ||
                              (!caseItem.underwritingCleared &&
                                !underwritingLatestRoundComplete)
                            }
                          />
                          <span className="text-sm font-semibold">
                            Underwriting complete
                            {!underwritingLatestRoundComplete &&
                              !caseItem.underwritingCleared && (
                                <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                                  Complete the current round's requirements
                                  first, or paste a new bank email above
                                </span>
                              )}
                          </span>
                        </label>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Dialog open={isAddReqOpen} onOpenChange={setIsAddReqOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add requirement</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                  <Input
                    autoFocus
                    placeholder="e.g. Updated bank statement"
                    value={newReqLabel}
                    onChange={(event) => setNewReqLabel(event.target.value)}
                    onKeyDown={(event) =>
                      event.key === "Enter" && handleAddRequirement()
                    }
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsAddReqOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleAddRequirement}
                    disabled={!newReqLabel.trim() || addRequirement.isPending}
                  >
                    {addRequirement.isPending ? "Adding..." : "Add requirement"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* BTL Stress Test */}
            {isStressTestStage && (
              <StressTestPanel
                caseId={id}
                className="lg:min-h-0 lg:flex-1"
                action={
                  isViewingCurrentStage &&
                  caseItem.status !== "completed" && (
                    <Button
                      size="sm"
                      onClick={handleAdvance}
                      disabled={!stressTestRequirement || advance.isPending}
                    >
                      {advance.isPending ? "Advancing…" : "Go to next step"}
                      <ArrowRight />
                    </Button>
                  )
                }
              />
            )}
          </div>
        </div>

        {/* Side container: icon rail, plus the open section on wide screens */}
        <Card className="hidden shrink-0 flex-row gap-0 overflow-hidden py-0 md:flex">
          <CaseSideMenu
            active={activeSection}
            counts={{ tasks: openTaskCount }}
            onSelect={selectSection}
          />
          {isWide && dockedSection && (
            <div className="flex w-[380px] min-h-0 flex-col 2xl:w-[440px]">
              {sidePanel}
            </div>
          )}
        </Card>
      </div>

      {/* Side panel — slide-over on smaller screens */}
      <Sheet
        open={!isWide && sheetSection !== null}
        onOpenChange={(open) => !open && setSheetSection(null)}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Case panel</SheetTitle>
            <SheetDescription>
              Tasks, messages and documents for this case.
            </SheetDescription>
          </SheetHeader>
          {sidePanel}
        </SheetContent>
      </Sheet>
    </div>
  );
}
