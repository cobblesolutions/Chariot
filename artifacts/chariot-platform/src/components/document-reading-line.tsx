import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import {
  useReadDocument,
  type BankStatementsReading,
  type CreditReportReading,
  type DocumentReading,
  type IdentityReading,
  type PortfolioReading,
  type ProofOfIncomeReading,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/utils";

const FIELD_LABELS: Record<string, string> = {
  title: "title", dateOfBirth: "date of birth", nationality: "nationality",
  currentAddress: "current address", currentAddressCity: "current address", currentAddressPostcode: "current address",
  previousAddress: "previous address", previousAddressCity: "previous address", previousAddressPostcode: "previous address",
  employmentStatus: "employment status", employerName: "employer", jobTitle: "job title",
  annualIncome: "annual income", monthlyCommitments: "monthly commitments", creditHistoryNotes: "credit history",
};

/** One line of what a reader found, per reader type. */
export function summariseReading(reading: DocumentReading): string[] {
  const data = reading.data as Record<string, unknown> | null;
  if (!data) return [];
  switch (reading.reader) {
    case "identity": {
      const d = data as IdentityReading;
      return [
        d.documentType?.replace("_", " ") ?? null,
        d.fullName,
        d.dateOfBirth ? `born ${d.dateOfBirth}` : null,
        d.nationality,
        d.expiryDate ? `expires ${d.expiryDate}` : null,
        d.postcode ? `address ${d.postcode}` : null,
      ].filter((part): part is string => !!part);
    }
    case "bank_statements": {
      const d = data as BankStatementsReading;
      return [
        d.bankName,
        d.monthlyNetSalary != null ? `net salary ${formatMoney(d.monthlyNetSalary)}/mo` : null,
        d.employerName ? `paid by ${d.employerName}` : null,
        d.monthlyCommitments != null ? `commitments ${formatMoney(d.monthlyCommitments)}/mo` : null,
        d.mortgagePayments?.length ? `${d.mortgagePayments.length} mortgage DD${d.mortgagePayments.length === 1 ? "" : "s"}` : null,
        d.monthlyRentReceived != null ? `rent in ${formatMoney(d.monthlyRentReceived)}/mo` : null,
        d.gambling ? "gambling" : null,
        d.returnedPayments ? `${d.returnedPayments} returned` : null,
        d.overdrawn ? "overdrawn" : null,
      ].filter((part): part is string => !!part);
    }
    case "proof_of_income": {
      const d = data as ProofOfIncomeReading;
      return [
        d.annualGrossIncome != null ? `${formatMoney(d.annualGrossIncome)}/yr` : null,
        d.documentType?.replace("_", " ") ?? null,
        d.employerName,
        d.jobTitle,
      ].filter((part): part is string => !!part);
    }
    case "credit_report": {
      const d = data as CreditReportReading;
      return [
        d.provider,
        d.score != null ? `score ${d.score}${d.scoreMax ? `/${d.scoreMax}` : ""}` : null,
        d.defaults != null || d.ccjs != null ? `${d.defaults ?? 0} defaults · ${d.ccjs ?? 0} CCJs` : null,
        d.missedPayments ? `${d.missedPayments} missed` : null,
        d.totalUnsecuredDebt != null ? `unsecured ${formatMoney(d.totalUnsecuredDebt)}` : null,
      ].filter((part): part is string => !!part);
    }
    case "portfolio": {
      const d = data as PortfolioReading;
      const created = d.createdPropertyIds?.length ?? 0;
      return [
        `${d.properties?.length ?? 0} propert${d.properties?.length === 1 ? "y" : "ies"} read`,
        created ? `${created} added` : null,
        d.skipped ? `${d.skipped} already on record` : null,
        d.totalValue != null ? `value ${formatMoney(d.totalValue)}` : null,
        d.totalBorrowing != null ? `borrowing ${formatMoney(d.totalBorrowing)}` : null,
        d.totalMonthlyRent != null ? `rent ${formatMoney(d.totalMonthlyRent)}/mo` : null,
      ].filter((part): part is string => !!part);
    }
    default:
      return [];
  }
}

export function appliedFieldLabels(reading: DocumentReading): string[] {
  return [...new Set(reading.appliedFields.filter((field) => !field.startsWith("property:")).map((field) => FIELD_LABELS[field] ?? field))];
}

/**
 * What the document reading system made of one file, shown under it: a
 * spinner while it reads, a one-line summary with what it filled in, or the
 * reason it could not read the file — with a re-read button for staff.
 */
export function DocumentReadingLine({
  documentId,
  reading,
  onRefresh,
}: {
  documentId: number;
  reading: DocumentReading | null | undefined;
  onRefresh: () => void;
}) {
  const readDocument = useReadDocument();
  const readAgain = () =>
    readDocument.mutate(
      { id: documentId },
      {
        onSuccess: onRefresh,
        onError: () => toast.add({ title: "Couldn't read document", type: "error" }),
      },
    );
  if (!reading || reading.status === "pending" || readDocument.isPending) {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3" /> Reading…
      </p>
    );
  }
  if (reading.status !== "completed") {
    return (
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="size-3 text-amber-600" />
        <span>{reading.error ?? "Couldn't read this file"}</span>
        <Button type="button" variant="ghost" size="xs" onClick={readAgain}>
          <RefreshCw /> Read again
        </Button>
      </p>
    );
  }
  const summary = summariseReading(reading);
  const applied = appliedFieldLabels(reading);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <Sparkles className="size-3 text-emerald-600" />
      <span>{summary.length > 0 ? summary.join(" · ") : "Nothing usable found"}</span>
      {applied.length > 0 ? <span className="text-emerald-700 dark:text-emerald-400">· filled {applied.join(", ")}</span> : null}
      <Button type="button" variant="ghost" size="xs" onClick={readAgain} aria-label="Read again">
        <RefreshCw />
      </Button>
    </p>
  );
}
