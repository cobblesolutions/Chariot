import { forwardRef } from "react";
import type { CalendarEvent } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { eventTypeMeta, formatTime } from "@/lib/calendar";

type EventChipProps = React.ComponentProps<"button"> & {
  event: CalendarEvent;
  /** `row`: one line with time + title (month). `block`: title over time (week grid). */
  layout?: "row" | "block";
  /** Row layout: always show the time, or only from the 2xl breakpoint up. */
  showTime?: "always" | "2xl";
};

/**
 * Compact tinted event pill used in the month grid and the week time grid.
 * Forwarded ref so it can anchor a Popover.
 */
export const EventChip = forwardRef<HTMLButtonElement, EventChipProps>(
  function EventChip(
    { event, layout = "row", showTime = "always", className, ...props },
    ref,
  ) {
    const meta = eventTypeMeta(event.eventType);
    if (layout === "block") {
      return (
        <button
          ref={ref}
          type="button"
          data-testid="event-chip"
          title={event.title}
          className={cn(
            "flex size-full min-w-0 flex-col justify-center overflow-hidden rounded-md px-2 py-1 text-left text-xs leading-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            meta.tint,
            event.completed && "opacity-60",
            className,
          )}
          {...props}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("size-1.5 shrink-0 rounded-full", meta.dot)}
            />
            <span
              className={cn(
                "min-w-0 truncate font-medium",
                event.completed && "line-through",
              )}
            >
              {event.title}
            </span>
          </span>
          <span className="truncate pl-3 tabular-nums text-muted-foreground">
            {formatTime(event.eventDate)}
            {event.clientName ? ` · ${event.clientName}` : ""}
          </span>
        </button>
      );
    }
    return (
      <button
        ref={ref}
        type="button"
        data-testid="event-chip"
        title={event.title}
        className={cn(
          "flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs leading-5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          meta.tint,
          event.completed && "opacity-60",
          className,
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", meta.dot)}
        />
        <span
          className={cn(
            "shrink-0 tabular-nums text-muted-foreground",
            showTime === "2xl" && "hidden 2xl:inline",
          )}
        >
          {formatTime(event.eventDate)}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium",
            event.completed && "line-through",
          )}
        >
          {event.title}
        </span>
      </button>
    );
  },
);
