import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import { Ban, FileText, FileUp, Plus, RotateCcw, Star, ThumbsDown } from "lucide-react";
import {
  useCreateCaseSubmission,
  useDeleteCaseSubmission,
  useListLenders,
  useUpdateCaseSubmission,
  getGetCaseQueryKey,
  getListCasesQueryKey,
  getGetClientQueryKey,
  type CaseDetail,
  type CaseSubmission,
  type CaseSubmissionStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { DocumentFile } from "@/components/document-file";
import { UploadProgress } from "@/components/upload-progress";
import { documentUploadHeaders, useUpload } from "@/lib/upload";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DatePicker } from "@/components/date-picker";
import { cn } from "@/lib/utils";
import { useAutosave } from "./use-autosave";
import { SaveStatus } from "./save-status";
import { ACCEPTED_DOCUMENT_TYPES, apiErrorMessage } from "./utils";

const STATUS_LABEL: Record<CaseSubmissionStatus, string> = {
  active: "Active",
  offered: "Offer received",
  withdrawn: "Withdrawn",
  declined: "Declined",
};

const isOpen = (submission: CaseSubmission) =>
  submission.status === "active" || submission.status === "offered";

/** How many of the tracked steps a submission has done, for the tab counter. */
export function submissionProgress(submission: CaseSubmission) {
  const steps = [
    !!submission.dipDocument,
    !!submission.lenderCaseNumber,
    submission.applicationFeeConfirmed,
    !!submission.valuationDate,
    submission.bankDecisionRequested,
  ];
  return { done: steps.filter(Boolean).length, total: steps.length };
}

/**
 * One tab per lender the case has been submitted to. Each tab tracks its own
 * DIP, case number, fee, valuation and decision, and can be withdrawn,
 * marked declined, reopened or made the primary the case follows.
 */
export function SubmissionsPanel({ caseDetail }: { caseDetail: CaseDetail }) {
  const qc = useQueryClient();
  const { data: lenders } = useListLenders();
  const createSubmission = useCreateCaseSubmission();
  const submissions = caseDetail.submissions;
  const [activeId, setActiveId] = useState<number | null>(
    submissions.find((item) => item.isPrimary)?.id ?? submissions[0]?.id ?? null,
  );
  const [addOpen, setAddOpen] = useState(false);

  // Keep a valid tab selected as submissions come and go.
  useEffect(() => {
    if (!submissions.some((item) => item.id === activeId)) {
      setActiveId(submissions.find((item) => item.isPrimary)?.id ?? submissions[0]?.id ?? null);
    }
  }, [submissions, activeId]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseDetail.id) });
    qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetClientQueryKey(caseDetail.clientId) });
  };

  const submittedLenderIds = new Set(submissions.filter(isOpen).map((item) => item.lenderId));
  const availableLenders = (lenders ?? []).filter(
    (lender) => lender.status === "active" && !submittedLenderIds.has(lender.id),
  );

  const handleAdd = (lenderId: number) => {
    createSubmission.mutate(
      { id: caseDetail.id, data: { lenderId } },
      {
        onSuccess: (created) => {
          setAddOpen(false);
          setActiveId(created.id);
          invalidate();
        },
        onError: (error) => {
          toast.add({
            title: "Couldn't add lender",
            description: apiErrorMessage(error, "Please try again."),
            type: "error",
          });
        },
      },
    );
  };

  const active = submissions.find((item) => item.id === activeId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 border-b">
        {submissions.map((submission) => {
          const progress = submissionProgress(submission);
          const selected = submission.id === activeId;
          const closed = !isOpen(submission);
          return (
            <button
              key={submission.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveId(submission.id)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm transition-colors",
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
                closed && "line-through decoration-muted-foreground/60",
              )}
            >
              {submission.isPrimary ? (
                <Star className="size-3.5 fill-current text-amber-500" aria-label="Primary" />
              ) : null}
              <span className={cn(closed && "text-muted-foreground")}>{submission.lenderName}</span>
              {closed ? null : (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {progress.done}/{progress.total}
                </span>
              )}
            </button>
          );
        })}
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mb-px text-muted-foreground"
              disabled={availableLenders.length === 0}
            >
              <Plus /> {submissions.length === 0 ? "Submit to a lender" : "Add lender"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-1">
            {availableLenders.map((lender) => (
              <button
                key={lender.id}
                type="button"
                onClick={() => handleAdd(lender.id)}
                disabled={createSubmission.isPending}
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                {lender.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {active ? (
        <SubmissionTab
          key={active.id}
          caseDetail={caseDetail}
          submission={active}
          onChanged={invalidate}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Not submitted to any lender yet. Add one or more lenders; each gets
          its own tracking.
        </p>
      )}
    </div>
  );
}

interface SubmissionDraft {
  lenderCaseNumber: string;
  valuationDate: string;
  valuationCompleted: boolean;
  applicationFeeConfirmed: boolean;
  bankDecisionRequested: boolean;
  notes: string;
}

function draftFrom(submission: CaseSubmission): SubmissionDraft {
  return {
    lenderCaseNumber: submission.lenderCaseNumber ?? "",
    valuationDate: submission.valuationDate ? submission.valuationDate.slice(0, 10) : "",
    valuationCompleted: !!submission.valuationCompletedAt,
    applicationFeeConfirmed: submission.applicationFeeConfirmed,
    bankDecisionRequested: submission.bankDecisionRequested,
    notes: submission.notes,
  };
}

function SubmissionTab({
  caseDetail,
  submission,
  onChanged,
}: {
  caseDetail: CaseDetail;
  submission: CaseSubmission;
  onChanged: () => void;
}) {
  const updateSubmission = useUpdateCaseSubmission();
  const deleteSubmission = useDeleteCaseSubmission();
  const [draft, setDraft] = useState<SubmissionDraft>(() => draftFrom(submission));
  const [closeReason, setCloseReason] = useState("");
  const [closing, setClosing] = useState<"withdrawn" | "declined" | null>(null);
  const dipInputRef = useRef<HTMLInputElement>(null);
  const dipUpload = useUpload();
  const isUploadingDip = dipUpload.uploading;
  const closed = !isOpen(submission);

  const setField =
    <K extends keyof SubmissionDraft>(key: K) =>
    (value: SubmissionDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value }));

  const payload = {
    lenderCaseNumber: draft.lenderCaseNumber,
    valuationDate: draft.valuationDate ? new Date(draft.valuationDate).toISOString() : null,
    valuationCompletedAt: draft.valuationCompleted
      ? (submission.valuationCompletedAt ?? new Date().toISOString())
      : null,
    applicationFeeConfirmed: draft.applicationFeeConfirmed,
    bankDecisionRequested: draft.bankDecisionRequested,
    notes: draft.notes,
  };

  const autosave = useAutosave({
    enabled: !closed,
    payload,
    seedKey: submission.id,
    save: async (next) => {
      try {
        await updateSubmission.mutateAsync({
          id: caseDetail.id,
          submissionId: submission.id,
          data: next,
        });
        onChanged();
      } catch (error) {
        throw new Error(apiErrorMessage(error, "Couldn't save submission"));
      }
    },
  });

  const changeStatus = (
    status: CaseSubmissionStatus,
    extra: { closeReason?: string | null; isPrimary?: boolean } = {},
  ) => {
    updateSubmission.mutate(
      { id: caseDetail.id, submissionId: submission.id, data: { status, ...extra } },
      {
        onSuccess: () => {
          setClosing(null);
          setCloseReason("");
          onChanged();
        },
        onError: (error) => {
          toast.add({
            title: "Couldn't update submission",
            description: apiErrorMessage(error, "Please try again."),
            type: "error",
          });
        },
      },
    );
  };

  const handleRemove = () => {
    deleteSubmission.mutate(
      { id: caseDetail.id, submissionId: submission.id },
      {
        onSuccess: onChanged,
        onError: (error) => {
          toast.add({
            title: "Couldn't remove submission",
            description: apiErrorMessage(error, "Withdraw it instead."),
            type: "error",
          });
        },
      },
    );
  };

  const handleDipUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.add({ title: "File too large", description: "Maximum file size is 50 MB.", type: "error" });
      if (dipInputRef.current) dipInputRef.current.value = "";
      return;
    }
    try {
      await dipUpload.send(file, {
        url: "/api/documents/upload",
        headers: documentUploadHeaders(file, {
          "x-document-category": "DIP",
          "x-client-id": caseDetail.clientId,
          "x-case-id": caseDetail.id,
          "x-submission-id": submission.id,
        }),
      });
      toast.add({ title: `DIP uploaded for ${submission.lenderName}`, type: "success" });
      onChanged();
    } catch (error) {
      toast.add({
        title: "Failed to upload DIP",
        description: error instanceof Error ? error.message : undefined,
        type: "error",
      });
    } finally {
      dipUpload.reset();
      if (dipInputRef.current) dipInputRef.current.value = "";
    }
  };

  const isBlank =
    !submission.dipDocument &&
    !submission.lenderCaseNumber &&
    !submission.applicationFeeConfirmed &&
    !submission.valuationDate &&
    !submission.bankDecisionRequested &&
    !submission.notes.trim();

  return (
    <div className="space-y-4" onBlur={() => autosave.flush()}>
      <input
        ref={dipInputRef}
        type="file"
        className="hidden"
        accept={ACCEPTED_DOCUMENT_TYPES}
        onChange={handleDipUpload}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={closed ? "outline" : submission.status === "offered" ? "default" : "secondary"}>
            {STATUS_LABEL[submission.status]}
          </Badge>
          {submission.isPrimary ? (
            <span className="text-xs text-muted-foreground">Primary: the case follows this lender</span>
          ) : null}
          {closed && submission.closeReason ? (
            <span className="text-xs text-muted-foreground">· {submission.closeReason}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {!closed && !submission.isPrimary ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => changeStatus(submission.status, { isPrimary: true })}
            >
              <Star /> Make primary
            </Button>
          ) : null}
          {!closed && submission.status === "active" ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => changeStatus("offered")}>
              Offer received
            </Button>
          ) : null}
          {!closed ? (
            <>
              <Button type="button" variant="ghost" size="xs" onClick={() => setClosing("withdrawn")}>
                <Ban /> Withdraw
              </Button>
              <Button type="button" variant="ghost" size="xs" onClick={() => setClosing("declined")}>
                <ThumbsDown /> Declined
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" size="xs" onClick={() => changeStatus("active")}>
              <RotateCcw /> Reopen
            </Button>
          )}
        </div>
      </div>

      {closing ? (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <p className="text-sm">
            {closing === "withdrawn"
              ? `Withdraw the submission to ${submission.lenderName}?`
              : `Record that ${submission.lenderName} declined?`}
          </p>
          <Input
            value={closeReason}
            onChange={(event) => setCloseReason(event.target.value)}
            placeholder="Reason (optional)"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setClosing(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant={closing === "declined" ? "destructive" : "default"}
              disabled={updateSubmission.isPending}
              onClick={() => changeStatus(closing, { closeReason: closeReason || null })}
            >
              {closing === "withdrawn" ? "Withdraw submission" : "Mark declined"}
            </Button>
          </div>
        </div>
      ) : null}

      <fieldset disabled={closed} className={cn("space-y-4", closed && "opacity-60")}>
        <Field>
          <FieldLabel htmlFor={`sub-${submission.id}-number`}>Lender case number</FieldLabel>
          <Input
            id={`sub-${submission.id}-number`}
            value={draft.lenderCaseNumber}
            onChange={(event) => setField("lenderCaseNumber")(event.target.value)}
            placeholder={submission.isPrimary ? "Becomes the case reference once set" : undefined}
          />
        </Field>
        <Field>
          <FieldLabel>Decision in principle (DIP)</FieldLabel>
          <div className="flex items-center justify-between gap-3">
            {submission.dipDocument ? (
              <DocumentFile
                id={submission.dipDocument.id}
                name={submission.dipDocument.name}
                variant="chip"
                className="min-w-0 flex-1"
                onDeleted={onChanged}
              />
            ) : (
              <span className="text-sm text-muted-foreground">Not uploaded yet</span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isUploadingDip || closed}
              onClick={() => dipInputRef.current?.click()}
            >
              <FileUp />
              {isUploadingDip ? "Uploading..." : submission.dipDocument ? "Replace" : "Upload"}
            </Button>
          </div>
          <UploadProgress progress={dipUpload.progress} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel>Valuation date</FieldLabel>
            <DatePicker
              value={draft.valuationDate}
              onChange={setField("valuationDate")}
              className="w-full justify-start"
            />
          </Field>
          <Field>
            <FieldLabel>Valuation</FieldLabel>
            <Select
              value={draft.valuationCompleted ? "done" : "pending"}
              onValueChange={(value) => setField("valuationCompleted")(value === "done")}
              disabled={!draft.valuationDate}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Booked</SelectItem>
                <SelectItem value="done">Took place</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <Checkbox
              checked={draft.applicationFeeConfirmed}
              onCheckedChange={(checked) => setField("applicationFeeConfirmed")(checked === true)}
            />
            Application &amp; valuation fee confirmed
          </label>
          <label className="flex items-center gap-3 text-sm">
            <Checkbox
              checked={draft.bankDecisionRequested}
              onCheckedChange={(checked) => setField("bankDecisionRequested")(checked === true)}
            />
            Decision requested from lender
          </label>
        </div>
        <Field>
          <FieldLabel htmlFor={`sub-${submission.id}-notes`}>Notes for this lender</FieldLabel>
          <Textarea
            id={`sub-${submission.id}-notes`}
            value={draft.notes}
            onChange={(event) => setField("notes")(event.target.value)}
            className="min-h-[60px]"
          />
        </Field>
      </fieldset>

      <div className="flex items-center justify-between gap-3">
        {isBlank && !closed ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            disabled={deleteSubmission.isPending}
            onClick={handleRemove}
          >
            Remove lender
          </Button>
        ) : (
          <span />
        )}
        <SaveStatus status={autosave.status} error={autosave.error} />
      </div>
    </div>
  );
}
