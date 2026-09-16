import type { CalendarEvent } from "@workspace/api-client-react";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  ArrowUpRight,
  Briefcase,
  CalendarDays,
  Check,
  Clock,
  Link2,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { eventMirrorLabel, eventTypeMeta, formatTime } from "@/lib/calendar";

export type EventActions = {
  onToggleComplete: (event: CalendarEvent) => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
};

type EventPopoverProps = EventActions & {
  event: CalendarEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  side?: React.ComponentProps<typeof PopoverContent>["side"];
  align?: React.ComponentProps<typeof PopoverContent>["align"];
};

/** Quick look at an event, anchored to whatever chip or row triggered it. */
export function EventPopover({
  event,
  open,
  onOpenChange,
  children,
  side = "right",
  align = "start",
  onToggleComplete,
  onEdit,
  onDelete,
}: EventPopoverProps) {
  const meta = eventTypeMeta(event.eventType);
  const date = new Date(event.eventDate);
  const mirror = eventMirrorLabel(event.source);
  // Completion is confirmed by completing the case, never from the calendar.
  const completeInCase =
    event.source === "case_completion" && !event.completed && event.caseId;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        collisionPadding={16}
        className="w-80 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className={cn("space-y-3 border-l-4 p-4", meta.accent)}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn("size-2 shrink-0 rounded-full", meta.dot)}
                />
                <span className="text-xs font-medium text-muted-foreground">
                  {meta.label}
                </span>
              </div>
              <h3
                className={cn(
                  "font-semibold leading-snug break-words",
                  event.completed && "text-muted-foreground line-through",
                )}
              >
                {event.title}
              </h3>
            </div>
            {event.completed && <Badge variant="secondary">Done</Badge>}
          </div>
          {mirror && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link2 className="size-3.5 shrink-0" />
              {mirror}
            </p>
          )}

          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CalendarDays className="size-4 shrink-0" />
              <span className="text-foreground">
                {format(date, "EEEE d MMMM yyyy")}
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="size-4 shrink-0" />
              <span className="text-foreground">{formatTime(date)}</span>
            </div>
            {event.caseId ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Briefcase className="size-4 shrink-0" />
                <Link
                  href={`/cases/${event.caseId}`}
                  className="inline-flex min-w-0 items-center gap-1 text-foreground"
                >
                  <span className="truncate">
                    {event.caseReference}
                    {event.clientName ? ` · ${event.clientName}` : ""}
                  </span>
                  <ArrowUpRight className="size-3.5 shrink-0" />
                </Link>
              </div>
            ) : null}
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-2 p-2">
          {completeInCase ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/cases/${event.caseId}`}>
                <Check /> Verify &amp; complete in case
              </Link>
            </Button>
          ) : (
            <Button
              variant={event.completed ? "ghost" : "outline"}
              size="sm"
              onClick={() => onToggleComplete(event)}
            >
              {event.completed ? <Undo2 /> : <Check />}
              {event.completed
                ? "Reopen"
                : event.source === "case_valuation"
                  ? "Valuation took place"
                  : "Mark done"}
            </Button>
          )}
          <ButtonGroup>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Edit event"
                  onClick={() => onEdit(event)}
                >
                  <Pencil />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
            {!mirror && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete event"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(event)}
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            )}
          </ButtonGroup>
        </div>
      </PopoverContent>
    </Popover>
  );
}
