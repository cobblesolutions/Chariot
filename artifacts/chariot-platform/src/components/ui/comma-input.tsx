import type { InputHTMLAttributes } from "react";
import { Input } from "./input";

export function formatCommaValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const cleaned = String(value).replace(/,/g, "").replace(/[^\d.]/g, "");
  const [whole = "", ...decimalParts] = cleaned.split(".");
  const formattedWhole = whole
    .replace(/^0+(?=\d)/, "")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = decimalParts.join("").slice(0, 2);
  return decimalParts.length > 0
    ? `${formattedWhole || "0"}.${decimals}`
    : formattedWhole;
}

type CommaInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value?: string | number | null;
  onChange: (value: string) => void;
};

export function CommaInput({ value, onChange, ...props }: CommaInputProps) {
  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={formatCommaValue(value)}
      onChange={(event) => onChange(event.target.value.replace(/[^\d.]/g, ""))}
    />
  );
}