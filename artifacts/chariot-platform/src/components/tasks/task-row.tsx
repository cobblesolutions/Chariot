import { forwardRef, type KeyboardEvent, type MouseEvent } from "react";
import { Link } from "wouter";
import { ArrowUpRight, ListChecks, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AssigneeAvatar,
  DueLabel,
  PriorityFlag,
  StatusToggle,
} from "./task-primitives";
import { STATUS_TINT, taskAction, type Task } from "./task-model";

export interface TaskRowProps {
  task: Task;
  active?: boolean;
  /** Brief attention flash (a task that was just created). */
  highlighted?: boolean;
  selected?: boolean;
  /** When any row is selected the selection checkboxes stay visible on every row. */
  selecting?: boolean;
  /** Show who the task belongs to (hidden when the list is already filtered to one person). */
  showAssignee?: boolean;
  showCase?: boolean;
  /** Viewer may not change this task: no tick, no inspector. */
  readOnly?: boolean;
  onOpen: (task: Task) => void;
  onToggleDone: (task: Task) => void;
  onToggleSelect?: (task: Task, event: MouseEvent | KeyboardEvent) => void;
}

/**
 * One line per task: tick, title, and a quiet trail of metadata. Click opens
 * the inspector; ctrl/cmd-click (or the checkbox) adds to a selection.
 */
export const TaskRow = forwardRef<HTMLDivElement, TaskRowProps>(
  function TaskRow(
    {
      task,
      active = false,
      highlighted = false,
      selected = false,
      selecting = false,
      showAssignee = false,
      showCase = true,
      readOnly = false,
      onOpen,
      onToggleDone,
      onToggleSelect,
    },
    ref,
  ) {
    const done = task.status === "done";
    const hasChecklist = task.checklistTotal > 0;
    const action = taskAction(task);

    const handleClick = (event: MouseEvent<HTMLDivElement>) => {
      if (readOnly) return;
      if (
        (event.metaKey || event.ctrlKey || event.shiftKey) &&
        onToggleSelect
      ) {
        event.preventDefault();
        onToggleSelect(task, event);
        return;
      }
      onOpen(task);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || readOnly) return;
      if (event.key === "Enter") {
        event.preventDefault();
        onOpen(task);
      } else if (event.key === " ") {
        event.preventDefault();
        onToggleSelect?.(task, event);
      }
    };

    return (
      <div
        ref={ref}
        role={readOnly ? undefined : "button"}
        tabIndex={readOnly ? undefined : 0}
        aria-current={active ? "true" : undefined}
        aria-selected={selected || undefined}
        data-task-id={task.id}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "group/row my-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition-colors",
          "focus-visible:ring-[3px] focus-visible:ring-ring/50",
          // Same wash as the matching kanban column.
          STATUS_TINT[task.status],
          !readOnly && "cursor-pointer",
          active && "ring-1 ring-primary/40 ring-inset",
          highlighted && "animate-in fade-in bg-primary/10 duration-500",
          selected && "ring-1 ring-primary/30 ring-inset",
          done && "text-muted-foreground",
        )}
      >
        {onToggleSelect && !readOnly && (
          <span
            className={cn(
              "flex w-4 shrink-0 items-center justify-center transition-opacity",
              selecting || selected
                ? "opacity-100"
                : "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelect(task, {} as MouseEvent)}
              aria-label={`Select task: ${task.title}`}
            />
          </span>
        )}
        <StatusToggle
          task={task}
          onToggle={() => onToggleDone(task)}
          disabled={readOnly}
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate font-medium",
              done && "line-through decoration-muted-foreground/60",
            )}
          >
            {task.headline}
          </span>
          {task.headline !== task.title && (
            <span className="block truncate text-xs text-muted-foreground">
              {task.title}
              {task.checklistTotal > 0 &&
                ` · step ${task.checklistDone + 1} of ${task.checklistTotal}`}
            </span>
          )}
        </span>
        {action && !done && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                size="icon-xs"
                className="shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                aria-label={action.label}
                onClick={(event: MouseEvent) => event.stopPropagation()}
              >
                <Link href={action.href}>
                  <ArrowUpRight />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{action.label}</TooltipContent>
          </Tooltip>
        )}
        <span className="flex shrink-0 items-center gap-2">
          {showCase && task.caseReference && (
            <Badge
              variant="outline"
              className="hidden font-normal sm:inline-flex"
            >
              {task.caseReference}
            </Badge>
          )}
          {hasChecklist && (
            <span
              className={cn(
                "hidden max-w-[16rem] items-center gap-1 text-xs text-muted-foreground md:inline-flex",
                task.checklistDone === task.checklistTotal && "text-primary",
              )}
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
                <span className="hidden truncate lg:inline">
                  · {task.checklistNext}
                </span>
              )}
            </span>
          )}
          {task.commentCount > 0 && (
            <span className="hidden items-center gap-1 text-xs text-muted-foreground md:inline-flex">
              <MessageSquare className="size-3.5" aria-hidden="true" />
              {task.commentCount}
            </span>
          )}
          <PriorityFlag priority={task.priority} />
          <DueLabel task={task} className="w-24 text-right" />
          {showAssignee && <AssigneeAvatar name={task.assignee} />}
        </span>
      </div>
    );
  },
);
