import type { ReactNode } from "react";
import { FieldGroup } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/** Count of non-empty values, for the "3/5" badge in a section header. */
export function countFilled(values: Array<string | boolean | null | undefined>) {
  return values.filter((value) =>
    typeof value === "boolean" ? value : !!value && value.trim() !== "",
  ).length;
}

/**
 * The cards of one form, stacked top to bottom in the order they are filled
 * in. Each card lays its fields out on a grid across the page.
 */
export function FormSections({ children }: { children: ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}

export function FormSection({
  id,
  title,
  filled,
  total,
  hint,
  wide,
  children,
}: {
  id: string;
  title: string;
  filled?: number;
  total?: number;
  hint?: string;
  /** A list or panel rather than fields: the body is left as one block. */
  wide?: boolean;
  children: ReactNode;
}) {
  const tracked = total != null && filled != null;
  const complete = tracked && filled >= total;
  return (
    <section
      id={id}
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border",
        // Tinted by completeness: green once everything is in, orange while
        // something is missing. Sections with nothing to count stay plain.
        !tracked && "bg-card",
        tracked && complete && "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/25",
        tracked && !complete && "border-orange-200 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/20",
      )}
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-inherit px-4 py-2.5 md:px-5">
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
      <div className="space-y-3 p-4 md:p-5">
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
        <FieldGroup
          className={cn(
            "gap-3",
            // Controls are transparent by default; keep them white on the tinted card.
            "[&_[data-slot=input]]:bg-background [&_[data-slot=textarea]]:bg-background [&_[data-slot=select-trigger]]:bg-background [&_[data-slot=input-group]]:bg-background [&_[data-slot=combobox-trigger]]:bg-background [&_[data-slot=popover-trigger]]:bg-background",
            // Fields flow across the row; anything with a textarea takes the full width.
            !wide && "grid sm:grid-cols-2 xl:grid-cols-3 gap-x-6 *:min-w-0 *:has-[textarea]:col-span-full",
          )}
        >
          {children}
        </FieldGroup>
      </div>
    </section>
  );
}
