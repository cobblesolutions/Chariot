import type { ReactNode } from "react";
import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Plain list of selectable records, separated by hairlines. */
export function RecordCardList({ children }: { children: ReactNode }) {
  return <div className="divide-y border-y">{children}</div>;
}

/** One existing record (a property or a case). Click to load it into the form. */
export function RecordCard({
  selected,
  onSelect,
  title,
  subtitle,
  badges,
  meta,
  completeness,
}: {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  completeness?: { filled: number; total: number };
}) {
  const complete =
    completeness != null && completeness.filled >= completeness.total;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 px-2 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50",
        selected && "bg-muted/60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{title}</p>
          {badges}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {[subtitle, meta].filter(Boolean).map((part, index) => (
            <span key={index}>
              {index > 0 ? " · " : ""}
              {part}
            </span>
          ))}
          {completeness ? (
            <span className={cn(complete && "text-emerald-600")}>
              {" "}
              · {completeness.filled}/{completeness.total} details
            </span>
          ) : null}
        </p>
      </div>
      <Check
        className={cn(
          "mt-0.5 size-4 shrink-0 text-primary transition-opacity",
          selected ? "opacity-100" : "opacity-0",
        )}
      />
    </button>
  );
}

/** Quiet "start a new one" row at the end of the list. */
export function AddNewCard({
  label,
  onClick,
  disabled,
  hint,
  selected,
  icon: Icon = Plus,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
  selected?: boolean;
  icon?: typeof Plus;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-2 px-2 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60",
        selected && "bg-muted/60 text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1">{label}</span>
      {disabled && hint ? <span className="text-xs">{hint}</span> : null}
    </button>
  );
}
