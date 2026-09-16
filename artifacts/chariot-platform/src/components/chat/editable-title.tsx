import * as React from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * A title that turns into an input when clicked. Enter or blur saves, Escape
 * cancels; an unchanged or empty value is not submitted.
 */
export function EditableTitle({
  value,
  onSave,
  className,
  inputClassName,
  label = "Rename",
  maxLength = 80,
}: {
  value: string;
  onSave: (value: string) => void;
  className?: string;
  inputClassName?: string;
  label?: string;
  maxLength?: number;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Tracks whether blur should commit; Escape flips it off first.
  const cancelled = React.useRef(false);

  React.useEffect(() => {
    if (editing) {
      setDraft(value);
      cancelled.current = false;
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, value]);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) return;
    const next = draft.trim();
    if (next && next !== value) onSave(next);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        maxLength={maxLength}
        aria-label={label}
        data-testid="title-input"
        className={cn("h-7 px-2 text-center", inputClassName)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            inputRef.current?.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            inputRef.current?.blur();
          }
          event.stopPropagation();
        }}
      />
    );
  }

  return (
    <button
      type="button"
      title={`${label} (click to edit)`}
      aria-label={`${label}: ${value}`}
      data-testid="editable-title"
      onClick={() => setEditing(true)}
      className={cn(
        "group/title inline-flex max-w-full items-center gap-1 rounded-md px-1 -mx-1 text-left hover:bg-muted",
        className,
      )}
    >
      <span className="truncate">{value}</span>
      <Pencil
        className="size-3 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-60 group-focus-visible/title:opacity-60"
        aria-hidden="true"
      />
    </button>
  );
}
