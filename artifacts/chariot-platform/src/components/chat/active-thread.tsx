import * as React from "react";
import {
  getGetCaseChatQueryKey,
  getGetConversationQueryKey,
  getListCaseConversationsQueryKey,
  getListCasesQueryKey,
  getListChatThreadsQueryKey,
  getListInboxQueryKey,
  getListMessagesQueryKey,
  getListMyConversationsQueryKey,
  getListStaffQueryKey,
  useCreateConversation,
  useGetCaseChat,
  useGetConversation,
  useListCases,
  useListStaff,
  useSendCaseChatMessage,
  useSendConversationMessage,
  useToggleMessageReaction,
  type InboxThread,
  type MessageReplyPreview,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Info,
  MessageSquare,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  ChatComposer,
  type ChatComposerSubmit,
  type Mentionable,
} from "./chat-composer";
import { ChatThread, type ChatMessageLike } from "./chat-thread";
import { EditableTitle } from "./editable-title";
import { ThreadAvatar, threadMenuActions } from "./thread-list";
import type { ThreadActions } from "./use-thread-actions";

/** Chats refresh on this cadence so new messages appear without a reload. */
export const CHAT_POLL_MS = 5000;

/** Find-in-conversation state, owned by the page so shortcuts can drive it. */
export type FindState = {
  open: boolean;
  query: string;
  setQuery: (query: string) => void;
  close: () => void;
};

type PaneChrome = {
  thread: InboxThread | undefined;
  actions: ThreadActions;
  find: FindState;
  infoOpen: boolean;
  onToggleInfo: () => void;
  /** Message id from a search-hit deep link (?m=), scrolled to on open. */
  deepLinkMessageId: number | null;
  /** Who the composer can @mention (excludes the current user). */
  mentionables: Mentionable[];
  /** Every name that renders as a mention chip, including the current user's. */
  mentionNames: string[];
};

/* ---------- header ---------- */

function ConversationHeader({
  kind,
  title,
  subtitle,
  thread,
  actions,
  find,
  infoOpen,
  onToggleInfo,
}: {
  kind: InboxThread["kind"];
  title: string;
  subtitle: string;
  thread: InboxThread | undefined;
  actions: ThreadActions;
  find: FindState;
  infoOpen: boolean;
  onToggleInfo: () => void;
}) {
  const [, navigate] = useLocation();
  const menu = thread ? threadMenuActions(thread, actions, navigate) : [];
  return (
    <div
      className="grid h-14 shrink-0 grid-cols-[6.5rem_1fr_6.5rem] items-center border-b bg-card/80 px-2 backdrop-blur"
      data-testid="chat-header"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className="justify-self-start rounded-full md:invisible"
        asChild
      >
        <Link href="/messages" aria-label="Back to chats">
          <ArrowLeft />
        </Link>
      </Button>
      <div className="flex min-w-0 items-center justify-center gap-2">
        <ThreadAvatar
          kind={kind}
          title={title}
          linkedToCase={thread?.caseId != null}
          className="size-7 text-[11px]"
        />
        <div className="flex min-w-0 flex-col items-center text-center">
          {/* Direct and group chats can be named; a case chat is named after its case. */}
          {thread?.conversationId != null ? (
            <EditableTitle
              value={title}
              label="Rename chat"
              onSave={(next) => actions.rename(thread, next)}
              className="text-sm leading-tight font-semibold"
              inputClassName="w-56 max-w-full text-sm font-semibold"
            />
          ) : (
            <div className="max-w-full truncate text-sm leading-tight font-semibold">
              {title}
            </div>
          )}
          <div className="max-w-full truncate text-[11px] text-muted-foreground">
            {subtitle}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label="Find in conversation"
          aria-pressed={find.open}
          onClick={() => (find.open ? find.close() : find.setQuery(""))}
        >
          <Search />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("rounded-full", infoOpen && "bg-muted")}
          aria-label={infoOpen ? "Hide details" : "Show details"}
          aria-pressed={infoOpen}
          onClick={onToggleInfo}
        >
          <Info />
        </Button>
        {menu.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-full"
                aria-label="Thread actions"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menu.map((item) => (
                <React.Fragment key={item.key}>
                  {item.separatorBefore && <DropdownMenuSeparator />}
                  <DropdownMenuItem onSelect={item.onSelect}>
                    <item.icon />
                    {item.label}
                  </DropdownMenuItem>
                </React.Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

/* ---------- find bar ---------- */

function FindBar({
  find,
  matches,
  index,
  onStep,
}: {
  find: FindState;
  matches: number;
  index: number;
  onStep: (delta: number) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div className="border-b bg-card px-3 py-2" data-testid="find-bar">
      <InputGroup className="rounded-full">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          ref={inputRef}
          value={find.query}
          onChange={(event) => find.setQuery(event.target.value)}
          placeholder="Find in conversation"
          aria-label="Find in conversation"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onStep(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              find.close();
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          <span
            className="text-xs tabular-nums text-muted-foreground"
            data-testid="find-count"
          >
            {find.query.trim()
              ? matches
                ? `${index + 1} of ${matches}`
                : "0 of 0"
              : ""}
          </span>
          <InputGroupButton
            size="icon-xs"
            aria-label="Previous match"
            disabled={matches === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronUp />
          </InputGroupButton>
          <InputGroupButton
            size="icon-xs"
            aria-label="Next match"
            disabled={matches === 0}
            onClick={() => onStep(1)}
          >
            <ChevronDown />
          </InputGroupButton>
          <InputGroupButton
            size="icon-xs"
            aria-label="Close find"
            onClick={find.close}
          >
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

/** Which message the find bar (or a deep link) currently points at. */
function useFindMatches<T extends ChatMessageLike>(
  messages: T[],
  find: FindState,
  deepLinkMessageId: number | null,
) {
  const [index, setIndex] = React.useState(0);
  const query = find.open ? find.query.trim().toLowerCase() : "";
  const matches = React.useMemo(
    () =>
      query
        ? messages
            .filter((message) => message.body.toLowerCase().includes(query))
            .map((message) => message.id)
            .reverse() // newest first, like scrolling up through history
        : [],
    [messages, query],
  );
  React.useEffect(() => {
    setIndex(0);
  }, [query]);
  const step = (delta: number) =>
    setIndex((current) =>
      matches.length ? (current + delta + matches.length) % matches.length : 0,
    );
  const focusMessageId = query ? (matches[index] ?? null) : deepLinkMessageId;
  return { matches, index, step, focusMessageId };
}

/* ---------- loading / missing ---------- */

export function ChatLoading() {
  return (
    <div className="flex flex-1 flex-col justify-end gap-2 p-6">
      <Skeleton className="h-9 w-1/2 rounded-lg" />
      <Skeleton className="ml-auto h-9 w-2/5 rounded-lg" />
      <Skeleton className="h-14 w-3/5 rounded-lg" />
    </div>
  );
}

function ChatMissing() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageSquare />
        </EmptyMedia>
        <EmptyTitle>Chat not found</EmptyTitle>
        <EmptyDescription>
          It may have been removed, or you may not be a participant.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function sendFailed(error: unknown) {
  toast.add({
    title: "Message not sent",
    description: error instanceof Error ? error.message : undefined,
    type: "error",
  });
}

/* ---------- case chat ---------- */

export function ActiveCaseChat({
  caseId,
  thread,
  actions,
  find,
  infoOpen,
  onToggleInfo,
  deepLinkMessageId,
  mentionables,
  mentionNames,
}: PaneChrome & { caseId: number }) {
  const {
    data: chatData,
    isLoading,
    isError,
  } = useGetCaseChat(caseId, {
    query: {
      enabled: !!caseId,
      queryKey: getGetCaseChatQueryKey(caseId),
      refetchInterval: CHAT_POLL_MS,
    },
  });
  const sendMessage = useSendCaseChatMessage();
  const toggleReaction = useToggleMessageReaction();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [replyTo, setReplyTo] = React.useState<MessageReplyPreview | null>(
    null,
  );
  const messages = chatData?.messages ?? [];
  const { matches, index, step, focusMessageId } = useFindMatches(
    messages,
    find,
    deepLinkMessageId,
  );

  React.useEffect(() => {
    if (chatData) {
      qc.invalidateQueries({ queryKey: getListInboxQueryKey() });
      qc.invalidateQueries({ queryKey: getListChatThreadsQueryKey() });
    }
  }, [chatData, qc]);

  React.useEffect(() => {
    setReplyTo(null);
  }, [caseId]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetCaseChatQueryKey(caseId) });
    qc.invalidateQueries({ queryKey: getListInboxQueryKey() });
    qc.invalidateQueries({ queryKey: getListChatThreadsQueryKey() });
    qc.invalidateQueries({ queryKey: getListMessagesQueryKey() });
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
  if (isError || !chatData) return <ChatMissing />;

  return (
    <>
      <ConversationHeader
        kind="case"
        title={
          thread?.title ??
          chatData.messages[0]?.caseReference ??
          `Case #${caseId}`
        }
        subtitle={
          thread?.case
            ? `${thread.case.clientName} · ${thread.case.stage}`
            : "Case chat · all staff"
        }
        thread={thread}
        actions={actions}
        find={find}
        infoOpen={infoOpen}
        onToggleInfo={onToggleInfo}
      />
      {find.open && (
        <FindBar
          find={find}
          matches={matches.length}
          index={index}
          onStep={step}
        />
      )}
      <ChatThread
        key={caseId}
        messages={messages}
        currentUserId={user?.id}
        highlight={find.open ? find.query : undefined}
        focusMessageId={focusMessageId}
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
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        isPending={sendMessage.isPending}
        onSend={handleSend}
        mentionables={mentionables}
      />
    </>
  );
}

/* ---------- direct / group conversation ---------- */

export function ActiveConversation({
  conversationId,
  thread,
  actions,
  find,
  infoOpen,
  onToggleInfo,
  deepLinkMessageId,
  mentionables,
  mentionNames,
}: PaneChrome & { conversationId: number }) {
  const {
    data: conversation,
    isLoading,
    isError,
  } = useGetConversation(conversationId, {
    query: {
      queryKey: getGetConversationQueryKey(conversationId),
      refetchInterval: CHAT_POLL_MS,
    },
  });
  const sendMessage = useSendConversationMessage();
  const toggleReaction = useToggleMessageReaction();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [replyTo, setReplyTo] = React.useState<MessageReplyPreview | null>(
    null,
  );
  const messages = conversation?.messages ?? [];
  const { matches, index, step, focusMessageId } = useFindMatches(
    messages,
    find,
    deepLinkMessageId,
  );

  React.useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  React.useEffect(() => {
    // Opening the conversation moved the read cursor server-side; reflect it in the list.
    if (conversation)
      qc.invalidateQueries({ queryKey: getListInboxQueryKey() });
  }, [conversation, qc]);

  const refresh = () => {
    qc.invalidateQueries({
      queryKey: getGetConversationQueryKey(conversationId),
    });
    if (conversation?.caseId)
      qc.invalidateQueries({
        queryKey: getListCaseConversationsQueryKey(conversation.caseId),
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
  if (isError || !conversation) return <ChatMissing />;

  const others = conversation.participants.filter((p) => p.id !== user?.id);
  const subtitle =
    conversation.kind === "group"
      ? `${conversation.participants.map((p) => p.displayName).join(", ")}${conversation.caseReference ? ` · ${conversation.caseReference}` : ""}`
      : `${others[0]?.role.replaceAll("_", " ") ?? "Direct message"}${conversation.caseReference ? ` · ${conversation.caseReference}` : ""}`;
  // In a direct chat only the other person is mentionable; groups get everyone in them.
  const inThread = new Set(conversation.participants.map((p) => p.id));
  const scoped = mentionables.filter(
    (person) => typeof person.id !== "number" || inThread.has(person.id),
  );

  return (
    <>
      <ConversationHeader
        kind={conversation.kind}
        title={conversation.title}
        subtitle={subtitle}
        thread={thread}
        actions={actions}
        find={find}
        infoOpen={infoOpen}
        onToggleInfo={onToggleInfo}
      />
      {find.open && (
        <FindBar
          find={find}
          matches={matches.length}
          index={index}
          onStep={step}
        />
      )}
      <ChatThread
        key={conversationId}
        messages={messages}
        currentUserId={user?.id}
        showSenders={conversation.kind === "group"}
        highlight={find.open ? find.query : undefined}
        focusMessageId={focusMessageId}
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
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        isPending={sendMessage.isPending}
        onSend={handleSend}
        mentionables={scoped}
      />
    </>
  );
}

/* ---------- new message ---------- */

type Recipient =
  | { kind: "person"; id: number; label: string; detail: string }
  | { kind: "everyone"; id: 0; label: string; detail: string }
  | { kind: "case"; id: number; label: string; detail: string };

/**
 * iMessage-style "New Message" pane: pick who it's to and the chat opens —
 * a person starts (or reopens) a direct chat, a case opens its case chat,
 * "Everyone" opens the all-staff group. No dialog.
 */
export function NewChatPane() {
  const { data: cases = [] } = useListCases(undefined, {
    query: { queryKey: getListCasesQueryKey() },
  });
  const { data: staffList = [] } = useListStaff({
    query: { queryKey: getListStaffQueryKey() },
  });
  const { user } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const createConvo = useCreateConversation();

  const recipients = React.useMemo<Recipient[]>(() => {
    const people: Recipient[] = staffList
      .filter((s) => s.id !== user?.id)
      .map((s) => ({
        kind: "person",
        id: s.id,
        label: s.displayName,
        detail: s.role.replaceAll("_", " "),
      }));
    const caseItems: Recipient[] = cases.map((c) => ({
      kind: "case",
      id: c.id,
      label: c.reference,
      detail: `Case · ${c.clientName} · ${c.stage}`,
    }));
    return [
      ...people,
      { kind: "everyone", id: 0, label: "Everyone", detail: "All staff" },
      ...caseItems,
    ];
  }, [staffList, cases, user?.id]);

  const open = (recipient: Recipient | null) => {
    if (!recipient) return;
    if (recipient.kind === "case") {
      setLocation(`/messages/case/${recipient.id}`);
      return;
    }
    createConvo.mutate(
      {
        data:
          recipient.kind === "person"
            ? { kind: "direct", participantUserId: recipient.id }
            : { kind: "group" },
      },
      {
        onSuccess: (created) => {
          qc.invalidateQueries({ queryKey: getListInboxQueryKey() });
          qc.invalidateQueries({ queryKey: getListMyConversationsQueryKey() });
          setLocation(`/messages/conversation/${created.id}`);
        },
        onError: () =>
          toast.add({ title: "Couldn't start the chat", type: "error" }),
      },
    );
  };

  // `/messages/new?to=<staff id>` (from site search) opens the direct chat
  // with that person straight away instead of asking who to message.
  const deepLinkUserId = React.useMemo(() => {
    const value = Number(new URLSearchParams(searchString).get("to"));
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [searchString]);
  const openedDeepLink = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (deepLinkUserId == null || openedDeepLink.current === deepLinkUserId)
      return;
    if (staffList.length === 0 || !user) return;
    openedDeepLink.current = deepLinkUserId;
    if (deepLinkUserId === user.id) {
      setLocation("/messages/new", { replace: true });
      return;
    }
    const person = staffList.find((s) => s.id === deepLinkUserId);
    if (!person) return;
    open({
      kind: "person",
      id: person.id,
      label: person.displayName,
      detail: "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkUserId, staffList, user?.id]);

  return (
    <>
      <div
        className="grid h-14 shrink-0 grid-cols-[2.5rem_1fr_2.5rem] items-center border-b bg-card/80 px-2 backdrop-blur"
        data-testid="chat-header"
      >
        <span />
        <div className="truncate text-center text-sm font-semibold">
          New Message
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label="Cancel"
          asChild
        >
          <Link href="/messages">
            <X />
          </Link>
        </Button>
      </div>
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-sm text-muted-foreground">To:</span>
        <Combobox
          items={recipients}
          itemToStringLabel={(r) => r?.label ?? ""}
          itemToStringValue={(r) => (r ? `${r.label} ${r.detail}` : "")}
          value={null}
          onValueChange={open}
        >
          <ComboboxInput
            autoFocus
            aria-label="To"
            placeholder="Type a name or case reference"
            className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
            disabled={createConvo.isPending}
          />
          <ComboboxContent>
            <ComboboxEmpty>No matches.</ComboboxEmpty>
            <ComboboxList>
              {(r: Recipient) => (
                <ComboboxItem key={`${r.kind}-${r.id}`} value={r}>
                  <ThreadAvatar
                    kind={
                      r.kind === "person"
                        ? "direct"
                        : r.kind === "case"
                          ? "case"
                          : "group"
                    }
                    title={r.label}
                    className="size-7 text-[11px]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.detail}
                    </span>
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {createConvo.isPending
            ? "Starting the chat…"
            : "Choose a person, a case, or everyone to start."}
        </p>
      </div>
    </>
  );
}
