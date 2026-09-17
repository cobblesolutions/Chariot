import { Star } from "lucide-react";
import type { CaseSubmission } from "@workspace/api-client-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const isOpen = (s: CaseSubmission) => s.status === "active" || s.status === "offered";

/** The lender the underwriting / stress test / offer panels are about, when a case is with more than one. */
export function openSubmissions(submissions: CaseSubmission[]) {
  return submissions.filter(isOpen);
}

/** The submission a panel should start on: the flagged primary, else the first open one. */
export function defaultSubmissionId(submissions: CaseSubmission[]): number | null {
  const open = openSubmissions(submissions);
  return (open.find((s) => s.isPrimary) ?? open[0])?.id ?? null;
}

export function LenderScope({
  submissions,
  value,
  onChange,
}: {
  submissions: CaseSubmission[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  const open = openSubmissions(submissions);
  if (open.length < 2) return null;
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value != null ? String(value) : ""}
      onValueChange={(next) => next && onChange(Number(next))}
      aria-label="Lender in view"
    >
      {open.map((s) => (
        <ToggleGroupItem key={s.id} value={String(s.id)} className="gap-1">
          {s.isPrimary ? <Star className="size-3 fill-current" /> : null}
          {s.lenderName}
          {s.stepFlagged ? <span className="size-1.5 rounded-full bg-red-500" aria-label="Overdue step" /> : null}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
