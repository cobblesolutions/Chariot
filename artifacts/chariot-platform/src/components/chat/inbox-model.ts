import type { InboxThread } from "@workspace/api-client-react";
import {
  Archive,
  AtSign,
  Briefcase,
  Inbox,
  MailOpen,
  Pin,
  UserRound,
  Users,
} from "lucide-react";
import { useSyncExternalStore } from "react";
import { CASE_STAGES } from "@/lib/stages";

/** A saved view of the inbox: what the left rail switches between. */
export type InboxView =
  | "all"
  | "unread"
  | "mentions"
  | "pinned"
  | "cases"
  | "direct"
  | "groups"
  | "archived";

/** How the visible threads are sectioned in the list. */
export type GroupMode = "recent" | "type" | "stage";

export type InboxViewDef = {
  key: InboxView;
  label: string;
  icon: typeof Inbox;
  hint: string;
  /** Rail section the view belongs to. */
  section: "inbox" | "channels" | "manage";
};

export const INBOX_VIEWS: InboxViewDef[] = [
  {
    key: "all",
    label: "All",
    icon: Inbox,
    hint: "Every active thread",
    section: "inbox",
  },
  {
    key: "unread",
    label: "Unread",
    icon: MailOpen,
    hint: "Threads with messages you haven't read",
    section: "inbox",
  },
  {
    key: "mentions",
    label: "Mentions",
    icon: AtSign,
    hint: "Unread messages that @mention you",
    section: "inbox",
  },
  {
    key: "pinned",
    label: "Pinned",
    icon: Pin,
    hint: "Threads you pinned",
    section: "inbox",
  },
  {
    key: "cases",
    label: "Cases",
    icon: Briefcase,
    hint: "Case chats and case-linked conversations",
    section: "channels",
  },
  {
    key: "direct",
    label: "Direct",
    icon: UserRound,
    hint: "One-to-one messages",
    section: "channels",
  },
  {
    key: "groups",
    label: "Groups",
    icon: Users,
    hint: "Group chats",
    section: "channels",
  },
  {
    key: "archived",
    label: "Archived",
    icon: Archive,
    hint: "Threads you archived",
    section: "manage",
  },
];

export const GROUP_MODES: { key: GroupMode; label: string }[] = [
  { key: "recent", label: "Recent activity" },
  { key: "type", label: "Thread type" },
  { key: "stage", label: "Case stage" },
];

export function threadHref(
  thread: Pick<InboxThread, "kind" | "caseId" | "conversationId">,
) {
  return thread.conversationId != null
    ? `/messages/conversation/${thread.conversationId}`
    : `/messages/case/${thread.caseId}`;
}

/** The {kind, id} pair the preference and read endpoints address. */
export function threadRef(
  thread: Pick<InboxThread, "caseId" | "conversationId">,
): { kind: "case" | "conversation"; id: number } {
  return thread.conversationId != null
    ? { kind: "conversation", id: thread.conversationId }
    : { kind: "case", id: thread.caseId! };
}

export function matchesView(thread: InboxThread, view: InboxView) {
  if (view === "archived") return thread.archived;
  if (thread.archived) return false;
  switch (view) {
    case "all":
      return true;
    case "unread":
      return thread.unreadCount > 0;
    case "mentions":
      return thread.mentionsMe;
    case "pinned":
      return thread.pinned;
    case "cases":
      return thread.caseId != null;
    case "direct":
      return thread.kind === "direct";
    case "groups":
      return thread.kind === "group";
  }
}

export type InboxFocus = {
  /** Only threads on cases assigned to the signed-in user. */
  myCases: boolean;
  /** Only threads on cases in these stages (empty = any). */
  stages: string[];
};

export function matchesFocus(
  thread: InboxThread,
  focus: InboxFocus,
  userName: string | undefined,
) {
  if (focus.myCases && thread.case?.assignedTo !== userName) return false;
  if (
    focus.stages.length > 0 &&
    !focus.stages.includes(thread.case?.stage ?? "")
  )
    return false;
  return true;
}

export function viewCounts(threads: InboxThread[]) {
  const counts = Object.fromEntries(
    INBOX_VIEWS.map((view) => [view.key, 0]),
  ) as Record<InboxView, number>;
  for (const thread of threads)
    for (const view of INBOX_VIEWS)
      if (matchesView(thread, view.key)) counts[view.key] += 1;
  return counts;
}

/** Unread that should badge: skips muted and archived threads. */
export function badgeUnread(threads: InboxThread[]) {
  return threads.reduce(
    (sum, thread) =>
      thread.muted || thread.archived ? sum : sum + thread.unreadCount,
    0,
  );
}

export function searchThreads(threads: InboxThread[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return threads;
  return threads.filter((thread) =>
    [
      thread.title,
      thread.subtitle,
      thread.case?.clientName,
      thread.case?.reference,
      thread.case?.assignedTo,
      thread.lastMessage?.body,
      ...thread.participants.map((person) => person.displayName),
    ].some((value) => value?.toLowerCase().includes(q)),
  );
}

export function byActivity(a: InboxThread, b: InboxThread) {
  return (
    new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
  );
}

export type ThreadGroup = {
  key: string;
  label: string;
  threads: InboxThread[];
};

function startOfDay(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function recentBucket(value: string, now: Date) {
  const days = Math.round(
    (startOfDay(now) - startOfDay(new Date(value))) / 86_400_000,
  );
  if (days <= 0) return { key: "today", label: "Today" };
  if (days === 1) return { key: "yesterday", label: "Yesterday" };
  if (days < 7) return { key: "week", label: "This week" };
  if (days < 30) return { key: "month", label: "This month" };
  return { key: "earlier", label: "Earlier" };
}

const RECENT_ORDER = ["today", "yesterday", "week", "month", "earlier"];
const TYPE_ORDER = ["case", "direct", "group"];
const TYPE_LABELS: Record<string, string> = {
  case: "Case chats",
  direct: "Direct messages",
  group: "Group chats",
};

/**
 * Sections the (already filtered) threads. Pinned threads always lead in their
 * own section; the rest fall into recency, type or case-stage buckets.
 */
export function groupThreads(
  threads: InboxThread[],
  mode: GroupMode,
  now = new Date(),
): ThreadGroup[] {
  const sorted = [...threads].sort(byActivity);
  const pinned = sorted.filter((thread) => thread.pinned);
  const rest = sorted.filter((thread) => !thread.pinned);
  const buckets = new Map<string, ThreadGroup>();
  const put = (key: string, label: string, thread: InboxThread) => {
    const group = buckets.get(key) ?? { key, label, threads: [] };
    group.threads.push(thread);
    buckets.set(key, group);
  };

  for (const thread of rest) {
    if (mode === "recent") {
      const bucket = recentBucket(thread.lastActivityAt, now);
      put(bucket.key, bucket.label, thread);
    } else if (mode === "type") {
      put(thread.kind, TYPE_LABELS[thread.kind] ?? thread.kind, thread);
    } else {
      const stage = thread.case?.stage;
      put(
        stage ? `stage-${stage}` : "none",
        stage ?? "Not linked to a case",
        thread,
      );
    }
  }

  const order = (key: string) => {
    if (mode === "recent") return RECENT_ORDER.indexOf(key);
    if (mode === "type") return TYPE_ORDER.indexOf(key);
    if (key === "none") return CASE_STAGES.length;
    return CASE_STAGES.indexOf(
      key.replace("stage-", "") as (typeof CASE_STAGES)[number],
    );
  };
  const groups = [...buckets.values()].sort(
    (a, b) => order(a.key) - order(b.key),
  );
  return pinned.length > 0
    ? [{ key: "pinned", label: "Pinned", threads: pinned }, ...groups]
    : groups;
}

/** Stages present among the case-linked threads, in pipeline order, with thread counts. */
export function stageCounts(threads: InboxThread[]) {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    if (thread.archived || !thread.case) continue;
    counts.set(thread.case.stage, (counts.get(thread.case.stage) ?? 0) + 1);
  }
  return CASE_STAGES.filter((stage) => counts.has(stage)).map((stage) => ({
    stage,
    count: counts.get(stage)!,
  }));
}

/* ---------- UI preferences (persist across route changes and reloads) ---------- */

export type InboxPrefs = {
  view: InboxView;
  groupBy: GroupMode;
  infoOpen: boolean;
  focus: InboxFocus;
  collapsed: string[];
};

const PREFS_KEY = "chariot.inbox.prefs";
const DEFAULT_PREFS: InboxPrefs = {
  view: "all",
  groupBy: "recent",
  infoOpen: true,
  focus: { myCases: false, stages: [] },
  collapsed: [],
};

let prefs: InboxPrefs = load();
const listeners = new Set<() => void>();

function load(): InboxPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<InboxPrefs>;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      focus: { ...DEFAULT_PREFS.focus, ...parsed.focus },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setInboxPrefs(patch: Partial<InboxPrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private mode etc. — the in-memory copy still works for this session
  }
  listeners.forEach((listener) => listener());
}

export function useInboxPrefs() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => prefs,
    () => DEFAULT_PREFS,
  );
}
