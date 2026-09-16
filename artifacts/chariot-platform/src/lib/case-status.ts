export type StatusTone = "active" | "pending" | "done" | "archived" | "neutral";

export interface StatusStyle {
  label: string;
  tone: StatusTone;
  /** Pastel pill classes (background + text). */
  className: string;
  /** Solid dot in the tone colour. */
  dotClassName: string;
}

// Full literal class strings so Tailwind's scanner picks them up.
const TONE_CLASSES: Record<StatusTone, { badge: string; dot: string }> = {
  active: { badge: "bg-green-50 text-green-700", dot: "bg-green-500" },
  pending: { badge: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  done: { badge: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  archived: { badge: "bg-stone-100 text-stone-600", dot: "bg-stone-400" },
  neutral: { badge: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
};

function style(label: string, tone: StatusTone): StatusStyle {
  return {
    label,
    tone,
    className: TONE_CLASSES[tone].badge,
    dotClassName: TONE_CLASSES[tone].dot,
  };
}

const CASE_STATUS_STYLES: Record<string, StatusStyle> = {
  active: style("Active", "active"),
  awaiting_client: style("Awaiting client", "pending"),
  completed: style("Completed", "done"),
};

/** Label + colours for a case status; archived wins over the stored status. */
export function caseStatusStyle(
  status: string | null | undefined,
  archivedAt?: Date | string | null,
): StatusStyle {
  if (archivedAt) return style("Archived", "archived");
  const known = status ? CASE_STATUS_STYLES[status] : undefined;
  if (known) return known;
  const label = status ? status.replace(/_/g, " ") : "Unknown";
  return style(label.charAt(0).toUpperCase() + label.slice(1), "neutral");
}
