import { useEffect, useState } from "react";
import type {
  CalendarEvent,
  CalendarEventInput,
  Case,
} from "@workspace/api-client-react";
import { useListCases } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { DatePicker } from "@/components/date-picker";
import { cn } from "@/lib/utils";
import {
  EVENT_TYPES,
  eventMirrorLabel,
  eventTypeMeta,
  type EventType,
} from "@/lib/calendar";

/** Prefill for a new event (from clicking a day or a time slot). */
export type EventDraft = {
  date?: Date;
  caseId?: number | null;
};

type EventDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing event; otherwise creating. */
  event?: CalendarEvent | null;
  draft?: EventDraft;
  pending?: boolean;
  onSubmit: (input: CalendarEventInput) => void;
};

function roundToQuarter(d: Date) {
  const r = new Date(d);
  r.setMinutes(Math.ceil(r.getMinutes() / 15) * 15, 0, 0);
  return r;
}

export function EventDialog({
  open,
  onOpenChange,
  event,
  draft,
  pending,
  onSubmit,
}: EventDialogProps) {
  const { data: cases } = useListCases();
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<EventType>("general");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [caseId, setCaseId] = useState<number | null>(null);

  // Reset the form each time the dialog opens, seeded from the event or draft.
  useEffect(() => {
    if (!open) return;
    if (event) {
      const d = new Date(event.eventDate);
      setTitle(event.title);
      setEventType(
        EVENT_TYPES.includes(event.eventType as EventType)
          ? (event.eventType as EventType)
          : "general",
      );
      setDate(format(d, "yyyy-MM-dd"));
      setTime(format(d, "HH:mm"));
      setCaseId(event.caseId ?? null);
      return;
    }
    const seed = draft?.date ?? roundToQuarter(new Date());
    setTitle("");
    setEventType("general");
    setDate(format(seed, "yyyy-MM-dd"));
    setTime(format(seed, "HH:mm"));
    setCaseId(draft?.caseId ?? null);
  }, [open, event, draft]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date || !time) return;
    onSubmit({
      title: title.trim(),
      eventType,
      eventDate: new Date(`${date}T${time}`).toISOString(),
      caseId,
    });
  };

  const selectedCase = cases?.find((c) => c.id === caseId) ?? null;
  // Events that mirror a case date are managed by the case: only the date moves here.
  const mirrored = event ? eventMirrorLabel(event.source) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
          <DialogDescription>
            {mirrored ? `${mirrored}. Changing the date here updates the case.` : null}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="event-title">Title</FieldLabel>
              <Input
                id="event-title"
                autoFocus
                placeholder="e.g. Valuation at 14 Elm Road"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={!!mirrored}
                required
              />
            </Field>
            <Field>
              <FieldLabel>Type</FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={2}
                value={eventType}
                onValueChange={(v) => v && setEventType(v as EventType)}
                disabled={!!mirrored}
                className="flex-wrap justify-start"
                aria-label="Event type"
              >
                {EVENT_TYPES.map((type) => {
                  const meta = eventTypeMeta(type);
                  return (
                    <ToggleGroupItem key={type} value={type}>
                      <span
                        aria-hidden="true"
                        className={cn("size-2 rounded-full", meta.dot)}
                      />
                      {meta.label}
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel>Date</FieldLabel>
                <DatePicker value={date} onChange={setDate} />
              </Field>
              <Field>
                <FieldLabel htmlFor="event-time">Time</FieldLabel>
                <Input
                  id="event-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>Case</FieldLabel>
              <Combobox
                items={cases ?? []}
                itemToStringLabel={(c) => `${c.reference} · ${c.clientName}`}
                itemToStringValue={(c) => `${c.reference} ${c.clientName}`}
                value={selectedCase}
                onValueChange={(c) => setCaseId(c?.id ?? null)}
                disabled={!!mirrored}
              >
                <ComboboxInput
                  className="w-full"
                  placeholder="No case (optional)"
                />
                <ComboboxContent>
                  <ComboboxEmpty>No cases found.</ComboboxEmpty>
                  <ComboboxList>
                    {(c: Case) => (
                      <ComboboxItem key={c.id} value={c}>
                        {c.reference}
                        <span className="text-muted-foreground">
                          {" "}
                          {c.clientName}
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : event ? "Save changes" : "Add event"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
