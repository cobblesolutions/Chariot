import { useMemo } from "react";
import {
  useListInbox,
  useListTasks,
  useListClients,
  getListInboxQueryKey,
  getListTasksQueryKey,
  getListClientsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/components/auth-provider";
import { badgeUnread } from "@/components/chat/inbox-model";

/** Menu badges refresh on this cadence so they stay current without a reload. */
const POLL_MS = 5000;

export type NewCountKey = "messages" | "tasks" | "enquiries";

/** How much of each thing is new for the signed-in user: the numbers on the menu bubbles. */
export function useNewCounts(enabled = true): Record<NewCountKey, number> {
  const { user } = useAuth();

  // One inbox query feeds the badge; muted and archived threads don't count.
  const { data: inbox } = useListInbox({
    query: {
      queryKey: getListInboxQueryKey(),
      refetchInterval: POLL_MS,
      enabled,
    },
  });
  const { data: tasks } = useListTasks({
    query: {
      queryKey: getListTasksQueryKey(),
      refetchInterval: POLL_MS,
      enabled,
    },
  });
  // Enquiries waiting for a decision badge the Add item.
  const { data: enquiries } = useListClients(
    { lifecycle: "enquiry" },
    {
      query: {
        queryKey: getListClientsQueryKey({ lifecycle: "enquiry" }),
        refetchInterval: POLL_MS,
        enabled,
      },
    },
  );

  return useMemo(
    () => ({
      messages: badgeUnread(inbox ?? []),
      tasks: (tasks ?? []).filter(
        (t) => t.assignedUserId === user?.id && t.status !== "done",
      ).length,
      enquiries: (enquiries ?? []).length,
    }),
    [inbox, tasks, enquiries, user?.id],
  );
}
