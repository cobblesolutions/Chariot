import { useMemo } from "react";
import { HDate, HebrewCalendar } from "@hebcal/core";
import type { CalendarEvent } from "@workspace/api-client-react";
import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

export type EventType = "valuation" | "completion" | "renewal" | "general";
export type CalendarView = "month" | "week" | "agenda";

export const EVENT_TYPES: EventType[] = [
  "valuation",
  "completion",
  "renewal",
  "general",
];

type EventTypeMeta = {
  label: string;
  /** Solid dot / bar in the type colour. */
  dot: string;
  /** Tinted chip background + its hover. */
  tint: string;
  /** Text in the type colour. */
  text: string;
  /** Left accent bar in the type colour. */
  accent: string;
};

// Full literal class strings so Tailwind's scanner picks them up. Colours reuse
// the pipeline stage tokens so the calendar stays on-brand in light and dark.
const EVENT_TYPE_META: Record<EventType, EventTypeMeta> = {
  valuation: {
    label: "Valuation",
    dot: "bg-stage-1",
    tint: "bg-stage-1/10 hover:bg-stage-1/20 data-[state=open]:bg-stage-1/20",
    text: "text-stage-1",
    accent: "border-l-stage-1",
  },
  completion: {
    label: "Completion",
    dot: "bg-stage-7",
    tint: "bg-stage-7/10 hover:bg-stage-7/20 data-[state=open]:bg-stage-7/20",
    text: "text-stage-7",
    accent: "border-l-stage-7",
  },
  renewal: {
    label: "Renewal",
    dot: "bg-stage-3",
    tint: "bg-stage-3/10 hover:bg-stage-3/20 data-[state=open]:bg-stage-3/20",
    text: "text-stage-3",
    accent: "border-l-stage-3",
  },
  general: {
    label: "General",
    dot: "bg-stage-5",
    tint: "bg-stage-5/10 hover:bg-stage-5/20 data-[state=open]:bg-stage-5/20",
    text: "text-stage-5",
    accent: "border-l-stage-5",
  },
};

export function eventTypeMeta(type: string): EventTypeMeta {
  return EVENT_TYPE_META[
    (type as EventType) in EVENT_TYPE_META ? (type as EventType) : "general"
  ];
}

/** Short explanation for events that mirror a case or renewal date (null for manual events). */
export function eventMirrorLabel(source: string | undefined): string | null {
  switch (source) {
    case "case_valuation":
      return "Mirrors the case's valuation date";
    case "case_completion":
      return "Mirrors the case's expected completion date";
    case "renewal":
      return "Renewal reminder";
    default:
      return null;
  }
}

/**
 * Height of the month grid (weekday header + six 7rem rows, 4.5rem rows on
 * phones). The week and agenda views are capped to it and scroll inside.
 */
export const GRID_HEIGHT_CLASS = "h-[29rem] md:h-[44rem]";

/**
 * Jewish holidays: a soft copper wash on the day (stage-6 is the one pipeline
 * hue no event type uses, so chips stay legible on it) and matching label text.
 */
export const HOLIDAY_WASH_CLASS = "bg-stage-6/[0.07] hover:bg-stage-6/[0.12]";
export const HOLIDAY_TEXT_CLASS = "text-stage-6";

/** Week starts on Monday (UK). */
export const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

export function dateKey(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export function formatTime(d: Date | string) {
  return format(new Date(d), "HH:mm");
}

/** "Today", "Tomorrow", "Yesterday" or "Mon 21 Sep". */
export function relativeDayLabel(d: Date, now = new Date()) {
  const diff = differenceInCalendarDays(d, now);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return format(d, "EEE d MMM");
}

/** The 6-week grid (Mon–Sun) that contains the whole month. */
export function monthGridDays(month: Date) {
  const start = startOfWeek(startOfMonth(month), WEEK_OPTIONS);
  const end = endOfWeek(endOfMonth(month), WEEK_OPTIONS);
  const days: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export function weekDays(anchor: Date) {
  const start = startOfWeek(anchor, WEEK_OPTIONS);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Events bucketed by day key, each bucket sorted by time. */
export function groupEventsByDay(events: CalendarEvent[]) {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = dateKey(new Date(event.eventDate));
    const bucket = map.get(key) ?? [];
    bucket.push(event);
    map.set(key, bucket);
  }
  for (const bucket of map.values()) {
    bucket.sort(
      (a, b) =>
        new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime(),
    );
  }
  return map;
}

export function eventsOn(map: Map<string, CalendarEvent[]>, day: Date) {
  return map.get(dateKey(day)) ?? [];
}

export function isToday(d: Date) {
  return isSameDay(d, new Date());
}

export type HebrewDayInfo = {
  /** "3" or, on the first of a Hebrew month, "1 Tishrei". */
  short: string;
  /** "3 Tishrei 5787" */
  full: string;
  holidays: string[];
};

/**
 * Hebrew date + holiday lookup for every day between `start` and `end`
 * (inclusive), keyed by Gregorian date key.
 */
export function useHebrewCalendar(start: Date, end: Date) {
  const startKey = dateKey(start);
  const endKey = dateKey(end);
  return useMemo(() => {
    const map = new Map<string, HebrewDayInfo>();
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const hd = new HDate(d);
      map.set(dateKey(d), {
        short:
          hd.getDate() === 1
            ? `${hd.getDate()} ${hd.getMonthName()}`
            : String(hd.getDate()),
        full: `${hd.getDate()} ${hd.getMonthName()} ${hd.getFullYear()}`,
        holidays: [],
      });
    }
    const holidays = HebrewCalendar.calendar({
      start,
      end,
      il: false,
      noMinorFast: true,
      noRoshChodesh: true,
      noSpecialShabbat: true,
      noModern: false,
    });
    for (const ev of holidays) {
      map.get(dateKey(ev.getDate().greg()))?.holidays.push(ev.render("en"));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKey, endKey]);
}

/** "Elul 5786" or "Elul – Tishrei 5787" for the span of a visible range. */
export function hebrewRangeLabel(start: Date, end: Date) {
  const a = new HDate(start);
  const b = new HDate(end);
  if (
    a.getMonthName() === b.getMonthName() &&
    a.getFullYear() === b.getFullYear()
  ) {
    return `${a.getMonthName()} ${a.getFullYear()}`;
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${a.getMonthName()} – ${b.getMonthName()} ${a.getFullYear()}`;
  }
  return `${a.getMonthName()} ${a.getFullYear()} – ${b.getMonthName()} ${b.getFullYear()}`;
}
