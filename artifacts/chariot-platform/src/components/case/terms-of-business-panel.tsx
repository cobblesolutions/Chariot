import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertCircle, Ban, Check, Eye, FileSignature, Mail, PenLine, RefreshCw, Upload } from "lucide-react";
import {
  useGetCaseTermsOfBusiness,
  useSaveCaseTermsOfBusiness,
  useSendCaseTermsOfBusiness,
  useRefreshCaseTermsOfBusiness,
  useVoidCaseTermsOfBusiness,
  useMarkCaseTermsOfBusinessSigned,
  useMockSignCaseTermsOfBusiness,
  getGetCaseTermsOfBusinessQueryKey,
  getGetCaseQueryKey,
  getGetClientQueryKey,
  getListCasesQueryKey,
  getListTasksQueryKey,
  type CaseTermsState,
  type TermsAgreement,
  type TermsTemplateField,
} from "@workspace/api-client-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DocumentFile } from "@/components/document-file";
import { previewDocument } from "@/components/document-preview";
import { UploadProgress } from "@/components/upload-progress";
import { openPdfPreview } from "@/components/settings/terms-of-business-tab";
import { apiErrorMessage } from "@/components/add/utils";
import { documentUploadHeaders, useUpload } from "@/lib/upload";
import { cn, formatDate } from "@/lib/utils";

const VIA_TEXT: Record<string, string> = {
  docusign: "Signed via DocuSign",
  signed_upload: "Signed copy received",
  staff: "Recorded by staff",
};

/** The read-only case values worth showing above the form (the rest are in the document). */
const SHOWN_AUTO: Array<{ key: string; label: string }> = [
  { key: "clientName", label: "Client" },
  { key: "propertyAddress", label: "Property" },
  { key: "loanAmount", label: "Loan" },
  { key: "serviceLevel", label: "Service level" },
  { key: "ourFee", label: "Our fee" },
  { key: "adviser", label: "Adviser" },
];

/**
 * The case's Terms of Business — the last section of every case. Staff fill
 * the template's fields, preview the document, and send it for signature;
 * the section then tracks the DocuSign envelope until the signed copy comes
 * back and is filed here. Nothing can proceed until it has.
 */
export function TermsOfBusinessPanel({
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
  const { data: state, isLoading } = useGetCaseTermsOfBusiness(caseId, {
    query: { queryKey: getGetCaseTermsOfBusinessQueryKey(caseId) },
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetCaseTermsOfBusinessQueryKey(caseId) });
    qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
    qc.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
    qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
    qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
    qc.invalidateQueries({ queryKey: ["/api/documents"] });
  };

  if (isLoading || !state) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (!state.template) {
    return (
      <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
        No Terms of Business template is published yet.{" "}
        <Link href="/settings?tab=terms-of-business" className="underline underline-offset-2">Publish one in Settings</Link> before this case can send its terms.
      </p>
    );
  }
  const agreement = state.agreement;
  if (agreement?.status === "signed") return <SignedView state={state} agreement={agreement} compact={compact} />;
  if (agreement?.status === "sent") return <SentView state={state} agreement={agreement} caseId={caseId} clientId={clientId} disabled={disabled} onChanged={invalidate} />;
  return <DraftForm state={state} caseId={caseId} clientId={clientId} disabled={disabled} compact={compact} onChanged={invalidate} />;
}

function StatusLine({ icon, tone, children }: { icon: React.ReactNode; tone: "ok" | "warn" | "bad" | "muted"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        tone === "ok" && "border-emerald-200/70 bg-emerald-50/50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200",
        tone === "warn" && "border-amber-200/70 bg-amber-50/50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200",
        tone === "bad" && "border-destructive/30 bg-destructive/5 text-destructive",
        tone === "muted" && "bg-muted/40 text-muted-foreground",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signed

function SignedView({ state, agreement, compact }: { state: CaseTermsState; agreement: TermsAgreement; compact?: boolean }) {
  const acceptance = state.acceptance;
  return (
    <div className="space-y-3">
      <StatusLine icon={<Check className="size-4" />} tone="ok">
        <p className="font-medium">
          {VIA_TEXT[agreement.signedVia ?? "staff"]} · {formatDate(agreement.signedAt ?? agreement.updatedAt)} · v{agreement.templateVersion}
          {state.currentVersion && state.currentVersion > agreement.templateVersion ? <span className="font-normal text-muted-foreground"> · current template is v{state.currentVersion}</span> : null}
        </p>
        {agreement.signedBy ? <p className="text-xs opacity-80">Recorded by {agreement.signedBy}{agreement.signedNote ? ` — ${agreement.signedNote}` : ""}</p> : agreement.signedNote ? <p className="text-xs opacity-80">{agreement.signedNote}</p> : null}
      </StatusLine>
      <div className={cn("flex flex-wrap items-center gap-2", compact && "flex-col items-stretch")}>
        {acceptance?.signedDocumentId != null ? (
          <DocumentFile id={acceptance.signedDocumentId} name={`${agreement.filename?.replace(/\.pdf$/i, "") ?? "Terms of Business"}-signed.pdf`} variant="chip" />
        ) : null}
        {agreement.hasDocument ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => previewDocument(`/api/cases/${agreement.caseId}/terms-of-business/document`, agreement.filename ?? "Terms of Business", `/api/cases/${agreement.caseId}/terms-of-business/document`)}>
            <Eye /> Document as sent
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Out for signature

function SentView({
  state,
  agreement,
  caseId,
  clientId,
  disabled,
  onChanged,
}: {
  state: CaseTermsState;
  agreement: TermsAgreement;
  caseId: number;
  clientId: number;
  disabled?: boolean;
  onChanged: () => void;
}) {
  const refresh = useRefreshCaseTermsOfBusiness();
  const voidReq = useVoidCaseTermsOfBusiness();
  const mock = useMockSignCaseTermsOfBusiness();
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [markOpen, setMarkOpen] = useState(false);
  const fail = (title: string) => (error: unknown) => toast.add({ title, description: apiErrorMessage(error, "Please try again"), type: "error" });
  const docHref = `/api/cases/${caseId}/terms-of-business/document`;
  const bounced = agreement.envelopeStatus === "delivery_failed";
  const envelope = agreement.envelopeStatus && agreement.envelopeStatus !== "sent" && !bounced ? ` · DocuSign: ${agreement.envelopeStatus}` : "";
  return (
    <div className="space-y-3">
      <StatusLine icon={bounced ? <AlertCircle className="size-4" /> : <Mail className="size-4" />} tone={bounced ? "bad" : "warn"}>
        <p className="font-medium">
          {bounced ? `The email to ${agreement.recipientEmail} bounced` : "Awaiting the client's signature"}{agreement.provider === "docusign_mock" ? " (mock DocuSign)" : ""}
        </p>
        <p className="text-xs opacity-80">
          {bounced
            ? "DocuSign could not deliver the signature request. Check the client's email address, void this request and send it again."
            : `Sent to ${agreement.recipientEmail} on ${formatDate(agreement.sentAt ?? agreement.updatedAt)}${agreement.sentBy ? ` by ${agreement.sentBy}` : ""} · v${agreement.templateVersion}${envelope}${agreement.lastCheckedAt ? ` · checked ${formatDate(agreement.lastCheckedAt)}` : ""}`}
        </p>
      </StatusLine>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={() => previewDocument(docHref, agreement.filename ?? "Terms of Business", docHref)}>
          <Eye /> View document
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate({ id: caseId }, { onSuccess: (next) => { onChanged(); if (next.agreement?.status === "signed") toast.add({ title: "Signed — the copy is filed in the case", type: "success" }); }, onError: fail("Couldn't check DocuSign") })}>
          <RefreshCw className={refresh.isPending ? "animate-spin" : undefined} /> Check status
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setVoidOpen(true)}>
          <Ban /> Void
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setMarkOpen(true)}>
          <PenLine /> Signed another way
        </Button>
        {state.signature.mode === "mock" ? (
          <>
            <Button type="button" variant="outline" size="sm" disabled={mock.isPending} onClick={() => mock.mutate({ id: caseId, data: { outcome: "signed" } }, { onSuccess: () => { onChanged(); toast.add({ title: "Mock signature applied", type: "success" }); }, onError: fail("Mock failed") })}>
              Simulate signature
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={mock.isPending} onClick={() => mock.mutate({ id: caseId, data: { outcome: "declined", reason: "Fee too high" } }, { onSuccess: onChanged, onError: fail("Mock failed") })}>
              Simulate decline
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={mock.isPending} onClick={() => mock.mutate({ id: caseId, data: { outcome: "bounced" } }, { onSuccess: onChanged, onError: fail("Mock failed") })}>
              Simulate bounce
            </Button>
          </>
        ) : null}
      </div>
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void the signature request?</DialogTitle>
            <DialogDescription>The client's DocuSign link stops working. You can change the details and send the document again.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>Reason (shown to the client)</FieldLabel>
            <Input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} maxLength={200} placeholder="e.g. Fee changed — a new version follows" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={voidReq.isPending}
              onClick={() => voidReq.mutate({ id: caseId, data: { reason: voidReason.trim() || "Withdrawn by the firm" } }, { onSuccess: () => { setVoidOpen(false); setVoidReason(""); onChanged(); }, onError: fail("Couldn't void the request") })}
            >
              {voidReq.isPending ? "Voiding…" : "Void"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <MarkSignedDialog open={markOpen} onOpenChange={setMarkOpen} caseId={caseId} clientId={clientId} onSigned={onChanged} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft: the form

function DraftForm({
  state,
  caseId,
  clientId,
  disabled,
  compact,
  onChanged,
}: {
  state: CaseTermsState;
  caseId: number;
  clientId: number;
  disabled?: boolean;
  compact?: boolean;
  onChanged: () => void;
}) {
  const save = useSaveCaseTermsOfBusiness();
  const send = useSendCaseTermsOfBusiness();
  const [values, setValues] = useState<Record<string, string>>(state.values);
  const saved = useRef(JSON.stringify(state.values));
  const [previewing, setPreviewing] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  const fields = state.template?.fields ?? [];
  const previous = state.agreement; // declined / voided / draft

  // Adopt values the server settled on (a new template version, another user's draft).
  useEffect(() => {
    const incoming = JSON.stringify(state.values);
    if (incoming !== saved.current) {
      saved.current = incoming;
      setValues(state.values);
    }
  }, [state.values]);

  const persist = (next: Record<string, string>) => {
    const serialised = JSON.stringify(next);
    if (serialised === saved.current) return;
    saved.current = serialised;
    save.mutate({ id: caseId, data: { values: next } }, {
      onError: (error) => toast.add({ title: "Couldn't save", description: apiErrorMessage(error, "Please try again"), type: "error" }),
    });
  };
  const setValue = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const missing = fields.filter((field) => field.required && !values[field.key]?.trim()).map((field) => field.label);
  const canSend = state.signature.configured && missing.length === 0 && !disabled;
  const sendBlocked = !state.signature.configured
    ? state.signature.mode === "off" ? "DocuSign is not connected (Settings → Terms of Business)" : `DocuSign is missing ${state.signature.missing.join(", ")}`
    : missing.length ? `Fill in ${missing.join(", ")}` : null;

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      await openPdfPreview(`/api/cases/${caseId}/terms-of-business/preview`, { values }, `${state.template?.title ?? "Terms of Business"} (preview)`);
    } catch (error) {
      toast.add({ title: "Couldn't render the preview", description: error instanceof Error ? error.message : undefined, type: "error" });
    } finally {
      setPreviewing(false);
    }
  };
  const handleSend = () =>
    send.mutate({ id: caseId, data: { values } }, {
      onSuccess: () => {
        onChanged();
        toast.add({ title: `Sent to ${state.recipient.email} for signature`, type: "success" });
      },
      onError: (error) => toast.add({ title: "Couldn't send", description: apiErrorMessage(error, "Please try again"), type: "error" }),
    });

  return (
    <div className="space-y-4">
      {previous && previous.status !== "draft" ? (
        <StatusLine icon={<AlertCircle className="size-4" />} tone={previous.status === "declined" ? "bad" : "muted"}>
          <p className="font-medium">
            {previous.status === "declined" ? "The client declined to sign" : "The last request was voided"} · {formatDate(previous.declinedAt ?? previous.voidedAt ?? previous.updatedAt)}
          </p>
          {(previous.declineReason ?? previous.voidReason) ? <p className="text-xs opacity-80">{previous.declineReason ?? previous.voidReason}{previous.voidedBy ? ` — ${previous.voidedBy}` : ""}</p> : null}
          <p className="text-xs opacity-80">Adjust the details below and send a new document.</p>
        </StatusLine>
      ) : null}

      <div className={cn("grid gap-x-4 gap-y-1 text-sm", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
        {SHOWN_AUTO.map((item) => (
          <div key={item.key} className="flex min-w-0 justify-between gap-3 border-b border-dashed py-1">
            <span className="shrink-0 text-muted-foreground">{item.label}</span>
            <span className={cn("min-w-0 truncate text-right", !state.auto[item.key] && "text-destructive")}>{state.auto[item.key] || "Missing on the case"}</span>
          </div>
        ))}
      </div>

      {fields.length ? (
        <div className={cn("grid gap-3", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
          {fields.map((field) => (
            <TermsFieldInput
              key={field.key}
              field={field}
              value={values[field.key] ?? ""}
              disabled={disabled}
              onChange={(value) => setValue(field.key, value)}
              onCommit={() => persist(values)}
              className={field.type === "textarea" && !compact ? "sm:col-span-2" : undefined}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">The template has no fields to fill — the document comes entirely from the case.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handlePreview} disabled={previewing}>
          <Eye /> {previewing ? "Rendering…" : "Preview PDF"}
        </Button>
        <Button type="button" size="sm" onClick={handleSend} disabled={!canSend || send.isPending} title={sendBlocked ?? undefined}>
          <FileSignature /> {send.isPending ? "Sending…" : `Send for signature`}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setMarkOpen(true)}>
          <PenLine /> Signed another way
        </Button>
        {sendBlocked ? <span className="text-xs text-muted-foreground">{sendBlocked}</span> : <span className="text-xs text-muted-foreground">Goes to {state.recipient.email} via DocuSign{state.signature.mode === "mock" ? " (mock)" : ""}.</span>}
      </div>
      {state.history.length ? (
        <p className="text-xs text-muted-foreground">
          {state.history.length} earlier attempt{state.history.length === 1 ? "" : "s"}: {state.history.map((item) => `${item.status} ${formatDate(item.updatedAt)}`).join(", ")}
        </p>
      ) : null}
      <MarkSignedDialog open={markOpen} onOpenChange={setMarkOpen} caseId={caseId} clientId={clientId} onSigned={onChanged} />
    </div>
  );
}

function TermsFieldInput({
  field,
  value,
  disabled,
  onChange,
  onCommit,
  className,
}: {
  field: TermsTemplateField;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
  className?: string;
}) {
  const label = (
    <FieldLabel>
      {field.label}
      {field.required ? <span className="ml-1 text-destructive" aria-hidden>•</span> : null}
    </FieldLabel>
  );
  if (field.type === "select") {
    return (
      <Field className={className}>
        {label}
        <Select value={value} onValueChange={(next) => { if (next != null) { onChange(next); queueMicrotask(onCommit); } }} disabled={disabled}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
      </Field>
    );
  }
  if (field.type === "textarea") {
    return (
      <Field className={className}>
        {label}
        <Textarea value={value} onChange={(event) => onChange(event.target.value)} onBlur={onCommit} disabled={disabled} className="min-h-[88px]" />
        {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
      </Field>
    );
  }
  return (
    <Field className={className}>
      {label}
      <Input
        value={value}
        type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
        inputMode={field.type === "currency" || field.type === "number" ? "decimal" : undefined}
        placeholder={field.type === "currency" ? "£" : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        disabled={disabled}
      />
      {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Fallback: signed outside DocuSign

type Via = "signed_upload" | "staff";

/**
 * The client signed on paper or agreed in person: upload the signed copy (filed
 * in the case under Terms of Business) and record it. Any DocuSign request
 * still out is voided.
 */
export function MarkSignedDialog({
  open,
  onOpenChange,
  caseId,
  clientId,
  onSigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: number;
  clientId: number;
  onSigned: () => void;
}) {
  const mark = useMarkCaseTermsOfBusinessSigned();
  const upload = useUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [via, setVia] = useState<Via>("signed_upload");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      let documentId: number | null = null;
      if (via === "signed_upload" && file) {
        const uploaded = await upload.send<{ id: number }>(file, {
          url: "/api/documents/upload",
          method: "POST",
          headers: documentUploadHeaders(file, { "x-client-id": clientId, "x-case-id": caseId, "x-document-category": "terms_business" }),
        });
        documentId = uploaded.id;
      }
      await mark.mutateAsync({ id: caseId, data: { via, note: note.trim() || undefined, documentId } });
      onSigned();
      onOpenChange(false);
      setNote("");
      setFile(null);
      toast.add({ title: "Terms of Business recorded as signed", type: "success" });
    } catch (error) {
      toast.add({ title: "Couldn't record the signature", description: apiErrorMessage(error, "Please try again"), type: "error" });
    } finally {
      upload.reset();
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a signature given outside DocuSign</DialogTitle>
          <DialogDescription>For a copy the client signed on paper, or an agreement made in person. Use DocuSign whenever you can — this bypasses the electronic record.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ToggleGroup type="single" variant="outline" value={via} onValueChange={(value) => value && setVia(value as Via)} className="w-full">
            <ToggleGroupItem value="signed_upload" className="flex-1">Signed copy</ToggleGroupItem>
            <ToggleGroupItem value="staff" className="flex-1">Agreed in person</ToggleGroupItem>
          </ToggleGroup>
          {via === "signed_upload" ? (
            <Field>
              <FieldLabel>The signed copy (PDF or image)</FieldLabel>
              <input ref={inputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                  <Upload /> {file ? "Change file" : "Choose file"}
                </Button>
                <span className="min-w-0 truncate text-sm text-muted-foreground">{file?.name ?? "Filed in the case under Terms of Business"}</span>
              </div>
              <UploadProgress progress={upload.progress} />
            </Field>
          ) : null}
          <Field>
            <FieldLabel>Note</FieldLabel>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={via === "staff" ? "e.g. Agreed at the meeting on 12 Sep" : "Optional"} maxLength={500} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (via === "signed_upload" && !file)}>
            {busy ? "Saving…" : "Record as signed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
