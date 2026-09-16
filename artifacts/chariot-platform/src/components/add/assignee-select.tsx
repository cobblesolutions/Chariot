import {
  useListDefaultAssignees,
  useListStaff,
  type DefaultAssigneeSection,
} from "@workspace/api-client-react";
import { Field, FieldLabel } from "@/components/ui/field";
import { AssigneePicker } from "@/components/assignee-picker";

const DEFAULT_VALUE = "__default__";

/**
 * Staff picker for one section of the Add flow. `null` means "use the default
 * assignee" (configured in Settings, otherwise a role-based fallback) and is
 * resolved server-side, so nothing is sent for it.
 */
export function AssigneeSelect({
  section,
  value,
  onChange,
  disabled,
  label = "Assign to",
}: {
  section: DefaultAssigneeSection;
  value: number | null;
  onChange: (userId: number | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const { data: staff } = useListStaff();
  const { data: defaults } = useListDefaultAssignees();
  const sectionDefault = defaults?.find((item) => item.section === section);
  const defaultLabel = sectionDefault?.displayName
    ? `Default · ${sectionDefault.displayName}`
    : "Default · by role";

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <AssigneePicker
        value={value == null ? DEFAULT_VALUE : String(value)}
        onValueChange={(next) =>
          onChange(next === DEFAULT_VALUE ? null : parseInt(next, 10))
        }
        staff={staff ?? []}
        leading={[{ value: DEFAULT_VALUE, label: defaultLabel }]}
        disabled={disabled}
      />
    </Field>
  );
}
