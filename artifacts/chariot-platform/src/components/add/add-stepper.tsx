import { Check, ChevronRight, X } from "lucide-react";
import type { Client } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { ADD_STEPS, currentAddStep, isClosedLifecycle } from "@/lib/enquiry";

/**
 * The three steps of the Add page as one quiet line: done steps are ticked,
 * the current one is bold, the rest are muted. A closed client shows a cross
 * where it stopped.
 */
export function AddStepper({ client }: { client: Pick<Client, "lifecycle" | "acceptedAt"> }) {
  const current = currentAddStep(client);
  const currentIndex = ADD_STEPS.findIndex((step) => step.key === current);
  const closed = isClosedLifecycle(client.lifecycle);
  const finished = client.lifecycle === "active";

  return (
    <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-sm" aria-label="Add steps">
      {ADD_STEPS.map((step, index) => {
        const done = finished || index < currentIndex;
        const isCurrent = !finished && index === currentIndex;
        const stopped = closed && isCurrent;
        return (
          <li key={step.key} className="flex items-center gap-1">
            {index > 0 ? <ChevronRight aria-hidden className="mx-1 size-3.5 text-muted-foreground/60" /> : null}
            <span
              className={cn(
                "flex items-center gap-1.5",
                isCurrent ? "font-semibold" : done ? "text-foreground" : "text-muted-foreground",
                stopped && "text-destructive",
              )}
              aria-current={isCurrent ? "step" : undefined}
            >
              {done ? (
                <Check className="size-3.5 text-primary" />
              ) : stopped ? (
                <X className="size-3.5" />
              ) : isCurrent ? (
                <span aria-hidden className="size-1.5 rounded-full bg-primary" />
              ) : null}
              {step.title}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
