import { useMemo } from "react";
import {
  useListInbox,
  useListTasks,
  useListClients,
  useGetAlertSummary,
  getListInboxQueryKey,
  getListTasksQueryKey,
  getListClientsQueryKey,
  getGetAlertSummaryQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/components/auth-provider";
import { badgeUnread } from "@/components/chat/inbox-model";

/** Menu badges refresh on this cadence so they stay current without a reload. */
const POLL_MS = 5000;

export type NewCountKey = "messages" | "tasks" | "enquiries" | "alerts";

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

  // Red alerts only: the badge is for what needs action, amber waits on the page.
  const { data: alerts } = useGetAlertSummary({
    query: { queryKey: getGetAlertSummaryQueryKey(), refetchInterval: 30_000, enabled },
  });

  return useMemo(
    () => ({
      alerts: alerts?.red ?? 0,
      messages: badgeUnread(inbox ?? []),
      tasks: (tasks ?? []).filter(
        (t) => t.assignedUserId === user?.id && t.status !== "done",
      ).length,
      enquiries: (enquiries ?? []).length,
    }),
    [inbox, tasks, enquiries, alerts, user?.id],
  );
}
