import type { ActivityListItem } from "@workspace/api-client-react";
import {
  Archive,
  ArchiveRestore,
  BadgeCheck,
  Banknote,
  Bell,
  Briefcase,
  CalendarClock,
  CircleCheckBig,
  ClipboardList,
  FileSignature,
  FileText,
  Gauge,
  Hash,
  Home,
  Inbox,
  Milestone,
  Receipt,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Activities are stored as free-text title/detail rows with no type column, so the
 * activity page derives a kind from the title the API routes write.
 * Every kind belongs to a coarser group used for the filter chips.
 */
export type NotificationGroup =
  "cases" | "underwriting" | "clients" | "properties" | "documents" | "billing";

export type NotificationTone =
  | "blue"
  | "violet"
  | "emerald"
  | "slate"
  | "amber"
  | "teal"
  | "orange"
  | "indigo"
  | "pink"
  | "purple"
  | "rose"
  | "neutral";

export interface NotificationKind {
  group: NotificationGroup;
  label: string;
  icon: LucideIcon;
  tone: NotificationTone;
}

const FALLBACK: NotificationKind = {
  group: "cases",
  label: "Update",
  icon: Bell,
  tone: "neutral",
};

/** Ordered: the first matcher that hits wins, so specific titles come before generic ones. */
const MATCHERS: Array<[RegExp, NotificationKind]> = [
  [
    /^case completed/i,
    {
      group: "cases",
      label: "Completed",
      icon: CircleCheckBig,
      tone: "emerald",
    },
  ],
  [
    /^case archived/i,
    { group: "cases", label: "Archived", icon: Archive, tone: "slate" },
  ],
  [
    /^case restored/i,
    { group: "cases", label: "Restored", icon: ArchiveRestore, tone: "amber" },
  ],
  [
    /^case number/i,
    { group: "cases", label: "Reference", icon: Hash, tone: "blue" },
  ],
  [
    /^stage completed/i,
    { group: "cases", label: "Stage", icon: Milestone, tone: "violet" },
  ],
  [/^case/i, { group: "cases", label: "Case", icon: Briefcase, tone: "blue" }],
  [
    /^stress test/i,
    { group: "underwriting", label: "Stress test", icon: Gauge, tone: "rose" },
  ],
  [
    /^lender offer/i,
    {
      group: "underwriting",
      label: "Lender offer",
      icon: ShieldCheck,
      tone: "purple",
    },
  ],
  [
    /^(requirement|underwriting)/i,
    {
      group: "underwriting",
      label: "Underwriting",
      icon: ClipboardList,
      tone: "purple",
    },
  ],
  [
    /^(service level confirmed|advice (sent|re-sent)|client approved advice|details (sent|re-sent) for confirmation|client confirmed details|details prefilled)/i,
    { group: "cases", label: "Advice", icon: BadgeCheck, tone: "violet" },
  ],
  [
    /^(client asked to discuss|client flagged|advanced without client confirmation)/i,
    { group: "cases", label: "Client", icon: Bell, tone: "amber" },
  ],
  [
    /^enquiry (accepted|reopened)/i,
    { group: "clients", label: "Accepted", icon: CircleCheckBig, tone: "emerald" },
  ],
  [
    /^(enquiry declined|client lost)/i,
    { group: "clients", label: "Closed", icon: Archive, tone: "slate" },
  ],
  [
    /^(repeat )?enquiry/i,
    { group: "clients", label: "Enquiry", icon: Inbox, tone: "teal" },
  ],
  [
    /^welcome email/i,
    { group: "clients", label: "Welcome", icon: Users, tone: "teal" },
  ],
  [
    /^terms of business/i,
    { group: "clients", label: "Terms", icon: FileSignature, tone: "teal" },
  ],
  [
    /^onboarding complete/i,
    { group: "clients", label: "Onboarded", icon: CircleCheckBig, tone: "emerald" },
  ],
  [
    /^client/i,
    { group: "clients", label: "Client", icon: Users, tone: "teal" },
  ],
  [
    /^propert/i,
    { group: "properties", label: "Property", icon: Home, tone: "orange" },
  ],
  [
    /^document/i,
    { group: "documents", label: "Document", icon: FileText, tone: "indigo" },
  ],
  [
    /^invoice/i,
    { group: "billing", label: "Invoice", icon: Receipt, tone: "pink" },
  ],
  [
    /^renewal/i,
    { group: "billing", label: "Renewal", icon: CalendarClock, tone: "amber" },
  ],
  [
    /^(payment|application fee)/i,
    { group: "billing", label: "Payment", icon: Banknote, tone: "emerald" },
  ],
];

export function classifyNotification(title: string): NotificationKind {
  return MATCHERS.find(([re]) => re.test(title))?.[1] ?? FALLBACK;
}

export const NOTIFICATION_GROUPS: Array<{
  value: NotificationGroup;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "cases", label: "Cases", icon: Briefcase },
  { value: "underwriting", label: "Underwriting", icon: ClipboardList },
  { value: "clients", label: "Clients", icon: Users },
  { value: "properties", label: "Properties", icon: Home },
  { value: "documents", label: "Documents", icon: FileText },
  { value: "billing", label: "Billing", icon: Receipt },
];

const GROUP_HREF: Record<NotificationGroup, string> = {
  cases: "/cases",
  underwriting: "/cases",
  clients: "/clients",
  properties: "/properties",
  documents: "/documents",
  billing: "/invoices",
};

const ENTITY_HREF: Record<
  NonNullable<ActivityListItem["entityType"]>,
  (id: number) => string
> = {
  client: (id) => `/clients/${id}`,
  property: (id) => `/properties/${id}`,
  invoice: (id) => `/invoices/${id}`,
  renewal: () => "/renewals",
  document: () => "/documents",
};

/**
 * Where clicking an activity takes you: the record it is about when the API
 * knows it, else the case, else the section it belongs to.
 */
export function notificationHref(
  act: Pick<ActivityListItem, "title" | "caseId" | "entityType" | "entityId">,
): string {
  if (act.entityType && act.entityId) {
    return ENTITY_HREF[act.entityType](act.entityId);
  }
  if (act.caseId) return `/cases/${act.caseId}`;
  const kind = classifyNotification(act.title);
  if (kind.label === "Renewal") return "/renewals";
  return GROUP_HREF[kind.group];
}

/**
 * Tailwind classes per tone, mirroring `stageClasses` in `stages.ts`. Full literal
 * strings so the scanner picks them up. `tile` styles the ItemMedia icon square,
 * `chip` the kind badge, `accent` the left-edge bar on the row.
 */
export const TONE_CLASSES: Record<
  NotificationTone,
  { tile: string; chip: string; accent: string }
> = {
  blue: {
    tile: "border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    chip: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    accent: "border-l-blue-500",
  },
  violet: {
    tile: "border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400",
    chip: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    accent: "border-l-violet-500",
  },
  emerald: {
    tile: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    accent: "border-l-emerald-500",
  },
  slate: {
    tile: "border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-400",
    chip: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    accent: "border-l-slate-500",
  },
  amber: {
    tile: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    accent: "border-l-amber-500",
  },
  teal: {
    tile: "border-teal-500/20 bg-teal-500/10 text-teal-600 dark:text-teal-400",
    chip: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
    accent: "border-l-teal-500",
  },
  orange: {
    tile: "border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400",
    chip: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    accent: "border-l-orange-500",
  },
  indigo: {
    tile: "border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    chip: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    accent: "border-l-indigo-500",
  },
  pink: {
    tile: "border-pink-500/20 bg-pink-500/10 text-pink-600 dark:text-pink-400",
    chip: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300",
    accent: "border-l-pink-500",
  },
  purple: {
    tile: "border-purple-500/20 bg-purple-500/10 text-purple-600 dark:text-purple-400",
    chip: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300",
    accent: "border-l-purple-500",
  },
  rose: {
    tile: "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    chip: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    accent: "border-l-rose-500",
  },
  neutral: {
    tile: "border-border bg-muted text-muted-foreground",
    chip: "border-border bg-muted text-muted-foreground",
    accent: "border-l-border",
  },
};
