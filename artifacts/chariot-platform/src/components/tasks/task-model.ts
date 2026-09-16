import {
  addDays,
  differenceInCalendarDays,
  format,
  isValid,
  nextDay,
  parse,
  startOfDay,
  type Day,
} from "date-fns";
import type {
  Task,
  TaskPriority,
  TaskStatus,
} from "@workspace/api-client-react";

export type { Task, TaskPriority, TaskStatus };

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

export const TASK_PRIORITIES: {
  value: TaskPriority;
  label: string;
  /** Colour of the priority flag; `null` means the flag is hidden (nothing to call out). */
  className: string | null;
}[] = [
  {
    value: "urgent",
    label: "Urgent",
    className: "text-red-600 dark:text-red-400",
  },
  {
    value: "high",
    label: "High",
    className: "text-amber-600 dark:text-amber-400",
  },
  { value: "normal", label: "Normal", className: null },
  { value: "low", label: "Low", className: "text-muted-foreground" },
];

/** Soft wash per status — kanban column backgrounds and list rows share it. */
export const STATUS_TINT: Record<TaskStatus, string> = {
  todo: "bg-orange-500/4 dark:bg-orange-400/6",
  in_progress: "bg-sky-500/7 dark:bg-sky-400/10",
  done: "bg-emerald-500/7 dark:bg-emerald-400/10",
};

export const priorityRank: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export const statusLabel = (status: TaskStatus) =>
  TASK_STATUSES.find((s) => s.value === status)?.label ?? status;
export const priorityLabel = (priority: TaskPriority) =>
  TASK_PRIORITIES.find((p) => p.value === priority)?.label ?? priority;
export const priorityClass = (priority: TaskPriority) =>
  TASK_PRIORITIES.find((p) => p.value === priority)?.className ?? null;

export const isOpen = (task: Pick<Task, "status">) => task.status !== "done";

/** "yyyy-MM-dd" of a task's due date (the API returns an ISO timestamp at UTC midnight). */
export const dueKey = (task: Pick<Task, "dueDate">) =>
  String(task.dueDate).slice(0, 10);

export const todayKey = () => format(new Date(), "yyyy-MM-dd");

const parseKey = (key: string) => parse(key, "yyyy-MM-dd", new Date());

/** Whole days from today to the due date: negative when overdue. */
export const daysUntilDue = (task: Pick<Task, "dueDate">) =>
  differenceInCalendarDays(parseKey(dueKey(task)), startOfDay(new Date()));

export const isOverdue = (task: Pick<Task, "dueDate" | "status">) =>
  isOpen(task) && daysUntilDue(task) < 0;

export type DueBucket = "overdue" | "today" | "tomorrow" | "week" | "later";

export const DUE_BUCKETS: { key: DueBucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
];

export function dueBucket(task: Pick<Task, "dueDate">): DueBucket {
  const days = daysUntilDue(task);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return "week";
  return "later";
}

/** Short human due label: "Today", "Tomorrow", "3 days overdue", "Mon 21 Sep". */
export function formatDue(task: Pick<Task, "dueDate">): string {
  const days = daysUntilDue(task);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${-days} days overdue`;
  const date = parseKey(dueKey(task));
  return days < 7 ? format(date, "EEEE") : format(date, "EEE d MMM");
}

export function formatDateKey(key: string): string {
  const date = parseKey(key);
  return isValid(date) ? format(date, "EEE d MMM yyyy") : key;
}

export function formatRelative(iso: string | Date): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return format(date, "d MMM yyyy");
}

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (
      (parts[0]?.charAt(0) ?? "") +
      (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "")
    ).toUpperCase() || "?"
  );
}

/* ------------------------------------------------------------------ */
/* Quick-add parsing                                                   */
/* ------------------------------------------------------------------ */

export interface QuickAddDraft {
  title: string;
  priority: TaskPriority | null;
  dueDate: string | null;
  /** Name fragment after "@", matched against staff by the caller. */
  assigneeQuery: string | null;
}

const WEEKDAYS: Record<string, Day> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

/**
 * Pull inline tokens out of a quick-add line so a task can be created from a
 * single keystroke flow: `!urgent`, `@name`, and natural dates such as
 * "today", "tomorrow", "next week", "friday", "in 3 days" or "2026-10-01".
 */
export function parseQuickAdd(input: string): QuickAddDraft {
  let text = ` ${input} `;
  let priority: TaskPriority | null = null;
  let dueDate: string | null = null;
  let assigneeQuery: string | null = null;
  const today = startOfDay(new Date());
  const key = (date: Date) => format(date, "yyyy-MM-dd");

  text = text.replace(/\s!(urgent|high|normal|low)\b/i, (_, p: string) => {
    priority = p.toLowerCase() as TaskPriority;
    return " ";
  });
  text = text.replace(/\s@([a-z][a-z.'-]*)/i, (_, name: string) => {
    assigneeQuery = name;
    return " ";
  });
  text = text.replace(/\s(\d{4}-\d{2}-\d{2})\b/, (_, iso: string) => {
    const date = parse(iso, "yyyy-MM-dd", new Date());
    if (isValid(date)) dueDate = iso;
    return " ";
  });
  if (!dueDate) {
    text = text.replace(
      /\s(today|tomorrow|next week)\b/i,
      (_, word: string) => {
        const w = word.toLowerCase();
        dueDate = key(
          w === "today"
            ? today
            : w === "tomorrow"
              ? addDays(today, 1)
              : addDays(today, 7),
        );
        return " ";
      },
    );
  }
  if (!dueDate) {
    text = text.replace(
      /\sin (\d{1,3}) (day|days|week|weeks)\b/i,
      (_, n: string, unit: string) => {
        const count =
          Number(n) * (unit.toLowerCase().startsWith("week") ? 7 : 1);
        dueDate = key(addDays(today, count));
        return " ";
      },
    );
  }
  if (!dueDate) {
    text = text.replace(
      /\s(?:on |next |by )?(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b/i,
      (_, day: string) => {
        dueDate = key(nextDay(today, WEEKDAYS[day.toLowerCase()]!));
        return " ";
      },
    );
  }
  return {
    title: text.replace(/\s+/g, " ").trim(),
    priority,
    dueDate,
    assigneeQuery,
  };
}
