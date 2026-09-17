import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCaseSubmission,
  useDeleteCaseSubmission,
  useListLenders,
  useUpdateCaseSubmission,
  getGetCaseQueryKey,
  getListDocumentsQueryKey,
} from "@workspace/api-client-react";
import type {
  CaseDetail,
  CaseSubmission,
  CaseSubmissionUpdate,
  Requirement,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  FileText,
  Landmark,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { UploadProgress } from "@/components/upload-progress";
import { documentUploadHeaders, useUpload } from "@/lib/upload";
import { DatePicker } from "@/components/date-picker";
import { SubmissionStepOwner } from "@/components/submission-step-owner";
import { submissionProgress } from "@/components/add/submissions-panel";
import { StepCard, useStepFlow } from "@/components/case/step-flow";
import { stageClasses } from "@/lib/stages";
import { cn, formatDate, formatMoney } from "@/lib/utils";

const isOpen = (s: CaseSubmission) =>
  s.status === "active" || s.status === "offered";

/** Case-level valuation state and handlers (one figure for the whole case). */
export type ValuationControls = {
  dateInput: string;
  onSaveDate: (value: string) => void;
  amountInput: string;
  onAmountChange: (digits: string) => void;
  onSetCompleted: (completed: boolean, amount?: number) => void;
  pending: boolean;
};

/** The primary lender's portfolio requirement, when that lender needs one at submission. */
export type PortfolioControls = {
  requirement: Requirement | undefined;
  checked: boolean;
  onToggle: () => void;
};

type Props = {
  caseItem: CaseDetail;
  /** Viewing the current stage on an open case. */
  canEdit: boolean;
  stageIndex: number;
  valuation: ValuationControls;
  portfolio: PortfolioControls;
};

/**
 * The Submission stage: one tab per lender the case has gone to, each with
 * its own step flow, plus "Add lender" and "Proceed with this lender".
 */
export function SubmissionLenders({
  caseItem,
  canEdit,
  stageIndex,
  valuation,
  portfolio,
}: Props) {
  const qc = useQueryClient();
  const submissions = caseItem.submissions;
  const primary = submissions.find((s) => s.isPrimary && isOpen(s));
  const [activeId, setActiveId] = useState<number | null>(null);
  const active =
    submissions.find((s) => s.id === activeId) ?? primary ?? submissions[0];

  const { data: lenders = [] } = useListLenders();
  const createSubmission = useCreateCaseSubmission();
  const [addOpen, setAddOpen] = useState(false);
  const refresh = () =>
    qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseItem.id) });

  const openLenderIds = new Set(
    submissions.filter(isOpen).map((s) => s.lenderId),
  );
  const addable = lenders.filter((l) => !openLenderIds.has(l.id));

  const addLender = (lenderId: number) => {
    createSubmission.mutate(
      { id: caseItem.id, data: { lenderId } },
      {
        onSuccess: (created) => {
          setAddOpen(false);
          setActiveId(created.id);
          toast.add({
            title: `Submitted to ${created.lenderName}`,
            type: "success",
          });
          refresh();
        },
        onError: (error: any) =>
          toast.add({
            title: "Could not add lender",
            description: error?.data?.error ?? error?.message,
            type: "error",
          }),
      },
    );
  };

  const colour = stageClasses(stageIndex);

  return (
    <div className="flex min-h-0 flex-col">
      {/* Lender tabs */}
      <div
        role="tablist"
        aria-label="Lenders"
        className="flex flex-wrap items-center gap-1 border-b px-3 py-2"
      >
        {submissions.map((s) => {
          const selected = active?.id === s.id;
          const progress = submissionProgress(s);
          const closed = !isOpen(s);
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveId(s.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                selected
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                closed && "line-through opacity-60",
              )}
            >
              {s.isPrimary && isOpen(s) && (
                <Star className={cn("size-3.5 fill-current", colour.text)} />
              )}
              <span className="truncate">{s.lenderName}</span>
              {s.stepFlagged ? (
                <span
                  className="size-2 shrink-0 rounded-full bg-red-500"
                  title={`${s.stepDays} days waiting for "${s.currentStepLabel}" (limit ${s.stepThresholdDays})`}
                  aria-label="Step overdue"
                />
              ) : null}
              {s.status === "offered" ? (
                <Badge
                  className="bg-emerald-50 text-emerald-700"
                  variant="secondary"
                >
                  Offer
                </Badge>
              ) : s.status === "declined" ? (
                <Badge variant="secondary" className="bg-red-50 text-red-700">
                  Declined
                </Badge>
              ) : s.status === "withdrawn" ? (
                <Badge variant="outline">Withdrawn</Badge>
              ) : (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {progress.done}/{progress.total}
                </span>
              )}
            </button>
          );
        })}
        {canEdit && (
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
              >
                <Plus /> Add lender
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1">
              {addable.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  Every lender is already on this case.
                </p>
              ) : (
                addable.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    disabled={createSubmission.isPending}
                    onClick={() => addLender(l.id)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted outline-none"
                  >
                    <Landmark className="size-3.5 text-muted-foreground" />
                    {l.name}
                  </button>
                ))
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {!active ? (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Landmark />
            </EmptyMedia>
            <EmptyTitle>No lender yet</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <LenderFlow
          key={active.id}
          caseItem={caseItem}
          submission={active}
          canEdit={canEdit}
          colour={colour}
          valuation={valuation}
          portfolio={portfolio}
          onRemoved={() => setActiveId(null)}
        />
      )}
    </div>
  );
}

function LenderFlow({
  caseItem,
  submission,
  canEdit,
  colour,
  valuation,
  portfolio,
  onRemoved,
}: {
  caseItem: CaseDetail;
  submission: CaseSubmission;
  canEdit: boolean;
  colour: ReturnType<typeof stageClasses>;
  valuation: ValuationControls;
  portfolio: PortfolioControls;
  onRemoved: () => void;
}) {
  const qc = useQueryClient();
  const update = useUpdateCaseSubmission();
  const remove = useDeleteCaseSubmission();
  const open = isOpen(submission);
  const editable = canEdit && open;
  const refresh = () =>
    qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseItem.id) });

  const save = (data: CaseSubmissionUpdate, success?: string) =>
    update.mutate(
      { id: caseItem.id, submissionId: submission.id, data },
      {
        onSuccess: () => {
          if (success) toast.add({ title: success, type: "success" });
          refresh();
        },
        onError: (error: any) =>
          toast.add({
            title: "Could not update the submission",
            description: error?.data?.error ?? error?.message,
            type: "error",
          }),
      },
    );

  // Case number: saved on Enter / blur.
  const [caseNumber, setCaseNumber] = useState(
    submission.lenderCaseNumber ?? "",
  );
  useEffect(() => {
    setCaseNumber(submission.lenderCaseNumber ?? "");
  }, [submission.lenderCaseNumber]);
  const saveCaseNumber = () => {
    const trimmed = caseNumber.trim();
    if (trimmed === (submission.lenderCaseNumber ?? "")) return;
    save({ lenderCaseNumber: trimmed || null });
  };

  // DIP upload, pinned to this lender.
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dipUpload = useUpload();
  const uploading = dipUpload.uploading;
  const uploadDip = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.add({
        title: "File too large",
        description: "Maximum file size is 50MB.",
        type: "error",
      });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    try {
      await dipUpload.send(file, {
        url: "/api/documents/upload",
        headers: documentUploadHeaders(file, {
          "x-document-category": "DIP",
          "x-client-id": caseItem.clientId,
          "x-case-id": caseItem.id,
          "x-submission-id": submission.id,
        }),
      });
      toast.add({
        title: `DIP uploaded for ${submission.lenderName}`,
        type: "success",
      });
      refresh();
      qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
    } catch (err) {
      toast.add({
        title: "Failed to upload DIP",
        description: err instanceof Error ? err.message : undefined,
        type: "error",
      });
    } finally {
      dipUpload.reset();
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Close (withdraw / declined) with an optional reason.
  const [closing, setClosing] = useState<"withdrawn" | "declined" | null>(null);
  const [closeReason, setCloseReason] = useState("");

  const valuationDone = !!caseItem.valuationCompletedAt;
  const valuationDatePassed = caseItem.valuationDate
    ? new Date(caseItem.valuationDate) < new Date()
    : false;
  const showPortfolio = submission.isPrimary && !!portfolio.requirement;

  const steps = useMemo(
    () => [
      { key: "dip", done: !!submission.dipDocument },
      { key: "case_number", done: !!submission.lenderCaseNumber },
      ...(showPortfolio ? [{ key: "portfolio", done: portfolio.checked }] : []),
      { key: "fee", done: submission.applicationFeeConfirmed },
      { key: "valuation", done: valuationDone },
      { key: "decision", done: submission.bankDecisionRequested },
    ],
    [submission, showPortfolio, portfolio.checked, valuationDone],
  );
  const flow = useStepFlow(steps.map((s) => s.done));

  const cardProps = (idx: number) => ({
    index: idx,
    done: steps[idx]!.done,
    locked: !flow.reachable(idx),
    open: flow.active === idx,
    isLast: idx === steps.length - 1,
    onOpenChange: (o: boolean) => (o ? flow.open(idx) : flow.close()),
    colour,
  });

  return (
    <div className="px-5 py-4">
      {/* Lender actions */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">{submission.lenderName}</span>
          {submission.isPrimary && open ? (
            <span className={cn("ml-2 text-xs font-medium", colour.text)}>
              The case proceeds with this lender
            </span>
          ) : !open ? (
            <span className="ml-2 text-xs text-muted-foreground">
              {submission.status === "declined" ? "Declined" : "Withdrawn"}
              {submission.closeReason ? ` — ${submission.closeReason}` : ""}
              {submission.closedAt
                ? ` · ${formatDate(submission.closedAt)}`
                : ""}
            </span>
          ) : null}
        </div>
        {canEdit && open && !submission.isPrimary && (
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() =>
              save(
                { isPrimary: true },
                `Proceeding with ${submission.lenderName}`,
              )
            }
          >
            <Star /> Proceed with this lender
          </Button>
        )}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Lender actions"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {open ? (
                <>
                  {submission.status !== "offered" && (
                    <DropdownMenuItem
                      onClick={() =>
                        save({ status: "offered" }, "Offer received")
                      }
                    >
                      <Check /> Offer received
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setClosing("declined")}>
                    <AlertTriangle /> Lender declined
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setClosing("withdrawn")}>
                    <RotateCcw /> Withdraw submission
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem
                  onClick={() =>
                    save({ status: "active" }, "Submission reopened")
                  }
                >
                  <RotateCcw /> Reopen
                </DropdownMenuItem>
              )}
              {submissionProgress(submission).done === 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() =>
                      remove.mutate(
                        { id: caseItem.id, submissionId: submission.id },
                        {
                          onSuccess: () => {
                            toast.add({
                              title: "Lender removed",
                              type: "success",
                            });
                            onRemoved();
                            refresh();
                          },
                          onError: (error: any) =>
                            toast.add({
                              title: "Could not remove lender",
                              description: error?.data?.error ?? error?.message,
                              type: "error",
                            }),
                        },
                      )
                    }
                  >
                    <Trash2 /> Remove lender
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Steps */}
      <div>
        {steps.map((step, idx) => {
          switch (step.key) {
            case "dip":
              return (
                <StepCard
                  key={step.key}
                  {...cardProps(idx)}
                  title="Upload the decision in principle (DIP)"
                  summary={submission.dipDocument?.name}
                  owner={<SubmissionStepOwner section="submission_dip" />}
                >
                  {submission.dipDocument ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
                      <Button
                        variant="link"
                        size="sm"
                        className="min-w-0 px-0"
                        asChild
                      >
                        <a
                          href={`/api/documents/${submission.dipDocument.id}/view`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FileText />
                          <span className="truncate">
                            {submission.dipDocument.name}
                          </span>
                        </a>
                      </Button>
                      {editable && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => fileRef.current?.click()}
                          disabled={uploading}
                        >
                          Replace
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => fileRef.current?.click()}
                      disabled={!editable || uploading}
                    >
                      <Upload /> {uploading ? "Uploading…" : "Upload DIP"}
                    </Button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    onChange={uploadDip}
                  />
                  <UploadProgress progress={dipUpload.progress} />
                </StepCard>
              );

            case "case_number":
              return (
                <StepCard
                  key={step.key}
                  {...cardProps(idx)}
                  title="Record the lender's case number"
                  summary={submission.lenderCaseNumber}
                  owner={
                    <SubmissionStepOwner section="submission_case_number" />
                  }
                >
                  <Input
                    value={caseNumber}
                    onChange={(e) => setCaseNumber(e.target.value)}
                    onBlur={saveCaseNumber}
                    onKeyDown={(e) => e.key === "Enter" && saveCaseNumber()}
                    placeholder="e.g. LND-2026-00123"
                    disabled={!editable}
                  />
                </StepCard>
              );

            case "portfolio":
              return portfolio.requirement ? (
                <StepCard
                  key={step.key}
                  {...cardProps(idx)}
                  title={portfolio.requirement.label}
                  summary="Sent to the lender"
                  owner={<SubmissionStepOwner section="submission_portfolio" />}
                >
                  <label className="flex cursor-pointer items-center gap-3 text-sm">
                    <Checkbox
                      checked={portfolio.checked}
                      onCheckedChange={portfolio.onToggle}
                      disabled={!editable}
                    />
                    Portfolio sent to the lender
                  </label>
                </StepCard>
              ) : null;

            case "fee":
              return (
                <StepCard
                  key={step.key}
                  {...cardProps(idx)}
                  title="Confirm the application & valuation fee"
                  summary="Fee confirmed"
                  owner={<SubmissionStepOwner section="submission_fee" />}
                >
                  <label className="flex cursor-pointer items-center gap-3 text-sm">
                    <Checkbox
                      checked={submission.applicationFeeConfirmed}
                      onCheckedChange={(checked) =>
                        save({ applicationFeeConfirmed: checked === true })
                      }
                      disabled={!editable || update.isPending}
                    />
                    Application & valuation fee confirmed
                  </label>
                </StepCard>
              );

            case "valuation":
              return (
                <StepCard
                  key={step.key}
                  {...cardProps(idx)}
                  title="Book and confirm the valuation"
                  summary={
                    caseItem.valuationAmount
                      ? `Valued at ${formatMoney(caseItem.valuationAmount)} · ${formatDate(caseItem.valuationDate)}`
                      : caseItem.valuationDate
                        ? `Took place · ${formatDate(caseItem.valuationDate)}`
                        : "Took place"
                  }
                  owner={
                    <SubmissionStepOwner section="submission_valuation_date" />
                  }
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>
                        <CalendarClock className="h-3.5 w-3.5" /> Valuation date
                      </FieldLabel>
                      <DatePicker
                        value={valuation.dateInput}
                        onChange={valuation.onSaveDate}
                        disabled={!canEdit}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>
                        <Landmark className="h-3.5 w-3.5" /> Valued at
                      </FieldLabel>
                      <InputGroup>
                        <InputGroupAddon>£</InputGroupAddon>
                        <InputGroupInput
                          inputMode="numeric"
                          placeholder="Paste the valuer's figure"
                          value={
                            valuation.amountInput
                              ? Number(valuation.amountInput).toLocaleString(
                                  "en-GB",
                                )
                              : ""
                          }
                          onChange={(e) =>
                            valuation.onAmountChange(
                              e.target.value.replace(/[^0-9]/g, ""),
                            )
                          }
                          disabled={!canEdit || !caseItem.valuationDate}
                        />
                      </InputGroup>
                      <FieldDescription>
                        Replaces the property value in the stress test.
                      </FieldDescription>
                    </Field>
                    <label
                      className={cn(
                        "flex items-start gap-3 rounded-md border p-3 text-sm sm:col-span-2",
                        valuationDatePassed && !valuationDone
                          ? "border-amber-400/70 bg-amber-50 dark:bg-amber-950/20"
                          : "bg-muted/30",
                        caseItem.valuationDate && canEdit
                          ? "cursor-pointer"
                          : "opacity-80",
                      )}
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={valuationDone}
                        onCheckedChange={(checked) =>
                          valuation.onSetCompleted(
                            checked === true,
                            Number(valuation.amountInput) || undefined,
                          )
                        }
                        disabled={
                          !caseItem.valuationDate ||
                          !canEdit ||
                          valuation.pending ||
                          (!valuationDone && !Number(valuation.amountInput))
                        }
                      />
                      <span className="flex-1 font-medium leading-snug">
                        Valuation took place
                        {valuationDone && caseItem.valuationAmount && (
                          <span className="ml-2 font-normal text-muted-foreground">
                            valued at {formatMoney(caseItem.valuationAmount)}
                          </span>
                        )}
                        {valuationDatePassed && !valuationDone && (
                          <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-500">
                            <AlertTriangle className="h-3.5 w-3.5" /> Valuation
                            date has passed — enter the figure and confirm
                          </span>
                        )}
                        {!caseItem.valuationDate && (
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">
                            Set a valuation date first.
                          </span>
                        )}
                      </span>
                    </label>
                  </div>
                </StepCard>
              );

            case "decision":
              return (
                <StepCard
                  key={step.key}
                  {...cardProps(idx)}
                  title="Request the lender's decision"
                  summary={
                    submission.status === "offered"
                      ? "Offer received"
                      : submission.status === "declined"
                        ? "Declined"
                        : "Decision requested"
                  }
                  owner={<SubmissionStepOwner section="submission_decision" />}
                >
                  <label
                    className={cn(
                      "flex items-start gap-3 rounded-md border p-3 text-sm",
                      valuationDone && !submission.bankDecisionRequested
                        ? "border-amber-400/70 bg-amber-50 dark:bg-amber-950/20"
                        : "bg-muted/30",
                      editable ? "cursor-pointer" : "opacity-80",
                    )}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={submission.bankDecisionRequested}
                      onCheckedChange={(checked) =>
                        save({ bankDecisionRequested: checked === true })
                      }
                      disabled={!editable || update.isPending}
                    />
                    <span className="flex-1 font-medium leading-snug">
                      Decision requested from {submission.lenderName}
                      {valuationDone && !submission.bankDecisionRequested && (
                        <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-500">
                          <AlertTriangle className="h-3.5 w-3.5" /> Valuation
                          done — chase the lender for a decision
                        </span>
                      )}
                      {submission.bankDecisionRequested && open && (
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">
                          Record the outcome from the{" "}
                          <ChevronDown className="inline size-3" /> menu: offer
                          received or declined.
                        </span>
                      )}
                    </span>
                  </label>
                </StepCard>
              );

            default:
              return null;
          }
        })}
      </div>

      <Dialog
        open={closing !== null}
        onOpenChange={(o) => !o && setClosing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {closing === "declined"
                ? "Lender declined"
                : "Withdraw submission"}
            </DialogTitle>
            <DialogDescription>
              {closing === "declined"
                ? `${submission.lenderName} declined the case. The submission stays on record.`
                : `Withdraw the case from ${submission.lenderName}. You can reopen it later.`}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
            placeholder="Reason (optional)"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)}>
              Cancel
            </Button>
            <Button
              variant={closing === "declined" ? "destructive" : "default"}
              disabled={update.isPending}
              onClick={() => {
                if (!closing) return;
                save(
                  { status: closing, closeReason: closeReason.trim() || null },
                  closing === "declined"
                    ? "Marked as declined"
                    : "Submission withdrawn",
                );
                setClosing(null);
                setCloseReason("");
              }}
            >
              {closing === "declined" ? "Mark declined" : "Withdraw"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
