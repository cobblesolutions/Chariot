import type { CalendarEvent } from "@workspace/api-client-react";
import { format, isSameDay, isSameMonth } from "date-fns";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  GRID_HEIGHT_CLASS,
  HOLIDAY_TEXT_CLASS,
  HOLIDAY_WASH_CLASS,
  SHABBAT_TEXT_CLASS,
  SHABBAT_WASH_CLASS,
  isShabbat,
  dateKey,
  eventTypeMeta,
  eventsOn,
  isToday,
  monthGridDays,
  type HebrewDayInfo,
} from "@/lib/calendar";
import { EventChip } from "./event-chip";
import { EventPopover, type EventActions } from "./event-popover";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

type MonthViewProps = EventActions & {
  month: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  hebrew: Map<string, HebrewDayInfo> | null;
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onNewEvent: (date: Date) => void;
  openKey: string | null;
  onOpenKey: (key: string | null) => void;
};

export function MonthView({
  month,
  eventsByDay,
  hebrew,
  selectedDate,
  onSelectDate,
  onNewEvent,
  openKey,
  onOpenKey,
  ...actions
}: MonthViewProps) {
  const days = monthGridDays(month);

  return (
    <div
      data-testid="month-view"
      className={cn("flex flex-col", GRID_HEIGHT_CLASS)}
    >
      <div className="grid grid-cols-7 border-b">
        {WEEKDAYS.map((label, i) => (
          <div
            key={label}
            className={cn(
              "py-2 text-center text-xs font-medium text-muted-foreground",
              i >= 5 && "text-muted-foreground/70",
            )}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid flex-1 auto-rows-fr grid-cols-7">
        {days.map((day, index) => {
          const key = dateKey(day);
          const inMonth = isSameMonth(day, month);
          const today = isToday(day);
          const selected = isSameDay(day, selectedDate);
          const dayEvents = eventsOn(eventsByDay, day);
          const overflow = dayEvents.length - MAX_CHIPS;
          const info = hebrew?.get(key);
          const holiday = info?.holidays[0];
          const shabbat = !holiday && isShabbat(day);

          return (
            <div
              key={key}
              data-testid="month-cell"
              data-shabbat={shabbat || undefined}
              data-today={today || undefined}
              data-selected={selected || undefined}
              onClick={() => onSelectDate(day)}
              onDoubleClick={() => onNewEvent(day)}
              className={cn(
                "group/cell relative flex min-w-0 flex-col gap-1 border-b border-r p-1.5 transition-colors hover:bg-muted/40",
                index % 7 === 6 && "border-r-0",
                index >= days.length - 7 && "border-b-0",
                !inMonth && "text-muted-foreground",
                !inMonth && !holiday && !shabbat && "bg-muted/30",
                holiday && !selected && HOLIDAY_WASH_CLASS,
                shabbat && !selected && SHABBAT_WASH_CLASS,
                selected && "bg-primary/5",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm tabular-nums",
                    today && "bg-primary font-semibold text-primary-foreground",
                    !today && selected && "font-semibold text-primary",
                    !today &&
                      !selected &&
                      shabbat &&
                      cn("font-medium", SHABBAT_TEXT_CLASS),
                  )}
                >
                  {day.getDate()}
                </span>
                {info && (
                  <span
                    className="hidden min-w-0 truncate text-xs text-muted-foreground/60 md:inline"
                    title={info.full}
                  >
                    {info.short}
                  </span>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`New event on ${format(day, "d MMMM")}`}
                      className="ml-auto opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNewEvent(day);
                      }}
                    >
                      <Plus />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>New event</TooltipContent>
                </Tooltip>
              </div>
              {holiday && (
                <span
                  className={cn(
                    "hidden truncate px-1 text-xs font-medium md:block",
                    HOLIDAY_TEXT_CLASS,
                  )}
                  title={info?.holidays.join(", ")}
                >
                  {holiday}
                </span>
              )}

              {/* Chips on md+; a dot row on narrow screens. */}
              <div className="hidden min-w-0 flex-col gap-0.5 md:flex">
                {dayEvents.slice(0, MAX_CHIPS).map((event) => (
                  <EventPopover
                    key={event.id}
                    event={event}
                    open={openKey === `month:${event.id}`}
                    onOpenChange={(open) =>
                      onOpenKey(open ? `month:${event.id}` : null)
                    }
                    {...actions}
                  >
                    <EventChip
                      event={event}
                      showTime="2xl"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </EventPopover>
                ))}
                {overflow > 0 && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="justify-start px-1.5 text-muted-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectDate(day);
                    }}
                  >
                    +{overflow} more
                  </Button>
                )}
              </div>
              {dayEvents.length > 0 && (
                <div className="flex flex-wrap gap-1 px-1 md:hidden">
                  {dayEvents.slice(0, 4).map((event) => (
                    <span
                      key={event.id}
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 rounded-full",
                        eventTypeMeta(event.eventType).dot,
                        event.completed && "opacity-40",
                      )}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
