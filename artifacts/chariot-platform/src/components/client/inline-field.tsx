import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CommaInput } from "@/components/ui/comma-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/date-picker";
import { AddressCombobox } from "@/components/address-combobox";
import type { PlaceAddress } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const NONE = "__none__";

export type InlineOption = { value: string; label: string } | string;

export type InlineFieldKind =
  "text" | "textarea" | "number" | "money" | "date" | "select" | "address";

export interface InlineFieldProps {
  label: string;
  /** Stored value; "" / null when unset. */
  value: string | null | undefined;
  kind?: InlineFieldKind;
  /** Read-mode rendering of a value; defaults to the raw string. */
  format?: (value: string) => ReactNode;
  /** Read-mode prompt when the value is empty. Defaults to "Add <label>". */
  placeholder?: string;
  /** Label above the value with a multi-line editor (addresses, notes). */
  block?: boolean;
  /** Input type for `kind: "text"`. */
  type?: "text" | "email" | "tel";
  options?: ReadonlyArray<InlineOption>;
  /** Persist the new value; resolve once the displayed data is fresh. */
  onSave: (value: string) => Promise<unknown>;
  /**
   * `kind: "address"` only: persist the whole picked address (street, city,
   * postcode) instead of just the street line.
   */
  onSaveAddress?: (address: PlaceAddress) => Promise<unknown>;
  disabled?: boolean;
}

/**
 * A label/value row that turns into the matching editor on a single click.
 * The editor occupies the value's slot at the same height so nothing shifts;
 * blur, Enter or picking an option saves, Escape cancels.
 */
export function InlineField({
  label,
  value,
  kind = "text",
  format,
  placeholder,
  block = false,
  type = "text",
  options = [],
  onSave,
  onSaveAddress,
  disabled,
}: InlineFieldProps) {
  const current = value ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  // Shown in read mode while the save (and the refetch behind it) completes.
  const [pending, setPending] = useState<string | null>(null);
  const skipBlur = useRef(false);

  const begin = () => {
    if (disabled) return;
    setDraft(current);
    skipBlur.current = false;
    setEditing(true);
  };

  const cancel = () => setEditing(false);

  const commit = async (next: string = draft, save = onSave) => {
    setEditing(false);
    if (next === current && save === onSave) return;
    setPending(next);
    try {
      await save(next);
    } finally {
      setPending(null);
    }
  };

  const shown = pending ?? current;
  const empty = shown.trim() === "";
  const display = empty
    ? (placeholder ?? `Add ${label.toLowerCase()}`)
    : (format?.(shown) ?? shown);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      skipBlur.current = true;
      cancel();
    } else if (
      event.key === "Enter" &&
      (kind !== "textarea" || event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      skipBlur.current = true;
      void commit();
    }
  };
  const onBlur = () => {
    if (skipBlur.current) return;
    void commit();
  };

  let editor: ReactNode = null;
  if (editing) {
    const alignment = block ? "" : "text-right";
    switch (kind) {
      case "textarea":
        editor = (
          <Textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            aria-label={label}
            className="min-h-[60px]"
          />
        );
        break;
      case "address":
        editor = (
          <AddressCombobox
            autoFocus
            fill={onSaveAddress ? "street" : "full"}
            value={draft}
            onChange={setDraft}
            onSelect={(address) => {
              // Picking a suggestion is the decision; save it without
              // waiting for the blur that follows.
              skipBlur.current = true;
              if (onSaveAddress) {
                void commit(address.line1 || draft, () => onSaveAddress(address));
              } else {
                void commit(address.formattedAddress || draft);
              }
            }}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            aria-label={label}
          />
        );
        break;
      case "money":
        editor = (
          <CommaInput
            autoFocus
            value={draft}
            onChange={setDraft}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            aria-label={label}
            className={alignment}
          />
        );
        break;
      case "number":
        editor = (
          <Input
            autoFocus
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            aria-label={label}
            className={alignment}
          />
        );
        break;
      case "select": {
        const normalised = options.map((option) =>
          typeof option === "string"
            ? { value: option, label: option }
            : option,
        );
        const known = normalised.some((option) => option.value === draft);
        editor = (
          <Select
            defaultOpen
            value={draft || NONE}
            onValueChange={(next) => void commit(next === NONE ? "" : next)}
            onOpenChange={(open) => {
              if (!open) cancel();
            }}
          >
            <SelectTrigger className="w-full" aria-label={label}>
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not set</SelectItem>
              {normalised.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
              {draft && !known ? (
                <SelectItem value={draft}>
                  {draft.replace(/_/g, " ")}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        );
        break;
      }
      case "date":
        editor = (
          <DatePicker
            open
            onOpenChange={(open) => {
              if (!open) cancel();
            }}
            value={draft}
            onChange={(next) => void commit(next)}
            aria-label={label}
          />
        );
        break;
      default:
        editor = (
          <Input
            autoFocus
            type={type}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            aria-label={label}
            className={alignment}
          />
        );
    }
  }

  const readButton = (
    <Button
      type="button"
      variant="ghost"
      onClick={begin}
      disabled={disabled}
      title={`Click to edit ${label.toLowerCase()}`}
      className={cn(
        "h-auto min-h-9 max-w-full cursor-text px-2 py-1 font-medium whitespace-normal",
        block
          ? "w-full justify-start text-left whitespace-pre-wrap"
          : "-mr-2 justify-end text-right",
        empty && "font-normal text-muted-foreground",
        pending != null && "opacity-70",
      )}
    >
      <span className={cn("min-w-0", block ? "" : "truncate")}>{display}</span>
    </Button>
  );

  if (block) {
    return (
      <div className="space-y-1 border-b py-2 text-sm last:border-b-0">
        <span className="text-muted-foreground">{label}</span>
        <div className="-mx-2">
          {editing ? <div className="px-2">{editor}</div> : readButton}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-11 items-center justify-between gap-4 border-b py-1 text-sm last:border-b-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 justify-end">
        {editing ? <div className="w-full max-w-72">{editor}</div> : readButton}
      </div>
    </div>
  );
}
