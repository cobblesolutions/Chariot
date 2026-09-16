import type {
  Client,
  ClientLifecycle,
  ClientSource,
  InteractionKind,
} from "@workspace/api-client-react";
import {
  CalendarClock,
  ClipboardCheck,
  Inbox,
  Layers,
  Mail,
  MessageSquareText,
  Phone,
  UserRound,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { differenceInCalendarDays, formatDistanceToNowStrict } from "date-fns";
import { LIFECYCLE_LABELS, isClosedLifecycle } from "@/lib/enquiry";
import { formatDate } from "@/lib/utils";

export type { Client };

export type ViewKey =
  | "all"
  | "mine"
  | "enquiries"
  | "onboarding"
  | "active"
  | "followups"
  | "closed";

export const VIEWS: { key: ViewKey; label: string; icon: LucideIcon; hint: string }[] = [
  { key: "all", label: "All clients", icon: Layers, hint: "Everyone on the register" },
  { key: "mine", label: "My clients", icon: UserRound, hint: "Clients you own" },
  { key: "enquiries", label: "Enquiries", icon: Inbox, hint: "Awaiting a decision" },
  { key: "onboarding", label: "Onboarding", icon: ClipboardCheck, hint: "Accepted, advanced info in progress" },
  { key: "active", label: "Active", icon: Users, hint: "Clients with a live case" },
  { key: "followups", label: "Follow-ups", icon: CalendarClock, hint: "Follow-up due today or overdue" },
  { key: "closed", label: "Closed", icon: XCircle, hint: "Declined or lost" },
];

export type SortKey = "activity" | "name" | "added" | "loan" | "followup";

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "activity", label: "Recent activity" },
  { key: "followup", label: "Next follow-up" },
  { key: "name", label: "Name" },
  { key: "added", label: "Recently added" },
  { key: "loan", label: "Loan total" },
];

export type FollowUpTone = "overdue" | "today" | "soon" | "later";

/** How urgent a client's next follow-up is; null when none is set. */
export function followUpTone(client: Pick<Client, "nextFollowUpAt">): FollowUpTone | null {
  if (!client.nextFollowUpAt) return null;
  const days = differenceInCalendarDays(new Date(client.nextFollowUpAt), new Date());
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "soon";
  return "later";
}

export const isFollowUpDue = (client: Pick<Client, "nextFollowUpAt">) => {
  const tone = followUpTone(client);
  return tone === "overdue" || tone === "today";
};

export function matchesView(client: Client, view: ViewKey, userId: number | undefined) {
  switch (view) {
    case "mine":
      return client.assignee?.id === userId;
    case "enquiries":
      return client.lifecycle === "enquiry";
    case "onboarding":
      return client.lifecycle === "onboarding";
    case "active":
      return client.lifecycle === "active";
    case "followups":
      return !isClosedLifecycle(client.lifecycle) && isFollowUpDue(client);
    case "closed":
      return isClosedLifecycle(client.lifecycle);
    default:
      return true;
  }
}

export function matchesSearch(client: Client, needle: string) {
  if (!needle) return true;
  const haystack = [
    client.name,
    client.companyName,
    client.email,
    client.phone,
    client.introducerName ?? "",
    client.enquirySummary ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

const LIFECYCLE_ORDER: Record<ClientLifecycle, number> = {
  enquiry: 0,
  onboarding: 1,
  active: 2,
  declined: 3,
  lost: 4,
};

/** Most recent of activity, logged contact and creation — what "recent" means on the list. */
export const lastTouch = (client: Client) =>
  [client.lastActivityAt, client.lastContactedAt, client.createdAt]
    .filter((value): value is string => !!value)
    .sort()
    .at(-1) ?? client.createdAt;

export function compareClients(a: Client, b: Client, sort: SortKey) {
  switch (sort) {
    case "name":
      return a.name.localeCompare(b.name);
    case "added":
      return b.createdAt.localeCompare(a.createdAt);
    case "loan":
      return b.loanTotal - a.loanTotal || a.name.localeCompare(b.name);
    case "followup": {
      const fa = a.nextFollowUpAt ?? "9999";
      const fb = b.nextFollowUpAt ?? "9999";
      return fa.localeCompare(fb) || a.name.localeCompare(b.name);
    }
    default:
      return lastTouch(b).localeCompare(lastTouch(a));
  }
}

export const lifecycleOrder = (a: Client, b: Client) =>
  LIFECYCLE_ORDER[a.lifecycle] - LIFECYCLE_ORDER[b.lifecycle];

export const lifecycleLabel = (lifecycle: ClientLifecycle) => LIFECYCLE_LABELS[lifecycle];

export const lifecycleBadgeVariant = (lifecycle: ClientLifecycle) =>
  isClosedLifecycle(lifecycle) ? "destructive" : lifecycle === "active" ? "default" : "outline";

export const INTERACTION_KINDS: { value: InteractionKind; label: string; icon: LucideIcon }[] = [
  { value: "call", label: "Call", icon: Phone },
  { value: "email", label: "Email", icon: Mail },
  { value: "meeting", label: "Meeting", icon: Users },
  { value: "note", label: "Note", icon: MessageSquareText },
];

export const interactionIcon = (kind: InteractionKind | null | undefined) =>
  INTERACTION_KINDS.find((item) => item.value === kind)?.icon ?? MessageSquareText;

/** "3 days ago" style label; empty string for missing dates. */
export function relativeTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "";
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

/** Whole-day distance for follow-up chips: "today", "in 3 days", "2 days overdue". */
export function followUpLabel(value: string | null | undefined) {
  if (!value) return "";
  const days = differenceInCalendarDays(new Date(value), new Date());
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${-days} days overdue`;
  if (days <= 14) return `In ${days} days`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(value));
}

export const SOURCE_FILTER_OPTIONS: ReadonlyArray<{ value: ClientSource | "none"; label: string }> = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone call" },
  { value: "website", label: "Website" },
  { value: "referral", label: "Referral" },
  { value: "introducer", label: "Introducer" },
  { value: "existing_client", label: "Existing client" },
  { value: "other", label: "Other" },
  { value: "none", label: "Not recorded" },
];

const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

/** Download the given clients as a CSV — the columns a broker would paste into a spreadsheet. */
export function exportClientsCsv(clients: Client[], filename = "clients.csv") {
  const rows = [
    ["Name", "Company", "Email", "Phone", "Stage", "Owner", "Source", "Introducer", "Open cases", "Loan total (£)", "Last contact", "Next follow-up", "Added"],
    ...clients.map((client) => [
      client.name,
      client.companyName,
      client.email,
      client.phone,
      LIFECYCLE_LABELS[client.lifecycle],
      client.assignee?.displayName ?? "",
      client.source ?? "",
      client.introducerName ?? "",
      client.openCases,
      client.loanTotal,
      client.lastContactedAt ? formatDate(client.lastContactedAt) : "",
      client.nextFollowUpAt ? formatDate(client.nextFollowUpAt) : "",
      formatDate(client.createdAt),
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
