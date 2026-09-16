import { forwardRef } from "react";
import type { CalendarEvent } from "@workspace/api-client-react";
import { Check } from "lucide-react";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { eventTypeMeta, formatTime } from "@/lib/calendar";
import { EventPopover, type EventActions } from "./event-popover";

type EventRowProps = React.ComponentProps<"button"> & {
  event: CalendarEvent;
  /** Lead with the day instead of the time (for cross-day lists). */
  dayLabel?: string;
};

/** A list row for an event: time (or day), title, case, and a type dot. */
const EventRowButton = forwardRef<HTMLButtonElement, EventRowProps>(
  function EventRowButton({ event, dayLabel, className, ...props }, ref) {
    const meta = eventTypeMeta(event.eventType);
    return (
      <Item
        asChild
        size="sm"
        className={cn(
          "w-full flex-nowrap rounded-none px-4 text-left",
          event.completed && "opacity-60",
          className,
        )}
      >
        <button ref={ref} type="button" data-testid="event-row" {...props}>
          <ItemMedia className="w-[4.5rem] flex-col items-start gap-0 self-start pt-0.5">
            <span className="max-w-full truncate text-sm font-semibold tabular-nums leading-tight">
              {dayLabel ?? formatTime(event.eventDate)}
            </span>
            {dayLabel && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatTime(event.eventDate)}
              </span>
            )}
          </ItemMedia>
          <ItemContent className="min-w-0 gap-0.5">
            <ItemTitle className="max-w-full">
              <span
                aria-hidden="true"
                className={cn("size-2 shrink-0 rounded-full", meta.dot)}
              />
              <span
                className={cn("truncate", event.completed && "line-through")}
              >
                {event.title}
              </span>
            </ItemTitle>
            <ItemDescription className="line-clamp-1">
              {meta.label}
              {event.clientName ? ` · ${event.clientName}` : ""}
              {event.caseReference ? ` · ${event.caseReference}` : ""}
            </ItemDescription>
          </ItemContent>
          {event.completed && (
            <Check className="size-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      </Item>
    );
  },
);

type Props = EventActions & {
  event: CalendarEvent;
  dayLabel?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: React.ComponentProps<typeof EventPopover>["side"];
};

export function EventRow({
  event,
  dayLabel,
  open,
  onOpenChange,
  side = "left",
  ...actions
}: Props) {
  return (
    <EventPopover
      event={event}
      open={open}
      onOpenChange={onOpenChange}
      side={side}
      {...actions}
    >
      <EventRowButton event={event} dayLabel={dayLabel} />
    </EventPopover>
  );
}
