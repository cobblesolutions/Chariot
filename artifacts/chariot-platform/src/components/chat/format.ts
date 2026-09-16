const time = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const dayShort = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});
const dayLong = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const dayLongYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long" });

/** Messages further apart than this get a timestamp label between them, like iMessage. */
export const TIMESTAMP_GAP_MS = 15 * 60 * 1000;

function startOfDay(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function daysAgo(date: Date, now = new Date()) {
  return Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
}

/** "12:34" — the time shown inside a bubble. */
export function formatMessageTime(value: string) {
  const date = new Date(value);
  return isNaN(date.getTime()) ? "" : time.format(date);
}

/** Chat-list stamp: time today, weekday this week, "3 Mar" older, with year if not this year. */
export function formatRelativeStamp(value: string, now = new Date()) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return "";
  const ago = daysAgo(date, now);
  if (ago === 0) return time.format(date);
  if (ago === 1) return "Yesterday";
  if (ago < 7) return weekday.format(date);
  if (date.getFullYear() === now.getFullYear()) return dayShort.format(date);
  return dayLongYear.format(date);
}

/** Date separator label: Today / Yesterday / Monday, 3 March / 3 March 2025. */
export function formatDayLabel(value: string, now = new Date()) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return "";
  const ago = daysAgo(date, now);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (date.getFullYear() === now.getFullYear()) return dayLong.format(date);
  return dayLongYear.format(date);
}

/** iMessage-style transcript timestamp: a bold day part ("Today", "Monday", "3 Mar") and the time. */
export function formatTimestampLabel(value: string, now = new Date()) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return { day: "", time: "" };
  const ago = daysAgo(date, now);
  const at = time.format(date);
  if (ago === 0) return { day: "Today", time: at };
  if (ago === 1) return { day: "Yesterday", time: at };
  if (ago < 7) return { day: weekday.format(date), time: at };
  if (date.getFullYear() === now.getFullYear())
    return { day: dayShort.format(date), time: at };
  return { day: dayLongYear.format(date), time: at };
}

export function sameDay(a: string, b: string) {
  const da = new Date(a),
    db = new Date(b);
  return startOfDay(da) === startOfDay(db);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** One of eight hues, chosen deterministically from a name or id, so each person keeps their colour. */
export const AVATAR_COLORS = [
  { bg: "bg-rose-500", text: "text-rose-600" },
  { bg: "bg-orange-500", text: "text-orange-600" },
  { bg: "bg-amber-500", text: "text-amber-600" },
  { bg: "bg-emerald-500", text: "text-emerald-600" },
  { bg: "bg-cyan-500", text: "text-cyan-600" },
  { bg: "bg-blue-500", text: "text-blue-600" },
  { bg: "bg-violet-500", text: "text-violet-600" },
  { bg: "bg-pink-500", text: "text-pink-600" },
] as const;

export function avatarColor(seed: string | number) {
  const text = String(seed);
  let hash = 0;
  for (let i = 0; i < text.length; i++)
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}
