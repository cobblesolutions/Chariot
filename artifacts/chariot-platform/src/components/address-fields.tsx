import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AddressCombobox } from "@/components/address-combobox";

export interface AddressValue {
  address: string;
  city: string;
  postcode: string;
}

export interface AddressFieldsProps {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  /** Prefix for the three input ids, e.g. "add-property" → add-property-address / -city / -postcode. */
  idPrefix: string;
  /** Label of the street line; City and Postcode keep their own labels. */
  label?: React.ReactNode;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

/**
 * Address · City · Postcode. Typing in the address line offers Google
 * suggestions; picking one fills all three fields.
 */
export function AddressFields({
  value,
  onChange,
  idPrefix,
  label = "Address",
  placeholder,
  required,
  disabled,
}: AddressFieldsProps) {
  const set = (patch: Partial<AddressValue>) => onChange({ ...value, ...patch });
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-address`}>
          {label}
          {required ? <span className="text-destructive"> *</span> : null}
        </FieldLabel>
        <AddressCombobox
          id={`${idPrefix}-address`}
          fill="street"
          value={value.address}
          onChange={(address) => set({ address })}
          onSelect={(place) =>
            set({
              address: place.line1 ?? value.address,
              city: place.city ?? "",
              postcode: place.postcode ?? "",
            })
          }
          placeholder={placeholder}
          required={required}
          disabled={disabled}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-city`}>City</FieldLabel>
          <Input
            id={`${idPrefix}-city`}
            value={value.city}
            onChange={(event) => set({ city: event.target.value })}
            autoComplete="off"
            disabled={disabled}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-postcode`}>Postcode</FieldLabel>
          <Input
            id={`${idPrefix}-postcode`}
            value={value.postcode}
            onChange={(event) => set({ postcode: event.target.value })}
            autoComplete="off"
            className="uppercase"
            disabled={disabled}
          />
        </Field>
      </div>
    </>
  );
}
