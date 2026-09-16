import type { ComponentProps, ReactNode } from "react";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_LABELS, isStaffRole } from "@/lib/roles";

export interface AssigneeStaff {
  id: number;
  displayName: string;
  role: string;
}

export interface AssigneeLeadingOption {
  value: string;
  label: ReactNode;
}

/**
 * Visual signature shared by every "who is this assigned to" control, so
 * assignment stands out from ordinary fields wherever it appears.
 */
export const assigneeTriggerClass =
  "border-violet-300 bg-violet-50 text-violet-950 hover:bg-violet-100 focus-visible:border-violet-400 focus-visible:ring-violet-300/60 data-[placeholder]:text-violet-800/70 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-50 dark:hover:bg-violet-950/60 dark:data-[placeholder]:text-violet-200/70 [&_svg:not([class*='text-'])]:text-violet-700 dark:[&_svg:not([class*='text-'])]:text-violet-300";

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.charAt(0) ?? "") + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "")
  ).toUpperCase() || "?";
}

/** Staff members as select items, with initials and role. */
export function AssigneeSelectItems({
  staff,
  leading = [],
}: {
  staff: AssigneeStaff[];
  leading?: AssigneeLeadingOption[];
}) {
  return (
    <>
      {leading.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-200">
            <UserRound className="size-3.5" />
          </span>
          <span>{option.label}</span>
        </SelectItem>
      ))}
      {staff.map((member) => (
        <SelectItem key={member.id} value={String(member.id)}>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-semibold text-white">
            {initialsOf(member.displayName)}
          </span>
          <span>
            {member.displayName}
            {isStaffRole(member.role) ? (
              <span className="text-muted-foreground"> · {ROLE_LABELS[member.role]}</span>
            ) : null}
          </span>
        </SelectItem>
      ))}
    </>
  );
}

type TriggerProps = Omit<ComponentProps<typeof SelectTrigger>, "children" | "value">;

/**
 * Drop-in select for choosing a staff member. Distinctly tinted so it reads
 * as "assignment" at a glance. Extra props go to the trigger, so it can sit
 * inside a react-hook-form `FormControl`.
 */
export function AssigneePicker({
  value,
  defaultValue,
  onValueChange,
  staff,
  leading,
  placeholder = "Select staff member",
  disabled,
  className,
  ...triggerProps
}: {
  value?: string;
  defaultValue?: string;
  onValueChange: (value: string) => void;
  staff: AssigneeStaff[];
  leading?: AssigneeLeadingOption[];
  placeholder?: string;
  disabled?: boolean;
} & TriggerProps) {
  return (
    <Select
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        {...triggerProps}
        className={cn("w-full", assigneeTriggerClass, className)}
      >
        <UserRound className="size-4 shrink-0" />
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <AssigneeSelectItems staff={staff} leading={leading} />
      </SelectContent>
    </Select>
  );
}
