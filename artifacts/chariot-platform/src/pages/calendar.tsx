import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  getListCalendarEventsQueryKey,
  useCompleteCalendarEvent,
  useCreateCalendarEvent,
  useDeleteCalendarEvent,
  useListCalendarEvents,
  useUpdateCalendarEvent,
  type CalendarEvent,
  type CalendarEventInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  addMonths,
  addWeeks,
  endOfMonth,
  format,
  isSameMonth,
  isSameYear,
  startOfMonth,
} from "date-fns";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AgendaView } from "@/components/calendar/agenda-view";
import { DayPanel } from "@/components/calendar/day-panel";
import {
  EventDialog,
  type EventDraft,
} from "@/components/calendar/event-dialog";
import { MonthView } from "@/components/calendar/month-view";
import { WeekView } from "@/components/calendar/week-view";
import { cn } from "@/lib/utils";
import {
  EVENT_TYPES,
  eventTypeMeta,
  groupEventsByDay,
  hebrewRangeLabel,
  isToday,
  monthGridDays,
  useHebrewCalendar,
  weekDays,
  type CalendarView,
  type EventType,
} from "@/lib/calendar";

const VIEW_STORAGE_KEY = "chariot.calendar.view";
const VIEWS: CalendarView[] = ["month", "week", "agenda"];

function readStoredView(): CalendarView {
  try {
    const v = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return VIEWS.includes(v as CalendarView) ? (v as CalendarView) : "month";
  } catch {
    return "month";
  }
}

type DialogState =
  | { mode: "create"; draft: EventDraft }
  | { mode: "edit"; event: CalendarEvent }
  | null;

export default function CalendarPage() {
  const qc = useQueryClient();
  const { data: events, isLoading, error } = useListCalendarEvents();

  const [view, setView] = useState<CalendarView>(readStoredView);
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [types, setTypes] = useState<EventType[]>(EVENT_TYPES);
  const [showCompleted, setShowCompleted] = useState(true);
  const [showHebrew, setShowHebrew] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<CalendarEvent | null>(
    null,
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);

  // ---- visible range -------------------------------------------------------
  const rangeDays = useMemo(() => {
    if (view === "week") return weekDays(cursor);
    if (view === "agenda") {
      return monthGridDays(cursor).filter((d) => isSameMonth(d, cursor));
    }
    return monthGridDays(cursor);
  }, [view, cursor]);
  const rangeStart = rangeDays[0];
  const rangeEnd = rangeDays[rangeDays.length - 1];
  const hebrewAll = useHebrewCalendar(rangeStart, rangeEnd);
  const hebrew = showHebrew ? hebrewAll : null;

  const periodLabel = useMemo(() => {
    if (view === "week") {
      const a = rangeStart;
      const b = rangeEnd;
      if (isSameMonth(a, b))
        return `${format(a, "d")} – ${format(b, "d MMM yyyy")}`;
      if (isSameYear(a, b))
        return `${format(a, "d MMM")} – ${format(b, "d MMM yyyy")}`;
      return `${format(a, "d MMM yyyy")} – ${format(b, "d MMM yyyy")}`;
    }
    return format(cursor, "MMMM yyyy");
  }, [view, cursor, rangeStart, rangeEnd]);
  const hebrewLabel = useMemo(
    () =>
      view === "week"
        ? hebrewRangeLabel(rangeStart, rangeEnd)
        : hebrewRangeLabel(startOfMonth(cursor), endOfMonth(cursor)),
    [view, cursor, rangeStart, rangeEnd],
  );

  // ---- events ------------------------------------------------------------
  const filtered = useMemo(() => {
    const list = (events ?? []).filter(
      (e) =>
        types.includes(e.eventType as EventType) &&
        (showCompleted || !e.completed),
    );
    return list.sort(
      (a, b) =>
        new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime(),
    );
  }, [events, types, showCompleted]);
  const eventsByDay = useMemo(() => groupEventsByDay(filtered), [filtered]);

  // ---- navigation ----------------------------------------------------------
  const step = useCallback(
    (direction: -1 | 1) => {
      setOpenKey(null);
      setCursor((c) =>
        view === "week" ? addWeeks(c, direction) : addMonths(c, direction),
      );
    },
    [view],
  );
  const goToday = useCallback(() => {
    const now = new Date();
    setOpenKey(null);
    setCursor(now);
    setSelectedDate(now);
  }, []);
  const selectDate = useCallback((date: Date) => {
    setOpenKey(null);
    setSelectedDate(date);
  }, []);

  const openCreate = useCallback((date?: Date) => {
    setOpenKey(null);
    setDialog({ mode: "create", draft: { date } });
  }, []);
  // New event on a day: the next quarter hour if it's today, otherwise 09:00.
  const openCreateOnDay = useCallback(
    (date: Date) => {
      const at = new Date(date);
      if (isToday(at)) {
        const now = new Date();
        at.setHours(
          now.getHours(),
          Math.ceil(now.getMinutes() / 15) * 15,
          0,
          0,
        );
      } else {
        at.setHours(9, 0, 0, 0);
      }
      openCreate(at);
    },
    [openCreate],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]',
        )
      ) {
        return;
      }
      switch (e.key) {
        case "ArrowLeft":
          step(-1);
          break;
        case "ArrowRight":
          step(1);
          break;
        case "t":
        case "T":
          goToday();
          break;
        case "n":
        case "N":
          openCreateOnDay(selectedDate);
          break;
        case "m":
        case "M":
          setView("month");
          break;
        case "w":
        case "W":
          setView("week");
          break;
        case "a":
        case "A":
          setView("agenda");
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, goToday, openCreateOnDay, selectedDate]);

  // ---- deep link -----------------------------------------------------------
  // `/calendar?event=<id>` (from site search or a notification) jumps to the
  // event's date and opens it. The param is then dropped so closing the
  // dialog or navigating the grid doesn't reopen it.
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const deepLinkEventId = useMemo(() => {
    const value = Number(new URLSearchParams(searchString).get("event"));
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [searchString]);
  const openedDeepLink = useRef<number | null>(null);
  useEffect(() => {
    if (deepLinkEventId == null) {
      openedDeepLink.current = null;
      return;
    }
    if (!events) return;
    if (openedDeepLink.current === deepLinkEventId) return;
    openedDeepLink.current = deepLinkEventId;
    const event = events.find((e) => e.id === deepLinkEventId);
    navigate("/calendar", { replace: true });
    if (!event) {
      toast.add({ title: "That event no longer exists", type: "error" });
      return;
    }
    const at = new Date(event.eventDate);
    setCursor(at);
    setSelectedDate(at);
    setOpenKey(null);
    setDialog({ mode: "edit", event });
  }, [deepLinkEventId, events, navigate]);

  // ---- mutations -----------------------------------------------------------
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListCalendarEventsQueryKey() });
  const createEvent = useCreateCalendarEvent();
  const updateEvent = useUpdateCalendarEvent();
  const deleteEvent = useDeleteCalendarEvent();
  const completeEvent = useCompleteCalendarEvent();

  const handleSubmit = (input: CalendarEventInput) => {
    if (dialog?.mode === "edit") {
      updateEvent.mutate(
        { id: dialog.event.id, data: input },
        {
          onSuccess: () => {
            toast.add({ title: "Event updated", type: "success" });
            setDialog(null);
            invalidate();
          },
          onError: () =>
            toast.add({ title: "Couldn't update event", type: "error" }),
        },
      );
      return;
    }
    createEvent.mutate(
      { data: input },
      {
        onSuccess: (created) => {
          toast.add({ title: "Event added", type: "success" });
          setDialog(null);
          setSelectedDate(new Date(created.eventDate));
          invalidate();
        },
        onError: () =>
          toast.add({ title: "Couldn't add event", type: "error" }),
      },
    );
  };

  const handleToggleComplete = (event: CalendarEvent) => {
    setOpenKey(null);
    completeEvent.mutate(
      { id: event.id, data: { completed: !event.completed } },
      {
        onSuccess: () => {
          toast.add({
            title: event.completed ? "Event reopened" : "Marked as done",
            type: "success",
          });
          invalidate();
        },
        onError: () =>
          toast.add({ title: "Couldn't update event", type: "error" }),
      },
    );
  };

  const handleEdit = (event: CalendarEvent) => {
    setOpenKey(null);
    setDialog({ mode: "edit", event });
  };

  const handleDelete = (event: CalendarEvent) => {
    setOpenKey(null);
    setPendingDelete(event);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteEvent.mutate(
      { id: pendingDelete.id },
      {
        onSuccess: () => {
          toast.add({ title: "Event deleted", type: "success" });
          invalidate();
        },
        onError: (err) =>
          toast.add({
            title: "Couldn't delete event",
            description: err instanceof Error ? err.message : undefined,
            type: "error",
          }),
      },
    );
    setPendingDelete(null);
  };

  const actions = {
    onToggleComplete: handleToggleComplete,
    onEdit: handleEdit,
    onDelete: handleDelete,
  };

  // ---- render --------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-[100rem] mx-auto">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-8 w-full max-w-xl" />
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
          <Skeleton className="h-[42rem]" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-[100rem] mx-auto">
        <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Couldn't load the calendar</AlertTitle>
          <AlertDescription>Refresh the page to try again.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-[100rem] mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
          <p className="text-muted-foreground mt-1">
            Valuations, completions and renewals across every case.
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={() => openCreateOnDay(selectedDate)}>
              <Plus /> New event
            </Button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-1.5">
            New event <Kbd>N</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <ButtonGroup aria-label="Navigate">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={
                  view === "week" ? "Previous week" : "Previous month"
                }
                onClick={() => step(-1)}
              >
                <ChevronLeft />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-1.5">
              Previous <Kbd>←</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={goToday}>
                Today
              </Button>
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-1.5">
              Jump to today <Kbd>T</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={view === "week" ? "Next week" : "Next month"}
                onClick={() => step(1)}
              >
                <ChevronRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-1.5">
              Next <Kbd>→</Kbd>
            </TooltipContent>
          </Tooltip>
        </ButtonGroup>

        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h2
            data-testid="period-label"
            className="text-xl font-semibold tabular-nums"
          >
            {periodLabel}
          </h2>
          {showHebrew && (
            <span className="text-sm text-muted-foreground">{hebrewLabel}</span>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={types}
            onValueChange={(v) => setTypes(v as EventType[])}
            aria-label="Show event types"
          >
            {EVENT_TYPES.map((type) => {
              const meta = eventTypeMeta(type);
              return (
                <ToggleGroupItem
                  key={type}
                  value={type}
                  aria-label={meta.label}
                  className="data-[state=on]:bg-card data-[state=off]:text-muted-foreground"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 rounded-full transition-opacity",
                      meta.dot,
                      !types.includes(type) && "opacity-30",
                    )}
                  />
                  <span className="hidden sm:inline">{meta.label}</span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Display options"
                  >
                    <Settings2 />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Display options</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Display</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={showCompleted}
                onCheckedChange={(v) => setShowCompleted(!!v)}
              >
                Completed events
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={showHebrew}
                onCheckedChange={(v) => setShowHebrew(!!v)}
              >
                Hebrew dates &amp; holidays
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tabs
            value={view}
            onValueChange={(v) => {
              setOpenKey(null);
              setView(v as CalendarView);
            }}
          >
            <TabsList aria-label="Calendar view">
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="agenda">Agenda</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="gap-0 overflow-hidden py-0">
          {view === "month" && (
            <MonthView
              month={cursor}
              eventsByDay={eventsByDay}
              hebrew={hebrew}
              selectedDate={selectedDate}
              onSelectDate={selectDate}
              onNewEvent={openCreateOnDay}
              openKey={openKey}
              onOpenKey={setOpenKey}
              {...actions}
            />
          )}
          {view === "week" && (
            <WeekView
              anchor={cursor}
              eventsByDay={eventsByDay}
              hebrew={hebrew}
              selectedDate={selectedDate}
              onSelectDate={selectDate}
              onNewEvent={openCreate}
              openKey={openKey}
              onOpenKey={setOpenKey}
              {...actions}
            />
          )}
          {view === "agenda" && (
            <AgendaView
              days={rangeDays}
              eventsByDay={eventsByDay}
              hebrew={hebrew}
              onNewEvent={openCreateOnDay}
              openKey={openKey}
              onOpenKey={setOpenKey}
              {...actions}
            />
          )}
        </Card>

        <DayPanel
          date={selectedDate}
          events={filtered}
          eventsByDay={eventsByDay}
          hebrew={hebrew}
          onNewEvent={openCreateOnDay}
          openKey={openKey}
          onOpenKey={setOpenKey}
          {...actions}
        />
      </div>

      <EventDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        event={dialog?.mode === "edit" ? dialog.event : null}
        draft={dialog?.mode === "create" ? dialog.draft : undefined}
        pending={createEvent.isPending || updateEvent.isPending}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete this event?"
        description={
          pendingDelete
            ? `"${pendingDelete.title}" will be removed from the calendar.`
            : ""
        }
        actionLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
