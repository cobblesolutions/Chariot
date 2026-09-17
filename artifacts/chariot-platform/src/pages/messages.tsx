import * as React from "react";
import {
  getGetCaseChatQueryKey,
  getGetConversationQueryKey,
  getListInboxQueryKey,
  getListStaffQueryKey,
  getSearchChatMessagesQueryKey,
  useGetCaseChat,
  useGetConversation,
  useListInbox,
  useListStaff,
  useSearchChatMessages,
} from "@workspace/api-client-react";
import { useDefaultLayout } from "react-resizable-panels";
import { ChevronDown, ListFilter, Search, SquarePen, X } from "lucide-react";
import { useLocation, useParams, useSearch } from "wouter";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CountBubble } from "@/components/count-bubble";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDebounced } from "@/hooks/use-debounced";
import { cn } from "@/lib/utils";
import {
  ActiveCaseChat,
  ActiveConversation,
  CHAT_POLL_MS,
  NewChatPane,
  type FindState,
} from "@/components/chat/active-thread";
import type { Mentionable } from "@/components/chat/chat-composer";
import { InboxRail } from "@/components/chat/inbox-rail";
import {
  badgeUnread,
  GROUP_MODES,
  groupThreads,
  INBOX_VIEWS,
  matchesFocus,
  matchesView,
  searchThreads,
  setInboxPrefs,
  stageCounts,
  threadHref,
  useInboxPrefs,
  viewCounts,
  type InboxView,
} from "@/components/chat/inbox-model";
import { ThreadList } from "@/components/chat/thread-list";
import {
  ThreadInfoPanel,
  type SharedFile,
} from "@/components/chat/thread-info-panel";
import { useThreadActions } from "@/components/chat/use-thread-actions";

/**
 * "page": the inbox sits directly on the page like every other screen (title,
 * then columns). "card": the previous framed layout — flip this to revert.
 */
const INBOX_FRAME: "page" | "card" = "card";

const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable
  );
};

/** Title row of the list column: unread bubble, view/group menus and the new-message button. */
function ListHeader({
  unread,
  view,
  onView,
  groupBy,
  onGroupBy,
  onNew,
  titleAs = "page",
}: {
  unread: number;
  view: InboxView;
  onView: (view: InboxView) => void;
  groupBy: (typeof GROUP_MODES)[number]["key"];
  onGroupBy: (mode: (typeof GROUP_MODES)[number]["key"]) => void;
  onNew: () => void;
  /** Page frame: the page already carries the "Messages" title, so name the view here. */
  titleAs?: "page" | "view";
}) {
  const current = INBOX_VIEWS.find((item) => item.key === view)!;
  return (
    <div className="flex h-14 shrink-0 items-center gap-1 pr-2 pl-4">
      {titleAs === "view" ? (
        // Below lg the view menu already names the view, so the heading only shows beside the rail.
        <h2 className="hidden items-center gap-2 text-base font-semibold lg:flex">
          {current.label}
          <CountBubble
            count={unread}
            aria-label={`${unread} unread messages`}
          />
        </h2>
      ) : (
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          Messages
          <CountBubble
            count={unread}
            aria-label={`${unread} unread messages`}
          />
        </h1>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        {/* Below lg the rail is hidden, so the view lives in a menu instead. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              aria-label="Change view"
            >
              <current.icon />
              {current.label}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={view}
              onValueChange={(value) => onView(value as InboxView)}
            >
              {INBOX_VIEWS.map((item) => (
                <DropdownMenuRadioItem key={item.key} value={item.key}>
                  <item.icon />
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label="Group threads by"
            >
              <ListFilter />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Group by</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={groupBy}
              onValueChange={(value) =>
                onGroupBy(value as (typeof GROUP_MODES)[number]["key"])
              }
            >
              {GROUP_MODES.map((mode) => (
                <DropdownMenuRadioItem key={mode.key} value={mode.key}>
                  {mode.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label="New message"
          onClick={onNew}
        >
          <SquarePen />
        </Button>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const { user } = useAuth();
  const params = useParams<{ caseId?: string; conversationId?: string }>();
  const [location, navigate] = useLocation();
  const searchString = useSearch();
  const isMobile = useIsMobile();
  const prefs = useInboxPrefs();
  const actions = useThreadActions();

  const activeCaseId = params.caseId ? Number(params.caseId) : null;
  const activeConversationId = params.conversationId
    ? Number(params.conversationId)
    : null;
  const composing = location === "/messages/new";
  const activeKey = composing
    ? null
    : activeCaseId != null
      ? `case-${activeCaseId}`
      : activeConversationId != null
        ? `conversation-${activeConversationId}`
        : null;
  const hasActive = composing || activeKey !== null;
  const deepLinkMessageId = React.useMemo(() => {
    const value = Number(new URLSearchParams(searchString).get("m"));
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [searchString]);

  /* ---------- data ---------- */

  const { data: inbox, isLoading } = useListInbox({
    query: { queryKey: getListInboxQueryKey(), refetchInterval: CHAT_POLL_MS },
  });
  const { data: staffList = [] } = useListStaff({
    query: { queryKey: getListStaffQueryKey() },
  });
  const threads = React.useMemo(() => inbox ?? [], [inbox]);
  const activeThread = threads.find((thread) => thread.key === activeKey);

  const mentionables = React.useMemo<Mentionable[]>(
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
  const mentionNames = React.useMemo(
    () => staffList.map((member) => member.displayName),
    [staffList],
  );

  // The open thread's transcript, for the shared-files section. Same query
  // key as the pane, so React Query dedupes the request.
  const { data: caseChat } = useGetCaseChat(activeCaseId ?? 0, {
    query: {
      enabled: activeCaseId != null,
      queryKey: getGetCaseChatQueryKey(activeCaseId ?? 0),
      refetchInterval: CHAT_POLL_MS,
    },
  });
  const { data: conversation } = useGetConversation(activeConversationId ?? 0, {
    query: {
      enabled: activeConversationId != null,
      queryKey: getGetConversationQueryKey(activeConversationId ?? 0),
      refetchInterval: CHAT_POLL_MS,
    },
  });
  const files = React.useMemo<SharedFile[]>(() => {
    const messages =
      (activeCaseId != null ? caseChat?.messages : conversation?.messages) ??
      [];
    return messages
      .flatMap((message) =>
        (message.attachments ?? []).map((attachment) => ({
          ...attachment,
          sender: message.sender,
          sentAt: message.createdAt,
        })),
      )
      .reverse();
  }, [activeCaseId, caseChat, conversation]);

  /* ---------- list state ---------- */

  const [search, setSearch] = React.useState("");
  const debouncedSearch = useDebounced(search.trim(), 250);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const searchEnabled = debouncedSearch.length >= 2;
  const { data: searchHits, isFetching: searchPending } = useSearchChatMessages(
    { q: debouncedSearch },
    {
      query: {
        enabled: searchEnabled,
        queryKey: getSearchChatMessagesQueryKey({ q: debouncedSearch }),
        placeholderData: (previous) => previous,
      },
    },
  );

  const counts = React.useMemo(() => viewCounts(threads), [threads]);
  const stages = React.useMemo(() => stageCounts(threads), [threads]);
  const myCasesCount = React.useMemo(
    () =>
      threads.filter(
        (thread) =>
          !thread.archived && thread.case?.assignedTo === user?.displayName,
      ).length,
    [threads, user?.displayName],
  );
  const visible = React.useMemo(
    () =>
      searchThreads(
        threads.filter(
          (thread) =>
            thread.key === activeKey ||
            (matchesView(thread, prefs.view) &&
              matchesFocus(thread, prefs.focus, user?.id)),
        ),
        search,
      ),
    [threads, activeKey, prefs.view, prefs.focus, user?.displayName, search],
  );
  const groups = React.useMemo(
    () => groupThreads(visible, prefs.groupBy),
    [visible, prefs.groupBy],
  );
  const collapsed = React.useMemo(
    () => new Set(prefs.collapsed),
    [prefs.collapsed],
  );
  const toggleGroup = (key: string) =>
    setInboxPrefs({
      collapsed: collapsed.has(key)
        ? prefs.collapsed.filter((item) => item !== key)
        : [...prefs.collapsed, key],
    });
  const flat = React.useMemo(
    () =>
      groups
        .filter((group) => !collapsed.has(group.key))
        .flatMap((group) => group.threads),
    [groups, collapsed],
  );
  const [focusedKey, setFocusedKey] = React.useState<string | null>(null);
  const unread = badgeUnread(threads);
  const focusActive = prefs.focus.myCases || prefs.focus.stages.length > 0;
  const emptyText = search
    ? "No threads match"
    : prefs.view === "archived"
      ? "Nothing archived"
      : prefs.view === "all" && !focusActive
        ? "No conversations yet"
        : `Nothing in ${INBOX_VIEWS.find((item) => item.key === prefs.view)?.label ?? "this view"}`;

  /* ---------- find in conversation ---------- */

  const [findOpen, setFindOpen] = React.useState(false);
  const [findQuery, setFindQuery] = React.useState("");
  React.useEffect(() => {
    setFindOpen(false);
    setFindQuery("");
  }, [activeKey]);
  const find: FindState = {
    open: findOpen,
    query: findQuery,
    setQuery: (query) => {
      setFindOpen(true);
      setFindQuery(query);
    },
    close: () => {
      setFindOpen(false);
      setFindQuery("");
    },
  };

  /* ---------- details column ---------- */

  const [mobileInfo, setMobileInfo] = React.useState(false);
  React.useEffect(() => {
    setMobileInfo(false);
  }, [activeKey]);
  const infoOpen = isMobile ? mobileInfo : prefs.infoOpen;
  const toggleInfo = () =>
    isMobile
      ? setMobileInfo((open) => !open)
      : setInboxPrefs({ infoOpen: !prefs.infoOpen });
  const showInfo = infoOpen && !!activeThread;

  const layout = useDefaultLayout({
    id: "chariot-inbox",
    storage: typeof localStorage === "undefined" ? undefined : localStorage,
    panelIds: showInfo ? ["list", "thread", "info"] : ["list", "thread"],
  });

  /* ---------- keyboard ---------- */

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const typing = isTyping(event.target);
      if (event.key === "Escape") {
        if (findOpen) {
          find.close();
          return;
        }
        if (typing) return;
        if (isMobile && hasActive) navigate("/messages");
        return;
      }
      if (typing) return;
      const key = event.key.toLowerCase();
      const moveFocus = (delta: number) => {
        if (flat.length === 0) return;
        const from = flat.findIndex(
          (thread) => thread.key === (focusedKey ?? activeKey),
        );
        const next = flat[(from + delta + flat.length) % flat.length]!;
        setFocusedKey(next.key);
      };
      switch (key) {
        case "j":
        case "arrowdown":
          event.preventDefault();
          moveFocus(1);
          break;
        case "k":
        case "arrowup":
          event.preventDefault();
          moveFocus(-1);
          break;
        case "enter": {
          const thread = flat.find((item) => item.key === focusedKey);
          if (thread) navigate(threadHref(thread));
          break;
        }
        case "/":
          event.preventDefault();
          searchInputRef.current?.focus();
          break;
        case "n":
          navigate("/messages/new");
          break;
        case "i":
          if (activeThread) toggleInfo();
          break;
        case "f":
          if (activeThread) {
            event.preventDefault();
            find.setQuery("");
          }
          break;
        case "p":
          if (activeThread) actions.togglePinned(activeThread);
          break;
        case "m":
          if (activeThread) actions.toggleMuted(activeThread);
          break;
        case "u":
          if (activeThread)
            actions.markRead(activeThread, activeThread.unreadCount > 0);
          break;
        case "e":
          if (activeThread) actions.toggleArchived(activeThread);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------- render ---------- */

  if (user?.role === "client") {
    return (
      <div className="p-6 md:p-8 max-w-page mx-auto">Staff only area.</div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-[calc(100dvh-4rem)] p-4 md:h-[100dvh] md:p-frame">
        <Skeleton className="mx-auto h-full w-full max-w-page" />
      </div>
    );
  }

  const listColumn = (
    <>
      <ListHeader
        unread={unread}
        view={prefs.view}
        onView={(view) => setInboxPrefs({ view })}
        groupBy={prefs.groupBy}
        onGroupBy={(groupBy) => setInboxPrefs({ groupBy })}
        onNew={() => navigate("/messages/new")}
        titleAs={INBOX_FRAME === "page" ? "view" : "page"}
      />
      <div className="shrink-0 space-y-2 px-3 pb-2">
        <InputGroup className="rounded-full bg-card">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchInputRef}
            placeholder="Search chats and messages"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearch("");
                event.currentTarget.blur();
              }
            }}
            aria-label="Search chats and messages"
          />
          {search && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {focusActive && (
          <div
            className="flex flex-wrap items-center gap-1"
            data-testid="focus-chips"
          >
            {prefs.focus.myCases && (
              <Badge variant="secondary" className="gap-1 pr-1">
                My cases
                <button
                  type="button"
                  aria-label="Stop filtering to my cases"
                  className="rounded-full hover:bg-foreground/10"
                  onClick={() =>
                    setInboxPrefs({ focus: { ...prefs.focus, myCases: false } })
                  }
                >
                  <X className="size-3" />
                </button>
              </Badge>
            )}
            {prefs.focus.stages.map((stage) => (
              <Badge key={stage} variant="secondary" className="gap-1 pr-1">
                {stage}
                <button
                  type="button"
                  aria-label={`Stop filtering to ${stage}`}
                  className="rounded-full hover:bg-foreground/10"
                  onClick={() =>
                    setInboxPrefs({
                      focus: {
                        ...prefs.focus,
                        stages: prefs.focus.stages.filter(
                          (item) => item !== stage,
                        ),
                      },
                    })
                  }
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                setInboxPrefs({ focus: { myCases: false, stages: [] } })
              }
            >
              Clear
            </Button>
          </div>
        )}
      </div>
      <ThreadList
        groups={groups}
        activeKey={activeKey}
        focusedKey={focusedKey}
        actions={actions}
        collapsed={collapsed}
        onToggleGroup={toggleGroup}
        onFocusRow={setFocusedKey}
        search={search}
        searchHits={searchEnabled ? searchHits : undefined}
        searchPending={searchEnabled && searchPending}
        emptyText={emptyText}
      />
    </>
  );

  const paneProps = {
    thread: activeThread,
    actions,
    find,
    infoOpen: showInfo,
    onToggleInfo: toggleInfo,
    deepLinkMessageId,
    mentionables,
    mentionNames,
  };
  const pane = composing ? (
    <NewChatPane />
  ) : activeCaseId != null ? (
    <ActiveCaseChat caseId={activeCaseId} {...paneProps} />
  ) : activeConversationId != null ? (
    <ActiveConversation conversationId={activeConversationId} {...paneProps} />
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
      <p className="text-lg text-muted-foreground">No conversation selected</p>
    </div>
  );

  const rail = (
    <InboxRail
      className="hidden lg:flex"
      view={prefs.view}
      onView={(view) => setInboxPrefs({ view })}
      counts={counts}
      focus={prefs.focus}
      onFocus={(focus) => setInboxPrefs({ focus })}
      stages={stages}
      myCasesCount={myCasesCount}
    />
  );

  const infoSheet = isMobile && activeThread && (
    <Sheet open={mobileInfo} onOpenChange={setMobileInfo}>
      <SheetContent side="right" className="w-[min(100vw,22rem)] p-0">
        <SheetTitle className="sr-only">Thread details</SheetTitle>
        <ThreadInfoPanel
          thread={activeThread}
          files={files}
          actions={actions}
          className="h-full"
        />
      </SheetContent>
    </Sheet>
  );

  const columns = (
    <>
      {isMobile ? (
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          data-testid="chat-pane"
        >
          {hasActive ? (
            pane
          ) : (
            <div className="flex min-h-0 flex-1 flex-col bg-muted/30">
              {listColumn}
            </div>
          )}
        </div>
      ) : (
        <>
          {rail}
          <ResizablePanelGroup
            id="chariot-inbox"
            defaultLayout={layout.defaultLayout}
            onLayoutChanged={layout.onLayoutChanged}
            className="min-h-0 min-w-0 flex-1"
          >
            <ResizablePanel
              id="list"
              defaultSize={320}
              minSize={260}
              maxSize={520}
              className="flex min-h-0 flex-col bg-muted/30"
            >
              {listColumn}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel
              id="thread"
              minSize={360}
              className="flex min-h-0 min-w-0 flex-col bg-background"
              data-testid="chat-pane"
            >
              {pane}
            </ResizablePanel>
            {showInfo && activeThread && (
              <>
                <ResizableHandle />
                <ResizablePanel
                  id="info"
                  defaultSize={280}
                  minSize={240}
                  maxSize={420}
                  className={cn("flex min-h-0 flex-col")}
                >
                  <ThreadInfoPanel
                    thread={activeThread}
                    files={files}
                    actions={actions}
                    onClose={toggleInfo}
                    className="flex-1"
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </>
      )}
    </>
  );

  if (INBOX_FRAME === "card") {
    return (
      <div className="h-[calc(100dvh-4rem)] min-h-0 overflow-hidden p-4 md:h-[100dvh] md:p-frame">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-page flex-col">
          <Card className="min-h-0 flex-1 flex-row gap-0 overflow-hidden py-0">
            {columns}
          </Card>
        </div>
        {infoSheet}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-page min-h-0 flex-col p-6 md:h-[100dvh] md:p-8">
      {/* Same header as every other page; hidden on mobile while a thread is open to give the chat the height. */}
      <div className={cn("mb-4 shrink-0", isMobile && hasActive && "hidden")}>
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          Messages
          <CountBubble
            count={unread}
            aria-label={`${unread} unread messages`}
          />
        </h1>
      </div>
      <div className="flex min-h-0 flex-1 border-t" data-testid="inbox-columns">
        {columns}
      </div>
      {infoSheet}
    </div>
  );
}
