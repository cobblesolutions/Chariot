import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetTaskQueryKey,
  getListTasksQueryKey,
  useGetTask,
  useListCases,
  type Case,
  type StaffUser,
  type Task,
  type TaskDetail,
} from "@workspace/api-client-react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Flag,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AssigneePicker } from "@/components/assignee-picker";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DatePicker } from "@/components/date-picker";
import { useAuth } from "@/components/auth-provider";
import { isFullAccess } from "@/lib/roles";
import { formatDate } from "@/lib/utils";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  dueKey,
  formatDateKey,
  formatRelative,
  initialsOf,
  isOverdue,
  priorityClass,
  taskAction,
} from "./task-model";
import { StatusIcon, StatusToggle } from "./task-primitives";
import { useTaskMutations } from "./use-task-mutations";

export interface TaskInspectorProps {
  taskId: number | null;
  staff: StaffUser[];
  onClose: () => void;
  /** Called after the task has been deleted (the page clears its selection). */
  onDeleted?: () => void;
  /** Hide the close button (the host renders its own, e.g. a Sheet). */
  hideClose?: boolean;
  className?: string;
}

/**
 * Everything about one task, edited in place: no dialogs, every field saves
 * as you leave it. Docked beside the list on wide screens, a sheet elsewhere.
 */
export function TaskInspector({
  taskId,
  staff,
  onClose,
  onDeleted,
  hideClose,
  className,
}: TaskInspectorProps) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);
  const mutations = useTaskMutations();
  const { data: cases } = useListCases();

  // The list row paints instantly; the detail query then fills in checklist + comments.
  const cached = useMemo(
    () =>
      qc
        .getQueryData<Task[]>(getListTasksQueryKey())
        ?.find((task) => task.id === taskId) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, taskId],
  );
  const { data: detail, isLoading } = useGetTask(taskId ?? 0, {
    query: {
      enabled: taskId !== null,
      queryKey: getGetTaskQueryKey(taskId ?? 0),
    },
  });
  const task: TaskDetail | null =
    detail ?? (cached ? { ...cached, checklist: [], comments: [] } : null);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [checklistDraft, setChecklistDraft] = useState("");
  const [comment, setComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setTitle(task?.title ?? "");
    setNotes(task?.notes ?? "");
    setChecklistDraft("");
    setComment("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, task?.title, task?.notes]);

  if (taskId === null) return null;

  if (!task) {
    return (
      <div className={cn("flex h-full flex-col", className)}>
        <div className="space-y-4 p-4">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  const canEdit = isAdmin || task.assignedUserId === user?.id;
  const canDelete = isAdmin || task.createdByUserId === user?.id;
  const selectedCase = cases?.find((c) => c.id === task.caseId) ?? null;
  const action = taskAction(task);
  const done = task.status === "done";
  const checklistDone = task.checklist.filter((item) => item.done).length;
  const checklistPct = task.checklist.length
    ? Math.round((checklistDone / task.checklist.length) * 100)
    : 0;

  const saveTitle = () => {
    const next = title.trim();
    if (!next) {
      setTitle(task.title);
      return;
    }
    if (next !== task.title) mutations.updateTask(task, { title: next });
  };
  const saveNotes = () => {
    if (notes !== task.notes) mutations.updateTask(task, { notes });
  };
  const submitChecklist = () => {
    const next = checklistDraft.trim();
    if (!next) return;
    mutations.addChecklist(task, next);
    setChecklistDraft("");
  };
  const submitComment = () => {
    const next = comment.trim();
    if (!next) return;
    mutations.postComment(task, next, { onSuccess: () => setComment("") });
  };
  const onTitleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setTitle(task.title);
      event.currentTarget.blur();
    }
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2 border-b pl-3",
          // A hosting Sheet draws its own close button in the top-right corner.
          hideClose ? "pr-12" : "pr-2",
        )}
      >
        <StatusToggle
          task={task}
          onToggle={() => mutations.toggleDone(task)}
          disabled={!canEdit}
        />
        <span className="text-xs text-muted-foreground">Task #{task.id}</span>
        <span className="flex-1" />
        {canDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Task actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 /> Delete task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {!hideClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close task"
          >
            <X />
          </Button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
        <div className="min-w-0 space-y-6 p-4">
          {task.headline !== task.title && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                Up next · step {task.checklistDone + 1} of {task.checklistTotal}
              </p>
              <p className="mt-0.5 text-base font-semibold leading-snug">{task.headline}</p>
            </div>
          )}
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={onTitleKey}
            disabled={!canEdit}
            aria-label="Task title"
            className={cn(
              "font-semibold",
              task.status === "done" && "line-through text-muted-foreground",
            )}
          />

          {/* Where to do it, and how to close it — the two things a task is for. */}
          <div className="flex flex-wrap items-center gap-2">
            {action && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild size="sm" className="min-w-0">
                    <Link href={action.href}>
                      <span className="truncate">{action.label}</span>
                      <ArrowUpRight />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{action.destination}</TooltipContent>
              </Tooltip>
            )}
            {canEdit && (
              <Button
                size="sm"
                variant={action ? "outline" : "default"}
                onClick={() => mutations.toggleDone(task)}
              >
                {done ? (
                  <>
                    <RotateCcw /> Reopen
                  </>
                ) : (
                  <>
                    <Check /> Mark complete
                  </>
                )}
              </Button>
            )}
          </div>

          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="min-w-0">
              <Select
                value={task.status}
                onValueChange={(value) =>
                  mutations.updateTask(task, {
                    status: value as Task["status"],
                  })
                }
                disabled={!canEdit}
              >
                <SelectTrigger className="w-full" aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      <StatusIcon status={status.value} className="size-4" />
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </dd>

            <dt className="text-xs text-muted-foreground">Priority</dt>
            <dd className="min-w-0">
              <Select
                value={task.priority}
                onValueChange={(value) =>
                  mutations.updateTask(task, {
                    priority: value as Task["priority"],
                  })
                }
                disabled={!canEdit}
              >
                <SelectTrigger className="w-full" aria-label="Priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((priority) => (
                    <SelectItem key={priority.value} value={priority.value}>
                      <Flag
                        className={cn(
                          "size-4",
                          priorityClass(priority.value) ??
                            "text-muted-foreground",
                        )}
                        fill={
                          priorityClass(priority.value)
                            ? "currentColor"
                            : "none"
                        }
                      />
                      {priority.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </dd>

            <dt className="text-xs text-muted-foreground">Assignee</dt>
            <dd className="min-w-0">
              {isAdmin ? (
                <AssigneePicker
                  value={String(task.assignedUserId)}
                  onValueChange={(value) => {
                    const member = staff.find((s) => String(s.id) === value);
                    mutations.updateTask(
                      task,
                      { assignedUserId: Number(value) },
                      member ? { assignee: member.displayName } : {},
                    );
                  }}
                  staff={staff}
                  aria-label="Assignee"
                />
              ) : (
                <span className="flex h-9 items-center gap-2">
                  <Avatar className="size-6">
                    <AvatarFallback className="text-xs">
                      {initialsOf(task.assignee)}
                    </AvatarFallback>
                  </Avatar>
                  {task.assignee}
                </span>
              )}
            </dd>

            <dt className="text-xs text-muted-foreground">Due</dt>
            <dd className="min-w-0">
              {isAdmin ? (
                <DatePicker
                  value={dueKey(task)}
                  onChange={(value) => {
                    if (value) mutations.updateTask(task, { dueDate: value });
                  }}
                  aria-label="Due date"
                  className={cn(
                    isOverdue(task) && "text-red-600 dark:text-red-400",
                  )}
                />
              ) : (
                <span
                  className={cn(
                    "flex h-9 items-center gap-2",
                    isOverdue(task) && "text-red-600 dark:text-red-400",
                  )}
                >
                  <CalendarDays className="size-4 text-muted-foreground" />
                  {formatDateKey(dueKey(task))}
                </span>
              )}
            </dd>

            <dt className="text-xs text-muted-foreground">Case</dt>
            <dd className="min-w-0">
              {canEdit ? (
                <Combobox
                  items={cases ?? []}
                  itemToStringLabel={(c: Case) =>
                    `${c.reference} · ${c.clientName}`
                  }
                  itemToStringValue={(c: Case) =>
                    `${c.reference} ${c.clientName}`
                  }
                  value={selectedCase}
                  onValueChange={(c: Case | null) =>
                    mutations.updateTask(
                      task,
                      { caseId: c?.id ?? null },
                      {
                        caseReference: c?.reference ?? null,
                        clientName: c?.clientName ?? null,
                      },
                    )
                  }
                >
                  <ComboboxInput
                    className="w-full"
                    placeholder="No case"
                    aria-label="Case"
                  />
                  <ComboboxContent>
                    <ComboboxEmpty>No cases found.</ComboboxEmpty>
                    <ComboboxList>
                      {(c: Case) => (
                        <ComboboxItem key={c.id} value={c}>
                          {c.reference}
                          <span className="text-muted-foreground">
                            {" "}
                            · {c.clientName}
                          </span>
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              ) : (
                <span className="flex h-9 items-center">
                  {task.caseReference
                    ? `${task.caseReference} · ${task.clientName}`
                    : "No case"}
                </span>
              )}
            </dd>
          </dl>

          <Field>
            <FieldLabel htmlFor={`task-notes-${task.id}`}>Notes</FieldLabel>
            <Textarea
              id={`task-notes-${task.id}`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={saveNotes}
              disabled={!canEdit}
              placeholder="Add context, links or next steps…"
              rows={3}
            />
          </Field>

          <Separator />

          <section className="space-y-3" aria-label="Checklist">
            <div className="flex items-center gap-2">
              <ListChecks className="size-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-medium">Checklist</h3>
              {task.checklist.length > 0 && (
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {checklistDone}/{task.checklist.length}
                </span>
              )}
            </div>
            {task.checklist.length > 0 && (
              <Progress value={checklistPct} aria-label="Checklist progress" />
            )}
            {isLoading && !detail ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <ul className="space-y-1">
                {task.checklist.map((item) => (
                  <li
                    key={item.id}
                    className="group/check flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50"
                  >
                    <Checkbox
                      id={`check-${item.id}`}
                      checked={item.done}
                      disabled={!canEdit || !!item.lockedHint}
                      onCheckedChange={(checked) =>
                        mutations.setChecklistItem(task, item.id, {
                          done: checked === true,
                        })
                      }
                    />
                    <label
                      htmlFor={`check-${item.id}`}
                      className={cn(
                        "flex-1 text-sm",
                        !item.lockedHint && "cursor-pointer",
                        item.done && "text-muted-foreground line-through",
                      )}
                      title={item.lockedHint ?? undefined}
                    >
                      {item.title}
                    </label>
                    {item.sourceKey && (
                      <span
                        className="text-[10px] uppercase tracking-wide text-muted-foreground"
                        title={
                          item.lockedHint
                            ? `${item.lockedHint} — it ticks itself once recorded`
                            : "Kept in step with the case: ticking it here marks it on the case too"
                        }
                      >
                        {item.lockedHint ? "on the case" : "synced"}
                      </span>
                    )}
                    {canEdit && !item.sourceKey && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-0 group-hover/check:opacity-100 focus-visible:opacity-100"
                        aria-label={`Remove step: ${item.title}`}
                        onClick={() =>
                          mutations.removeChecklistItem(task, item.id)
                        }
                      >
                        <X />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <InputGroup>
                <InputGroupInput
                  value={checklistDraft}
                  onChange={(event) => setChecklistDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitChecklist();
                    }
                  }}
                  placeholder="Add a step and press Enter"
                  aria-label="New checklist step"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Add step"
                    disabled={
                      !checklistDraft.trim() || mutations.isAddingChecklist
                    }
                    onClick={submitChecklist}
                  >
                    <Plus />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            )}
          </section>

          <Separator />

          <section className="space-y-3" aria-label="Comments">
            <div className="flex items-center gap-2">
              <MessageSquare
                className="size-4 text-primary"
                aria-hidden="true"
              />
              <h3 className="text-sm font-medium">Comments</h3>
              {task.comments.length > 0 && (
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {task.comments.length}
                </span>
              )}
            </div>
            {task.comments.length === 0 ? (
              !isLoading && (
                <Empty className="py-6">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageSquare />
                    </EmptyMedia>
                    <EmptyDescription>No comments yet.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )
            ) : (
              <ul className="space-y-3">
                {task.comments.map((item) => (
                  <li key={item.id} className="group/comment flex gap-2.5">
                    <Avatar className="size-6 shrink-0">
                      <AvatarFallback className="text-xs">
                        {initialsOf(item.authorName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium">
                          {item.authorName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelative(item.createdAt)}
                        </span>
                        {(isAdmin || item.authorUserId === user?.id) && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="ml-auto opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100"
                            aria-label="Remove comment"
                            onClick={() =>
                              mutations.removeComment(task, item.id)
                            }
                          >
                            <X />
                          </Button>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-foreground/90">
                        {item.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2">
              <Textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    event.preventDefault();
                    submitComment();
                  }
                }}
                placeholder="Write a comment… (Ctrl+Enter to post)"
                rows={2}
                aria-label="New comment"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={submitComment}
                  disabled={!comment.trim() || mutations.isPostingComment}
                >
                  Comment
                </Button>
              </div>
            </div>
          </section>

          <Separator />

          <dl className="space-y-1 text-xs text-muted-foreground">
            <div className="flex gap-2">
              <dt>Created</dt>
              <dd className="min-w-0">
                {formatDate(task.createdAt)}
                {task.createdByName
                  ? ` by ${task.createdByName}`
                  : " automatically"}
              </dd>
            </div>
            {task.completedAt && (
              <div className="flex gap-2">
                <dt>Completed</dt>
                <dd>{formatDate(task.completedAt)}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt>Assigned to</dt>
              <dd className="flex items-center gap-1">
                <UserRound className="size-3" aria-hidden="true" />{" "}
                {task.assignee}
              </dd>
            </div>
          </dl>
        </div>
      </ScrollArea>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this task?"
        description="This cannot be undone."
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          mutations.deleteTask(task, { onSuccess: () => onDeleted?.() });
          onClose();
        }}
      />
    </div>
  );
}
