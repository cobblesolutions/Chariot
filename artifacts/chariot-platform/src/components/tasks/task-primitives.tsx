import type { ComponentProps } from "react";
import { Circle, CircleCheck, CircleDotDashed, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  dueKey,
  formatDateKey,
  formatDue,
  initialsOf,
  isOverdue,
  priorityClass,
  priorityLabel,
  statusLabel,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "./task-model";

export function StatusIcon({
  status,
  className,
}: {
  status: TaskStatus;
  className?: string;
}) {
  if (status === "done")
    return <CircleCheck className={cn("text-primary", className)} />;
  if (status === "in_progress")
    return <CircleDotDashed className={cn("text-primary", className)} />;
  return <Circle className={cn("text-muted-foreground/50", className)} />;
}

/** The tick circle at the start of every task row: completes or reopens the task. */
export function StatusToggle({
  task,
  onToggle,
  disabled,
  ...props
}: {
  task: Pick<Task, "status" | "title">;
  onToggle: () => void;
  disabled?: boolean;
} & Omit<ComponentProps<typeof Button>, "onClick" | "children">) {
  const label = task.status === "done" ? "Reopen task" : "Mark task complete";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`${label}: ${task.title}`}
          aria-pressed={task.status === "done"}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          {...props}
        >
          <StatusIcon status={task.status} className="size-4.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {task.status === "done"
          ? "Reopen"
          : `Complete (${statusLabel(task.status)})`}
      </TooltipContent>
    </Tooltip>
  );
}

/** Coloured flag for high/urgent/low priority; hidden for normal. */
export function PriorityFlag({
  priority,
  className,
  showLabel = false,
}: {
  priority: TaskPriority;
  className?: string;
  showLabel?: boolean;
}) {
  const color = priorityClass(priority);
  if (!color && !showLabel) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        color ?? "text-muted-foreground",
        className,
      )}
      title={`${priorityLabel(priority)} priority`}
    >
      <Flag
        className="size-3.5"
        fill={color ? "currentColor" : "none"}
        aria-hidden="true"
      />
      {showLabel && priorityLabel(priority)}
    </span>
  );
}

export function DueLabel({
  task,
  className,
}: {
  task: Pick<Task, "dueDate" | "status">;
  className?: string;
}) {
  const overdue = isOverdue(task);
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        overdue
          ? "font-medium text-red-600 dark:text-red-400"
          : "text-muted-foreground",
        task.status === "done" && "text-muted-foreground/70",
        className,
      )}
    >
      {task.status === "done" ? formatDateKey(dueKey(task)) : formatDue(task)}
    </span>
  );
}

export function AssigneeAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Avatar className={cn("size-6", className)}>
          <AvatarFallback className="text-xs font-medium">
            {initialsOf(name)}
          </AvatarFallback>
        </Avatar>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}
