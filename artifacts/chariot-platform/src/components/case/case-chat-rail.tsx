import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInbox,
  useListStaff,
  useGetCaseChat,
  useGetConversation,
  useSendCaseChatMessage,
  useSendConversationMessage,
  useToggleMessageReaction,
  useCreateCaseConversation,
  getListInboxQueryKey,
  getListStaffQueryKey,
  getGetCaseChatQueryKey,
  getGetConversationQueryKey,
  getListChatThreadsQueryKey,
  getListMyConversationsQueryKey,
  getListCaseConversationsQueryKey,
} from "@workspace/api-client-react";
import type {
  CaseDetail,
  InboxThread,
  MessageReplyPreview,
} from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ExternalLink, MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/components/auth-provider";
import { ChatThread } from "@/components/chat/chat-thread";
import {
  ChatComposer,
  type ChatComposerSubmit,
  type Mentionable,
} from "@/components/chat/chat-composer";
import { CHAT_POLL_MS, ChatLoading } from "@/components/chat/active-thread";
import { byActivity, threadHref } from "@/components/chat/inbox-model";
import { ThreadAvatar } from "@/components/chat/thread-list";
import { formatRelativeStamp } from "@/components/chat/format";
import { SidePanelHeader } from "@/components/case/case-side-menu";
import { cn } from "@/lib/utils";

/** What the switcher needs from a thread; the case chat may not be in the inbox yet. */
type RailThread = Pick<
  InboxThread,
  | "key"
  | "kind"
  | "caseId"
  | "conversationId"
  | "title"
  | "subtitle"
  | "unreadCount"
  | "mentionsMe"
  | "lastMessage"
>;

const convoSchema = z
  .object({
    kind: z.enum(["direct", "group"]),
    participantUserId: z.coerce.number().optional(),
  })
  .refine(
    (data) => {
      if (data.kind === "direct" && !data.participantUserId) return false;
      return true;
    },
    {
      message: "Participant required for direct message",
      path: ["participantUserId"],
    },
  );

function CreateConversationDialog({
  caseId,
  open,
  onOpenChange,
  onCreated,
}: {
  caseId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: number) => void;
}) {
  const qc = useQueryClient();
  const createConvo = useCreateCaseConversation();
  const { data: staffList = [] } = useListStaff();
  const { user } = useAuth();

  const form = useForm<
    z.input<typeof convoSchema>,
    unknown,
    z.output<typeof convoSchema>
  >({
    resolver: zodResolver(convoSchema),
    defaultValues: { kind: "direct", participantUserId: 0 },
  });

  const kind = form.watch("kind");

  const onSubmit = (data: z.infer<typeof convoSchema>) => {
    createConvo.mutate(
      {
        id: caseId,
        data: {
          kind: data.kind as any,
          participantUserId: data.participantUserId || undefined,
        },
      },
      {
        onSuccess: (res) => {
          toast.add({ title: "Conversation started", type: "success" });
          qc.invalidateQueries({ queryKey: getListInboxQueryKey() });
          qc.invalidateQueries({
            queryKey: getListCaseConversationsQueryKey(caseId),
          });
          qc.invalidateQueries({ queryKey: getListMyConversationsQueryKey() });
          form.reset();
          onCreated(res.id);
          onOpenChange(false);
        },
        onError: () => {
          toast.add({ title: "Failed to start conversation", type: "error" });
        },
      },
    );
  };

  const availableStaff = staffList.filter((s) => s.id !== user?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Conversation</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="direct">Direct Message</SelectItem>
                      <SelectItem value="group">Group Chat</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {kind === "direct" && (
              <FormField
                control={form.control}
                name="participantUserId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Participant</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={
                        field.value ? String(field.value) : undefined
                      }
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select staff member" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableStaff.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createConvo.isPending}>
                {createConvo.isPending ? "Starting..." : "Start Conversation"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function sendFailed(error: unknown) {
  toast.add({
    title: "Message not sent",
    description: error instanceof Error ? error.message : undefined,
    type: "error",
  });
}

type ThreadViewProps = {
  mentionables: Mentionable[];
  mentionNames: string[];
};

/** The case's own chat (all staff). */
function CaseThreadView({
  caseId,
  mentionables,
  mentionNames,
}: ThreadViewProps & { caseId: number }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [replyTo, setReplyTo] = useState<MessageReplyPreview | null>(null);
  const sendMessage = useSendCaseChatMessage();
  const toggleReaction = useToggleMessageReaction();
  const { data: chat, isLoading } = useGetCaseChat(caseId, {
    query: {
      enabled: !!caseId,
      queryKey: getGetCaseChatQueryKey(caseId),
      refetchInterval: CHAT_POLL_MS,
    },
  });

  useEffect(() => {
    // Fetching the chat moved the read cursor server-side; reflect it in the badges.
    if (chat) {
      qc.invalidateQueries({ queryKey: getListInboxQueryKey() });
      qc.invalidateQueries({ queryKey: getListChatThreadsQueryKey() });
    }
  }, [chat, qc]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetCaseChatQueryKey(caseId) });
    qc.invalidateQueries({ queryKey: getListInboxQueryKey() });
    qc.invalidateQueries({ queryKey: getListChatThreadsQueryKey() });
  };

  const handleSend = async ({ body, attachmentIds }: ChatComposerSubmit) => {
    try {
      await sendMessage.mutateAsync({
        id: caseId,
        data: { body, replyToMessageId: replyTo?.id, attachmentIds },
      });
    } catch (error) {
      sendFailed(error);
      throw error;
    }
    setReplyTo(null);
    refresh();
  };

  if (isLoading) return <ChatLoading />;

  return (
    <>
      <ChatThread
        messages={chat?.messages ?? []}
        currentUserId={user?.id}
        showSenders
        emptyText="No messages yet. Notes here are visible to all staff."
        mentionNames={mentionNames}
        onReply={(m) =>
          setReplyTo({ id: m.id, sender: m.sender, body: m.body })
        }
        onReact={(messageId, emoji) =>
          toggleReaction.mutate(
            { id: messageId, data: { emoji } },
            { onSettled: refresh },
          )
        }
      />
      <ChatComposer
        placeholder="Message the team…"
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        isPending={sendMessage.isPending}
        onSend={handleSend}
        mentionables={mentionables}
      />
    </>
  );
}

/** A direct or group conversation linked to the case. */
function ConversationThreadView({
  conversationId,
  caseId,
  mentionables,
  mentionNames,
}: ThreadViewProps & { conversationId: number; caseId: number }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [replyTo, setReplyTo] = useState<MessageReplyPreview | null>(null);
  const sendMessage = useSendConversationMessage();
  const toggleReaction = useToggleMessageReaction();
  const { data: conversation, isLoading } = useGetConversation(conversationId, {
    query: {
      queryKey: getGetConversationQueryKey(conversationId),
      refetchInterval: CHAT_POLL_MS,
    },
  });

  useEffect(() => {
    if (conversation)
      qc.invalidateQueries({ queryKey: getListInboxQueryKey() });
  }, [conversation, qc]);

  const refresh = () => {
    qc.invalidateQueries({
      queryKey: getGetConversationQueryKey(conversationId),
    });
    qc.invalidateQueries({
      queryKey: getListCaseConversationsQueryKey(caseId),
    });
    qc.invalidateQueries({ queryKey: getListInboxQueryKey() });
    qc.invalidateQueries({ queryKey: getListMyConversationsQueryKey() });
  };

  const handleSend = async ({ body, attachmentIds }: ChatComposerSubmit) => {
    try {
      await sendMessage.mutateAsync({
        id: conversationId,
        data: { body, replyToMessageId: replyTo?.id, attachmentIds },
      });
    } catch (error) {
      sendFailed(error);
      throw error;
    }
    setReplyTo(null);
    refresh();
  };

  if (isLoading) return <ChatLoading />;

  // Only the people in this conversation can be mentioned.
  const participantIds = new Set(
    conversation?.participants.map((p) => p.id) ?? [],
  );
  const scopedMentionables = mentionables.filter(
    (m) => typeof m.id === "string" || participantIds.has(m.id),
  );

  return (
    <>
      <ChatThread
        messages={conversation?.messages ?? []}
        currentUserId={user?.id}
        showSenders={conversation?.kind === "group"}
        emptyText="No messages in this conversation yet."
        mentionNames={mentionNames}
        onReply={(m) =>
          setReplyTo({ id: m.id, sender: m.sender, body: m.body })
        }
        onReact={(messageId, emoji) =>
          toggleReaction.mutate(
            { id: messageId, data: { emoji } },
            { onSettled: refresh },
          )
        }
      />
      <ChatComposer
        placeholder="Type an internal message…"
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        isPending={sendMessage.isPending}
        onSend={handleSend}
        mentionables={scopedMentionables}
      />
    </>
  );
}

function ThreadSwitcher({
  threads,
  selectedKey,
  onSelect,
}: {
  threads: RailThread[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Case conversations"
      className="max-h-56 overflow-y-auto border-b"
    >
      {threads.map((thread) => {
        const active = thread.key === selectedKey;
        const unread = thread.unreadCount > 0;
        return (
          <button
            key={thread.key}
            type="button"
            role="option"
            aria-selected={active}
            onClick={() => onSelect(thread.key)}
            className={cn(
              "flex w-full items-center gap-3 px-3 py-2 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60",
              active && "bg-muted",
            )}
          >
            <ThreadAvatar
              kind={thread.kind}
              title={thread.title}
              className="size-8"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "truncate text-sm",
                    unread ? "font-semibold" : "font-medium",
                  )}
                >
                  {thread.title}
                </span>
                {thread.mentionsMe && (
                  <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                    @
                  </span>
                )}
                {thread.lastMessage && (
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {formatRelativeStamp(
                      new Date(thread.lastMessage.createdAt).toISOString(),
                    )}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "block truncate text-xs",
                  unread ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {thread.lastMessage
                  ? `${thread.lastMessage.sender}: ${thread.lastMessage.body}`
                  : thread.subtitle}
              </span>
            </span>
            <span className="flex w-2 shrink-0 justify-center">
              {unread && (
                <span
                  className="size-2 rounded-full bg-primary"
                  aria-label={`${thread.unreadCount} unread`}
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Chat for one case: the case's own thread plus any direct/group
 * conversations linked to it, with inbox read-state. Docked beside the case
 * on wide screens or inside a sheet below that.
 */
export function CaseChatRail({
  caseItem,
  onClose,
}: {
  caseItem: CaseDetail;
  /** Rendered as a collapse button when provided. */
  onClose?: () => void;
}) {
  const { user } = useAuth();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Shares the inbox query (and its poll) with the sidebar badges.
  const { data: inbox, isLoading } = useListInbox({
    query: { queryKey: getListInboxQueryKey(), refetchInterval: CHAT_POLL_MS },
  });
  const { data: staffList = [] } = useListStaff({
    query: { queryKey: getListStaffQueryKey() },
  });

  const threads = useMemo<RailThread[]>(() => {
    const mine = (inbox ?? []).filter((t) => t.caseId === caseItem.id);
    const caseThread: RailThread = mine.find((t) => t.kind === "case") ?? {
      key: `case-${caseItem.id}`,
      kind: "case",
      caseId: caseItem.id,
      conversationId: null,
      title: caseItem.reference,
      subtitle: "Case chat · all staff",
      unreadCount: 0,
      mentionsMe: false,
      lastMessage: null,
    };
    const conversations = mine
      .filter((t) => t.kind !== "case")
      .sort(byActivity);
    return [caseThread, ...conversations];
  }, [inbox, caseItem.id, caseItem.reference]);

  const selected =
    threads.find((t) => t.key === selectedKey) ?? threads[0] ?? null;

  const mentionables = useMemo<Mentionable[]>(
    () => [
      ...staffList
        .filter((member) => member.id !== user?.id)
        .map((member) => ({
          id: member.id,
          label: member.displayName,
          detail: member.role.replaceAll("_", " "),
        })),
      { id: "everyone", label: "everyone", detail: "Notify all staff" },
    ],
    [staffList, user?.id],
  );
  const mentionNames = useMemo(
    () => staffList.map((member) => member.displayName),
    [staffList],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CreateConversationDialog
        caseId={caseItem.id}
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreated={(id) => setSelectedKey(`conversation-${id}`)}
      />

      <SidePanelHeader
        icon={MessageSquare}
        title="Messages"
        onClose={onClose}
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setIsCreateOpen(true)}
                  aria-label="New conversation"
                >
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New conversation</TooltipContent>
            </Tooltip>
            {selected && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Open in Messages"
                    asChild
                  >
                    <Link href={threadHref(selected)}>
                      <ExternalLink />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open in Messages</TooltipContent>
              </Tooltip>
            )}
          </>
        }
      />

      {isLoading ? (
        <div className="space-y-2 border-b p-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        threads.length > 1 &&
        selected && (
          <ThreadSwitcher
            threads={threads}
            selectedKey={selected.key}
            onSelect={setSelectedKey}
          />
        )
      )}

      <div className="relative flex min-h-0 flex-1 flex-col bg-background">
        {!selected ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageSquare />
              </EmptyMedia>
              <EmptyTitle>No conversations</EmptyTitle>
              <EmptyDescription>
                Start one to discuss this case with the team.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : selected.kind === "case" ? (
          <CaseThreadView
            key={selected.key}
            caseId={caseItem.id}
            mentionables={mentionables}
            mentionNames={mentionNames}
          />
        ) : (
          <ConversationThreadView
            key={selected.key}
            conversationId={selected.conversationId as number}
            caseId={caseItem.id}
            mentionables={mentionables}
            mentionNames={mentionNames}
          />
        )}
      </div>
    </div>
  );
}
