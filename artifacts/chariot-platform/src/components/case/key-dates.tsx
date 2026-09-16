import { useEffect, useState } from "react";
import type { Case } from "@workspace/api-client-react";
import { Link } from "wouter";
import { format, isBefore, startOfDay } from "date-fns";
import { CalendarDays, Check, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { DatePicker } from "@/components/date-picker";
import { formatMoney } from "@/lib/utils";

type Props = {
  caseItem: Case;
  /** Confirm (true, with the valuer's figure) or reopen (false) the valuation. */
  onSetValuationCompleted: (completed: boolean, amount?: number) => void;
  /** "yyyy-MM-dd" or "" to clear. */
  onSaveExpectedCompletionDate: (value: string) => void;
  pending?: boolean;
};

type Tone = "done" | "overdue" | "scheduled" | "none";

const passed = (iso: string) =>
  isBefore(startOfDay(new Date(iso)), startOfDay(new Date()));
const dateLabel = (iso: string) => format(new Date(iso), "EEE d MMM yyyy");

/** One compact pill — title and date — opening its details. */
function KeyDateButton({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value: string;
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          data-tone={tone}
          aria-label={`${label}: ${value}`}
          className="gap-1.5"
        >
          <span className="font-semibold">{label}</span>
          <span className="font-normal opacity-90">{value}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The two dates the case is wired to — valuation and expected completion —
 * as compact header buttons. Each mirrors a calendar event and a follow-up
 * task; status flips as the day passes.
 */
export function CaseKeyDates({
  caseItem,
  onSetValuationCompleted,
  onSaveExpectedCompletionDate,
  pending,
}: Props) {
  const closed = caseItem.status === "completed" || !!caseItem.archivedAt;
  const valuationDone = !!caseItem.valuationCompletedAt;
  const [amount, setAmount] = useState("");
  useEffect(() => {
    setAmount(
      caseItem.valuationAmount
        ? String(Math.round(caseItem.valuationAmount))
        : "",
    );
  }, [caseItem.valuationAmount]);
  const valuationOverdue =
    !!caseItem.valuationDate &&
    !valuationDone &&
    passed(caseItem.valuationDate);
  const completionOverdue =
    !!caseItem.expectedCompletionDate &&
    caseItem.status !== "completed" &&
    passed(caseItem.expectedCompletionDate);

  const valuationTone: Tone = valuationDone
    ? "done"
    : valuationOverdue
      ? "overdue"
      : caseItem.valuationDate
        ? "scheduled"
        : "none";
  const completionTone: Tone =
    caseItem.status === "completed"
      ? "done"
      : completionOverdue
        ? "overdue"
        : caseItem.expectedCompletionDate
          ? "scheduled"
          : "none";

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="case-key-dates"
    >
      <KeyDateButton
        label="Valuation"
        value={
          caseItem.valuationDate
            ? dateLabel(caseItem.valuationDate)
            : "Not scheduled"
        }
        tone={valuationTone}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Valuation</span>
          {valuationDone ? (
            <Badge>Took place</Badge>
          ) : valuationOverdue ? (
            <Badge variant="destructive">Date passed — confirm</Badge>
          ) : caseItem.valuationDate ? (
            <Badge variant="secondary">Scheduled</Badge>
          ) : (
            <Badge variant="outline">Not scheduled</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {caseItem.valuationDate
            ? valuationDone && caseItem.valuationCompletedAt
              ? `${dateLabel(caseItem.valuationDate)} · confirmed ${dateLabel(caseItem.valuationCompletedAt)}${caseItem.valuationAmount ? ` · valued at ${formatMoney(caseItem.valuationAmount)}` : ""}`
              : dateLabel(caseItem.valuationDate)
            : "Set the date in the Submission step."}
        </p>
        {caseItem.valuationDate && !closed && !valuationDone && (
          <InputGroup>
            <InputGroupAddon>£</InputGroupAddon>
            <InputGroupInput
              inputMode="numeric"
              placeholder="Valuer's figure"
              value={amount ? Number(amount).toLocaleString("en-GB") : ""}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </InputGroup>
        )}
        {caseItem.valuationDate && !closed && (
          <div className="flex justify-end">
            {valuationDone ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => onSetValuationCompleted(false)}
                title="Reopens the calendar event and follow-up task"
              >
                <Undo2 /> Reopen
              </Button>
            ) : (
              <Button
                variant={valuationOverdue ? "default" : "outline"}
                size="sm"
                disabled={pending || !Number(amount)}
                onClick={() =>
                  onSetValuationCompleted(true, Number(amount) || undefined)
                }
              >
                <Check /> Took place
              </Button>
            )}
          </div>
        )}
      </KeyDateButton>

      <KeyDateButton
        label="Completion"
        value={
          caseItem.expectedCompletionDate
            ? dateLabel(caseItem.expectedCompletionDate)
            : "No date"
        }
        tone={completionTone}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Completion</span>
          {caseItem.status === "completed" ? (
            <Badge>Completed</Badge>
          ) : completionOverdue ? (
            <Badge variant="destructive">Date passed — verify</Badge>
          ) : caseItem.expectedCompletionDate ? (
            <Badge variant="secondary">Expected</Badge>
          ) : (
            <Badge variant="outline">No date</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {caseItem.expectedCompletionDate
            ? completionOverdue
              ? "Verify completion, then mark the case completed in the Completion stage."
              : "Mirrored to the calendar with a follow-up task for the completions team."
            : "Set the day the mortgage is expected to complete."}
        </p>
        <div className="flex items-center justify-between gap-2">
          {closed ? (
            caseItem.expectedCompletionDate && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarDays className="size-4" />
                {dateLabel(caseItem.expectedCompletionDate)}
              </span>
            )
          ) : (
            <DatePicker
              size="sm"
              className="w-auto"
              placeholder="Set date"
              value={caseItem.expectedCompletionDate}
              onChange={onSaveExpectedCompletionDate}
              disabled={pending}
            />
          )}
          {caseItem.expectedCompletionDate && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/calendar">Calendar</Link>
            </Button>
          )}
        </div>
      </KeyDateButton>
    </div>
  );
}
