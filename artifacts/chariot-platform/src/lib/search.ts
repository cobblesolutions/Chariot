import type {
  GlobalSearchResults,
  GlobalSearchType,
} from "@workspace/api-client-react";
import {
  Activity,
  Briefcase,
  Building2,
  Calendar,
  CheckSquare,
  FileText,
  Home,
  MessagesSquare,
  Receipt,
  RefreshCw,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Display metadata for the record types `GET /search` returns, in the order
 * the API groups them. `tile` mirrors the sidebar's colour language so a hit
 * is recognisable by its icon square before its label is read.
 */
export interface SearchTypeMeta {
  type: GlobalSearchType;
  label: string;
  plural: string;
  icon: LucideIcon;
  tile: string;
}

export const SEARCH_TYPES: SearchTypeMeta[] = [
  {
    type: "case",
    label: "Case",
    plural: "Cases",
    icon: Briefcase,
    tile: "border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  {
    type: "client",
    label: "Client",
    plural: "Clients",
    icon: Users,
    tile: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  {
    type: "property",
    label: "Property",
    plural: "Properties",
    icon: Home,
    tile: "border-teal-500/20 bg-teal-500/10 text-teal-600 dark:text-teal-400",
  },
  {
    type: "task",
    label: "Task",
    plural: "Tasks",
    icon: CheckSquare,
    tile: "border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  {
    type: "message",
    label: "Message",
    plural: "Messages",
    icon: MessagesSquare,
    tile: "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  {
    type: "event",
    label: "Event",
    plural: "Calendar",
    icon: Calendar,
    tile: "border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  {
    type: "lender",
    label: "Lender",
    plural: "Lenders",
    icon: Building2,
    tile: "border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  },
  {
    type: "user",
    label: "Staff",
    plural: "Staff",
    icon: UserRound,
    tile: "border-pink-500/20 bg-pink-500/10 text-pink-600 dark:text-pink-400",
  },
  {
    type: "notification",
    label: "Activity",
    plural: "Activity",
    icon: Activity,
    tile: "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
  {
    type: "document",
    label: "Document",
    plural: "Documents",
    icon: FileText,
    tile: "border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-400",
  },
  {
    type: "invoice",
    label: "Invoice",
    plural: "Invoices",
    icon: Receipt,
    tile: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  {
    type: "renewal",
    label: "Renewal",
    plural: "Renewals",
    icon: RefreshCw,
    tile: "border-purple-500/20 bg-purple-500/10 text-purple-600 dark:text-purple-400",
  },
];

const META_BY_TYPE = new Map(SEARCH_TYPES.map((meta) => [meta.type, meta]));

export function searchTypeMeta(type: GlobalSearchType): SearchTypeMeta {
  return META_BY_TYPE.get(type) ?? SEARCH_TYPES[0];
}

export const ALL_SEARCH_TYPES: GlobalSearchType[] = SEARCH_TYPES.map(
  (meta) => meta.type,
);

/** The API needs at least two characters; shorter input shows hints instead. */
export const MIN_QUERY_LENGTH = 2;

export function isSearchType(value: string): value is GlobalSearchType {
  return META_BY_TYPE.has(value as GlobalSearchType);
}

/** Parse `?types=case,client` into known types; an empty list means "all". */
export function parseSearchTypes(raw: string | null): GlobalSearchType[] {
  if (!raw) return [];
  return raw.split(",").filter(isSearchType);
}

/** `/search?q=…&types=…` for the full results page. */
export function searchPageHref(query: string, types: GlobalSearchType[] = []) {
  const params = new URLSearchParams();
  params.set("q", query);
  if (types.length && types.length < ALL_SEARCH_TYPES.length) {
    params.set("types", types.join(","));
  }
  return `/search?${params.toString()}`;
}

/** Sum of group totals for a subset of types (all when `types` is empty). */
export function countResults(
  results: GlobalSearchResults | undefined,
  types: GlobalSearchType[] = [],
) {
  if (!results) return 0;
  const wanted = types.length ? new Set(types) : null;
  return results.groups
    .filter((group) => !wanted || wanted.has(group.type))
    .reduce((sum, group) => sum + group.total, 0);
}

/* ---------------------------------------------------------------------------
 * Recent searches — a per-browser convenience, so localStorage is the right
 * home; every access is guarded because storage can be unavailable.
 * ------------------------------------------------------------------------ */

const RECENT_KEY = "chariot.search.recent";
const RECENT_LIMIT = 8;

export function readRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function rememberSearch(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return readRecentSearches();
  const next = [
    trimmed,
    ...readRecentSearches().filter(
      (item) => item.toLowerCase() !== trimmed.toLowerCase(),
    ),
  ].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function clearRecentSearches() {
  try {
    window.localStorage.removeItem(RECENT_KEY);
  } catch {
    /* ignore */
  }
}
