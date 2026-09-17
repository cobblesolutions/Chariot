import { useState } from "react";
import { format } from "date-fns";
import type { StaffUser } from "@workspace/api-client-react";
import {
  CalendarDays,
  CircleCheck,
  Flag,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "./task-model";
import { StatusIcon } from "./task-primitives";

export interface BulkBarProps {
  count: number;
  isAdmin: boolean;
  staff: StaffUser[];
  onStatus: (status: TaskStatus) => void;
  onPriority: (priority: TaskPriority) => void;
  onAssign: (member: StaffUser) => void;
  onDue: (date: string) => void;
  onDelete: () => void;
  onClear: () => void;
  className?: string;
}

/** Floating action strip shown while tasks are multi-selected. */
export function BulkBar({
  count,
  isAdmin,
  staff,
  onStatus,
  onPriority,
  onAssign,
  onDue,
  onDelete,
  onClear,
  className,
}: BulkBarProps) {
  const [dateOpen, setDateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (count === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label={`${count} tasks selected`}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm",
        className,
      )}
    >
      <span className="text-sm font-medium tabular-nums">{count} selected</span>
      <ButtonGroup>
        <Button variant="outline" size="sm" onClick={() => onStatus("done")}>
          <CircleCheck /> Complete
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Set status">
              Status
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {TASK_STATUSES.map((status) => (
              <DropdownMenuItem
                key={status.value}
                onClick={() => onStatus(status.value)}
              >
                <StatusIcon status={status.value} className="size-4" />
                {status.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Set priority">
              <Flag /> Priority
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {TASK_PRIORITIES.map((priority) => (
              <DropdownMenuItem
                key={priority.value}
                onClick={() => onPriority(priority.value)}
              >
                <Flag
                  className={cn(
                    "size-4",
                    priority.className ?? "text-muted-foreground",
                  )}
                  fill={priority.className ? "currentColor" : "none"}
                />
                {priority.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Reassign">
                <UserRound /> Assign
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {staff.map((member) => (
                <DropdownMenuItem
                  key={member.id}
                  onClick={() => onAssign(member)}
                >
                  {member.displayName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {isAdmin && (
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Reschedule">
                <CalendarDays /> Due
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                onSelect={(selected) => {
                  if (selected) onDue(format(selected, "yyyy-MM-dd"));
                  setDateOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        )}
      </ButtonGroup>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 /> Delete
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-auto"
        onClick={onClear}
        aria-label="Clear selection"
      >
        <X />
      </Button>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${count} ${count === 1 ? "task" : "tasks"}?`}
        description="This cannot be undone."
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
        }}
      />
    </div>
  );
}
