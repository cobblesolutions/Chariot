import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  useListStaff,
  getListStaffQueryKey,
} from "@workspace/api-client-react";
import type { CaseDetail } from "@workspace/api-client-react";
import { ListTodo } from "lucide-react";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/components/auth-provider";
import { QuickAdd, type QuickAddHandle } from "@/components/tasks/quick-add";
import { TaskInspector } from "@/components/tasks/task-inspector";
import { TaskRow } from "@/components/tasks/task-row";
import { dueKey, priorityRank } from "@/components/tasks/task-model";
import { useTaskMutations } from "@/components/tasks/use-task-mutations";
import { SidePanelHeader } from "@/components/case/case-side-menu";

type CaseTasksPanelProps = {
  caseItem: CaseDetail;
  isAdmin: boolean;
  onClose?: () => void;
};

/**
 * The case's tasks in a side panel: quick-add on top, rows below, inspector
 * in a sheet. Ref focuses the quick-add input.
 */
export const CaseTasksPanel = forwardRef<QuickAddHandle, CaseTasksPanelProps>(
  function CaseTasksPanel({ caseItem, isAdmin, onClose }, ref) {
    const { user } = useAuth();
    const mutations = useTaskMutations();
    const { data: staff } = useListStaff({
      query: { enabled: isAdmin, queryKey: getListStaffQueryKey() },
    });
    const quickAddRef = useRef<QuickAddHandle>(null);
    const [showAll, setShowAll] = useState(true);
    const [showCompleted, setShowCompleted] = useState(false);
    const [activeId, setActiveId] = useState<number | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => quickAddRef.current?.focus(),
    }));

    const openCount = caseItem.tasks.filter((t) => t.status !== "done").length;
    const visibleTasks = caseItem.tasks
      .filter(
        (task) =>
          (showCompleted || task.status !== "done") &&
          (showAll || task.assignedUserId === user?.id),
      )
      .sort(
        (a, b) =>
          Number(a.status === "done") - Number(b.status === "done") ||
          dueKey(a).localeCompare(dueKey(b)) ||
          priorityRank[a.priority] - priorityRank[b.priority] ||
          a.id - b.id,
      );

    return (
      <div className="flex h-full min-h-0 flex-col">
        <SidePanelHeader
          icon={ListTodo}
          title="Tasks"
          count={openCount}
          onClose={onClose}
        />
        <div className="space-y-3 border-b px-4 py-3">
          <QuickAdd
            ref={quickAddRef}
            caseId={caseItem.id}
            staff={staff ?? []}
            pending={mutations.isCreating}
            onCreate={(input, reset) =>
              mutations.createTask(input, { onSuccess: () => reset() })
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <Tabs
              value={showAll ? "all" : "mine"}
              onValueChange={(v) => setShowAll(v === "all")}
            >
              <TabsList>
                <TabsTrigger value="all">Everyone</TabsTrigger>
                <TabsTrigger value="mine">Mine</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs
              value={showCompleted ? "all" : "open"}
              onValueChange={(v) => setShowCompleted(v === "all")}
            >
              <TabsList>
                <TabsTrigger value="open">Open</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {visibleTasks.length === 0 ? (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListTodo />
                </EmptyMedia>
                <EmptyTitle>
                  {showCompleted ? "No tasks found" : "No active tasks"}
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            visibleTasks.map((task) => {
              const canEdit = isAdmin || task.assignedUserId === user?.id;
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  active={activeId === task.id}
                  showAssignee
                  showCase={false}
                  readOnly={!canEdit}
                  onOpen={(item) => setActiveId(item.id)}
                  onToggleDone={mutations.toggleDone}
                />
              );
            })
          )}
        </div>

        <Sheet
          open={activeId !== null}
          onOpenChange={(open) => !open && setActiveId(null)}
        >
          <SheetContent
            className="w-full gap-0 p-0 sm:max-w-md"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Task details</SheetTitle>
              <SheetDescription>Edit the selected task.</SheetDescription>
            </SheetHeader>
            <TaskInspector
              taskId={activeId}
              staff={staff ?? []}
              onClose={() => setActiveId(null)}
              onDeleted={() => setActiveId(null)}
              hideClose
            />
          </SheetContent>
        </Sheet>
      </div>
    );
  },
);
