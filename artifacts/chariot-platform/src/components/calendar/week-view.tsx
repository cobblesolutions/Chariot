import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CalendarEvent } from "@workspace/api-client-react";
import { format, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import {
  GRID_HEIGHT_CLASS,
  HOLIDAY_TEXT_CLASS,
  HOLIDAY_WASH_CLASS,
  dateKey,
  eventsOn,
  isToday,
  weekDays,
  type HebrewDayInfo,
} from "@/lib/calendar";
import { EventChip } from "./event-chip";
import { EventPopover, type EventActions } from "./event-popover";

const HOUR_PX = 56;
const DEFAULT_START = 7;
const DEFAULT_END = 20;

type WeekViewProps = EventActions & {
  anchor: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  hebrew: Map<string, HebrewDayInfo> | null;
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onNewEvent: (date: Date) => void;
  openKey: string | null;
  onOpenKey: (key: string | null) => void;
};

type Positioned = {
  event: CalendarEvent;
  top: number;
  lane: number;
  lanes: number;
};

/** Assign side-by-side lanes to events that overlap (each event is one hour). */
function layoutDay(events: CalendarEvent[], startHour: number): Positioned[] {
  const laneEnds: number[] = [];
  const placed: { event: CalendarEvent; start: number; lane: number }[] = [];
  for (const event of events) {
    const d = new Date(event.eventDate);
    const start = d.getHours() * 60 + d.getMinutes();
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = start + 60;
    placed.push({ event, start, lane });
  }
  const lanes = Math.max(1, laneEnds.length);
  return placed.map(({ event, start, lane }) => ({
    event,
    top: ((start - startHour * 60) / 60) * HOUR_PX,
    lane,
    lanes,
  }));
}

function useNowMinutes() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function WeekView({
  anchor,
  eventsByDay,
  hebrew,
  selectedDate,
  onSelectDate,
  onNewEvent,
  openKey,
  onOpenKey,
  ...actions
}: WeekViewProps) {
  const days = weekDays(anchor);
  const now = useNowMinutes();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Widen the visible hours if anything falls outside the working day.
  let startHour = DEFAULT_START;
  let endHour = DEFAULT_END;
  for (const day of days) {
    for (const event of eventsOn(eventsByDay, day)) {
      const h = new Date(event.eventDate).getHours();
      startHour = Math.min(startHour, h);
      endHour = Math.max(endHour, h + 1);
    }
  }
  const hours = Array.from(
    { length: endHour - startHour },
    (_, i) => startHour + i,
  );
  const nowTop =
    ((now.getHours() * 60 + now.getMinutes() - startHour * 60) / 60) * HOUR_PX;
  const showsToday = days.some(isToday);

  // Open the grid on the working day (or centred on "now" this week).
  const weekKey = dateKey(days[0]);
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (!viewport) return;
    const target = showsToday
      ? nowTop - viewport.clientHeight / 2
      : (8 - startHour) * HOUR_PX;
    viewport.scrollTop = Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey, startHour]);

  return (
    <div
      data-testid="week-view"
      className={cn("flex flex-col", GRID_HEIGHT_CLASS)}
    >
      {/* Day headers */}
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b">
        <div />
        {days.map((day) => {
          const today = isToday(day);
          const selected = isSameDay(day, selectedDate);
          const info = hebrew?.get(dateKey(day));
          const holiday = info?.holidays[0];
          return (
            <button
              key={dateKey(day)}
              type="button"
              onClick={() => onSelectDate(day)}
              className={cn(
                "flex min-w-0 flex-col items-center gap-0.5 border-l py-2 text-xs text-muted-foreground",
                holiday && !selected && HOLIDAY_WASH_CLASS,
                selected && "bg-primary/5",
              )}
            >
              <span className="uppercase tracking-wide">
                {format(day, "EEE")}
              </span>
              <span
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-full text-base font-semibold text-foreground tabular-nums",
                  today && "bg-primary text-primary-foreground",
                  !today && selected && "text-primary",
                )}
              >
                {day.getDate()}
              </span>
              {info && (
                <span
                  className={cn(
                    "max-w-full truncate px-1",
                    holiday
                      ? cn("font-medium", HOLIDAY_TEXT_CLASS)
                      : "text-muted-foreground/70",
                  )}
                  title={holiday ? info.holidays.join(", ") : info.full}
                >
                  {holiday ?? info.short}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Time grid, capped to the month grid's height */}
      <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
          <div className="relative" style={{ height: hours.length * HOUR_PX }}>
            {hours.map((h, i) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums"
                style={{ top: i * HOUR_PX }}
              >
                {i === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const today = isToday(day);
            const positioned = layoutDay(eventsOn(eventsByDay, day), startHour);
            return (
              <div
                key={dateKey(day)}
                className="relative border-l"
                style={{ height: hours.length * HOUR_PX }}
              >
                {hours.map((h, i) => (
                  <button
                    key={h}
                    type="button"
                    aria-label={`New event at ${String(h).padStart(2, "0")}:00 on ${format(day, "EEEE d MMMM")}`}
                    className={cn(
                      "absolute inset-x-0 border-t border-border/60 outline-none hover:bg-muted/50 focus-visible:bg-muted/50",
                      i === 0 && "border-t-0",
                    )}
                    style={{ top: i * HOUR_PX, height: HOUR_PX }}
                    onClick={() => {
                      const at = new Date(day);
                      at.setHours(h, 0, 0, 0);
                      onNewEvent(at);
                    }}
                  />
                ))}
                {positioned.map(({ event, top, lane, lanes }) => (
                  <div
                    key={event.id}
                    className="absolute px-0.5"
                    style={{
                      top: top + 1,
                      height: HOUR_PX - 2,
                      left: `${(lane / lanes) * 100}%`,
                      width: `${100 / lanes}%`,
                    }}
                  >
                    <EventPopover
                      event={event}
                      open={openKey === `week:${event.id}`}
                      onOpenChange={(open) =>
                        onOpenKey(open ? `week:${event.id}` : null)
                      }
                      side="right"
                      {...actions}
                    >
                      <EventChip event={event} layout="block" />
                    </EventPopover>
                  </div>
                ))}
                {today && nowTop >= 0 && nowTop <= hours.length * HOUR_PX && (
                  <div
                    aria-hidden="true"
                    data-testid="now-line"
                    className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                    style={{ top: nowTop }}
                  >
                    <span className="-ml-1 size-2 rounded-full bg-destructive" />
                    <span className="h-px flex-1 bg-destructive" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
