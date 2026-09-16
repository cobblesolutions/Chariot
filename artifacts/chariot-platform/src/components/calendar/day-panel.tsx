import type { CalendarEvent } from "@workspace/api-client-react";
import { format, isAfter } from "date-fns";
import { CalendarDays, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  dateKey,
  eventsOn,
  relativeDayLabel,
  type HebrewDayInfo,
} from "@/lib/calendar";
import { EventRow } from "./event-row";
import type { EventActions } from "./event-popover";

type DayPanelProps = EventActions & {
  className?: string;
  date: Date;
  /** All (filtered) events, sorted by time. */
  events: CalendarEvent[];
  eventsByDay: Map<string, CalendarEvent[]>;
  hebrew: Map<string, HebrewDayInfo> | null;
  onNewEvent: (date: Date) => void;
  openKey: string | null;
  onOpenKey: (key: string | null) => void;
};

const UP_NEXT_LIMIT = 5;

/** "Tomorrow" or "Thu 17" — short enough for the row's leading column. */
function shortDayLabel(d: Date) {
  const label = relativeDayLabel(d);
  return label === "Today" || label === "Tomorrow" ? label : format(d, "EEE d");
}

/** Right-hand panel: the selected day's schedule, then what's coming up next. */
export function DayPanel({
  className,
  date,
  events,
  eventsByDay,
  hebrew,
  onNewEvent,
  openKey,
  onOpenKey,
  ...actions
}: DayPanelProps) {
  const dayEvents = eventsOn(eventsByDay, date);
  const info = hebrew?.get(dateKey(date));
  const now = new Date();
  const upNext = events
    .filter((e) => !e.completed && isAfter(new Date(e.eventDate), now))
    .filter((e) => dateKey(new Date(e.eventDate)) !== dateKey(date))
    .slice(0, UP_NEXT_LIMIT);

  return (
    <Card className={cn("gap-0 py-0 lg:sticky lg:top-6", className)}>
      <CardHeader className="border-b py-4">
        <CardTitle data-testid="day-panel-title">
          {relativeDayLabel(date)}
        </CardTitle>
        <CardDescription>
          {format(date, "EEEE d MMMM yyyy")}
          {info && <span className="block">{info.full}</span>}
        </CardDescription>
        {!!info?.holidays.length && (
          <div className="flex flex-wrap gap-1 pt-1">
            {info.holidays.map((h) => (
              <Badge key={h} variant="secondary">
                {h}
              </Badge>
            ))}
          </div>
        )}
        <CardAction>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New event on this day"
                onClick={() => onNewEvent(date)}
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New event on this day</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>

      <CardContent className="px-0 py-2">
        {dayEvents.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarDays />
              </EmptyMedia>
              <EmptyDescription>Nothing scheduled.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col">
            {dayEvents.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                open={openKey === `day:${event.id}`}
                onOpenChange={(open) =>
                  onOpenKey(open ? `day:${event.id}` : null)
                }
                {...actions}
              />
            ))}
          </div>
        )}
      </CardContent>

      {upNext.length > 0 && (
        <>
          <Separator />
          <CardContent className="px-0 py-2">
            <p className="px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Up next
            </p>
            <div className="flex flex-col">
              {upNext.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  dayLabel={shortDayLabel(new Date(event.eventDate))}
                  open={openKey === `next:${event.id}`}
                  onOpenChange={(open) =>
                    onOpenKey(open ? `next:${event.id}` : null)
                  }
                  {...actions}
                />
              ))}
            </div>
          </CardContent>
        </>
      )}
    </Card>
  );
}
