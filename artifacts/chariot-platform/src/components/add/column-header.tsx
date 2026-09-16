import type { ReactNode } from "react";

export type ColumnStatus = "empty" | "draft" | "saved";

const STATUS_LABEL: Record<ColumnStatus, string> = {
  empty: "",
  draft: "Unsaved",
  saved: "Saved",
};

/** Quiet heading shared by the three Add columns. */
export function ColumnHeader({
  title,
  description,
  status,
  action,
  needs,
}: {
  title: string;
  description?: ReactNode;
  status: ColumnStatus;
  action?: ReactNode;
  /** What this column still needs before the case can proceed; empty = complete. */
  needs?: string[];
}) {
  return (
    <div className="space-y-1 border-b pb-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {STATUS_LABEL[status] ? (
            <span className="text-xs text-muted-foreground">
              {STATUS_LABEL[status]}
            </span>
          ) : null}
          {action}
        </div>
      </div>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
      {needs ? (
        needs.length === 0 ? (
          <p className="text-xs font-medium text-emerald-600">Complete</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Still needed:</span>{" "}
            {needs.join(" · ")}
          </p>
        )
      ) : null}
    </div>
  );
}
