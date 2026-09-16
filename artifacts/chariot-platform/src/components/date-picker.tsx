import * as React from "react";
import { format, isValid, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type DatePickerProps = Omit<
  React.ComponentProps<typeof Button>,
  "value" | "onChange"
> & {
  /** "yyyy-MM-dd" (a full ISO string is accepted and sliced to the date part). */
  value?: string | null;
  /** Called with "yyyy-MM-dd", or "" when cleared. */
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Controlled popover state; omit to let the picker manage it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function parseValue(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = parse(value.slice(0, 10), "yyyy-MM-dd", new Date());
  return isValid(date) ? date : undefined;
}

function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
  open: openProp,
  onOpenChange,
  ...props
}: DatePickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const date = parseValue(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-empty={!date}
          className={cn(
            "w-full justify-start font-normal data-[empty=true]:text-muted-foreground",
            className,
          )}
          {...props}
        >
          <CalendarIcon />
          {date ? formatDate(date) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          captionLayout="dropdown"
          onSelect={(selected) => {
            onChange?.(selected ? format(selected, "yyyy-MM-dd") : "");
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
