import * as React from "react";
import type {
  ChatSearchResult,
  InboxThread,
} from "@workspace/api-client-react";
import {
  Archive,
  ArchiveRestore,
  AtSign,
  BellOff,
  Briefcase,
  ChevronDown,
  ExternalLink,
  Mail,
  MailOpen,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pin,
  PinOff,
  Users,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { CountBubble } from "@/components/count-bubble";
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
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StageBadge } from "@/components/stage-badge";
import { avatarColor, formatRelativeStamp, initials } from "./format";
import { threadHref, type ThreadGroup } from "./inbox-model";
import type { ThreadActions } from "./use-thread-actions";

/* ---------- avatar ---------- */

export function ThreadAvatar({
  kind,
  title,
  linkedToCase = false,
  className,
}: {
  kind: InboxThread["kind"];
  title: string;
  /** Direct/group chats that belong to a case get a small case marker. */
  linkedToCase?: boolean;
  className?: string;
}) {
  return (
    <span className="relative shrink-0">
      <Avatar className={cn("size-10", className)}>
        <AvatarFallback
          className={cn(
            "font-medium text-white",
            kind === "case"
              ? "bg-primary"
              : kind === "group"
                ? "bg-slate-500"
                : avatarColor(title).bg,
          )}
        >
          {kind === "case" ? (
            <Briefcase className="size-4" />
          ) : kind === "group" ? (
            <Users className="size-4" />
          ) : (
            initials(title)
          )}
        </AvatarFallback>
      </Avatar>
      {linkedToCase && kind !== "case" && (
        <span
          className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card"
          aria-label="Linked to a case"
        >
          <Briefcase className="size-2.5" />
        </span>
      )}
    </span>
  );
}

/* ---------- per-thread menu ---------- */

export type ThreadMenuAction = {
  key: string;
  label: string;
  icon: typeof Pin;
  onSelect: () => void;
  /** Start a new visual group before this item. */
  separatorBefore?: boolean;
};

export function threadMenuActions(
  thread: InboxThread,
  actions: ThreadActions,
  navigate: (href: string) => void,
): ThreadMenuAction[] {
  const items: ThreadMenuAction[] = [
    {
      key: "pin",
      label: thread.pinned ? "Unpin" : "Pin to top",
      icon: thread.pinned ? PinOff : Pin,
      onSelect: () => actions.togglePinned(thread),
    },
    {
      key: "read",
      label: thread.unreadCount > 0 ? "Mark as read" : "Mark as unread",
      icon: thread.unreadCount > 0 ? MailOpen : Mail,
      onSelect: () => actions.markRead(thread, thread.unreadCount > 0),
    },
    {
      key: "mute",
      label: thread.muted ? "Unmute" : "Mute notifications",
      icon: thread.muted ? Mail : BellOff,
      onSelect: () => actions.toggleMuted(thread),
    },
  ];
  if (thread.case) {
    items.push({
      key: "case",
      label: `Open case ${thread.case.reference}`,
      icon: ExternalLink,
      separatorBefore: true,
      onSelect: () => navigate(`/cases/${thread.case!.id}`),
    });
  }
  items.push({
    key: "archive",
    label: thread.archived ? "Move back to inbox" : "Archive",
    icon: thread.archived ? ArchiveRestore : Archive,
    separatorBefore: true,
    onSelect: () => actions.toggleArchived(thread),
  });
  return items;
}

/* ---------- row ---------- */

function ThreadRow({
  thread,
  active,
  focused,
  actions,
  onFocusRow,
}: {
  thread: InboxThread;
  active: boolean;
  /** Keyboard cursor (J/K) — distinct from the open thread. */
  focused: boolean;
  actions: ThreadActions;
  onFocusRow: () => void;
}) {
  const [, navigate] = useLocation();
  const menu = threadMenuActions(thread, actions, navigate);
  const preview = thread.lastMessage;
  const unread = thread.unreadCount > 0 && !thread.muted;
  const ref = React.useRef<HTMLAnchorElement>(null);

  React.useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group/row relative mx-2"
          data-testid="thread-row"
          data-active={active || undefined}
          data-focused={focused || undefined}
          data-thread-key={thread.key}
        >
          <Link
            ref={ref}
            href={threadHref(thread)}
            data-slot="thread-row"
            onFocus={onFocusRow}
            title={thread.subtitle}
            className={cn(
              "flex items-center gap-3 rounded-xl py-2 pr-9 pl-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted",
              // Same quiet fill as the active item in the rail; the keyboard cursor is a lighter tint.
              active ? "bg-muted" : focused && "bg-muted/60",
            )}
          >
            <ThreadAvatar
              kind={thread.kind}
              title={thread.title}
              linkedToCase={thread.caseId != null}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {/* Line 1: name, stage, then status icons and time on the right. */}
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "truncate text-[15px] leading-5",
                    unread ? "font-semibold" : "font-medium",
                  )}
                >
                  {thread.title}
                </span>
                <span
                  className={cn(
                    "ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground",
                  )}
                >
                  {thread.pinned && (
                    <Pin className="size-3 fill-current" aria-label="Pinned" />
                  )}
                  {thread.muted && (
                    <BellOff className="size-3" aria-label="Muted" />
                  )}
                  {thread.lastMessage &&
                    formatRelativeStamp(thread.lastMessage.createdAt)}
                </span>
              </div>
              {/* Line 2: latest message, with the unread count on the right. */}
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13px] leading-5",
                    unread ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {preview ? (
                    <>
                      {preview.hasAttachment && (
                        <Paperclip className="mr-1 inline size-3 align-[-2px]" />
                      )}
                      {preview.sender}: {preview.body || "Attachment"}
                    </>
                  ) : (
                    "No messages yet"
                  )}
                </span>
                {thread.case && (
                  <StageBadge
                    stage={thread.case.stage}
                    stageIndex={thread.case.stageIndex}
                    className="h-4 shrink-0 px-1.5 text-[10px] leading-none"
                  />
                )}
                {thread.mentionsMe && (
                  <span
                    className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    aria-label="Mentions you"
                  >
                    <AtSign className="size-2.5" />
                  </span>
                )}
                {thread.unreadCount > 0 && (
                  <CountBubble
                    count={thread.unreadCount}
                    className={cn(
                      "h-4 min-w-4 px-1 text-[10px]",
                      thread.muted && "opacity-60",
                    )}
                    data-testid="unread-badge"
                    aria-label={`${thread.unreadCount} unread`}
                  />
                )}
              </div>
            </div>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Actions for ${thread.title}`}
                className="absolute top-2 right-2 rounded-full opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
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
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {menu.map((item) => (
          <React.Fragment key={item.key}>
            {item.separatorBefore && <ContextMenuSeparator />}
            <ContextMenuItem onSelect={item.onSelect}>
              <item.icon />
              {item.label}
            </ContextMenuItem>
          </React.Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/* ---------- message search hits ---------- */

function SearchHit({ hit, query }: { hit: ChatSearchResult; query: string }) {
  const href =
    hit.conversationId != null
      ? `/messages/conversation/${hit.conversationId}?m=${hit.messageId}`
      : `/messages/case/${hit.caseId}?m=${hit.messageId}`;
  return (
    <Link
      href={href}
      data-slot="thread-row"
      data-testid="search-hit"
      className="mx-2 flex items-center gap-3 rounded-xl py-2 pr-3 pl-2.5 outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
    >
      <ThreadAvatar
        kind={hit.kind}
        title={hit.threadTitle}
        linkedToCase={hit.caseId != null}
        className="size-8 text-xs"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">
            {hit.threadTitle}
          </span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {formatRelativeStamp(hit.createdAt)}
          </span>
        </div>
        <div className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">{hit.sender}:</span>{" "}
          <Highlighted text={hit.body} query={query} />
        </div>
      </div>
    </Link>
  );
}

/** Wraps case-insensitive matches of `query` in <mark>. */
export function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const parts = text.split(
    new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"),
  );
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark
            key={index}
            className="rounded-sm bg-primary/20 px-0.5 text-inherit"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

/* ---------- list ---------- */

export function ThreadList({
  groups,
  activeKey,
  focusedKey,
  actions,
  collapsed,
  onToggleGroup,
  onFocusRow,
  search,
  searchHits,
  searchPending,
  emptyText,
}: {
  groups: ThreadGroup[];
  activeKey: string | null;
  focusedKey: string | null;
  actions: ThreadActions;
  collapsed: Set<string>;
  onToggleGroup: (key: string) => void;
  onFocusRow: (key: string) => void;
  search: string;
  searchHits: ChatSearchResult[] | undefined;
  searchPending: boolean;
  emptyText: string;
}) {
  const total = groups.reduce((sum, group) => sum + group.threads.length, 0);
  const searching = search.trim().length >= 2;

  return (
    <ScrollArea
      className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!"
      data-testid="chat-list"
    >
      {total === 0 && !searching ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquare />
            </EmptyMedia>
            <EmptyDescription>{emptyText}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-0.5 py-1">
          {groups.map((group) => {
            const open = !collapsed.has(group.key);
            return (
              <Collapsible
                key={group.key}
                open={open}
                onOpenChange={() => onToggleGroup(group.key)}
              >
                <CollapsibleTrigger asChild>
                  {/* Plain label: the global aria-expanded hover paint is opted out so it never reads as a bar. */}
                  <button
                    type="button"
                    className="group/head flex w-full items-center gap-1.5 bg-transparent px-4 pt-3 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent"
                    data-testid="thread-group"
                  >
                    {group.label}
                    <span className="tabular-nums opacity-60">
                      {group.threads.length}
                    </span>
                    <ChevronDown
                      className={cn(
                        "ml-auto size-3 transition-[opacity,rotate]",
                        open
                          ? "opacity-0 group-hover/head:opacity-100"
                          : "-rotate-90 opacity-100",
                      )}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-0.5">
                  {group.threads.map((thread) => (
                    <ThreadRow
                      key={thread.key}
                      thread={thread}
                      active={thread.key === activeKey}
                      focused={thread.key === focusedKey}
                      actions={actions}
                      onFocusRow={() => onFocusRow(thread.key)}
                    />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
          {searching && (
            <div
              className="mt-1 flex flex-col gap-0.5"
              data-testid="search-results"
            >
              <div className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                Messages
                <span className="tabular-nums opacity-60">
                  {searchPending ? "…" : (searchHits?.length ?? 0)}
                </span>
              </div>
              {searchHits?.map((hit) => (
                <SearchHit key={hit.messageId} hit={hit} query={search} />
              ))}
              {!searchPending && searchHits?.length === 0 && total === 0 && (
                <p className="px-6 py-4 text-center text-sm text-muted-foreground">
                  Nothing matches “{search.trim()}”.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </ScrollArea>
  );
}
