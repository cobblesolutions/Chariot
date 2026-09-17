import type { CalendarEvent } from "@workspace/api-client-react";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import {
  HOLIDAY_TEXT_CLASS,
  SHABBAT_TEXT_CLASS,
  isShabbat,
  dateKey,
  isToday,
  relativeDayLabel,
  type HebrewDayInfo,
} from "@/lib/calendar";
import { EventRow } from "./event-row";
import type { EventActions } from "./event-popover";

type AgendaViewProps = EventActions & {
  /** Days in the visible range, in order. */
  days: Date[];
  eventsByDay: Map<string, CalendarEvent[]>;
  hebrew: Map<string, HebrewDayInfo> | null;
  onNewEvent: (date: Date) => void;
  openKey: string | null;
  onOpenKey: (key: string | null) => void;
};

export function AgendaView({
  days,
  eventsByDay,
  hebrew,
  onNewEvent,
  openKey,
  onOpenKey,
  ...actions
}: AgendaViewProps) {
  const groups = days
    .map((day) => ({ day, events: eventsByDay.get(dateKey(day)) ?? [] }))
    .filter((g) => g.events.length > 0);

  if (groups.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarDays />
          </EmptyMedia>
          <EmptyTitle>Nothing scheduled</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNewEvent(days[0])}
          >
            Add an event
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <ScrollArea
      className={cn(
        "*:data-[slot=scroll-area-viewport]:max-h-[29rem] md:*:data-[slot=scroll-area-viewport]:max-h-[44rem]",
      )}
    >
      <div data-testid="agenda-view" className="divide-y">
        {groups.map(({ day, events }) => {
          const info = hebrew?.get(dateKey(day));
          const holiday = info?.holidays[0];
          const today = isToday(day);
          const shabbat = !holiday && isShabbat(day);
          return (
            <section
              key={dateKey(day)}
              className="grid gap-x-6 py-2 md:grid-cols-[10rem_1fr]"
            >
              <header className="flex items-baseline gap-2 px-4 py-2 md:flex-col md:gap-0.5 md:py-3">
                <span
                  className={cn(
                    "text-sm font-semibold",
                    today
                      ? "text-primary"
                      : shabbat
                        ? SHABBAT_TEXT_CLASS
                        : "text-foreground",
                  )}
                >
                  {relativeDayLabel(day)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format(day, "d MMMM yyyy")}
                </span>
                {info && (
                  <span
                    className={cn(
                      "text-xs",
                      holiday
                        ? cn("font-medium", HOLIDAY_TEXT_CLASS)
                        : "text-muted-foreground/70",
                    )}
                  >
                    {holiday ?? info.full}
                  </span>
                )}
              </header>
              <div className="flex flex-col">
                {events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    open={openKey === `agenda:${event.id}`}
                    onOpenChange={(open) =>
                      onOpenKey(open ? `agenda:${event.id}` : null)
                    }
                    side="bottom"
                    {...actions}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </ScrollArea>
  );
}
