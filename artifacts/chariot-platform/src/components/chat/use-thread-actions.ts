import { useQueryClient } from "@tanstack/react-query";
import {
  getGetConversationQueryKey,
  getListInboxQueryKey,
  getListMyConversationsQueryKey,
  useSetThreadRead,
  useUpdateConversation,
  useUpdateThreadPreferences,
  type InboxThread,
  type ThreadPreferencesInput,
} from "@workspace/api-client-react";
import { toast } from "@/components/ui/toast";
import { threadRef } from "./inbox-model";

/**
 * Pin / mute / archive / read-state actions on an inbox thread. Each patches
 * the cached inbox first so the list responds instantly, then resyncs.
 */
export function useThreadActions() {
  const qc = useQueryClient();
  const updatePrefs = useUpdateThreadPreferences();
  const setRead = useSetThreadRead();
  const updateConversation = useUpdateConversation();

  const patchCache = (key: string, patch: Partial<InboxThread>) => {
    qc.setQueryData<InboxThread[]>(getListInboxQueryKey(), (threads) =>
      threads?.map((thread) =>
        thread.key === key ? { ...thread, ...patch } : thread,
      ),
    );
  };
  const resync = () =>
    qc.invalidateQueries({ queryKey: getListInboxQueryKey() });

  const setPrefs = (thread: InboxThread, patch: ThreadPreferencesInput) => {
    patchCache(thread.key, patch);
    const ref = threadRef(thread);
    updatePrefs.mutate(
      { kind: ref.kind, id: ref.id, data: patch },
      {
        onError: () => {
          toast.add({ title: "Couldn't update the thread", type: "error" });
          resync();
        },
        onSuccess: resync,
      },
    );
  };

  const markRead = (thread: InboxThread, read: boolean) => {
    patchCache(thread.key, {
      unreadCount: read ? 0 : Math.max(1, thread.unreadCount),
      mentionsMe: read ? false : thread.mentionsMe,
    });
    const ref = threadRef(thread);
    setRead.mutate(
      { kind: ref.kind, id: ref.id, data: { read } },
      {
        onError: () => {
          toast.add({ title: "Couldn't change the read state", type: "error" });
          resync();
        },
        onSuccess: resync,
      },
    );
  };

  /** Names a direct/group conversation for everyone in it; empty restores the default title. */
  const rename = (thread: InboxThread, title: string) => {
    if (thread.conversationId == null) return;
    const next = title.trim();
    if (next) patchCache(thread.key, { title: next });
    updateConversation.mutate(
      { id: thread.conversationId, data: { title: next || null } },
      {
        onError: () => {
          toast.add({ title: "Couldn't rename the chat", type: "error" });
          resync();
        },
        onSuccess: (conversation) => {
          qc.setQueryData(
            getGetConversationQueryKey(conversation.id),
            conversation,
          );
          qc.invalidateQueries({ queryKey: getListMyConversationsQueryKey() });
          resync();
        },
      },
    );
  };

  return {
    rename,
    togglePinned: (thread: InboxThread) =>
      setPrefs(thread, { pinned: !thread.pinned }),
    toggleMuted: (thread: InboxThread) =>
      setPrefs(thread, { muted: !thread.muted }),
    toggleArchived: (thread: InboxThread) =>
      setPrefs(thread, { archived: !thread.archived }),
    markRead,
  };
}

export type ThreadActions = ReturnType<typeof useThreadActions>;
