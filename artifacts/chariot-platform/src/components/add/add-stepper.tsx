import { Check, X } from "lucide-react";
import type { Client } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { ADD_STEPS, currentAddStep, isClosedLifecycle } from "@/lib/enquiry";

/**
 * The three steps of the Add page, inline: done steps are ticked, the current
 * one is bold, the rest are quiet. A closed client shows a cross where it
 * stopped. Sits on one row with the step's action.
 */
export function AddStepper({ client }: { client: Pick<Client, "lifecycle" | "acceptedAt"> }) {
  const current = currentAddStep(client);
  const currentIndex = ADD_STEPS.findIndex((step) => step.key === current);
  const closed = isClosedLifecycle(client.lifecycle);
  const finished = client.lifecycle === "active";

  return (
    <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-2" aria-label="Add steps">
      {ADD_STEPS.map((step, index) => {
        const done = finished || index < currentIndex;
        const isCurrent = !finished && index === currentIndex;
        const stopped = closed && isCurrent;
        return (
          <li key={step.key} className="flex items-center gap-1">
            {index > 0 ? (
              <span aria-hidden className={cn("mx-2 h-px w-6 sm:w-10", done || isCurrent ? "bg-primary/50" : "bg-border")} />
            ) : null}
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  done && "bg-primary text-primary-foreground",
                  isCurrent && !stopped && "bg-primary text-primary-foreground ring-4 ring-primary/15",
                  stopped && "bg-destructive text-white",
                  !done && !isCurrent && "border text-muted-foreground",
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                {done ? <Check className="size-3.5" /> : stopped ? <X className="size-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  "text-sm",
                  isCurrent ? "font-semibold" : done ? "font-medium" : "text-muted-foreground",
                  stopped && "text-destructive",
                )}
              >
                {step.title}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
