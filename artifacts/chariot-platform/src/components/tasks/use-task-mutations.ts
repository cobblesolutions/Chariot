import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCaseQueryKey,
  getGetTaskQueryKey,
  getListTasksQueryKey,
  useBulkDeleteTasks,
  useBulkUpdateTasks,
  useCreateTask,
  useCreateTaskChecklistItem,
  useCreateTaskComment,
  useDeleteTask,
  useDeleteTaskChecklistItem,
  useDeleteTaskComment,
  useUpdateTask,
  useUpdateTaskChecklistItem,
  type Task,
  type TaskBulkUpdate,
  type TaskDetail,
  type TaskInput,
  type TaskUpdate,
} from "@workspace/api-client-react";
import { toast } from "@/components/ui/toast";

export function apiErrorMessage(error: unknown): string | undefined {
  const data = (error as { data?: { error?: string; incomplete?: string[] } } | undefined)?.data;
  if (data && typeof data.error === "string") {
    // A stage hand-off refused because the case can't move on lists what is still open.
    return data.incomplete?.length ? `${data.error}: ${data.incomplete.join(", ")}` : data.error;
  }
  return error instanceof Error ? error.message : undefined;
}

const failToast = (title: string) => (error: unknown) =>
  toast.add({ title, description: apiErrorMessage(error), type: "error" });

/** Fields of an update that can be mirrored straight onto the cached task before the server answers. */
function optimisticPatch(data: TaskUpdate): Partial<Task> {
  const patch: Partial<Task> = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.notes !== undefined) patch.notes = data.notes;
  if (data.priority !== undefined) patch.priority = data.priority;
  if (data.caseId !== undefined) patch.caseId = data.caseId;
  if (data.dueDate !== undefined) patch.dueDate = data.dueDate;
  if (data.assignedUserId !== undefined)
    patch.assignedUserId = data.assignedUserId;
  const status =
    data.status ??
    (data.completed === true
      ? "done"
      : data.completed === false
        ? "todo"
        : undefined);
  if (status !== undefined) {
    patch.status = status;
    patch.completedAt = status === "done" ? new Date().toISOString() : null;
  }
  return patch;
}

/**
 * Every task mutation the UI needs, with optimistic cache updates so ticking,
 * re-prioritising and editing feel instant. Failures roll back and toast.
 */
export function useTaskMutations() {
  const qc = useQueryClient();
  const listKey = getListTasksQueryKey();

  const invalidate = useCallback(
    (task?: Pick<Task, "id" | "caseId"> | null) => {
      qc.invalidateQueries({ queryKey: listKey });
      if (task) {
        qc.invalidateQueries({ queryKey: getGetTaskQueryKey(task.id) });
        if (task.caseId)
          qc.invalidateQueries({ queryKey: getGetCaseQueryKey(task.caseId) });
      }
    },
    [qc, listKey],
  );

  const patchCaches = useCallback(
    (id: number, patch: Partial<Task>) => {
      // Stop an in-flight poll from painting stale rows over the optimistic patch.
      void qc.cancelQueries({ queryKey: listKey });
      const prevList = qc.getQueryData<Task[]>(listKey);
      const detailKey = getGetTaskQueryKey(id);
      const prevDetail = qc.getQueryData<TaskDetail>(detailKey);
      if (prevList) {
        qc.setQueryData<Task[]>(
          listKey,
          prevList.map((task) =>
            task.id === id ? { ...task, ...patch } : task,
          ),
        );
      }
      if (prevDetail)
        qc.setQueryData<TaskDetail>(detailKey, { ...prevDetail, ...patch });
      return () => {
        if (prevList) qc.setQueryData(listKey, prevList);
        if (prevDetail) qc.setQueryData(detailKey, prevDetail);
      };
    },
    [qc, listKey],
  );

  const removeFromCaches = useCallback(
    (ids: number[]) => {
      const prevList = qc.getQueryData<Task[]>(listKey);
      if (prevList)
        qc.setQueryData<Task[]>(
          listKey,
          prevList.filter((task) => !ids.includes(task.id)),
        );
      return () => {
        if (prevList) qc.setQueryData(listKey, prevList);
      };
    },
    [qc, listKey],
  );

  const update = useUpdateTask({
    mutation: {
      onError: failToast("Task was not updated"),
      onSuccess: (task) => patchCaches(task.id, task),
      onSettled: (task, _error, variables) =>
        invalidate(task ?? { id: variables.id, caseId: null }),
    },
  });
  const create = useCreateTask({
    mutation: {
      onError: failToast("Task was not created"),
      onSuccess: (task) => {
        qc.setQueryData<Task[]>(listKey, (old) =>
          old ? [...old, task] : [task],
        );
        invalidate(task);
      },
    },
  });
  const remove = useDeleteTask({
    mutation: {
      onError: failToast("Task was not deleted"),
      onSettled: () => invalidate(),
    },
  });
  const bulkUpdate = useBulkUpdateTasks({
    mutation: {
      onError: failToast("Tasks were not updated"),
      onSuccess: (tasks) => {
        for (const task of tasks) patchCaches(task.id, task);
      },
      onSettled: () => invalidate(),
    },
  });
  const bulkDelete = useBulkDeleteTasks({
    mutation: {
      onError: failToast("Tasks were not deleted"),
      onSettled: () => invalidate(),
    },
  });

  const addChecklistItem = useCreateTaskChecklistItem({
    mutation: { onError: failToast("Checklist item was not added") },
  });
  const updateChecklistItem = useUpdateTaskChecklistItem({
    mutation: { onError: failToast("Checklist item was not updated") },
  });
  const deleteChecklistItem = useDeleteTaskChecklistItem({
    mutation: { onError: failToast("Checklist item was not removed") },
  });
  const addComment = useCreateTaskComment({
    mutation: { onError: failToast("Comment was not posted") },
  });
  const deleteComment = useDeleteTaskComment({
    mutation: { onError: failToast("Comment was not removed") },
  });

  /** Patch one task; `extra` carries display fields (e.g. the new assignee's name) for the optimistic row. */
  const updateTask = useCallback(
    (
      task: Pick<Task, "id" | "caseId">,
      data: TaskUpdate,
      extra: Partial<Task> = {},
    ) => {
      const rollback = patchCaches(task.id, {
        ...optimisticPatch(data),
        ...extra,
      });
      update.mutate({ id: task.id, data }, { onError: rollback });
    },
    [patchCaches, update],
  );

  const toggleDone = useCallback(
    (task: Task) =>
      updateTask(task, { status: task.status === "done" ? "todo" : "done" }),
    [updateTask],
  );

  const createTask = useCallback(
    (data: TaskInput, callbacks?: { onSuccess?: (task: Task) => void }) =>
      create.mutate({ data }, { onSuccess: callbacks?.onSuccess }),
    [create],
  );

  const deleteTask = useCallback(
    (task: Task, callbacks?: { onSuccess?: () => void }) => {
      const rollback = removeFromCaches([task.id]);
      remove.mutate(
        { id: task.id },
        {
          onError: rollback,
          onSuccess: () => {
            if (task.caseId)
              qc.invalidateQueries({
                queryKey: getGetCaseQueryKey(task.caseId),
              });
            callbacks?.onSuccess?.();
          },
        },
      );
    },
    [remove, removeFromCaches, qc],
  );

  const bulkUpdateTasks = useCallback(
    (
      ids: number[],
      data: Omit<TaskBulkUpdate, "ids">,
      extra: Partial<Task> = {},
    ) => {
      const patch = { ...optimisticPatch(data), ...extra };
      const rollbacks = ids.map((id) => patchCaches(id, patch));
      bulkUpdate.mutate(
        { data: { ids, ...data } },
        { onError: () => rollbacks.forEach((rollback) => rollback()) },
      );
    },
    [bulkUpdate, patchCaches],
  );

  const bulkDeleteTasks = useCallback(
    (ids: number[], callbacks?: { onSuccess?: () => void }) => {
      const rollback = removeFromCaches(ids);
      bulkDelete.mutate(
        { data: { ids } },
        { onError: rollback, onSuccess: callbacks?.onSuccess },
      );
    },
    [bulkDelete, removeFromCaches],
  );

  /* Checklist & comments live on the detail query; counts on the list row. */
  const refreshDetail = useCallback(
    (task: Pick<Task, "id" | "caseId">) => invalidate(task),
    [invalidate],
  );

  const addChecklist = useCallback(
    (task: Pick<Task, "id" | "caseId">, title: string) =>
      addChecklistItem.mutate(
        { id: task.id, data: { title } },
        { onSettled: () => refreshDetail(task) },
      ),
    [addChecklistItem, refreshDetail],
  );

  const setChecklistItem = useCallback(
    (
      task: Pick<Task, "id" | "caseId" | "status">,
      itemId: number,
      data: { done?: boolean; title?: string },
    ) => {
      const detailKey = getGetTaskQueryKey(task.id);
      const prev = qc.getQueryData<TaskDetail>(detailKey);
      if (prev) {
        qc.setQueryData<TaskDetail>(detailKey, {
          ...prev,
          checklist: prev.checklist.map((item) =>
            item.id === itemId ? { ...item, ...data } : item,
          ),
        });
      }
      // Mirror the server rule: the first ticked step starts the task.
      if (data.done && task.status === "todo") {
        patchCaches(task.id, { status: "in_progress" });
      }
      updateChecklistItem.mutate(
        { id: task.id, itemId, data },
        {
          onError: () => {
            if (prev) qc.setQueryData(detailKey, prev);
          },
          onSettled: () => refreshDetail(task),
        },
      );
    },
    [qc, updateChecklistItem, refreshDetail, patchCaches],
  );

  const removeChecklistItem = useCallback(
    (task: Pick<Task, "id" | "caseId">, itemId: number) => {
      const detailKey = getGetTaskQueryKey(task.id);
      const prev = qc.getQueryData<TaskDetail>(detailKey);
      if (prev) {
        qc.setQueryData<TaskDetail>(detailKey, {
          ...prev,
          checklist: prev.checklist.filter((item) => item.id !== itemId),
        });
      }
      deleteChecklistItem.mutate(
        { id: task.id, itemId },
        {
          onError: () => {
            if (prev) qc.setQueryData(detailKey, prev);
          },
          onSettled: () => refreshDetail(task),
        },
      );
    },
    [qc, deleteChecklistItem, refreshDetail],
  );

  const postComment = useCallback(
    (
      task: Pick<Task, "id" | "caseId">,
      body: string,
      callbacks?: { onSuccess?: () => void },
    ) =>
      addComment.mutate(
        { id: task.id, data: { body } },
        {
          onSuccess: callbacks?.onSuccess,
          onSettled: () => refreshDetail(task),
        },
      ),
    [addComment, refreshDetail],
  );

  const removeComment = useCallback(
    (task: Pick<Task, "id" | "caseId">, commentId: number) =>
      deleteComment.mutate(
        { id: task.id, commentId },
        { onSettled: () => refreshDetail(task) },
      ),
    [deleteComment, refreshDetail],
  );

  return {
    updateTask,
    toggleDone,
    createTask,
    deleteTask,
    bulkUpdateTasks,
    bulkDeleteTasks,
    addChecklist,
    setChecklistItem,
    removeChecklistItem,
    postComment,
    removeComment,
    isCreating: create.isPending,
    isPostingComment: addComment.isPending,
    isAddingChecklist: addChecklistItem.isPending,
  };
}

export type TaskMutations = ReturnType<typeof useTaskMutations>;
