import { useEffect, useState } from "react";
import { Check, ChevronDown, Lock } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { StageClasses } from "@/lib/stages";

export type FlowStep = {
  key: string;
  label: string;
  done: boolean;
};

/**
 * Compact numbered tracker for the steps inside a stage — the stage strip's
 * little sibling. A step opens once every step before it is done (a
 * finished step can always be reviewed).
 */
export function StepTracker({
  steps,
  activeIndex,
  colour,
  onSelect,
}: {
  steps: FlowStep[];
  activeIndex: number | null;
  colour: StageClasses;
  onSelect: (index: number) => void;
}) {
  return (
    <ol
      className="scroll-fade-x flex items-start overflow-x-auto pb-1"
      aria-label="Steps in this stage"
    >
      {steps.map((step, idx) => {
        const reachable = step.done || steps.slice(0, idx).every((s) => s.done);
        const isActive = idx === activeIndex;
        const isLast = idx === steps.length - 1;
        return (
          <li
            key={step.key}
            aria-current={isActive ? "step" : undefined}
            className="relative flex min-w-[4.5rem] flex-1 flex-col items-center gap-1.5 text-center"
          >
            {!isLast && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-3.5 left-1/2 h-0.5 w-full -translate-y-1/2 rounded-full",
                  step.done ? colour.bg : "bg-border",
                )}
              />
            )}
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onSelect(idx)}
              aria-label={`Step ${idx + 1}: ${step.label}`}
              className={cn(
                "relative z-10 flex size-7 items-center justify-center rounded-full border-2 text-xs font-semibold outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/50",
                step.done
                  ? cn(colour.solid, "cursor-pointer")
                  : reachable
                    ? cn(
                        "cursor-pointer bg-card",
                        colour.border,
                        colour.text,
                        isActive && `ring-4 ${colour.ring}`,
                      )
                    : "cursor-not-allowed border-border bg-muted text-muted-foreground",
              )}
            >
              {step.done ? <Check className="size-3.5" /> : idx + 1}
            </button>
            <span
              className={cn(
                "px-1 text-[10px] leading-tight font-medium text-balance sm:text-[11px]",
                isActive
                  ? colour.text
                  : step.done
                    ? "text-foreground"
                    : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One step in a vertical stepper: numbered node on a rail, title row that
 * expands the body. Locked steps (an earlier step is still open) cannot be
 * expanded; finished steps show a one-line summary instead.
 */
export function StepCard({
  index,
  title,
  owner,
  summary,
  done,
  locked,
  open,
  isLast = false,
  onOpenChange,
  colour,
  children,
}: {
  index: number;
  title: React.ReactNode;
  /** Default-owner pill, shown after the title. */
  owner?: React.ReactNode;
  /** What was recorded, shown once the step is done and collapsed. */
  summary?: React.ReactNode;
  done: boolean;
  locked: boolean;
  open: boolean;
  isLast?: boolean;
  onOpenChange: (open: boolean) => void;
  colour: StageClasses;
  children: React.ReactNode;
}) {
  const expanded = open && !locked;
  return (
    <Collapsible
      open={expanded}
      onOpenChange={onOpenChange}
      className="relative pl-11"
    >
      {!isLast && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-8 bottom-0 left-[13px] w-0.5",
            done ? colour.bg : "bg-border",
          )}
        />
      )}
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1.5 left-0 flex size-7 items-center justify-center rounded-full border-2 text-xs font-semibold",
          done
            ? colour.solid
            : locked
              ? "border-border bg-muted text-muted-foreground"
              : cn(
                  "bg-card",
                  colour.border,
                  colour.text,
                  `ring-4 ${colour.ring}`,
                ),
        )}
      >
        {done ? <Check className="size-3.5" /> : index + 1}
      </span>
      <CollapsibleTrigger
        disabled={locked}
        className={cn(
          "flex w-full items-center gap-3 rounded-md py-2 pr-2 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
          locked ? "cursor-not-allowed" : "hover:bg-muted/50",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium",
              locked ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {title}
            {owner}
          </span>
          {!expanded && done && summary && (
            <span className="truncate text-xs text-muted-foreground">
              {summary}
            </span>
          )}
        </span>
        {locked ? (
          <Lock className="size-3.5 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 pb-5 pr-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Which step is expanded. Defaults to the first unfinished step and jumps
 * forward as steps complete; the user may reopen an earlier, finished step.
 */
export function useStepFlow(doneFlags: boolean[]) {
  const [override, setOverride] = useState<number | "none" | null>(null);
  const signature = doneFlags.map(Number).join("");

  useEffect(() => {
    setOverride(null);
  }, [signature]);

  const firstOpen = doneFlags.findIndex((done) => !done);
  const reachable = (index: number) =>
    doneFlags[index] || doneFlags.slice(0, index).every(Boolean);
  const active =
    override === "none"
      ? null
      : override !== null && reachable(override)
        ? override
        : firstOpen === -1
          ? null
          : firstOpen;

  return {
    active,
    open: (index: number) => setOverride(index),
    close: () => setOverride("none"),
    reachable,
  };
}
