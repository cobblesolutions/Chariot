import { useEffect, useRef, useState } from "react";
import {
  getGetCaseQueryKey,
  getGetCaseLenderOfferReviewQueryKey,
  getListInvoicesQueryKey,
  useGetCaseLenderOfferReview,
  useGetSubmissionLenderOfferReview,
  getGetSubmissionLenderOfferReviewQueryKey,
  useNotifyLenderOffer,
  useReviewCaseLenderOffer,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { useAuth } from "@/components/auth-provider";
import { isFullAccess } from "@/lib/roles";
import { formatDate } from "@/lib/utils";
import { apiErrorMessage } from "@/components/add/utils";
import { useQueryClient } from "@tanstack/react-query";
import { DocumentFile } from "@/components/document-file";
import {
  Building2,
  CheckCircle2,
  FileCheck2,
  FileText,
  Mail,
  Receipt,
  Send,
  Upload,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { UploadProgress } from "@/components/upload-progress";
import { documentUploadHeaders, useUpload } from "@/lib/upload";

function formatMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

function MatchStatus({
  matched,
  reviewed,
}: {
  matched: boolean;
  reviewed: boolean;
}) {
  if (!reviewed) {
    return null;
  }
  return matched ? (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-500">
      <CheckCircle2 className="h-3.5 w-3.5" /> Matches
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
      <XCircle className="h-3.5 w-3.5" /> Does not match
    </span>
  );
}

export function LenderOfferPanel({
  caseId,
  submissionId = null,
  clientId,
  offerSent,
  onToggleOfferSent,
  disabled = false,
}: {
  caseId: number;
  /** The lender submission the offer is from; the primary open one when null. */
  submissionId?: number | null;
  clientId: number;
  offerSent: boolean;
  onToggleOfferSent: () => void;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastDocumentId = useRef<number | null>(null);
  const offerUpload = useUpload();
  const [isUploading, setIsUploading] = useState(false);
  const [offerAddress, setOfferAddress] = useState("");
  const [offerClientName, setOfferClientName] = useState("");
  const [offerPropertyValue, setOfferPropertyValue] = useState("");
  const [offerLoanAmount, setOfferLoanAmount] = useState("");
  // The case-level route follows the primary lender; a specific lender has its own route.
  const caseLevel = useGetCaseLenderOfferReview(caseId, {
    query: { enabled: !!caseId && submissionId == null, queryKey: getGetCaseLenderOfferReviewQueryKey(caseId) },
  });
  const perLender = useGetSubmissionLenderOfferReview(caseId, submissionId ?? 0, {
    query: { enabled: !!caseId && submissionId != null, queryKey: getGetSubmissionLenderOfferReviewQueryKey(caseId, submissionId ?? 0) },
  });
  const review = submissionId != null ? perLender.data : caseLevel.data;
  const isLoading = submissionId != null ? perLender.isLoading : caseLevel.isLoading;
  const invalidateReview = async () => {
    await qc.invalidateQueries({ queryKey: getGetCaseLenderOfferReviewQueryKey(caseId) });
    if (submissionId != null) await qc.invalidateQueries({ queryKey: getGetSubmissionLenderOfferReviewQueryKey(caseId, submissionId) });
  };
  const reviewOffer = useReviewCaseLenderOffer();
  const notify = useNotifyLenderOffer();
  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);
  const handleNotify = () =>
    notify.mutate({ id: caseId, data: { submissionId: submissionId ?? null } }, {
      onSuccess: (result) => {
        void invalidateReview();
        qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
        qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        const client = result.clientEmailStatus === "sent" ? "client emailed" : `client email ${result.clientEmailStatus}`;
        const lender = result.lenderEmailStatus === "sent" ? "lender told" : result.lenderEmailStatus === "no_contact" ? "no lender contact on file" : `lender email ${result.lenderEmailStatus}`;
        toast.add({ title: `Offer sent — ${client}, ${lender}`, description: result.invoice ? `Invoice ${result.invoice.invoiceNumber} issued.` : undefined, type: result.clientEmailStatus === "failed" ? "error" : "success" });
      },
      onError: (error) => toast.add({ title: "Couldn't send the offer", description: apiErrorMessage(error, "Please try again."), type: "error" }),
    });

  useEffect(() => {
    const documentId = review?.document?.id ?? null;
    if (documentId === lastDocumentId.current) return;
    lastDocumentId.current = documentId;
    setOfferAddress(review?.offerAddress ?? "");
    setOfferClientName(review?.offerClientName ?? "");
    setOfferPropertyValue(
      review?.offerPropertyValue != null
        ? String(review.offerPropertyValue)
        : "",
    );
    setOfferLoanAmount(review?.offerLoanAmount != null ? String(review.offerLoanAmount) : "");
  }, [
    review?.document?.id,
    review?.offerAddress,
    review?.offerClientName,
    review?.offerPropertyValue,
    review?.offerLoanAmount,
  ]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.add({
        title: "File too large",
        description: "Maximum file size is 50MB.",
        type: "error",
      });
      return;
    }
    setIsUploading(true);
    try {
      const uploaded = await offerUpload.send<{ id?: number } | null>(file, {
        url: "/api/documents/upload",
        headers: documentUploadHeaders(file, {
          "x-document-category": "LENDER_OFFER",
          "x-client-id": clientId,
          "x-case-id": caseId,
          ...(submissionId != null ? { "x-submission-id": submissionId } : {}),
        }),
      });
      // The file is on the server; the rest is reading it, so drop the bar.
      offerUpload.reset();
      await qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
      await invalidateReview();
      if (!uploaded?.id)
        throw new Error("Upload response did not include a document id");

      const extractionResponse = await fetch(
        `/api/cases/${caseId}/lender-offer/extract`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: uploaded.id }),
        },
      );
      const extraction = await extractionResponse.json().catch(() => null);
      if (!extractionResponse.ok) {
        toast.add({
          title: "Lender offer uploaded",
          description:
            extraction?.error ??
            "Automatic reading is not available yet. You can enter the values manually.",
          type: extractionResponse.status === 503 ? undefined : "error",
        });
      } else {
        setOfferAddress(extraction.offerAddress ?? "");
        setOfferClientName(extraction.offerClientName ?? "");
        setOfferPropertyValue(
          extraction.offerPropertyValue != null
            ? String(extraction.offerPropertyValue)
            : "",
        );
        setOfferLoanAmount(extraction.offerLoanAmount != null ? String(extraction.offerLoanAmount) : "");
        toast.add({
          title: "Lender offer read successfully",
          description:
            "Review the extracted values before running the comparison.",
          type: "success",
        });
      }
    } catch (error) {
      toast.add({
        title: "Failed to upload lender offer",
        description: error instanceof Error ? error.message : "Upload failed",
        type: "error",
      });
    } finally {
      offerUpload.reset();
      setIsUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleReview = () => {
    if (
      !review?.document ||
      !offerAddress.trim() ||
      !offerClientName.trim() ||
      !offerPropertyValue ||
      reviewOffer.isPending
    )
      return;
    reviewOffer.mutate(
      {
        id: caseId,
        data: {
          submissionId,
          documentId: review.document.id,
          offerAddress: offerAddress.trim(),
          offerClientName: offerClientName.trim(),
          offerPropertyValue: Number(
            offerPropertyValue.replace(/[^0-9.]/g, ""),
          ),
          offerLoanAmount: offerLoanAmount ? Number(offerLoanAmount.replace(/[^0-9.]/g, "")) : null,
        },
      },
      {
        onSuccess: async (result) => {
          await invalidateReview();
          await qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
          toast.add({
            title: result.allMatched
              ? "Offer details match the case"
              : "Offer review found mismatches",
            type: result.allMatched ? undefined : "error",
          });
        },
        onError: (error: any) => {
          toast.add({
            title: "Failed to review lender offer",
            description: error?.response?.data?.error ?? error?.message,
            type: "error",
          });
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="p-5">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const reviewed = review?.reviewedAt != null;

  return (
    <ScrollArea className="p-5 space-y-5 *:data-[slot=scroll-area-viewport]:max-h-[560px]">
      <div className="rounded-lg border bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">
              Lender offer document
            </p>
          </div>
          <FileCheck2 className="h-5 w-5 text-primary shrink-0" />
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          {review?.document ? (
            <DocumentFile
              id={review.document.id}
              name={review.document.name}
              variant="chip"
              className="min-w-0 flex-1"
              onDeleted={
                disabled
                  ? undefined
                  : () => {
                      void qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
                      void qc.invalidateQueries({ queryKey: getGetCaseLenderOfferReviewQueryKey(caseId) });
                    }
              }
            />
          ) : (
            <span className="text-sm text-muted-foreground">
              No lender offer uploaded
            </span>
          )}
          {!disabled && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={isUploading}
            >
              <Upload />
              {isUploading
                ? "Uploading..."
                : review?.document
                  ? "Replace"
                  : "Upload offer"}
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={handleUpload}
        />
        <UploadProgress progress={offerUpload.progress} />
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Check offer details
          </p>
        </div>

        <Field>
          <FieldLabel>Property address on offer</FieldLabel>
          <Input
            value={offerAddress}
            onChange={(event) => setOfferAddress(event.target.value)}
            disabled={disabled || !review?.document}
          />
          <FieldDescription>
            Case: {review?.expectedAddress ?? "—"}
          </FieldDescription>
          <MatchStatus
            matched={review?.addressMatches ?? false}
            reviewed={reviewed}
          />
        </Field>

        <Field>
          <FieldLabel>Client name on offer</FieldLabel>
          <Input
            value={offerClientName}
            onChange={(event) => setOfferClientName(event.target.value)}
            disabled={disabled || !review?.document}
          />
          <FieldDescription>
            Case: {review?.expectedClientName ?? "—"}
          </FieldDescription>
          <MatchStatus
            matched={review?.nameMatches ?? false}
            reviewed={reviewed}
          />
        </Field>

        <Field>
          <FieldLabel>Property value on offer</FieldLabel>
          <Input
            value={offerPropertyValue}
            onChange={(event) =>
              setOfferPropertyValue(event.target.value.replace(/[^0-9.]/g, ""))
            }
            inputMode="decimal"
            placeholder="e.g. 350000"
            disabled={disabled || !review?.document}
          />
          <FieldDescription>
            Case: {formatMoney(review?.expectedPropertyValue)}
          </FieldDescription>
          <MatchStatus
            matched={review?.valueMatches ?? false}
            reviewed={reviewed}
          />
        </Field>

        <Field>
          <FieldLabel>Loan amount on offer</FieldLabel>
          <Input
            value={offerLoanAmount}
            onChange={(event) =>
              setOfferLoanAmount(event.target.value.replace(/[^0-9.]/g, ""))
            }
            inputMode="decimal"
            placeholder="optional, e.g. 300000"
            disabled={disabled || !review?.document}
          />
          <FieldDescription>
            Case: {formatMoney(review?.expectedLoanAmount)}
            {offerLoanAmount && Number(offerLoanAmount) > 0 && review?.expectedLoanAmount != null && Math.abs(Number(offerLoanAmount) - review.expectedLoanAmount) >= 1
              ? " — differs; the fee is worked out on the offer's loan"
              : " — the fee percentage is taken from this when given"}
          </FieldDescription>
        </Field>

        <Button
          className="w-full"
          onClick={handleReview}
          disabled={
            disabled ||
            !review?.document ||
            !offerAddress.trim() ||
            !offerClientName.trim() ||
            !offerPropertyValue ||
            reviewOffer.isPending
          }
        >
          {reviewOffer.isPending ? "Reviewing..." : "Review offer against case"}
        </Button>
      </div>

      <div
        className={`rounded-lg border p-4 ${review?.allMatched ? "border-emerald-500/30 bg-emerald-500/5" : "bg-muted/20"}`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-foreground">
            Offer details checked
          </span>
          {review?.allMatched ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-500">
              <CheckCircle2 className="h-4 w-4" /> Matches
            </span>
          ) : (
            <span className="text-xs font-medium text-muted-foreground">
              Awaiting three matches
            </span>
          )}
        </div>
      </div>

      {/* Scope step 12: the offer moment — one action, everything on the spot. */}
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">Send the offer</span>
          {review?.notifiedAt ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-500">
              <CheckCircle2 className="h-4 w-4" /> Sent {formatDate(review.notifiedAt)}{review.notifiedBy ? ` · ${review.notifiedBy}` : ""}
            </span>
          ) : null}
        </div>
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium">Client</span> — the offer{review?.document ? ` (${review.document.name})` : ""} attached, with the invoice.
              {review?.notifiedAt ? <span className="text-muted-foreground"> · {review.clientEmailStatus === "sent" ? "emailed" : `email ${review.clientEmailStatus}`}</span> : null}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium">Invoice</span> —{" "}
              {review?.invoice ? (
                <Link href={`/invoices/${review.invoice.id}`} className="underline-offset-2 hover:underline">
                  {review.invoice.invoiceNumber} · £{review.invoice.total.toLocaleString("en-GB")} · {review.invoice.status}
                </Link>
              ) : review?.feeSummary ? (
                <>{review.feeSummary} — issued when you send</>
              ) : (
                <span className="text-destructive">no fee agreed on the case — set "Our fee" on the deal first</span>
              )}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium">Lender</span> —{" "}
              {review?.lenderContacts.length
                ? review.lenderContacts.map((c) => c.name).join(", ")
                : <span className="text-muted-foreground">no contact with an email on the lender (add one under Lenders)</span>}
              {review?.notifiedAt && review.lenderEmailStatus ? <span className="text-muted-foreground"> · {review.lenderEmailStatus === "sent" ? "told" : review.lenderEmailStatus.replace("_", " ")}</span> : null}
            </span>
          </li>
        </ul>
        {!disabled ? (
          isAdmin ? (
            <Button
              size="sm"
              className="w-full"
              onClick={handleNotify}
              disabled={!review?.allMatched || (!review?.invoice && !review?.feeSummary) || notify.isPending}
              title={!review?.allMatched ? "Check the offer against the case first" : undefined}
            >
              <Send /> {notify.isPending ? "Sending…" : review?.notifiedAt ? "Send again" : "Send offer to client & lender"}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">An administrator sends the offer — it issues the invoice.</p>
          )
        ) : null}
        <label className={`flex items-center gap-2 text-xs text-muted-foreground ${!disabled ? "cursor-pointer" : ""}`}>
          <Checkbox checked={offerSent} onCheckedChange={() => onToggleOfferSent()} disabled={disabled} />
          Sent another way — tick "Offer sent to client" by hand
        </label>
      </div>
    </ScrollArea>
  );
}
