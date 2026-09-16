import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Copy, Mail, MessageSquareText, PencilLine, Send } from "lucide-react";
import {
  useGetCaseSubmissionDetails,
  useSendCaseSubmissionDetails,
  usePrefillCaseFromPrevious,
  getGetCaseSubmissionDetailsQueryKey,
  getGetCaseQueryKey,
  getGetClientQueryKey,
  getListCasesQueryKey,
  getListTasksQueryKey,
  type SubmissionPack,
} from "@workspace/api-client-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/components/add/utils";
import { WelcomeTemplateDialog } from "@/components/add/welcome-template-dialog";
import { RecordAnswerDialog, approvalStatus } from "./advice-stage-panel";

/** The pack laid out as sections of label/value pairs; empty required fields are flagged. */
export function SubmissionPackView({ pack, compact }: { pack: SubmissionPack; compact?: boolean }) {
  return (
    <div className={cn("grid gap-4", compact ? "" : "lg:grid-cols-3")}>
      {pack.sections.map((section) => (
        <div key={section.key} className="min-w-0 rounded-md border">
          <p className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</p>
          <dl className="divide-y">
            {section.fields.map((field) => (
              <div key={field.key} className="grid grid-cols-[7.5rem_1fr] gap-2 px-3 py-1.5 text-sm">
                <dt className="truncate text-muted-foreground">{field.label}</dt>
                <dd className={cn("min-w-0 break-words", field.missing && "text-destructive", !field.value && !field.missing && "text-muted-foreground/60")}>
                  {field.value ?? (field.missing ? "Missing" : "—")}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

/**
 * Stage 1 — Submission details. Everything the lender will get, assembled
 * from the client, property, case and advice; copy from the client's last
 * case; send to the client to confirm; record a confirmation given by phone.
 */
export function SubmissionDetailsPanel({
  caseId,
  clientId,
  disabled,
  compact,
}: {
  caseId: number;
  clientId: number;
  disabled?: boolean;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const { data: state, isLoading } = useGetCaseSubmissionDetails(caseId, {
    query: { queryKey: getGetCaseSubmissionDetailsQueryKey(caseId) },
  });
  const send = useSendCaseSubmissionDetails();
  const prefill = usePrefillCaseFromPrevious();
  const [recordOpen, setRecordOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetCaseSubmissionDetailsQueryKey(caseId) });
    qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
    qc.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
    qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
    qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
  };

  if (isLoading || !state) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const { pack, latest, confirmed, previousCase } = state;
  const status = approvalStatus(latest);
  const canSend = pack.missing.length === 0 && !confirmed && !disabled;

  const handlePrefill = () =>
    prefill.mutate(
      { id: caseId },
      {
        onSuccess: (result) => {
          invalidate();
          toast.add({
            title: result.copied.length ? `Copied from ${result.fromReference}` : `Nothing to copy from ${result.fromReference}`,
            description: result.copied.join(", ") || "Every field that case could fill was already filled.",
            type: "success",
          });
        },
        onError: (error) =>
          toast.add({ title: "Couldn't copy from the last case", description: apiErrorMessage(error, "Please try again."), type: "error" }),
      },
    );

  const handleSend = () =>
    send.mutate(
      { id: caseId },
      {
        onSuccess: (next) => {
          invalidate();
          const delivery = next.latest?.deliveryStatus;
          toast.add({
            title: "Details sent for confirmation",
            description: delivery === "sent" ? "The client can confirm from the email or the portal." : "Email sending is not active — they can still confirm in the portal.",
            type: "success",
          });
        },
        onError: (error) =>
          toast.add({ title: "Couldn't send the details", description: apiErrorMessage(error, "Please try again."), type: "error" }),
      },
    );

  return (
    <div className={cn("space-y-4", compact ? "" : "p-4 md:p-5")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {pack.missing.length === 0 ? (
            <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400">
              <Check /> Everything the lender needs is filled in
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle /> {pack.missing.length} missing
            </Badge>
          )}
          {confirmed ? (
            <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400">
              <Check /> Confirmed by the client
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {previousCase && !disabled ? (
            <Button variant="outline" size="sm" onClick={handlePrefill} disabled={prefill.isPending} title={`Copy empty fields from ${previousCase.reference}`}>
              <Copy /> {prefill.isPending ? "Copying…" : `Copy from ${previousCase.reference}`}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setTemplateOpen(true)}>
            <PencilLine /> Email text
          </Button>
        </div>
      </div>

      {pack.missing.length ? (
        <p className="text-sm text-muted-foreground">
          Still needed: {pack.missing.join(" · ")}. Fill these in on the client, property and case forms.
        </p>
      ) : null}

      <SubmissionPackView pack={pack} compact={compact} />

      <div className="flex flex-col gap-3 rounded-md border bg-muted/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm">
          {status ? (
            <p className={cn(status.tone === "ok" && "text-emerald-700 dark:text-emerald-400", status.tone === "warn" && "text-amber-700 dark:text-amber-400")}>
              {status.tone === "ok" ? <Check className="mr-1 inline size-4" /> : status.tone === "warn" ? <MessageSquareText className="mr-1 inline size-4" /> : <Mail className="mr-1 inline size-4" />}
              {status.text.replace("Approved", "Confirmed").replace("Discussion requested", "Client flagged an issue")}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {pack.missing.length ? "Complete the details, then send them to the client to confirm." : "Send the details to the client to confirm before submission."}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {latest && !latest.response && !disabled ? (
            <Button variant="outline" size="sm" onClick={() => setRecordOpen(true)}>Record client's answer</Button>
          ) : null}
          {!confirmed && !disabled ? (
            <Button size="sm" disabled={!canSend || send.isPending} onClick={handleSend} title={pack.missing.join(", ") || undefined}>
              <Send /> {send.isPending ? "Sending…" : latest ? "Resend for confirmation" : "Send for confirmation"}
            </Button>
          ) : null}
        </div>
      </div>

      {latest ? (
        <RecordAnswerDialog open={recordOpen} onOpenChange={setRecordOpen} caseId={caseId} approval={latest} onRecorded={invalidate} />
      ) : null}
      <WelcomeTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} templateKey="details_confirmation" />
    </div>
  );
}
