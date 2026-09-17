import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { UploadProgress as UploadProgressState } from "@/lib/upload";

/**
 * The quick progress line shown under any file picker while an upload is in
 * flight: file name (with "2 of 5" for batches), percent sent, and the bar.
 */
export function UploadProgress({
  progress,
  className,
}: {
  progress: UploadProgressState | null;
  className?: string;
}) {
  if (!progress) return null;
  const batch = progress.count > 1 ? `${progress.index + 1} of ${progress.count} · ` : "";
  return (
    <div
      className={cn("space-y-1", className)}
      role="status"
      aria-live="polite"
      data-testid="upload-progress"
    >
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {batch}
          {progress.fileName}
        </span>
        <span className="shrink-0 tabular-nums">
          {progress.percent >= 100 ? "Processing…" : `${progress.percent}%`}
        </span>
      </div>
      <Progress value={progress.percent} className="h-1" />
    </div>
  );
}
