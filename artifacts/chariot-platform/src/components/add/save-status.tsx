import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutosaveStatus } from "./use-autosave";

/** Quiet inline autosave indicator: Saving… / Saved / Unsaved changes / error. */
export function SaveStatus({
  status,
  error,
  className,
}: {
  status: AutosaveStatus;
  error?: string | null;
  className?: string;
}) {
  if (status === "idle") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        status === "error" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
      role="status"
    >
      {status === "saving" ? (
        <>
          <Loader2 className="size-3 animate-spin" /> Saving…
        </>
      ) : status === "saved" ? (
        <>
          <Check className="size-3 text-emerald-600" /> Saved
        </>
      ) : status === "dirty" ? (
        "Unsaved changes"
      ) : (
        error ?? "Couldn't save"
      )}
    </span>
  );
}
