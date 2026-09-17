import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardPaste, FileSignature, Mail, MessageSquareText, PencilLine, Send, ShieldCheck, Sparkles } from "lucide-react";
import {
  useConfirmCaseServiceLevel,
  useExtractCaseInstruction,
  useGetCaseAdvice,
  useUpdateCaseAdvice,
  useSendCaseAdvice,
  useRecordCaseApproval,
  useListLenders,
  getGetCaseAdviceQueryKey,
  getGetCaseQueryKey,
  getListCasesQueryKey,
  getListTasksQueryKey,
  type CaseAdviceInput,
  type CaseAdviceState,
  type ClientApproval,
} from "@workspace/api-client-react";
import { useAuth } from "@/components/auth-provider";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { CommaInput } from "@/components/ui/comma-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isFullAccess } from "@/lib/roles";
import { cn, formatDate } from "@/lib/utils";
import { SERVICE_TYPES, needsAdvice, serviceTypeLabel } from "@/lib/service-types";
import { useAutosave } from "@/components/add/use-autosave";
import { SaveStatus } from "@/components/add/save-status";
import { apiErrorMessage } from "@/components/add/utils";
import { WelcomeTemplateDialog } from "@/components/add/welcome-template-dialog";
import { TermsOfBusinessPanel } from "./terms-of-business-panel";

interface AdviceDraft {
  lenderId: string;
  product: string;
  ratePct: string;
  termYears: string;
  monthlyPayment: string;
  arrangementFee: string;
  summary: string;
  reasoning: string;
  source: "" | "adviser" | "client_email" | "staff";
  instructionEmailText: string;
}

const draftFrom = (state: CaseAdviceState | undefined): AdviceDraft => ({
  lenderId: state?.advice.lenderId != null ? String(state.advice.lenderId) : "",
  product: state?.advice.product ?? "",
  ratePct: state?.advice.ratePct != null ? String(state.advice.ratePct) : "",
  termYears: state?.advice.termYears != null ? String(state.advice.termYears) : "",
  monthlyPayment: state?.advice.monthlyPayment != null ? String(state.advice.monthlyPayment) : "",
  arrangementFee: state?.advice.arrangementFee != null ? String(state.advice.arrangementFee) : "",
  summary: state?.advice.summary ?? "",
  reasoning: state?.advice.reasoning ?? "",
  source: state?.advice.source ?? "",
  instructionEmailText: state?.advice.instructionEmailText ?? "",
});

const num = (value: string) => {
  const parsed = parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

/** One line on where the client's answer stands. */
export function approvalStatus(latest: ClientApproval | null | undefined) {
  if (!latest) return null;
  if (latest.response === "approved") {
    return { tone: "ok" as const, text: `Approved ${latest.respondedVia === "email" ? "by email" : latest.respondedVia === "portal" ? "in the portal" : "by phone/email (recorded)"} · ${formatDate(latest.respondedAt)}` };
  }
  if (latest.response === "discuss") {
    return { tone: "warn" as const, text: `Discussion requested ${formatDate(latest.respondedAt)}${latest.note ? ` — "${latest.note}"` : ""}` };
  }
  if (new Date(latest.expiresAt).getTime() < Date.now()) {
    return { tone: "warn" as const, text: `Sent ${formatDate(latest.sentAt)} · link expired — resend` };
  }
  const delivery = latest.deliveryStatus === "sent" ? "" : latest.deliveryStatus === "disabled" ? " · email not active" : latest.deliveryStatus === "failed" ? " · email failed" : "";
  return { tone: "pending" as const, text: `Sent ${formatDate(latest.sentAt)} (v${latest.version}) · awaiting reply${delivery}` };
}

/**
 * Stage 0 — Advice & approval. The adviser (an administrator) confirms the
 * service level, writes the recommendation and sends it; everyone can see
 * where the client's answer stands and record one given by phone.
 */
export function AdviceStagePanel({
  caseId,
  clientId,
  serviceType,
  disabled,
  compact,
}: {
  caseId: number;
  /** With `clientId`, the case's Terms of Business section renders at the bottom (the case page); the Add page has its own. */
  clientId?: number;
  serviceType: string;
  /** Read-only: viewing a past stage or a completed case. */
  disabled?: boolean;
  /** Tighter spacing for the Add page column. */
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);
  const { data: state, isLoading } = useGetCaseAdvice(caseId, {
    query: { queryKey: getGetCaseAdviceQueryKey(caseId) },
  });
  const { data: lenders } = useListLenders();
  const confirm = useConfirmCaseServiceLevel();
  const update = useUpdateCaseAdvice();
  const send = useSendCaseAdvice();
  const extract = useExtractCaseInstruction();
  const [recordOpen, setRecordOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [emailText, setEmailText] = useState("");
  // Execution-only: the record is the client's own instruction, which any staff member may write.
  const instruction = state?.mode === "instruction";
  const canEdit = !!state && !disabled && (instruction || isAdmin);

  const [draft, setDraft] = useState<AdviceDraft>(() => draftFrom(state));
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    // Seed once per case, and again when the server copy changes under us (another adviser).
    const stamp = state ? `${caseId}:${state.advice.updatedAt ?? "none"}` : null;
    if (state && seeded.current !== stamp) {
      seeded.current = stamp;
      setDraft(draftFrom(state));
    }
  }, [state, caseId]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetCaseAdviceQueryKey(caseId) });
    qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
    qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
    qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
  };

  const payload: CaseAdviceInput = {
    lenderId: draft.lenderId ? parseInt(draft.lenderId, 10) : null,
    product: draft.product.trim() || null,
    ratePct: num(draft.ratePct),
    termYears: draft.termYears ? parseInt(draft.termYears, 10) : null,
    monthlyPayment: num(draft.monthlyPayment),
    arrangementFee: num(draft.arrangementFee),
    summary: draft.summary.trim() || null,
    reasoning: draft.reasoning.trim() || null,
    source: draft.source || (instruction ? "staff" : "adviser"),
    instructionEmailText: draft.instructionEmailText.trim() || null,
  };
  const autosave = useAutosave({
    enabled: canEdit,
    payload,
    seedKey: `${caseId}:${state?.advice.updatedAt ?? "none"}`,
    save: async (next) => {
      try {
        const saved = await update.mutateAsync({ id: caseId, data: next });
        qc.setQueryData(getGetCaseAdviceQueryKey(caseId), saved);
        seeded.current = `${caseId}:${saved.advice.updatedAt ?? "none"}`;
      } catch (error) {
        throw new Error(apiErrorMessage(error, "Couldn't save the advice"));
      }
    },
  });

  const setField = <K extends keyof AdviceDraft>(key: K) => (value: AdviceDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /** Read the client's email; nothing is saved until the fields autosave. */
  const handleExtract = () => {
    const text = emailText.trim();
    if (!text) return;
    extract.mutate(
      { id: caseId, data: { emailText: text } },
      {
        onSuccess: ({ extracted, model }) => {
          setDraft((current) => ({
            ...current,
            lenderId: extracted.lenderId != null ? String(extracted.lenderId) : current.lenderId,
            product: extracted.product ?? current.product,
            ratePct: extracted.ratePct != null ? String(extracted.ratePct) : current.ratePct,
            termYears: extracted.termYears != null ? String(extracted.termYears) : current.termYears,
            summary: extracted.summary ?? current.summary,
            source: "client_email",
            instructionEmailText: text,
          }));
          const found = [
            extracted.lenderId != null ? "lender" : null,
            extracted.product ? "product" : null,
            extracted.ratePct != null ? "rate" : null,
            extracted.termYears != null ? "term" : null,
          ].filter(Boolean);
          const unmatched = extracted.lenderName && extracted.lenderId == null ? ` "${extracted.lenderName}" is not a lender on file — choose one.` : "";
          toast.add({
            title: found.length ? `Read ${found.join(", ")} from the email` : "Nothing recognisable in the email",
            description: `${model ? "" : "Basic read — the AI is not active. "}Check the fields before moving on.${unmatched}`,
            type: found.length ? "success" : "warning",
          });
        },
        onError: (error) =>
          toast.add({ title: "Couldn't read the email", description: apiErrorMessage(error, "Please try again."), type: "error" }),
      },
    );
  };

  const handleConfirm = () =>
    confirm.mutate(
      { id: caseId },
      {
        onSuccess: () => {
          invalidate();
          toast.add({ title: `${serviceTypeLabel(serviceType)} confirmed`, type: "success" });
        },
        onError: (error) =>
          toast.add({ title: "Couldn't confirm the service level", description: apiErrorMessage(error, "Please try again."), type: "error" }),
      },
    );

  const handleSend = async () => {
    await autosave.flush();
    send.mutate(
      { id: caseId },
      {
        onSuccess: (next) => {
          invalidate();
          const delivery = next.latest?.deliveryStatus;
          toast.add({
            title: "Advice sent to the client",
            description: delivery === "sent" ? "They can approve from the email or the portal." : delivery === "disabled" ? "Email sending is not active — they can still approve in the portal." : "The email could not be delivered; the portal request is live.",
            type: delivery === "failed" ? "error" : "success",
          });
        },
        onError: (error) =>
          toast.add({ title: "Couldn't send the advice", description: apiErrorMessage(error, "Please try again."), type: "error" }),
      },
    );
  };

  if (isLoading || !state) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const confirmed = !!state.serviceLevelConfirmedAt;
  const latest = state.latest;
  const status = approvalStatus(latest);
  const approved = latest?.response === "approved";
  const level = SERVICE_TYPES.find((item) => item.value === serviceType);

  return (
    <div className={cn("space-y-5", compact ? "" : "p-4 md:p-5")}>
      {/* Step 5 — service level */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Service level</p>
            <p className="text-sm font-medium">
              {serviceTypeLabel(serviceType)}
              {level ? <span className="font-normal text-muted-foreground"> — {level.hint}</span> : null}
            </p>
          </div>
          {confirmed ? (
            <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400">
              <ShieldCheck /> Confirmed by {state.serviceLevelConfirmedBy ?? "the adviser"} · {formatDate(state.serviceLevelConfirmedAt)}
            </Badge>
          ) : isAdmin && !disabled ? (
            <Button size="sm" onClick={handleConfirm} disabled={confirm.isPending}>
              <ShieldCheck /> {confirm.isPending ? "Confirming…" : "Confirm service level"}
            </Button>
          ) : (
            <Badge variant="secondary">Awaiting the adviser's confirmation</Badge>
          )}
        </div>
        {!confirmed && !isAdmin ? (
          <p className="text-xs text-muted-foreground">Only an administrator (the adviser) can confirm the level. Change it on the case if it is wrong.</p>
        ) : null}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileSignature className="size-3.5 shrink-0" />
          {state.termsOfBusiness ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              Terms of Business signed {state.termsOfBusiness.via === "docusign" ? "via DocuSign" : state.termsOfBusiness.via === "signed_upload" ? "(signed copy)" : "(recorded by staff)"} · {formatDate(state.termsOfBusiness.signedAt)} · v{state.termsOfBusiness.version}
            </span>
          ) : (
            <span>Terms of Business not yet signed — the case cannot proceed until they are (see the Terms of Business section).</span>
          )}
        </p>
      </section>

      {/* Step 6 — the client's preference: written advice, or their own instruction (execution only) */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {instruction ? "Client instruction (execution only)" : "Recommendation"}
          </p>
          <div className="flex items-center gap-2">
            {canEdit ? <SaveStatus status={autosave.status} error={autosave.error} /> : null}
            {!instruction ? (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setTemplateOpen(true)}>
                <PencilLine /> Email text
              </Button>
            ) : null}
          </div>
        </div>

        {instruction && canEdit ? (
          <div className="space-y-2 rounded-md border border-dashed px-3 py-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <ClipboardPaste className="size-4 text-muted-foreground" /> Paste the client's email
            </p>
            <Textarea
              value={emailText}
              onChange={(event) => setEmailText(event.target.value)}
              placeholder="The email where the client says which lender and product they want…"
              className="min-h-24 font-mono text-xs"
              aria-label="Client's email"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Fills the fields below from the email; the email is kept on file with the instruction.</p>
              <Button size="sm" variant="outline" onClick={handleExtract} disabled={!emailText.trim() || extract.isPending}>
                <Sparkles /> {extract.isPending ? "Reading…" : "Fill from email"}
              </Button>
            </div>
          </div>
        ) : null}
        {instruction && draft.instructionEmailText && !emailText ? (
          <details className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground">Client's email on file{draft.source === "client_email" ? "" : " (not the source of these fields)"}</summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono">{draft.instructionEmailText}</pre>
          </details>
        ) : null}

        <fieldset disabled={!canEdit || approved} className="space-y-4 disabled:opacity-80">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>Lender</FieldLabel>
              <select
                value={draft.lenderId}
                onChange={(event) => setField("lenderId")(event.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Choose a lender</option>
                {(lenders ?? []).map((lender) => (
                  <option key={lender.id} value={lender.id}>{lender.name}</option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`advice-product-${caseId}`}>Product</FieldLabel>
              <Input id={`advice-product-${caseId}`} value={draft.product} onChange={(event) => setField("product")(event.target.value)} placeholder="5-year fixed, 75% LTV" />
            </Field>
            <Field>
              <FieldLabel htmlFor={`advice-rate-${caseId}`}>Rate (%)</FieldLabel>
              <Input id={`advice-rate-${caseId}`} type="number" step="0.01" min="0" value={draft.ratePct} onChange={(event) => setField("ratePct")(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`advice-term-${caseId}`}>Term (years)</FieldLabel>
              <Input id={`advice-term-${caseId}`} type="number" min="0" value={draft.termYears} onChange={(event) => setField("termYears")(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`advice-payment-${caseId}`}>Monthly payment (£)</FieldLabel>
              <CommaInput id={`advice-payment-${caseId}`} value={draft.monthlyPayment} onChange={setField("monthlyPayment")} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`advice-fee-${caseId}`}>Arrangement fee (£)</FieldLabel>
              <CommaInput id={`advice-fee-${caseId}`} value={draft.arrangementFee} onChange={setField("arrangementFee")} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor={`advice-summary-${caseId}`}>
              {instruction ? "What the client asked for — in their words" : "Recommendation — what the client reads"}
            </FieldLabel>
            <Textarea
              id={`advice-summary-${caseId}`}
              value={draft.summary}
              onChange={(event) => setField("summary")(event.target.value)}
              placeholder={instruction ? "The mortgage the client has chosen and any conditions they set." : "Why this lender and product suits them, in plain words."}
              className="min-h-28"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`advice-reasoning-${caseId}`}>{instruction ? "Notes — on file only" : "Reasoning — on file only"}</FieldLabel>
            <Textarea
              id={`advice-reasoning-${caseId}`}
              value={draft.reasoning}
              onChange={(event) => setField("reasoning")(event.target.value)}
              placeholder={instruction ? "Anything to note about the instruction (no advice was given)." : "Alternatives considered, affordability notes…"}
              className="min-h-20"
            />
          </Field>
        </fieldset>

        {/* Send / status */}
        <div className="flex flex-col gap-3 rounded-md border bg-muted/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            {instruction ? (
              state.instructionRecorded ? (
                <p className="text-emerald-700 dark:text-emerald-400">
                  <Check className="mr-1 inline size-4" />
                  Instruction recorded{state.advice.updatedBy ? ` by ${state.advice.updatedBy}` : ""}{state.advice.source === "client_email" ? " from the client's email" : ""} — the client confirms it with the submission details.
                </p>
              ) : (
                <p className="text-muted-foreground">Still needed: {state.missing.join(" · ")}</p>
              )
            ) : status ? (
              <p className={cn(status.tone === "ok" && "text-emerald-700 dark:text-emerald-400", status.tone === "warn" && "text-amber-700 dark:text-amber-400")}>
                {status.tone === "ok" ? <Check className="mr-1 inline size-4" /> : status.tone === "warn" ? <MessageSquareText className="mr-1 inline size-4" /> : <Mail className="mr-1 inline size-4" />}
                {status.text}
              </p>
            ) : state.missing.length ? (
              <p className="text-muted-foreground">Before sending: {state.missing.join(" · ")}</p>
            ) : (
              <p className="text-muted-foreground">Ready to send — the client gets Approve / Further discussion buttons.</p>
            )}
          </div>
          {!instruction ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              {latest && !latest.response && !disabled ? (
                <Button variant="outline" size="sm" onClick={() => setRecordOpen(true)}>
                  Record client's answer
                </Button>
              ) : null}
              {isAdmin && !disabled && !approved ? (
                <Button size="sm" disabled={!state.readyToSend || send.isPending} onClick={handleSend} title={state.missing.join(", ") || undefined}>
                  <Send /> {send.isPending ? "Sending…" : latest ? "Resend advice" : "Send to client"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {clientId != null ? (
        <section className="space-y-3 border-t pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Terms of Business</p>
          <TermsOfBusinessPanel caseId={caseId} clientId={clientId} disabled={disabled} />
        </section>
      ) : null}

      {latest ? (
        <RecordAnswerDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          caseId={caseId}
          approval={latest}
          onRecorded={invalidate}
        />
      ) : null}
      <WelcomeTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} templateKey="advice_email" />
    </div>
  );
}

/** Staff enter an answer the client gave by phone or in a reply email. */
export function RecordAnswerDialog({
  open,
  onOpenChange,
  caseId,
  approval,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: number;
  approval: ClientApproval;
  onRecorded: () => void;
}) {
  const record = useRecordCaseApproval();
  const [response, setResponse] = useState<"approved" | "discuss">("approved");
  const [note, setNote] = useState("");
  const what = approval.kind === "advice" ? "advice" : "details";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record the client's answer</DialogTitle>
          <DialogDescription>For an answer given by phone or in a reply — the {what} sent {formatDate(approval.sentAt)} (v{approval.version}).</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ToggleGroup type="single" variant="outline" value={response} onValueChange={(value) => value && setResponse(value as "approved" | "discuss")} className="w-full">
            <ToggleGroupItem value="approved" className="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              {approval.kind === "advice" ? "Approved" : "Confirmed"}
            </ToggleGroupItem>
            <ToggleGroupItem value="discuss" className="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              {approval.kind === "advice" ? "Wants to discuss" : "Something is wrong"}
            </ToggleGroupItem>
          </ToggleGroup>
          <Field>
            <FieldLabel htmlFor="record-note">Note</FieldLabel>
            <Textarea id="record-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="How they answered and anything they said" className="min-h-20" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={record.isPending}
            onClick={() =>
              record.mutate(
                { id: caseId, approvalId: approval.id, data: { response, note: note.trim() || undefined } },
                {
                  onSuccess: () => {
                    onOpenChange(false);
                    setNote("");
                    onRecorded();
                    toast.add({ title: "Answer recorded", type: "success" });
                  },
                  onError: (error) =>
                    toast.add({ title: "Couldn't record the answer", description: apiErrorMessage(error, "Please try again."), type: "error" }),
                },
              )
            }
          >
            {record.isPending ? "Saving…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
