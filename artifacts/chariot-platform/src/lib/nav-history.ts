import { useEffect, useSyncExternalStore } from "react";

/**
 * Where the user has been inside the app, so a "Back to …" button returns to
 * the page they actually came from (a client, the calendar, a task) rather
 * than always to the list page. Browser history is opaque, so we mirror it:
 * every push/replace/pop wouter performs is recorded here, each history entry
 * is tagged with its index via `history.state`, and the stack is kept in
 * sessionStorage so a reload or browser back/forward stays in step.
 */

interface NavEntry {
  /** App path (base stripped) including the query string. */
  path: string;
  /** Page-provided name, e.g. the client's name; see useNavTitle. */
  title?: string;
}

interface NavHistory {
  entries: NavEntry[];
  cursor: number;
}

export interface BackTarget {
  href: string;
  label: string;
}

const STORAGE_KEY = "chariot.nav.history";
const STATE_KEY = "chariotNavIndex";
const base = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Human names for routes; detail pages refine these via useNavTitle. */
const ROUTE_LABELS: [RegExp, string][] = [
  [/^\/dashboard$/, "Dashboard"],
  [/^\/portal$/, "Portal"],
  [/^\/add(\/|$)/, "Add"],
  [/^\/(activity|notifications|activities)$/, "Activity"],
  [/^\/clients$/, "Clients"],
  [/^\/clients\/\d+/, "Client"],
  [/^\/cases$/, "Cases"],
  [/^\/cases\/\d+/, "Case"],
  [/^\/tasks$/, "Tasks"],
  [/^\/lenders$/, "Lenders"],
  [/^\/lenders\/\d+/, "Lender"],
  [/^\/properties$/, "Properties"],
  [/^\/properties\/\d+/, "Property"],
  [/^\/calendar$/, "Calendar"],
  [/^\/messages(\/|$)/, "Messages"],
  [/^\/documents$/, "Documents"],
  [/^\/invoices$/, "Invoices"],
  [/^\/invoices\/\d+/, "Invoice"],
  [/^\/renewals$/, "Renewals"],
  [/^\/settings$/, "Settings"],
  [/^\/change-password$/, "Change Password"],
];

function pathname(path: string) {
  return path.split("?")[0];
}

/** Label for a path, or undefined for pages we never send the user back to (login etc.). */
export function routeLabel(path: string): string | undefined {
  const p = pathname(path);
  return ROUTE_LABELS.find(([re]) => re.test(p))?.[1];
}

function currentPath(): string {
  const { pathname: p, search } = window.location;
  const stripped = p.startsWith(base) ? p.slice(base.length) : p;
  return (stripped || "/") + search;
}

let history: NavHistory = { entries: [], cursor: -1 };
const listeners = new Set<() => void>();
// Set while we re-tag the current entry so wouter's replaceState event is ignored.
let tagging = false;

function load(): NavHistory | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NavHistory;
    return Array.isArray(parsed.entries) && typeof parsed.cursor === "number"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function emit() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Private windows may block storage; the in-memory stack still applies.
  }
  listeners.forEach((l) => l());
}

function stateIndex(): number | undefined {
  const s: unknown = window.history.state;
  if (s && typeof s === "object" && STATE_KEY in s) {
    const idx = (s as Record<string, unknown>)[STATE_KEY];
    if (typeof idx === "number") return idx;
  }
  return undefined;
}

function tag(index: number) {
  if (stateIndex() === index) return;
  const s: unknown = window.history.state;
  const prev = s && typeof s === "object" ? s : {};
  tagging = true;
  try {
    window.history.replaceState({ ...prev, [STATE_KEY]: index }, "");
  } finally {
    tagging = false;
  }
}

function push() {
  const entries = history.entries.slice(0, history.cursor + 1);
  entries.push({ path: currentPath() });
  history = { entries, cursor: entries.length - 1 };
  tag(history.cursor);
  emit();
}

function replace() {
  if (tagging) return;
  const path = currentPath();
  const entries = history.entries.slice();
  const cur = entries[history.cursor];
  entries[history.cursor] = cur?.path === path ? cur : { path };
  history = { ...history, entries };
  tag(history.cursor);
  emit();
}

function pop() {
  const idx = stateIndex();
  const entry = idx === undefined ? undefined : history.entries[idx];
  if (idx === undefined || !entry) {
    // An entry created before we started tracking; adopt it as the newest.
    push();
    return;
  }
  const path = currentPath();
  const entries = history.entries.slice();
  if (entry.path !== path) entries[idx] = { path };
  history = { entries, cursor: idx };
  emit();
}

function init() {
  const stored = load();
  const idx = stateIndex();
  const path = currentPath();
  if (stored && idx !== undefined && stored.entries[idx]?.path === path) {
    history = { entries: stored.entries, cursor: idx };
    return;
  }
  if (stored && idx === undefined) {
    // Typed URL or external link inside an existing session: continue the stack.
    history = stored;
    push();
    return;
  }
  history = { entries: [{ path }], cursor: 0 };
  tag(0);
  emit();
}

let installed = false;

/** Start mirroring wouter's navigation. Idempotent; call once at app start. */
export function installNavHistory() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  init();
  window.addEventListener("pushState", push);
  window.addEventListener("replaceState", replace);
  window.addEventListener("popstate", pop);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return history;
}

/**
 * The page to offer as "Back to …": the nearest earlier page that is not this
 * one and that we are happy to return to, or `fallback` when the user landed
 * here directly. `steps` is how far `history.go` must travel (0 = use href).
 */
export function useBackTarget(
  fallback: BackTarget,
): BackTarget & { steps: number } {
  const h = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const here = h.entries[h.cursor];
  for (let i = h.cursor - 1; i >= 0; i--) {
    const entry = h.entries[i];
    if (here && pathname(entry.path) === pathname(here.path)) continue;
    const label = entry.title ?? routeLabel(entry.path);
    if (label) return { href: entry.path, label, steps: h.cursor - i };
  }
  return { ...fallback, steps: 0 };
}

/**
 * Name a page for back buttons elsewhere ("Back to John Smith" instead of
 * "Back to Client"). `path` is the page's own route; the title is only written
 * while that is the current entry, because a page on its way out can still
 * render once against the next location. Pass undefined until the name is known.
 */
export function useNavTitle(path: string, title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const cur = history.entries[history.cursor];
    if (!cur || pathname(cur.path) !== path || cur.title === title) return;
    const entries = history.entries.slice();
    entries[history.cursor] = { ...cur, title };
    history = { ...history, entries };
    emit();
  }, [path, title]);
}
