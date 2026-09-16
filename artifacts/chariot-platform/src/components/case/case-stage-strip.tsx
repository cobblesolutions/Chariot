import { useEffect, useRef } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  Circle,
  ClipboardList,
  FileCheck2,
  Flag,
  Gauge,
  ReceiptText,
  SearchCheck,
  Send,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stageClasses } from "@/lib/stages";

const STAGE_ICONS: Record<string, LucideIcon> = {
  "Submission details": ClipboardList,
  "Advice & approval": BadgeCheck,
  Submission: Send,
  Underwriting: SearchCheck,
  "Stress test": Gauge,
  "Lender offer": FileCheck2,
  "Invoice & payment": ReceiptText,
  Completion: CheckCircle2,
};

type CaseStageStripProps = {
  stages: string[];
  stageIndex: number;
  skippedStageIndexes: number[];
  /** Stage whose requirements are shown below; past stages can be revisited. */
  viewingStageIndex: number;
  onSelect: (index: number) => void;
  stageDays: number;
  stageFlagged: boolean;
};

/**
 * Horizontal pipeline strip: one node per stage with a connector between
 * them. Scrolls sideways on narrow screens, centred on the current stage.
 */
export function CaseStageStrip({
  stages,
  stageIndex,
  skippedStageIndexes,
  viewingStageIndex,
  onSelect,
  stageDays,
  stageFlagged,
}: CaseStageStripProps) {
  const currentRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({
      inline: "center",
      block: "nearest",
    });
  }, [stageIndex]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end text-xs text-muted-foreground">
        <span className="tabular-nums">
          Stage {viewingStageIndex + 1} of {stages.length}
        </span>
      </div>
      <ol
        className="scroll-fade-x -mt-1.5 flex items-start overflow-x-auto pt-1.5 pb-1 sm:justify-center"
        aria-label="Case progress"
      >
        {stages.map((stage, idx) => {
          const isSkipped = skippedStageIndexes.includes(idx);
          const isPast = idx < stageIndex;
          const isCurrent = idx === stageIndex;
          const isFuture = idx > stageIndex;
          const isSelected = idx === viewingStageIndex;
          const isLast = idx === stages.length - 1;
          const colour = stageClasses(idx);
          const Icon = STAGE_ICONS[stage] ?? Circle;

          return (
            <li
              key={stage}
              ref={isCurrent ? currentRef : undefined}
              aria-current={isCurrent ? "step" : undefined}
              className="relative flex min-w-[4.5rem] max-w-[15rem] flex-1 flex-col items-center gap-2 text-center sm:min-w-[5.5rem]"
            >
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-4 left-1/2 h-0.5 w-full -translate-y-1/2 rounded-full",
                    isPast ? colour.bg : "bg-border",
                  )}
                />
              )}
              <button
                type="button"
                disabled={isFuture || isSkipped}
                onClick={() => onSelect(idx)}
                aria-label={`${stage}${isCurrent ? " (current stage)" : ""}`}
                className={cn(
                  "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  isSkipped
                    ? "cursor-not-allowed border-border bg-muted text-muted-foreground"
                    : isPast
                      ? cn(
                          colour.solid,
                          "cursor-pointer",
                          isSelected && `ring-4 ${colour.ring}`,
                        )
                      : isCurrent
                        ? cn(
                            "cursor-pointer bg-card",
                            colour.border,
                            colour.text,
                            `ring-4 ${colour.ring}`,
                          )
                        : "cursor-not-allowed border-border bg-muted text-muted-foreground",
                )}
              >
                {isSkipped ? (
                  <span className="text-[8px] font-bold">N/A</span>
                ) : (
                  <Icon className="size-4" />
                )}
              </button>
              <div className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    "px-1 text-[10px] leading-tight font-medium text-balance sm:text-xs",
                    isSkipped
                      ? "text-muted-foreground line-through opacity-60"
                      : isSelected || isCurrent
                        ? colour.text
                        : isFuture
                          ? "text-muted-foreground"
                          : "text-foreground",
                  )}
                >
                  {stage}
                </span>
                <span className="flex min-h-4 items-center">
                  {isSkipped ? (
                    <Badge variant="secondary">Skipped</Badge>
                  ) : isCurrent ? (
                    stageFlagged ? (
                      <Badge variant="destructive">
                        <Flag /> {stageDays} days
                      </Badge>
                    ) : (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                          colour.tint,
                          colour.text,
                        )}
                      >
                        {stageDays} days
                      </span>
                    )
                  ) : null}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
