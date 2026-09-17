import type { ComponentProps, ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useAiProgress, type AiReadKind } from "@/lib/ai-progress";

/**
 * The button that starts an AI read. While the read runs it turns into a
 * progress button: spinner plus a line that follows what the model is doing
 * (server progress when available, a sensible sequence otherwise).
 */
export function AiProgressButton({
  busy,
  kind,
  token,
  children,
  className,
  disabled,
  ...props
}: ComponentProps<typeof Button> & {
  busy: boolean;
  kind: AiReadKind;
  /** The x-ai-progress token sent with the request, so the button can follow it. */
  token?: string | null;
  children: ReactNode;
}) {
  const message = useAiProgress({ active: busy, kind, token });
  return (
    <Button
      {...props}
      disabled={disabled || busy}
      aria-live="polite"
      aria-busy={busy || undefined}
      className={cn("transition-[min-width] duration-300", busy && "min-w-56 justify-start", className)}
    >
      {busy ? (
        <>
          <Spinner />
          <span key={message} className="animate-in fade-in truncate duration-300">{message}</span>
        </>
      ) : (
        <>
          <Sparkles />
          {children}
        </>
      )}
    </Button>
  );
}

/** Inline (non-button) version, for a file that is being read in the background. */
export function AiProgressLine({
  active,
  kind,
  serverMessage,
  className,
}: {
  active: boolean;
  kind: AiReadKind;
  serverMessage?: string | null;
  className?: string;
}) {
  const message = useAiProgress({ active, kind, serverMessage });
  if (!active) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} aria-live="polite">
      <Spinner className="size-3" />
      <span key={message} className="animate-in fade-in duration-300">{message}</span>
    </span>
  );
}
