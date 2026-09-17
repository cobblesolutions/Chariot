import type { ReactNode } from "react";
import { FieldGroup } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * Widths on a card's field grid: one column by default, and these to span
 * more. A card has as many field columns as it is wide (see `cols`), so
 * `half` is two of a full card's four, or all of a two-wide card.
 */
export const span = {
  half: "sm:col-span-2",
  full: "col-span-full",
} as const;

/** Count of non-empty values, for the "3/5" badge in a section header. */
export function countFilled(values: Array<string | boolean | null | undefined>) {
  return values.filter((value) =>
    typeof value === "boolean" ? value : !!value && value.trim() !== "",
  ).length;
}

/** Card width in grid columns → the card's own span and its field columns. */
const CARD_COLS = {
  1: { card: "sm:col-span-1", fields: "xl:grid-cols-1" },
  2: { card: "sm:col-span-2", fields: "xl:grid-cols-2" },
  3: { card: "sm:col-span-2 xl:col-span-3", fields: "xl:grid-cols-3" },
  4: { card: "sm:col-span-2 xl:col-span-4", fields: "xl:grid-cols-4" },
} as const;

/**
 * The cards of one form on a four-column grid (two below `xl`), in the
 * order they are filled in. Each card says how many columns it takes, so
 * small cards sit beside each other and big ones run the full width.
 */
export function FormSections({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export function FormSection({
  id,
  title,
  filled,
  total,
  hint,
  wide,
  cols = 4,
  stretch,
  children,
}: {
  id: string;
  title: string;
  filled?: number;
  total?: number;
  hint?: string;
  /** A list or panel rather than fields: the body is left as one block. */
  wide?: boolean;
  /** How many of the four grid columns the card takes; it gets that many field columns. */
  cols?: 1 | 2 | 3 | 4;
  /** Let the fields (a lone textarea, say) grow to fill the card when a taller neighbour sets the row height. */
  stretch?: boolean;
  children: ReactNode;
}) {
  const tracked = total != null && filled != null;
  const complete = tracked && filled >= total;
  return (
    <section
      id={id}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border",
        CARD_COLS[cols].card,
        // Tinted by completeness: green once everything is in, orange while
        // something is missing. Sections with nothing to count stay plain.
        !tracked && "bg-card",
        tracked && complete && "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/25",
        tracked && !complete && "border-orange-200 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/20",
      )}
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-inherit px-4 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {tracked ? (
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              complete ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400",
            )}
          >
            {complete ? "Complete" : `${filled}/${total}`}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        <FieldGroup
          className={cn(
            "flex-1 gap-3",
            // Controls are transparent by default; keep them white on the tinted card.
            "[&_[data-slot=input]]:bg-background [&_[data-slot=textarea]]:bg-background [&_[data-slot=select-trigger]]:bg-background [&_[data-slot=input-group]]:bg-background [&_[data-slot=combobox-trigger]]:bg-background [&_[data-slot=popover-trigger]]:bg-background",
            // Fields sit on the grid; each one says how many columns it takes (see `span`).
            !wide && "grid gap-x-4 sm:grid-cols-2 *:min-w-0",
            !wide && CARD_COLS[cols].fields,
            // Rows stay tight unless the card is asked to fill its height.
            !wide && (stretch ? "content-stretch [&_[data-slot=textarea]]:flex-1" : "content-start"),
          )}
        >
          {children}
        </FieldGroup>
      </div>
    </section>
  );
}
