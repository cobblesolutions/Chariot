import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NONE = "__none__";

/**
 * Select over a fixed option list where "" means not set. Keeps a value that
 * is no longer in the list (legacy data) selectable so it is not silently lost.
 */
export function OptionSelect({
  value,
  onChange,
  options,
  placeholder = "Not set",
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string } | string>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const normalised = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  const known = normalised.some((option) => option.value === value);
  return (
    <Select
      value={value || NONE}
      onValueChange={(next) => onChange(next === NONE ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {normalised.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
        {value && !known ? (
          <SelectItem value={value}>{value.replace(/_/g, " ")}</SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  );
}
