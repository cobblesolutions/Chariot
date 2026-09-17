import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearch } from "wouter";
import {
  getListStaffQueryKey,
  useListStaff,
  useListTasks,
  type StaffUser,
} from "@workspace/api-client-react";
import {
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Flag,
  Inbox,
  Keyboard,
  Layers,
  LayoutList,
  ListFilter,
  Search,
  X,
  SquareKanban,
  UserRound,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Field, FieldLabel } from "@/components/ui/field";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CountBubble } from "@/components/count-bubble";
import { useAuth } from "@/components/auth-provider";
import { useMediaQuery } from "@/hooks/use-media-query";
import { isFullAccess } from "@/lib/roles";
import { BulkBar } from "@/components/tasks/bulk-bar";
import { QuickAdd, type QuickAddHandle } from "@/components/tasks/quick-add";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskInspector } from "@/components/tasks/task-inspector";
import {
  DUE_BUCKETS,
  TASK_PRIORITIES,
  daysUntilDue,
  dueBucket,
  dueKey,
  isOpen,
  priorityRank,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@/components/tasks/task-model";
import { PriorityFlag } from "@/components/tasks/task-primitives";
import { TaskRow } from "@/components/tasks/task-row";
import { useTaskMutations } from "@/components/tasks/use-task-mutations";

type ViewKey = "open" | "today" | "upcoming" | "done" | "all";
type GroupKey = "due" | "priority" | "case" | "assignee" | "none";
type Mode = "list" | "board";
type AssigneeFilter = "me" | "all" | number;

const VIEWS: {
  key: ViewKey;
  label: string;
  icon: typeof Inbox;
  hint: string;
}[] = [
  { key: "open", label: "Open", icon: Inbox, hint: "Everything still to do" },
  {
    key: "today",
    label: "Today",
    icon: CalendarCheck,
    hint: "Due today or overdue",
  },
  {
    key: "upcoming",
    label: "Upcoming",
    icon: CalendarClock,
    hint: "Due after today",
  },
  {
    key: "done",
    label: "Completed",
    icon: CheckCircle2,
    hint: "Finished tasks",
  },
  { key: "all", label: "All", icon: Layers, hint: "Every task" },
];

const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "due", label: "Group by due date" },
  { key: "priority", label: "Group by priority" },
  { key: "case", label: "Group by case" },
  { key: "assignee", label: "Group by assignee" },
  { key: "none", label: "No grouping" },
];

type CaseOption = { id: number; reference: string; clientName: string };
type ClientOption = { id: number; name: string };

/** Human labels for `task.kind`; "manual" stands in for tasks with no kind. */
const KIND_LABELS: Record<string, string> = {
  manual: "Manual",
  enquiry_review: "Enquiry review",
  client_onboarding: "Onboarding",
  advanced_property: "Add property",
  advanced_case: "Set up case",
  property_review: "Property review",
  property_import: "Property import",
  case_submission: "Submission details",
  stage_handoff: "Stage handoff",
  submission_step: "Submission step",
};
const kindLabel = (kind: string) =>
  KIND_LABELS[kind] ?? kind.replace(/_/g, " ");

const SHORTCUTS: [string, string[]][] = [
  ["New task", ["N"]],
  ["Search", ["/"]],
  ["Move down / up", ["J", "K"]],
  ["Open task", ["↵"]],
  ["Complete task", ["C"]],
  ["Select task", ["X"]],
  ["Close / clear", ["Esc"]],
];

const matchesView = (task: Task, view: ViewKey) => {
  switch (view) {
    case "open":
      return isOpen(task);
    case "today":
      return isOpen(task) && daysUntilDue(task) <= 0;
    case "upcoming":
      return isOpen(task) && daysUntilDue(task) > 0;
    case "done":
      return !isOpen(task);
    default:
      return true;
  }
};

const compareTasks = (a: Task, b: Task) => {
  if (!isOpen(a) && !isOpen(b)) {
    return (
      String(b.completedAt ?? "").localeCompare(String(a.completedAt ?? "")) ||
      b.id - a.id
    );
  }
  return (
    dueKey(a).localeCompare(dueKey(b)) ||
    priorityRank[a.priority] - priorityRank[b.priority] ||
    a.id - b.id
  );
};

interface TaskGroup {
  key: string;
  label: ReactNode;
  tasks: Task[];
}

function groupTasks(
  tasks: Task[],
  groupBy: GroupKey,
  view: ViewKey,
): TaskGroup[] {
  const sorted = [...tasks].sort(compareTasks);
  if (groupBy === "none" || (groupBy === "due" && view === "done")) {
    return sorted.length
      ? [
          {
            key: "all",
            label: view === "done" ? "Completed" : "Tasks",
            tasks: sorted,
          },
        ]
      : [];
  }
  const buckets = new Map<string, TaskGroup>();
  const push = (key: string, label: ReactNode, task: Task) => {
    const group = buckets.get(key) ?? { key, label, tasks: [] };
    group.tasks.push(task);
    buckets.set(key, group);
  };
  for (const task of sorted) {
    if (groupBy === "due") {
      const bucket = isOpen(task) ? dueBucket(task) : "done";
      push(
        bucket,
        bucket === "done"
          ? "Completed"
          : DUE_BUCKETS.find((b) => b.key === bucket)?.label,
        task,
      );
    } else if (groupBy === "priority") {
      push(
        task.priority,
        <PriorityFlag priority={task.priority} showLabel />,
        task,
      );
    } else if (groupBy === "case") {
      push(
        task.caseId ? `case-${task.caseId}` : "no-case",
        task.caseReference
          ? `${task.caseReference} · ${task.clientName}`
          : "No case",
        task,
      );
    } else {
      push(`user-${task.assignedUserId}`, task.assignee, task);
    }
  }
  const order =
    groupBy === "due"
      ? [...DUE_BUCKETS.map((b) => b.key), "done"]
      : groupBy === "priority"
        ? TASK_PRIORITIES.map((p) => p.value)
        : [...buckets.keys()].sort((a, b) => {
            if (a === "no-case") return 1;
            if (b === "no-case") return -1;
            return String(buckets.get(a)?.label).localeCompare(
              String(buckets.get(b)?.label),
            );
          });
  return order
    .map((key) => buckets.get(key))
    .filter((group): group is TaskGroup => !!group);
}

const isTypingTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable
  );
};

function RailButton({
  active,
  icon: Icon,
  label,
  count,
  onClick,
  title,
}: {
  active: boolean;
  icon?: typeof Inbox;
  label: ReactNode;
  count?: number;
  onClick: () => void;
  title?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "w-full justify-start font-normal",
        active && "bg-muted font-medium",
      )}
      onClick={onClick}
      aria-pressed={active}
      title={title}
    >
      {Icon && <Icon />}
      <span className="truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </Button>
  );
}

function FilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove ${label} filter`}
        className="rounded-sm text-muted-foreground hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </Badge>
  );
}

export default function TasksPage() {
  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);
  const { data: tasks, isLoading } = useListTasks();
  const { data: staffData } = useListStaff({
    query: { enabled: isAdmin, queryKey: getListStaffQueryKey() },
  });
  const staff: StaffUser[] = useMemo(() => staffData ?? [], [staffData]);
  const mutations = useTaskMutations();
  const isWide = useMediaQuery("(min-width: 1280px)");

  const [view, setView] = useState<ViewKey>("open");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("me");
  const [priorities, setPriorities] = useState<Set<TaskPriority>>(new Set());
  const [search, setSearch] = useState("");
  const [caseFilter, setCaseFilter] = useState<CaseOption | null>(null);
  const [clientFilter, setClientFilter] = useState<ClientOption | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("any");
  const [groupBy, setGroupBy] = useState<GroupKey>("due");
  const [mode, setMode] = useState<Mode>("board");
  const [activeId, setActiveId] = useState<number | null>(() => {
    const id = Number(new URLSearchParams(window.location.search).get("task"));
    return id > 0 ? id : null;
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Freshly added task: scrolled into view and flashed so it is obvious where it went.
  const [justAddedId, setJustAddedId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const quickAddRef = useRef<QuickAddHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // A link to /tasks?task=<id> while already on this page (site search, a
  // notification) must open that task too, not just on first mount.
  const searchString = useSearch();
  useEffect(() => {
    const id = Number(new URLSearchParams(searchString).get("task"));
    if (id > 0) setActiveId(id);
  }, [searchString]);

  // Keep ?task= in the URL so a task can be linked to and survives a refresh.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeId) url.searchParams.set("task", String(activeId));
    else url.searchParams.delete("task");
    window.history.replaceState(window.history.state, "", url);
  }, [activeId]);

  const byPerson = useMemo(() => {
    const all = tasks ?? [];
    if (!isAdmin || assigneeFilter === "all") return all;
    const id = assigneeFilter === "me" ? user?.id : assigneeFilter;
    return all.filter((task) => task.assignedUserId === id);
  }, [tasks, isAdmin, assigneeFilter, user?.id]);

  const viewCounts = useMemo(
    () =>
      Object.fromEntries(
        VIEWS.map((item) => [
          item.key,
          byPerson.filter((task) => matchesView(task, item.key)).length,
        ]),
      ) as Record<ViewKey, number>,
    [byPerson],
  );
  const priorityCounts = useMemo(
    () =>
      Object.fromEntries(
        TASK_PRIORITIES.map((item) => [
          item.value,
          byPerson.filter(
            (task) => isOpen(task) && task.priority === item.value,
          ).length,
        ]),
      ) as Record<TaskPriority, number>,
    [byPerson],
  );
  const personCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const task of tasks ?? []) {
      if (isOpen(task))
        counts.set(
          task.assignedUserId,
          (counts.get(task.assignedUserId) ?? 0) + 1,
        );
    }
    return counts;
  }, [tasks]);

  // Filter options come from the loaded tasks, so only cases/clients/kinds
  // that actually have tasks are offered.
  const caseOptions = useMemo(() => {
    const map = new Map<number, CaseOption>();
    for (const task of tasks ?? []) {
      if (task.caseId && task.caseReference && !map.has(task.caseId))
        map.set(task.caseId, {
          id: task.caseId,
          reference: task.caseReference,
          clientName: task.clientName ?? "",
        });
    }
    return [...map.values()].sort((a, b) =>
      a.reference.localeCompare(b.reference),
    );
  }, [tasks]);
  const clientOptions = useMemo(() => {
    const map = new Map<number, ClientOption>();
    for (const task of tasks ?? []) {
      if (task.clientId && task.clientName && !map.has(task.clientId))
        map.set(task.clientId, { id: task.clientId, name: task.clientName });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);
  const kindOptions = useMemo(() => {
    const kinds = new Set<string>();
    for (const task of tasks ?? []) kinds.add(task.kind ?? "manual");
    return [...kinds].sort((a, b) => kindLabel(a).localeCompare(kindLabel(b)));
  }, [tasks]);
  const matchesRecordFilters = useCallback(
    (task: Task) =>
      (!caseFilter || task.caseId === caseFilter.id) &&
      (!clientFilter || task.clientId === clientFilter.id) &&
      (kindFilter === "any" || (task.kind ?? "manual") === kindFilter),
    [caseFilter, clientFilter, kindFilter],
  );
  const activeFilterCount =
    (caseFilter ? 1 : 0) +
    (clientFilter ? 1 : 0) +
    (kindFilter !== "any" ? 1 : 0);
  const clearFilters = () => {
    setCaseFilter(null);
    setClientFilter(null);
    setKindFilter("any");
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return byPerson.filter((task) => {
      if (!matchesRecordFilters(task)) return false;
      // The board keeps its Done column populated; the column itself limits how many show.
      if (mode === "board" && view === "open" && !isOpen(task)) {
        if (!task.completedAt) return false;
      } else if (!matchesView(task, view)) return false;
      if (priorities.size > 0 && !priorities.has(task.priority)) return false;
      if (needle) {
        const haystack =
          `${task.title} ${task.caseReference ?? ""} ${task.clientName ?? ""} ${task.notes} ${task.assignee}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [byPerson, view, priorities, search, mode, matchesRecordFilters]);

  const groups = useMemo(
    () => groupTasks(visible, groupBy, view),
    [visible, groupBy, view],
  );
  useEffect(() => {
    if (justAddedId === null) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-task-id="${justAddedId}"]`,
    );
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const timer = window.setTimeout(() => setJustAddedId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [justAddedId, groups]);

  const visibleIds = useMemo(
    () => new Set(visible.map((task) => task.id)),
    [visible],
  );
  const showAssignee = isAdmin && assigneeFilter !== "me";

  // Drop selections/active task that are no longer in the list (deleted or filtered out).
  useEffect(() => {
    setSelected((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleIds]);
  useEffect(() => {
    if (
      activeId !== null &&
      tasks &&
      !tasks.some((task) => task.id === activeId)
    )
      setActiveId(null);
  }, [tasks, activeId]);

  const toggleSelect = useCallback((task: Task) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  }, []);
  const togglePriority = (priority: TaskPriority) =>
    setPriorities((current) => {
      const next = new Set(current);
      if (next.has(priority)) next.delete(priority);
      else next.add(priority);
      return next;
    });
  const toggleGroup = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectedIds = useMemo(() => [...selected], [selected]);
  const clearSelection = () => setSelected(new Set());
  const bulk = {
    status: (status: TaskStatus) =>
      mutations.bulkUpdateTasks(selectedIds, { status }),
    priority: (priority: TaskPriority) =>
      mutations.bulkUpdateTasks(selectedIds, { priority }),
    assign: (member: StaffUser) =>
      mutations.bulkUpdateTasks(
        selectedIds,
        { assignedUserId: member.id },
        { assignee: member.displayName },
      ),
    due: (dueDate: string) =>
      mutations.bulkUpdateTasks(selectedIds, { dueDate }),
    delete: () =>
      mutations.bulkDeleteTasks(selectedIds, { onSuccess: clearSelection }),
  };

  // Keyboard: n new · / search · j/k move · c complete · x select · esc close.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) {
        if (event.key === "Escape") (event.target as HTMLElement).blur();
        return;
      }
      const rows = [
        ...(listRef.current?.querySelectorAll<HTMLElement>("[data-task-id]") ??
          []),
      ];
      const focusedIndex = rows.findIndex(
        (row) => row === document.activeElement,
      );
      const focusedTask =
        focusedIndex >= 0
          ? visible.find(
              (t) => t.id === Number(rows[focusedIndex].dataset.taskId),
            )
          : null;
      switch (event.key) {
        case "n":
          event.preventDefault();
          quickAddRef.current?.focus();
          break;
        case "/":
          event.preventDefault();
          searchRef.current?.focus();
          break;
        case "j":
        case "ArrowDown":
          if (rows.length) {
            event.preventDefault();
            rows[Math.min(rows.length - 1, focusedIndex + 1)]?.focus();
          }
          break;
        case "k":
        case "ArrowUp":
          if (rows.length) {
            event.preventDefault();
            rows[
              Math.max(0, focusedIndex <= 0 ? 0 : focusedIndex - 1)
            ]?.focus();
          }
          break;
        case "c": {
          const target = focusedTask ?? visible.find((t) => t.id === activeId);
          if (target) {
            event.preventDefault();
            mutations.toggleDone(target);
          }
          break;
        }
        case "x":
          if (focusedTask) {
            event.preventDefault();
            toggleSelect(focusedTask);
          }
          break;
        case "Escape":
          if (selected.size) clearSelection();
          else setActiveId(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, activeId, selected.size, mutations, toggleSelect]);

  /**
   * Make sure a newly created task is on screen: widen whichever filter would
   * hide it (view, person, priority, search), then scroll to and flash it.
   */
  const revealTask = (task: Task) => {
    const hiddenBy: string[] = [];
    if (!matchesView(task, view)) {
      setView(isOpen(task) ? "open" : "done");
      hiddenBy.push(isOpen(task) ? "Open" : "Completed");
    }
    if (isAdmin && assigneeFilter !== "all") {
      const personId = assigneeFilter === "me" ? user?.id : assigneeFilter;
      if (task.assignedUserId !== personId) {
        setAssigneeFilter(task.assignedUserId);
        hiddenBy.push(task.assignee);
      }
    }
    if (priorities.size > 0 && !priorities.has(task.priority)) {
      setPriorities(new Set());
      hiddenBy.push("all priorities");
    }
    if (search.trim()) setSearch("");
    if (!matchesRecordFilters(task)) {
      clearFilters();
      hiddenBy.push("all cases");
    }
    if (hiddenBy.length) {
      toast.add({
        title: "Task added",
        description: `Showing ${hiddenBy.join(" · ")} so you can see it.`,
        type: "success",
      });
    }
    setJustAddedId(task.id);
    if (isWide) setActiveId(task.id);
  };

  const activeView = VIEWS.find((item) => item.key === view)!;
  const assigneeLabel =
    assigneeFilter === "me"
      ? "My tasks"
      : assigneeFilter === "all"
        ? "Everyone"
        : (staff.find((member) => member.id === assigneeFilter)?.displayName ??
          "Tasks");

  const inspector = (hideClose: boolean) => (
    <TaskInspector
      taskId={activeId}
      staff={staff}
      onClose={() => setActiveId(null)}
      onDeleted={() => setActiveId(null)}
      hideClose={hideClose}
    />
  );

  if (isLoading) {
    return (
      <div className="h-[calc(100dvh-4rem)] p-4 md:h-[100dvh] md:p-frame">
        <Skeleton className="mx-auto h-full w-full max-w-page" />
      </div>
    );
  }

  const rail = (
    <>
      <div className="flex h-14 shrink-0 items-center px-4">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          Tasks
          <CountBubble
            count={viewCounts.today}
            aria-label={`${viewCounts.today} tasks due today or overdue`}
          />
        </h1>
      </div>
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
        <nav className="space-y-4 px-2 pb-4" aria-label="Task views">
          <div className="space-y-0.5">
            {VIEWS.map((item) => (
              <RailButton
                key={item.key}
                active={view === item.key}
                icon={item.icon}
                label={item.label}
                count={item.key === "all" ? undefined : viewCounts[item.key]}
                onClick={() => setView(item.key)}
                title={item.hint}
              />
            ))}
          </div>
          {isAdmin && (
            <div className="space-y-0.5">
              <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                People
              </p>
              <RailButton
                active={assigneeFilter === "me"}
                icon={UserRound}
                label="Me"
                count={user ? personCounts.get(user.id) : undefined}
                onClick={() => setAssigneeFilter("me")}
              />
              <RailButton
                active={assigneeFilter === "all"}
                icon={Users}
                label="Everyone"
                count={[...personCounts.values()].reduce(
                  (sum, n) => sum + n,
                  0,
                )}
                onClick={() => setAssigneeFilter("all")}
              />
              {staff
                .filter((member) => member.id !== user?.id)
                .map((member) => (
                  <RailButton
                    key={member.id}
                    active={assigneeFilter === member.id}
                    label={member.displayName}
                    count={personCounts.get(member.id)}
                    onClick={() => setAssigneeFilter(member.id)}
                  />
                ))}
            </div>
          )}
          <div className="space-y-0.5">
            <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
              Priority
            </p>
            {TASK_PRIORITIES.map((item) => (
              <RailButton
                key={item.value}
                active={priorities.has(item.value)}
                label={
                  <span className="flex items-center gap-2">
                    <Flag
                      className={cn(
                        "size-3.5",
                        item.className ?? "text-muted-foreground",
                      )}
                      fill={item.className ? "currentColor" : "none"}
                      aria-hidden="true"
                    />
                    {item.label}
                  </span>
                }
                count={priorityCounts[item.value]}
                onClick={() => togglePriority(item.value)}
              />
            ))}
          </div>
        </nav>
      </ScrollArea>
    </>
  );

  return (
    <div className="h-[calc(100dvh-4rem)] min-h-0 overflow-hidden p-4 md:h-[100dvh] md:p-frame">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-page flex-col">
        <Card className="min-h-0 flex-1 gap-0 overflow-hidden py-0 md:flex-row">
          <aside className="hidden w-56 shrink-0 flex-col border-r bg-muted/30 md:flex">
            {rail}
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-4">
              <div className="md:hidden">
                <Select
                  value={view}
                  onValueChange={(value) => setView(value as ViewKey)}
                >
                  <SelectTrigger aria-label="View">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VIEWS.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <h2 className="hidden min-w-0 items-center gap-2 truncate text-sm font-semibold md:flex">
                {activeView.label}
                {isAdmin && (
                  <span className="font-normal text-muted-foreground">
                    · {assigneeLabel}
                  </span>
                )}
                <Badge variant="secondary">{visible.length}</Badge>
              </h2>
              <div className="ml-auto flex items-center gap-2">
                <InputGroup className="w-40 lg:w-56 bg-card">
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput
                    ref={searchRef}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search"
                    aria-label="Search tasks"
                  />
                  <InputGroupAddon
                    align="inline-end"
                    className="hidden lg:flex"
                  >
                    <Kbd>/</Kbd>
                  </InputGroupAddon>
                </InputGroup>
                <Popover>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button
                          variant={activeFilterCount ? "secondary" : "ghost"}
                          size="sm"
                          aria-label="Filter tasks"
                        >
                          <ListFilter />
                          <span className="hidden sm:inline">Filter</span>
                          {activeFilterCount > 0 && (
                            <Badge className="h-5 min-w-5 px-1 tabular-nums">
                              {activeFilterCount}
                            </Badge>
                          )}
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      Filter by case, client or type
                    </TooltipContent>
                  </Tooltip>
                  <PopoverContent align="end" className="w-72 space-y-3">
                    <Field>
                      <FieldLabel htmlFor="task-filter-case">Case</FieldLabel>
                      <Combobox
                        items={caseOptions}
                        itemToStringLabel={(c: CaseOption) => c.reference}
                        itemToStringValue={(c: CaseOption) =>
                          `${c.reference} ${c.clientName}`
                        }
                        value={caseFilter}
                        onValueChange={(c: CaseOption | null) =>
                          setCaseFilter(c)
                        }
                      >
                        <ComboboxInput
                          id="task-filter-case"
                          className="w-full"
                          placeholder="Any case"
                          showClear
                        />
                        <ComboboxContent>
                          <ComboboxEmpty>No cases found.</ComboboxEmpty>
                          <ComboboxList>
                            {(c: CaseOption) => (
                              <ComboboxItem key={c.id} value={c}>
                                <span className="shrink-0">{c.reference}</span>
                                {c.clientName && (
                                  <span className="truncate text-muted-foreground">
                                    · {c.clientName}
                                  </span>
                                )}
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="task-filter-client">
                        Client
                      </FieldLabel>
                      <Combobox
                        items={clientOptions}
                        itemToStringLabel={(c: ClientOption) => c.name}
                        itemToStringValue={(c: ClientOption) => c.name}
                        value={clientFilter}
                        onValueChange={(c: ClientOption | null) =>
                          setClientFilter(c)
                        }
                      >
                        <ComboboxInput
                          id="task-filter-client"
                          className="w-full"
                          placeholder="Any client"
                          showClear
                        />
                        <ComboboxContent>
                          <ComboboxEmpty>No clients found.</ComboboxEmpty>
                          <ComboboxList>
                            {(c: ClientOption) => (
                              <ComboboxItem key={c.id} value={c}>
                                {c.name}
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="task-filter-kind">Type</FieldLabel>
                      <Select value={kindFilter} onValueChange={setKindFilter}>
                        <SelectTrigger
                          id="task-filter-kind"
                          className="w-full"
                          aria-label="Task type"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any type</SelectItem>
                          {kindOptions.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {kindLabel(kind)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    {activeFilterCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={clearFilters}
                      >
                        Clear filters
                      </Button>
                    )}
                  </PopoverContent>
                </Popover>
                {mode === "list" && (
                  <Select
                    value={groupBy}
                    onValueChange={(value) => setGroupBy(value as GroupKey)}
                  >
                    <SelectTrigger
                      className="hidden lg:flex"
                      aria-label="Group by"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GROUPS.map((item) => (
                        <SelectItem key={item.key} value={item.key}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Tabs
                  value={mode}
                  onValueChange={(value) => setMode(value as Mode)}
                >
                  <TabsList>
                    <TabsTrigger value="list" aria-label="List view">
                      <LayoutList />
                    </TabsTrigger>
                    <TabsTrigger value="board" aria-label="Board view">
                      <SquareKanban />
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <Popover>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="hidden md:inline-flex"
                          aria-label="Keyboard shortcuts"
                        >
                          <Keyboard />
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Keyboard shortcuts</TooltipContent>
                  </Tooltip>
                  <PopoverContent align="end" className="w-64">
                    <dl className="space-y-2 text-sm">
                      {SHORTCUTS.map(([label, keys]) => (
                        <div
                          key={label}
                          className="flex items-center justify-between gap-3"
                        >
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd>
                            <KbdGroup>
                              {keys.map((key) => (
                                <Kbd key={key}>{key}</Kbd>
                              ))}
                            </KbdGroup>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </PopoverContent>
                </Popover>
              </div>
            </header>

            {activeFilterCount > 0 && (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2 md:px-4">
                {caseFilter && (
                  <FilterChip
                    label={`Case ${caseFilter.reference}`}
                    onClear={() => setCaseFilter(null)}
                  />
                )}
                {clientFilter && (
                  <FilterChip
                    label={clientFilter.name}
                    onClear={() => setClientFilter(null)}
                  />
                )}
                {kindFilter !== "any" && (
                  <FilterChip
                    label={kindLabel(kindFilter)}
                    onClear={() => setKindFilter("any")}
                  />
                )}
                <Button
                  variant="link"
                  size="sm"
                  className="h-6 px-1 text-xs"
                  onClick={clearFilters}
                >
                  Clear all
                </Button>
              </div>
            )}

            {view !== "done" && (
              <div className="shrink-0 border-b px-3 py-3 md:px-4">
                <QuickAdd
                  ref={quickAddRef}
                  staff={staff}
                  defaultAssigneeId={
                    typeof assigneeFilter === "number" ? assigneeFilter : null
                  }
                  pending={mutations.isCreating}
                  onCreate={(input, reset) =>
                    mutations.createTask(input, {
                      onSuccess: (task) => {
                        reset();
                        revealTask(task);
                      },
                    })
                  }
                />
              </div>
            )}

            {mode === "board" ? (
              <TaskBoard
                tasks={visible}
                activeId={activeId}
                showAssignee={showAssignee}
                onOpen={(task) => setActiveId(task.id)}
                onMove={(task, status) =>
                  mutations.updateTask(task, { status })
                }
              />
            ) : (
              <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
                <div ref={listRef} className="pb-4">
                  {groups.length === 0 ? (
                    <Empty className="py-16">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <activeView.icon />
                        </EmptyMedia>
                        <EmptyTitle>
                          {search || priorities.size || activeFilterCount
                            ? "Nothing matches"
                            : `Nothing in ${activeView.label.toLowerCase()}`}
                        </EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    groups.map((group) => {
                      const open = !collapsed.has(group.key);
                      const allSelected = group.tasks.every((task) =>
                        selected.has(task.id),
                      );
                      return (
                        <Collapsible
                          key={group.key}
                          open={open}
                          onOpenChange={() => toggleGroup(group.key)}
                        >
                          <div className="group/head sticky top-0 z-[1] flex items-center gap-1 bg-card/95 px-3 pt-3 pb-1 backdrop-blur supports-[backdrop-filter]:bg-card/80">
                            <CollapsibleTrigger asChild>
                              <Button
                                variant="ghost"
                                size="xs"
                                className="-ml-1 text-muted-foreground"
                              >
                                <ChevronRight
                                  className={cn(
                                    "transition-transform",
                                    open && "rotate-90",
                                  )}
                                />
                                <span className="text-xs font-medium tracking-wide uppercase">
                                  {group.label}
                                </span>
                                <span className="tabular-nums">
                                  {group.tasks.length}
                                </span>
                              </Button>
                            </CollapsibleTrigger>
                            <Button
                              variant="ghost"
                              size="xs"
                              className="ml-auto text-muted-foreground opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100"
                              onClick={() =>
                                setSelected((current) => {
                                  const next = new Set(current);
                                  for (const task of group.tasks) {
                                    if (allSelected) next.delete(task.id);
                                    else next.add(task.id);
                                  }
                                  return next;
                                })
                              }
                            >
                              {allSelected ? "Deselect all" : "Select all"}
                            </Button>
                          </div>
                          <CollapsibleContent>
                            <div className="px-1">
                              {group.tasks.map((task) => (
                                <TaskRow
                                  key={task.id}
                                  task={task}
                                  active={activeId === task.id}
                                  highlighted={justAddedId === task.id}
                                  selected={selected.has(task.id)}
                                  selecting={selected.size > 0}
                                  showAssignee={showAssignee}
                                  onOpen={(item) => setActiveId(item.id)}
                                  onToggleDone={mutations.toggleDone}
                                  onToggleSelect={toggleSelect}
                                />
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            )}

            {selected.size > 0 && (
              <div className="shrink-0 px-3 pb-3 md:px-4">
                <BulkBar
                  count={selected.size}
                  isAdmin={isAdmin}
                  staff={staff}
                  onStatus={bulk.status}
                  onPriority={bulk.priority}
                  onAssign={bulk.assign}
                  onDue={bulk.due}
                  onDelete={bulk.delete}
                  onClear={clearSelection}
                />
              </div>
            )}
          </div>

          {activeId !== null && isWide && (
            <aside
              className="flex w-96 shrink-0 flex-col border-l"
              aria-label="Task details"
            >
              {inspector(false)}
            </aside>
          )}
        </Card>
      </div>

      <Sheet
        open={activeId !== null && !isWide}
        onOpenChange={(open) => !open && setActiveId(null)}
      >
        <SheetContent
          className="w-full gap-0 p-0 sm:max-w-md data-[state=closed]:duration-150 data-[state=open]:duration-200"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Task details</SheetTitle>
            <SheetDescription>Edit the selected task.</SheetDescription>
          </SheetHeader>
          {!isWide && inspector(true)}
        </SheetContent>
      </Sheet>
    </div>
  );
}
