import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetClientQueryKey,
  getGetClientTimelineQueryKey,
  getGetDashboardQueryKey,
  getListActivitiesQueryKey,
  getListClientInteractionsQueryKey,
  getListClientsQueryKey,
  getListTasksQueryKey,
  useAcceptClientEnquiry,
  useBulkUpdateClients,
  useCreateClientInteraction,
  useDeclineClientEnquiry,
  useDeleteClientInteraction,
  useReopenClientEnquiry,
  useUpdateClient,
  useUpdateClientInteraction,
  type Client,
  type ClientDetail,
  type ClientInteraction,
  type ClientInteractionInput,
  type ClientInteractionUpdate,
  type DeclineClientInput,
  type UpdateClientInfoBody,
} from "@workspace/api-client-react";
import { toast } from "@/components/ui/toast";

export function apiErrorMessage(error: unknown): string | undefined {
  const data = (error as { data?: { error?: string } } | undefined)?.data;
  if (data && typeof data.error === "string") return data.error;
  return error instanceof Error ? error.message : undefined;
}

const failToast = (title: string) => (error: unknown) =>
  toast.add({ title, description: apiErrorMessage(error), type: "error" });

/**
 * Every client mutation the CRM views need. List and detail caches are patched
 * optimistically so reassigning, follow-ups and notes feel instant; failures
 * roll back and toast.
 */
export function useClientMutations() {
  const qc = useQueryClient();
  const listKey = getListClientsQueryKey();

  const invalidate = useCallback(
    (id?: number) => {
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      if (id) {
        qc.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
        qc.invalidateQueries({ queryKey: getGetClientTimelineQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListClientInteractionsQueryKey(id) });
      }
      qc.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
    },
    [qc, listKey],
  );

  const patchCaches = useCallback(
    (id: number, patch: Partial<Client>) => {
      void qc.cancelQueries({ queryKey: listKey });
      const prevList = qc.getQueryData<Client[]>(listKey);
      const detailKey = getGetClientQueryKey(id);
      const prevDetail = qc.getQueryData<ClientDetail>(detailKey);
      if (prevList) {
        qc.setQueryData<Client[]>(
          listKey,
          prevList.map((client) => (client.id === id ? { ...client, ...patch } : client)),
        );
      }
      if (prevDetail) qc.setQueryData<ClientDetail>(detailKey, { ...prevDetail, ...patch });
      return () => {
        if (prevList) qc.setQueryData(listKey, prevList);
        if (prevDetail) qc.setQueryData(detailKey, prevDetail);
      };
    },
    [qc, listKey],
  );

  const update = useUpdateClient({
    mutation: {
      onError: failToast("Client was not updated"),
      onSuccess: (client) => patchCaches(client.id, client),
      onSettled: (_client, _error, variables) => invalidate(variables.id),
    },
  });
  const bulk = useBulkUpdateClients({
    mutation: {
      onError: failToast("Clients were not updated"),
      onSuccess: (clients) => {
        for (const client of clients) patchCaches(client.id, client);
      },
      onSettled: () => invalidate(),
    },
  });
  const accept = useAcceptClientEnquiry({
    mutation: {
      onError: failToast("Enquiry was not accepted"),
      onSuccess: (client) => {
        patchCaches(client.id, client);
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        toast.add({
          title: "Enquiry accepted",
          description:
            client.welcomeDelivery?.status === "sent"
              ? "Welcome email sent."
              : client.welcomeDelivery?.status === "failed"
                ? "The welcome email did not send — resend it from the client page."
                : undefined,
          type: client.welcomeDelivery?.status === "failed" ? "error" : "success",
        });
      },
      onSettled: (_client, _error, variables) => invalidate(variables.id),
    },
  });
  const decline = useDeclineClientEnquiry({
    mutation: {
      onError: failToast("Enquiry was not closed"),
      onSuccess: (client) => patchCaches(client.id, client),
      onSettled: (_client, _error, variables) => invalidate(variables.id),
    },
  });
  const reopen = useReopenClientEnquiry({
    mutation: {
      onError: failToast("Client was not reopened"),
      onSuccess: (client) => patchCaches(client.id, client),
      onSettled: (_client, _error, variables) => invalidate(variables.id),
    },
  });
  const logInteraction = useCreateClientInteraction({
    mutation: {
      onError: failToast("Interaction was not logged"),
      onSuccess: (interaction, variables) => {
        const patch: Partial<Client> = { lastContactedAt: interaction.occurredAt };
        if (variables.data.nextFollowUpAt !== undefined) patch.nextFollowUpAt = variables.data.nextFollowUpAt;
        patchCaches(interaction.clientId, patch);
      },
      onSettled: (_interaction, _error, variables) => invalidate(variables.id),
    },
  });
  const editInteraction = useUpdateClientInteraction({
    mutation: {
      onError: failToast("Interaction was not updated"),
      onSuccess: (interaction) => {
        const key = getListClientInteractionsQueryKey(interaction.clientId);
        qc.setQueryData<ClientInteraction[]>(key, (old) =>
          old ? old.map((item) => (item.id === interaction.id ? interaction : item)) : old,
        );
      },
      onSettled: (_interaction, _error, variables) => invalidate(variables.id),
    },
  });
  const removeInteraction = useDeleteClientInteraction({
    mutation: {
      onError: failToast("Interaction was not deleted"),
      onSettled: (_void, _error, variables) => invalidate(variables.id),
    },
  });

  const updateClient = useCallback(
    (client: Pick<Client, "id">, data: UpdateClientInfoBody, options?: { onSuccess?: (client: ClientDetail) => void }) => {
      const rollback = patchCaches(client.id, data as Partial<Client>);
      update.mutate(
        { id: client.id, data },
        { onError: rollback, onSuccess: options?.onSuccess },
      );
    },
    [update, patchCaches],
  );

  const setOwner = useCallback(
    (client: Pick<Client, "id">, owner: { id: number; displayName: string } | null) => {
      const rollback = patchCaches(client.id, {
        assignee: owner ? { id: owner.id, displayName: owner.displayName } : null,
      });
      update.mutate({ id: client.id, data: { assignedUserId: owner?.id ?? null } }, { onError: rollback });
    },
    [update, patchCaches],
  );

  const setFollowUp = useCallback(
    (client: Pick<Client, "id">, nextFollowUpAt: string | null) => {
      const rollback = patchCaches(client.id, { nextFollowUpAt });
      update.mutate({ id: client.id, data: { nextFollowUpAt } }, { onError: rollback });
    },
    [update, patchCaches],
  );

  const bulkAssign = useCallback(
    (ids: number[], owner: { id: number; displayName: string } | null, options?: { onSuccess?: () => void }) => {
      const rollbacks = ids.map((id) =>
        patchCaches(id, { assignee: owner ? { id: owner.id, displayName: owner.displayName } : null }),
      );
      bulk.mutate(
        { data: { ids, assignedUserId: owner?.id ?? null } },
        {
          onError: () => rollbacks.forEach((rollback) => rollback()),
          onSuccess: () => {
            toast.add({
              title: owner ? `Assigned ${ids.length} to ${owner.displayName}` : `Unassigned ${ids.length}`,
              type: "success",
            });
            options?.onSuccess?.();
          },
        },
      );
    },
    [bulk, patchCaches],
  );

  const acceptClient = useCallback(
    (client: Pick<Client, "id">) => accept.mutate({ id: client.id }),
    [accept],
  );
  const declineClient = useCallback(
    (client: Pick<Client, "id">, data: DeclineClientInput, options?: { onSuccess?: () => void }) =>
      decline.mutate({ id: client.id, data }, { onSuccess: options?.onSuccess }),
    [decline],
  );
  const reopenClient = useCallback(
    (client: Pick<Client, "id">) => reopen.mutate({ id: client.id }),
    [reopen],
  );
  const addInteraction = useCallback(
    (client: Pick<Client, "id">, data: ClientInteractionInput, options?: { onSuccess?: () => void }) =>
      logInteraction.mutate({ id: client.id, data }, { onSuccess: options?.onSuccess }),
    [logInteraction],
  );
  const updateInteraction = useCallback(
    (clientId: number, interactionId: number, data: ClientInteractionUpdate, options?: { onSuccess?: () => void }) =>
      editInteraction.mutate({ id: clientId, interactionId, data }, { onSuccess: options?.onSuccess }),
    [editInteraction],
  );
  const deleteInteraction = useCallback(
    (clientId: number, interactionId: number) =>
      removeInteraction.mutate({ id: clientId, interactionId }),
    [removeInteraction],
  );

  return {
    updateClient,
    setOwner,
    setFollowUp,
    bulkAssign,
    acceptClient,
    declineClient,
    reopenClient,
    addInteraction,
    updateInteraction,
    deleteInteraction,
    isUpdating: update.isPending,
    isAccepting: accept.isPending,
    isDeclining: decline.isPending,
    isLogging: logInteraction.isPending,
    isEditingInteraction: editInteraction.isPending,
    isBulkPending: bulk.isPending,
  };
}
