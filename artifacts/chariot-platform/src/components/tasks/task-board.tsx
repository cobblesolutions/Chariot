import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  closestCorners,
  defaultDropAnimationSideEffects,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ListChecks, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import {
  AssigneeAvatar,
  DueLabel,
  PriorityFlag,
  StatusIcon,
} from "./task-primitives";
import {
  STATUS_TINT,
  TASK_STATUSES,
  type Task,
  type TaskStatus,
} from "./task-model";

export interface TaskBoardProps {
  tasks: Task[];
  activeId: number | null;
  showAssignee?: boolean;
  onOpen: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
}

type Columns = Record<TaskStatus, number[]>;

const emptyColumns = (): Columns => ({ todo: [], in_progress: [], done: [] });

const isStatus = (value: unknown): value is TaskStatus =>
  TASK_STATUSES.some((status) => status.value === value);

/**
 * Build the column lists from the task list, keeping any order the user has
 * dragged into place for ids that are still present. `pending` holds cards
 * that were just dropped into a new column: they stay there while the status
 * change is still on its way to the cache, so nothing jumps back and forth.
 */
function deriveColumns(
  tasks: Task[],
  previous: Columns | null,
  pending: Map<number, TaskStatus>,
): Columns {
  const next = emptyColumns();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const statusOf = (task: Task) => pending.get(task.id) ?? task.status;
  if (previous) {
    for (const status of TASK_STATUSES) {
      for (const id of previous[status.value]) {
        const task = byId.get(id);
        if (task && statusOf(task) === status.value) {
          next[status.value].push(id);
          byId.delete(id);
        }
      }
    }
  }
  for (const task of byId.values()) next[statusOf(task)].push(task.id);
  return next;
}

/** How far the lifted card tilts and grows while it is being carried. */
const LIFT = "rotate(2deg) scale(1.03)";

/** How many completed tasks the Done column shows while its "Recent" filter is on. */
const RECENT_DONE = 5;
/** Page size when the Done column is scrolled through in full. */
const DONE_PAGE = 20;

const DROP_MS = 240;
// A touch of overshoot so the card visibly "clicks" into its slot.
const DROP_EASING = "cubic-bezier(0.34, 1.25, 0.64, 1)";

/**
 * On release the lifted card glides from under the pointer to its slot; the
 * card inside settles flat over the same duration (see `Lifted`), so it reads
 * as one motion. The real card stays hidden until the overlay lands on it.
 */
const dropAnimation: DropAnimation = {
  duration: DROP_MS,
  easing: DROP_EASING,
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0" } },
  }),
};

/**
 * Whether a card is currently being carried. The overlay keeps rendering a
 * clone of its last child during the drop animation, so the tilt has to come
 * from context (which still updates the clone) rather than from props.
 */
const Lifted = createContext(false);

/** Kanban of the current view: drag cards between (and within) columns; dropping in a new column changes the status. */
export function TaskBoard({
  tasks,
  activeId,
  showAssignee = false,
  onOpen,
  onMove,
}: TaskBoardProps) {
  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const pending = useRef(new Map<number, TaskStatus>());
  const [columns, setColumns] = useState<Columns>(() =>
    deriveColumns(tasks, null, pending.current),
  );
  const [dragId, setDragId] = useState<number | null>(null);

  // Re-sync when the task list changes (new tasks, filters, server updates) but
  // never while a drag is in flight, so the columns don't jump under the pointer.
  useEffect(() => {
    if (dragId !== null) return;
    for (const [id, status] of pending.current) {
      const task = taskById.get(id);
      if (!task || task.status === status) pending.current.delete(id);
    }
    setColumns((previous) => deriveColumns(tasks, previous, pending.current));
  }, [tasks, taskById, dragId]);

  // Keep the closed hand while carrying, wherever the pointer wanders.
  useEffect(() => {
    if (dragId === null) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.cursor = previous;
    };
  }, [dragId]);

  const sensors = useSensors(
    // A small activation distance keeps plain clicks opening the inspector.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space picks a card up (Enter keeps opening it), arrows move it, Escape cancels.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
    }),
  );

  /**
   * Magnetic targeting: first decide which column the pointer is in (falling
   * back to the column the card overlaps most), then snap to the nearest card
   * slot in that column — or to the end of the column when the pointer is
   * below its last card.
   */
  const collisionDetection: CollisionDetection = (args) => {
    const columnHit =
      pointerWithin(args).find((hit) => isStatus(hit.id)) ??
      rectIntersection(args).find((hit) => isStatus(hit.id));
    if (!columnHit) return closestCorners(args);
    const status = columnHit.id as TaskStatus;
    const ids = columns[status].filter((id) => id !== dragId);
    const cards = args.droppableContainers.filter((container) =>
      ids.includes(Number(container.id)),
    );
    const pointerY = args.pointerCoordinates?.y;
    const lastRect = ids.length
      ? args.droppableRects.get(ids[ids.length - 1]!)
      : undefined;
    if (
      !cards.length ||
      (pointerY !== undefined && lastRect && pointerY > lastRect.bottom)
    ) {
      return [{ id: status }];
    }
    const nearest = closestCenter({ ...args, droppableContainers: cards });
    return nearest.length ? nearest : [{ id: status }];
  };

  const columnOf = (id: number | string, cols: Columns): TaskStatus | null => {
    if (isStatus(id)) return id;
    for (const status of TASK_STATUSES) {
      if (cols[status.value].includes(Number(id))) return status.value;
    }
    return null;
  };

  const onDragStart = ({ active }: DragStartEvent) =>
    setDragId(Number(active.id));

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setColumns((cols) => {
      const from = columnOf(active.id, cols);
      const to = columnOf(over.id, cols);
      if (!from || !to || from === to) return cols;
      const id = Number(active.id);
      const source = cols[from].filter((item) => item !== id);
      const target = [...cols[to]];
      const overIndex = isStatus(over.id)
        ? target.length
        : target.indexOf(Number(over.id));
      target.splice(overIndex < 0 ? target.length : overIndex, 0, id);
      return { ...cols, [from]: source, [to]: target };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = Number(active.id);
    const task = taskById.get(id);
    setDragId(null);
    if (!task) return;
    const to = columnOf(id, columns) ?? task.status;
    if (over && !isStatus(over.id)) {
      const list = columns[to];
      const fromIndex = list.indexOf(id);
      const toIndex = list.indexOf(Number(over.id));
      if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
        setColumns({ ...columns, [to]: arrayMove(list, fromIndex, toIndex) });
      }
    }
    if (to !== task.status) {
      pending.current.set(id, to);
      onMove(task, to);
    }
  };

  const onDragCancel = () => {
    setDragId(null);
    setColumns((previous) => deriveColumns(tasks, previous, pending.current));
  };

  const dragging = dragId !== null ? (taskById.get(dragId) ?? null) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
        {TASK_STATUSES.map((column) => (
          <BoardColumn
            key={column.value}
            status={column.value}
            label={column.label}
            ids={columns[column.value]}
            taskById={taskById}
            activeId={activeId}
            dragId={dragId}
            showAssignee={showAssignee}
            onOpen={onOpen}
          />
        ))}
      </div>
      <Lifted.Provider value={dragId !== null}>
        <DragOverlay dropAnimation={dropAnimation}>
          {dragging ? (
            <BoardCard task={dragging} showAssignee={showAssignee} overlay />
          ) : null}
        </DragOverlay>
      </Lifted.Provider>
    </DndContext>
  );
}

function BoardColumn({
  status,
  label,
  ids,
  taskById,
  activeId,
  dragId,
  showAssignee,
  onOpen,
}: {
  status: TaskStatus;
  label: string;
  ids: number[];
  taskById: Map<number, Task>;
  activeId: number | null;
  dragId: number | null;
  showAssignee: boolean;
  onOpen: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [recentOnly, setRecentOnly] = useState(true);
  const [pageCount, setPageCount] = useState(1);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isDone = status === "done";

  // Done reads newest-first; the other columns keep the dragged order.
  const ordered = useMemo(() => {
    const all = ids
      .map((id) => taskById.get(id))
      .filter((task): task is Task => !!task);
    if (!isDone) return all;
    return [...all].sort(
      (a, b) =>
        String(b.completedAt ?? "").localeCompare(
          String(a.completedAt ?? ""),
        ) || b.id - a.id,
    );
  }, [ids, taskById, isDone]);
  const limit = !isDone
    ? ordered.length
    : recentOnly
      ? RECENT_DONE
      : Math.min(ordered.length, pageCount * DONE_PAGE);
  const items = ordered.slice(0, limit);
  const hasMore = limit < ordered.length;

  // Infinite scroll: reveal the next page when the sentinel scrolls into view.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || recentOnly) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting))
        setPageCount((count) => count + 1);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, recentOnly, items.length]);
  // Highlight the column while it holds a card that started somewhere else.
  const dragging = dragId !== null ? taskById.get(dragId) : undefined;
  const receiving =
    !!dragging &&
    dragging.status !== status &&
    (isOver || ids.includes(dragging.id));

  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      className={cn(
        "flex min-h-0 w-72 shrink-0 flex-col rounded-md border border-transparent transition-colors duration-200",
        STATUS_TINT[status],
        receiving && "border-primary/40",
      )}
    >
      <header className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
        <StatusIcon status={status} className="size-4" />
        <h3 className="text-sm font-semibold">{label}</h3>
        {isDone && (
          <Label className="ml-auto gap-1.5 text-xs font-normal text-muted-foreground">
            <Switch
              size="sm"
              checked={recentOnly}
              onCheckedChange={(checked) => {
                setRecentOnly(checked);
                setPageCount(1);
              }}
              aria-label={`Show only the last ${RECENT_DONE} completed tasks`}
            />
            Last {RECENT_DONE}
          </Label>
        )}
        <span
          className={cn(
            "text-xs tabular-nums text-muted-foreground",
            !isDone && "ml-auto",
          )}
        >
          {isDone && recentOnly && ordered.length > items.length
            ? `${items.length} of ${ordered.length}`
            : ordered.length}
        </span>
      </header>
      <SortableContext
        id={status}
        items={items.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-2.5 pb-2.5">
          {items.length === 0 && (
            <p
              className={cn(
                "rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground transition-colors",
                receiving && "border-primary/50 text-primary",
              )}
            >
              {dragId !== null ? "Drop here" : "Nothing here"}
            </p>
          )}
          {items.map((task) => (
            <SortableCard
              key={task.id}
              task={task}
              active={activeId === task.id}
              showAssignee={showAssignee}
              onOpen={onOpen}
            />
          ))}
          {isDone && hasMore && !recentOnly && (
            <div
              ref={sentinelRef}
              className="py-2 text-center text-xs text-muted-foreground"
            >
              Loading more…
            </div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({
  task,
  active,
  showAssignee,
  onOpen,
}: {
  task: Task;
  active: boolean;
  showAssignee: boolean;
  onOpen: (task: Task) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 touch-none",
        // While carried, the card's slot shows as a dashed target so the landing spot is obvious.
        isDragging &&
          "bg-primary/5 outline-1 outline-dashed -outline-offset-1 outline-primary/50 *:invisible",
      )}
      aria-label={task.title}
      onClick={() => onOpen(task)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !isDragging) onOpen(task);
      }}
      {...attributes}
      {...listeners}
    >
      <BoardCard task={task} active={active} showAssignee={showAssignee} />
    </div>
  );
}

function BoardCard({
  task,
  active = false,
  showAssignee,
  overlay = false,
}: {
  task: Task;
  active?: boolean;
  showAssignee: boolean;
  overlay?: boolean;
}) {
  const carried = useContext(Lifted);
  // Mount flat, then tilt on the next frame so the pick-up animates too.
  const [tilted, setTilted] = useState(false);
  useEffect(() => {
    if (!overlay) return;
    const frame = requestAnimationFrame(() => setTilted(carried));
    return () => cancelAnimationFrame(frame);
  }, [overlay, carried]);
  return (
    <Item
      asChild
      variant="outline"
      size="sm"
      className={cn(
        "cursor-grab border-border/60 bg-card shadow-xs select-none transition-shadow duration-200 hover:shadow-md active:cursor-grabbing",
        active && "border-primary/50",
        overlay && "cursor-grabbing",
        overlay && tilted && "shadow-xl ring-[3px] ring-ring/40",
      )}
    >
      <div
        style={
          overlay
            ? {
                transform: tilted ? LIFT : "none",
                transition: `transform ${DROP_MS}ms ${DROP_EASING}`,
              }
            : undefined
        }
      >
        <ItemContent className="gap-2">
          <ItemTitle
            className={cn(
              "leading-snug",
              task.status === "done" && "text-muted-foreground line-through",
            )}
          >
            {task.headline}
          </ItemTitle>
          {task.headline !== task.title ? (
            <ItemDescription className="truncate text-xs">
              {task.title}
              {task.clientName ? ` · ${task.clientName}` : ""}
            </ItemDescription>
          ) : task.caseReference ? (
            <ItemDescription className="truncate text-xs">
              {task.caseReference} · {task.clientName}
            </ItemDescription>
          ) : null}
          <div className="flex items-center gap-3">
            <DueLabel task={task} />
            <PriorityFlag priority={task.priority} />
            {task.checklistTotal > 0 && (
              <span
                className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
                title={
                  task.checklistNext
                    ? `Up to: ${task.checklistNext}`
                    : "All steps done"
                }
              >
                <ListChecks className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="tabular-nums">
                  {task.checklistDone}/{task.checklistTotal}
                </span>
                {task.checklistNext && task.headline === task.title && (
                  <span className="truncate">· {task.checklistNext}</span>
                )}
              </span>
            )}
            {task.commentCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MessageSquare className="size-3.5" aria-hidden="true" />
                {task.commentCount}
              </span>
            )}
            {showAssignee && (
              <AssigneeAvatar name={task.assignee} className="ml-auto size-5" />
            )}
          </div>
        </ItemContent>
      </div>
    </Item>
  );
}
