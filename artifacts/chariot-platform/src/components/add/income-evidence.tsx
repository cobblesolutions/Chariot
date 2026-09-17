import { Check, FileText, RefreshCw, Sparkles, Upload } from "lucide-react";
import {
  useReadDocument,
  type ClientDetail,
  type ProofOfIncomeReading,
} from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AiProgressLine } from "@/components/ai-progress-button";
import { toast } from "@/components/ui/toast";
import { previewDocument } from "@/components/document-preview";
import { formatMoney } from "@/lib/utils";
import { EMPLOYMENT_STATUSES } from "./utils";
import { apiErrorMessage } from "./utils";

/** The employment fields the proof-of-income reading can fill. */
export interface IncomeValues {
  annualIncome: string;
  employerName: string;
  jobTitle: string;
  employmentStatus: string;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  payslip: "payslip",
  p60: "P60",
  sa302: "SA302",
  tax_year_overview: "tax year overview",
  accounts: "accounts",
  employment_contract: "employment contract",
  bank_statement: "bank statement",
  other: "document",
};
const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "weekly",
  fortnightly: "fortnightly",
  four_weekly: "four-weekly",
  monthly: "monthly",
  annual: "annual",
};

/** Latest proof-of-income upload for the client, or null. */
export function latestProofOfIncome(client: ClientDetail) {
  return (
    client.documents
      .filter((document) => document.category === "proof_income")
      .sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""))[0] ?? null
  );
}

/** What the reading would put in the form, as input strings. */
export function valuesFromReading(data: ProofOfIncomeReading): Partial<IncomeValues> {
  const values: Partial<IncomeValues> = {};
  if (data.annualGrossIncome != null) values.annualIncome = String(data.annualGrossIncome);
  if (data.employerName) values.employerName = data.employerName;
  if (data.jobTitle) values.jobTitle = data.jobTitle;
  if (data.employmentStatus) values.employmentStatus = data.employmentStatus;
  return values;
}

/**
 * Shows what the document reading system read from the client's proof of
 * income and lets staff put those values into the employment fields. The
 * server already fills empty fields on upload; this covers re-reads and
 * overwriting what was typed.
 */
export function IncomeEvidence({
  client,
  draft,
  onApply,
  onUpload,
  onRefresh,
}: {
  client: ClientDetail;
  draft: IncomeValues;
  onApply: (values: Partial<IncomeValues>) => void;
  onUpload: () => void;
  onRefresh: () => void;
}) {
  const document = latestProofOfIncome(client);
  const reading = document?.reading ?? null;
  const readDocument = useReadDocument();
  // Reading is on demand: nothing is sent to the model until staff click Read.
  const waiting = !!document && reading?.status === "pending";

  if (!document) {
    return (
      <Alert>
        <FileText />
        <AlertTitle>No proof of income yet</AlertTitle>
        <AlertDescription>
          <p>Annual income is read from the payslip, P60 or SA302 once one is uploaded.</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onUpload}>
            <Upload />
            Upload proof of income
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const readAgain = () =>
    readDocument.mutate(
      { id: document.id },
      {
        onSuccess: onRefresh,
        onError: (error) =>
          toast.add({ title: "Couldn't read document", description: apiErrorMessage(error, "Reading failed"), type: "error" }),
      },
    );
  const reading_ = readDocument.isPending;
  const viewDocument = () =>
    previewDocument(`/api/documents/${document.id}/view`, document.name, `/api/documents/${document.id}/download`);
  const nameButton = (
    <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={viewDocument}>
      {document.name}
    </button>
  );

  if (waiting || reading_) {
    return (
      <Alert>
        <Spinner />
        <AlertTitle>Reading {nameButton}</AlertTitle>
        <AlertDescription>
          <AiProgressLine active kind="proof_income" serverMessage={reading?.progress ?? null} />
        </AlertDescription>
      </Alert>
    );
  }

  if (!reading) {
    return (
      <Alert>
        <FileText />
        <AlertTitle>{nameButton} has not been read yet</AlertTitle>
        <AlertDescription>
          <p>Read it to fill in income, employer and job title from the document.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={readAgain}>
              <Sparkles />
              Read with AI
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onUpload}>
              <Upload />
              Upload another
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  const data = (reading.data ?? null) as ProofOfIncomeReading | null;
  if (reading.status !== "completed" || !data) {
    return (
      <Alert variant="destructive">
        <FileText />
        <AlertTitle>Couldn't read {nameButton}</AlertTitle>
        <AlertDescription>
          <p>{reading?.error ?? "The document reader did not return a result."}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={readAgain}>
              <RefreshCw />
              Read again
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onUpload}>
              <Upload />
              Upload another
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const values = valuesFromReading(data);
  const keys = Object.keys(values) as Array<keyof IncomeValues>;
  const applied = keys.length > 0 && keys.every((key) => draft[key] === values[key]);
  const summary = [
    data.annualGrossIncome != null ? `${formatMoney(data.annualGrossIncome)}/yr` : null,
    data.documentType
      ? `${data.payFrequency && data.payFrequency !== "annual" ? `${FREQUENCY_LABELS[data.payFrequency]} ` : ""}${DOCUMENT_TYPE_LABELS[data.documentType]}`
      : null,
    data.periodEnd,
  ].filter(Boolean).join(" · ");
  const employment = [
    data.employerName,
    data.jobTitle,
    data.employmentStatus ? EMPLOYMENT_STATUSES.find((s) => s.value === data.employmentStatus)?.label : null,
  ].filter(Boolean).join(" · ");

  return (
    <Alert>
      <FileText />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        <span>Read from {nameButton}</span>
        <Badge variant="outline">{reading.source === "ai" ? "AI" : "text patterns"}</Badge>
        {data.confidence ? <Badge variant="secondary">{data.confidence} confidence</Badge> : null}
      </AlertTitle>
      <AlertDescription>
        {data.annualGrossIncome == null ? (
          <p>No income figure was found in this document.</p>
        ) : (
          <p className="text-foreground">{summary}</p>
        )}
        {employment ? <p>{employment}</p> : null}
        {data.notes ? <p className="text-xs">{data.notes}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {keys.length > 0 ? (
            <Button type="button" variant={applied ? "ghost" : "default"} size="sm" disabled={applied} onClick={() => onApply(values)}>
              {applied ? <Check /> : null}
              {applied ? "Applied" : "Use these values"}
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={readAgain}>
            <RefreshCw />
            Read again
          </Button>
          {data.annualGrossIncome == null ? (
            <Button type="button" variant="outline" size="sm" onClick={onUpload}>
              <Upload />
              Upload another
            </Button>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}
