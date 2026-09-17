import { useEffect, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { NATIONALITIES } from "@/lib/nationalities";
import { cn } from "@/lib/utils";

/**
 * Searchable nationality picker. Typing filters the list; a value that is not
 * in the list (legacy free text) stays selectable so it is not lost.
 */
export function NationalitySelect({
  value,
  onChange,
  disabled,
  id,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const [inputValue, setInputValue] = useState(value);
  // A value set from outside (a document reader filling the field) must show in the box too.
  useEffect(() => {
    setInputValue(value);
  }, [value]);
  const items =
    value && !NATIONALITIES.includes(value) ? [value, ...NATIONALITIES] : NATIONALITIES;

  return (
    <Combobox
      items={items}
      value={value || null}
      onValueChange={(next: string | null) => {
        onChange(next ?? "");
        setInputValue(next ?? "");
      }}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        className={cn("w-full", className)}
        showClear
        autoComplete="off"
        placeholder="Search nationalities"
        disabled={disabled}
      />
      <ComboboxContent>
        <ComboboxEmpty>No nationality found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
