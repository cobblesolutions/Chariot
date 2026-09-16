import * as React from "react";
import { ArrowDown, Download, FileText, Reply, SmilePlus } from "lucide-react";
import type {
  MessageAttachment,
  MessageReaction,
  MessageReplyPreview,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Marker, MarkerContent } from "@/components/ui/marker";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
} from "@/components/ui/message-scroller";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AttachmentViewer, openAttachmentViewer } from "./attachment-viewer";
import { Emoji, EmojiText } from "./emoji";
import { EmojiPicker } from "./emoji-picker";
import {
  avatarColor,
  formatTimestampLabel,
  sameDay,
  TIMESTAMP_GAP_MS,
} from "./format";

/** The subset of Message / ConversationMessage the thread needs. */
export type ChatMessageLike = {
  id: number;
  sender: string;
  senderUserId?: number | null;
  body: string;
  createdAt: string;
  replyTo?: MessageReplyPreview | null;
  reactions?: MessageReaction[];
  attachments?: MessageAttachment[];
};

type ChatThreadProps<T extends ChatMessageLike> = {
  messages: T[];
  currentUserId?: number | null;
  onReply?: (message: T) => void;
  onReact?: (messageId: number, emoji: string) => void;
  /** Show sender names above bubbles from other people (group chats). */
  showSenders?: boolean;
  emptyText?: string;
  className?: string;
  /** Find-in-conversation query: matching text is marked in every bubble. */
  highlight?: string;
  /** Message to scroll to and outline (the current find match, or a deep link). */
  focusMessageId?: number | null;
  /** Names that render as @mention chips when written as "@Name" in a body. */
  mentionNames?: string[];
};

/** The iMessage Tapback set. */
export const TAPBACKS = ["❤️", "👍", "👎", "😂", "‼️", "❓"];

const GROUP_WINDOW_MS = 60 * 1000;
/** Bubbles holding block content (quote, attachments) pad uniformly by this much, and the
 *  blocks inside take the bubble's radius minus it, so their corners sit concentric with
 *  the bubble's. Text-only bubbles keep the wider pill padding. */
const BUBBLE_BLOCK_PAD = "p-2";
const BUBBLE_INNER_RADIUS = "rounded-[calc(var(--radius)-0.5rem)]";
const VISIBLE_REACTIONS = 4;

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentUrl(attachment: Pick<MessageAttachment, "id">) {
  return `/api/chat/attachments/${attachment.id}/download`;
}

export function isImageAttachment(
  attachment: Pick<MessageAttachment, "contentType">,
) {
  return attachment.contentType.startsWith("image/");
}

/** Applies a reaction toggle locally so the tapback flips before the server confirms. */
export function toggleReactionLocally(
  reactions: MessageReaction[],
  emoji: string,
): MessageReaction[] {
  const existing = reactions.find((reaction) => reaction.emoji === emoji);
  if (!existing) {
    return [...reactions, { emoji, count: 1, users: ["You"], reacted: true }];
  }
  if (existing.reacted) {
    return reactions
      .map((reaction) =>
        reaction === existing
          ? {
              ...reaction,
              count: reaction.count - 1,
              reacted: false,
              users: reaction.users.filter((user) => user !== "You"),
            }
          : reaction,
      )
      .filter((reaction) => reaction.count > 0);
  }
  return reactions.map((reaction) =>
    reaction === existing
      ? {
          ...reaction,
          count: reaction.count + 1,
          reacted: true,
          users: [...reaction.users, "You"],
        }
      : reaction,
  );
}

/**
 * Optimistic reactions: the tapback flips the moment it is tapped and the
 * server's answer (which arrives with the next messages prop) replaces the guess.
 */
function useOptimisticReactions<T extends ChatMessageLike>(messages: T[]) {
  const [overrides, setOverrides] = React.useState<
    Map<number, MessageReaction[]>
  >(() => new Map());
  React.useEffect(() => {
    setOverrides(new Map());
  }, [messages]);
  const reactionsFor = React.useCallback(
    (message: T) => overrides.get(message.id) ?? message.reactions ?? [],
    [overrides],
  );
  const toggle = React.useCallback((message: T, emoji: string) => {
    setOverrides((current) => {
      const next = new Map(current);
      next.set(
        message.id,
        toggleReactionLocally(
          current.get(message.id) ?? message.reactions ?? [],
          emoji,
        ),
      );
      return next;
    });
  }, []);
  return { reactionsFor, toggle };
}

type Row<T> =
  | { kind: "stamp"; key: string; at: string }
  | {
      kind: "message";
      key: string;
      message: T;
      first: boolean;
      last: boolean;
      latestOwn: boolean;
    };

/**
 * Turns the flat list into iMessage rows: a timestamp whenever the day changes
 * or the gap is long, and first/last-of-run flags so a run from one sender is
 * one tight cluster with a single tail and name.
 */
function buildRows<T extends ChatMessageLike>(
  messages: T[],
  currentUserId: number | null | undefined,
): Row<T>[] {
  const rows: Row<T>[] = [];
  const senderKey = (m: T) => m.senderUserId ?? m.sender;
  const ms = (m: T) => new Date(m.createdAt).getTime();
  const latestOwnId = [...messages]
    .reverse()
    .find((m) => m.senderUserId === currentUserId)?.id;
  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const stamped =
      !previous ||
      !sameDay(previous.createdAt, message.createdAt) ||
      ms(message) - ms(previous) > TIMESTAMP_GAP_MS;
    if (stamped)
      rows.push({
        kind: "stamp",
        key: `stamp-${message.id}`,
        at: message.createdAt,
      });
    const continues = (a: T | undefined, b: T) =>
      !!a &&
      senderKey(a) === senderKey(b) &&
      Math.abs(ms(b) - ms(a)) < GROUP_WINDOW_MS;
    rows.push({
      kind: "message",
      key: `m-${message.id}`,
      message,
      first: stamped || !continues(previous, message),
      last:
        !next ||
        !continues(message, next) ||
        ms(next) - ms(message) > TIMESTAMP_GAP_MS,
      latestOwn: message.id === latestOwnId,
    });
  });
  return rows;
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Message text with "@Name" mentions rendered as chips and find matches marked.
 * Mentions are matched longest-name-first so "@Worker A" wins over "@Worker".
 */
function MessageBody({
  body,
  highlight,
  mentionNames,
  mine,
}: {
  body: string;
  highlight?: string;
  mentionNames?: string[];
  mine: boolean;
}) {
  const nodes = React.useMemo(() => {
    const names = [...(mentionNames ?? []), "everyone", "all"]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    const mention = names.length
      ? new RegExp(`(@(?:${names.map(escapeRegExp).join("|")}))(?![\\w])`, "gi")
      : null;
    const query = highlight?.trim();
    const mark = query ? new RegExp(`(${escapeRegExp(query)})`, "gi") : null;

    // Emoji inside the text become Twemoji SVGs, matching the picker and tapbacks.
    const withMarks = (text: string, keyPrefix: string): React.ReactNode[] => {
      if (!mark) return [<EmojiText key={keyPrefix} text={text} />];
      return text.split(mark).map((part, index) =>
        part && part.toLowerCase() === query!.toLowerCase() ? (
          <mark
            key={`${keyPrefix}-${index}`}
            className="rounded-sm bg-yellow-300/80 px-0.5 text-foreground"
          >
            <EmojiText text={part} />
          </mark>
        ) : (
          <EmojiText key={`${keyPrefix}-${index}`} text={part} />
        ),
      );
    };
    if (!mention) return withMarks(body, "b");
    return body.split(mention).flatMap((part, index) =>
      index % 2 === 1 ? (
        <span
          key={`m-${index}`}
          className={cn(
            "rounded-md px-1 font-semibold",
            mine ? "bg-primary-foreground/20" : "bg-primary/15 text-primary",
          )}
          data-testid="mention"
        >
          {part}
        </span>
      ) : (
        withMarks(part, `t-${index}`)
      ),
    );
  }, [body, highlight, mentionNames, mine]);
  return <>{nodes}</>;
}

/** Scrolls the focused message into view whenever it changes. */
function FocusMessage({ messageId }: { messageId: number | null | undefined }) {
  const { scrollToMessage } = useMessageScroller();
  React.useEffect(() => {
    if (messageId == null) return;
    // Give a freshly loaded transcript one frame to lay out before jumping.
    const frame = requestAnimationFrame(() =>
      scrollToMessage(String(messageId), {
        behavior: "smooth",
        align: "center",
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [messageId, scrollToMessage]);
  return null;
}

function QuotedReply({
  reply,
  mine,
}: {
  reply: MessageReplyPreview;
  mine: boolean;
}) {
  const { scrollToMessage } = useMessageScroller();
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        scrollToMessage(String(reply.id), { behavior: "smooth" });
      }}
      className={cn(
        BUBBLE_INNER_RADIUS,
        "mb-1.5 flex w-full min-w-0 flex-col px-2.5 py-1.5 text-left text-[13px] leading-snug",
        mine ? "bg-primary-foreground/15" : "bg-background/70",
      )}
      aria-label={`Jump to message from ${reply.sender}`}
    >
      <span className="font-semibold">{reply.sender}</span>
      <span className={cn("truncate", mine ? "opacity-85" : "opacity-70")}>
        {reply.body || "Attachment"}
      </span>
    </button>
  );
}

function Attachments({
  attachments,
  all,
  mine,
}: {
  attachments: MessageAttachment[];
  /** Every attachment in the thread, so the viewer can step between them. */
  all: MessageAttachment[];
  mine: boolean;
}) {
  // Everything opens in the in-page viewer rather than a new tab.
  const open = (attachment: MessageAttachment) =>
    openAttachmentViewer(all, attachment.id);
  return (
    <div className="flex flex-col gap-1.5">
      {attachments.map((attachment) => {
        const url = attachmentUrl(attachment);
        if (isImageAttachment(attachment)) {
          return (
            <button
              key={attachment.id}
              type="button"
              aria-label={`Open ${attachment.name}`}
              onClick={() => open(attachment)}
              className={cn("block overflow-hidden", BUBBLE_INNER_RADIUS)}
            >
              <img
                src={url}
                alt={attachment.name}
                loading="lazy"
                className="max-h-72 w-auto max-w-full object-cover"
              />
            </button>
          );
        }
        return (
          <Attachment
            key={attachment.id}
            size="sm"
            state="done"
            className={cn(
              BUBBLE_INNER_RADIUS,
              mine && "border-primary-foreground/20",
            )}
          >
            <AttachmentTrigger asChild>
              <button
                type="button"
                aria-label={`Open ${attachment.name}`}
                onClick={() => open(attachment)}
              />
            </AttachmentTrigger>
            <AttachmentMedia>
              <FileText />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{attachment.name}</AttachmentTitle>
              <AttachmentDescription>
                {formatBytes(attachment.byteSize)}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction asChild>
                <a
                  href={url}
                  download={attachment.name}
                  aria-label={`Download ${attachment.name}`}
                >
                  <Download />
                </a>
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        );
      })}
    </div>
  );
}

/** Tapbacks pinned to the bubble's top corner, like iMessage; tap one to toggle it. */
function Tapbacks({
  reactions,
  mine,
  onToggle,
}: {
  reactions: MessageReaction[];
  mine: boolean;
  onToggle?: (emoji: string) => void;
}) {
  const shown = reactions.slice(0, VISIBLE_REACTIONS);
  const hidden = reactions.length - shown.length;
  const label = `Reactions: ${reactions.map((r) => `${r.emoji} ${r.count}`).join(", ")}`;
  return (
    <div
      role="group"
      aria-label={label}
      data-testid="reactions"
      className={cn(
        "absolute -top-5 z-10 flex items-center gap-0.5 rounded-full border border-background bg-muted p-0.5 shadow-sm",
        "animate-in fade-in duration-200",
        mine ? "-left-2" : "-right-2",
      )}
    >
      {shown.map((reaction) => (
        <Tooltip key={reaction.emoji}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-pressed={reaction.reacted}
              aria-label={`${reaction.emoji} ${reaction.count}`}
              disabled={!onToggle}
              onClick={() => onToggle?.(reaction.emoji)}
              className={cn(
                "flex h-6 min-w-6 items-center gap-0.5 rounded-full px-1.5 text-[13px] leading-none transition-colors hover:bg-background",
                reaction.reacted && "bg-primary text-primary-foreground",
              )}
            >
              <Emoji emoji={reaction.emoji} className="size-4" />
              {reaction.count > 1 && (
                <span className="text-[11px] font-medium">
                  {reaction.count}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{reaction.users.join(", ")}</TooltipContent>
        </Tooltip>
      ))}
      {hidden > 0 && (
        <span className="px-1 text-[11px] text-muted-foreground">
          +{hidden}
        </span>
      )}
    </div>
  );
}

/** The Tapback bar that floats above a bubble on hover, tap or focus. */
function TapbackBar({
  mine,
  onReact,
  onReply,
}: {
  mine: boolean;
  onReact?: (emoji: string) => void;
  onReply?: () => void;
}) {
  return (
    // The padded wrapper touches the bubble, so the pointer never leaves the
    // hover area on its way up to the bar. Hidden bars must not swallow clicks.
    <div
      className={cn(
        "absolute bottom-full z-20 pb-1.5",
        mine ? "right-0" : "left-0",
        "pointer-events-none opacity-0 transition-opacity duration-150",
        "group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-100",
        "group-data-[actions-open=true]/bubble:pointer-events-auto group-data-[actions-open=true]/bubble:opacity-100",
        "focus-within:pointer-events-auto focus-within:opacity-100",
        "has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100",
      )}
    >
      <div
        role="toolbar"
        aria-label="Message actions"
        data-testid="message-actions"
        className={cn(
          "flex items-center gap-0.5 rounded-full border bg-popover p-1 text-popover-foreground shadow-lg",
        )}
      >
        {onReact &&
          TAPBACKS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React with ${emoji}`}
              onClick={() => onReact(emoji)}
              className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-muted"
            >
              <Emoji emoji={emoji} className="size-5" />
            </button>
          ))}
        {onReact && (
          <EmojiPicker onPick={onReact} triggerLabel="More reactions">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label="More reactions"
            >
              <SmilePlus />
            </Button>
          </EmojiPicker>
        )}
        {onReply && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label="Reply"
            onClick={onReply}
          >
            <Reply />
          </Button>
        )}
      </div>
    </div>
  );
}

function MessageRow<T extends ChatMessageLike>({
  message,
  first,
  last,
  latestOwn,
  mine,
  reactions,
  showSenders,
  onReact,
  onReply,
  highlight,
  mentionNames,
  focused,
  allAttachments,
}: {
  message: T;
  first: boolean;
  last: boolean;
  latestOwn: boolean;
  mine: boolean;
  reactions: MessageReaction[];
  showSenders: boolean;
  onReact?: (emoji: string) => void;
  onReply?: () => void;
  highlight?: string;
  mentionNames?: string[];
  focused?: boolean;
  allAttachments: MessageAttachment[];
}) {
  // Touch screens have no hover: tapping the bubble shows the tapback bar instead.
  const [actionsOpen, setActionsOpen] = React.useState(false);
  const attachments = message.attachments ?? [];
  const react = onReact
    ? (emoji: string) => {
        onReact(emoji);
        setActionsOpen(false);
      }
    : undefined;
  const reply = onReply
    ? () => {
        onReply();
        setActionsOpen(false);
      }
    : undefined;

  return (
    <Message align={mine ? "end" : "start"}>
      <MessageContent className="gap-0.5">
        {first && !mine && showSenders && (
          <MessageHeader
            className={cn(
              "ml-3 text-[11px] font-medium",
              avatarColor(message.sender).text,
            )}
          >
            {message.sender}
          </MessageHeader>
        )}
        <Bubble
          variant={mine ? "default" : "muted"}
          align={mine ? "end" : "start"}
          data-actions-open={actionsOpen || undefined}
          className={cn(
            "max-w-[75%] gap-0",
            focused &&
              "rounded-lg ring-2 ring-ring ring-offset-2 ring-offset-background",
          )}
        >
          <BubbleContent
            className={cn(
              "rounded-lg text-[15px] leading-snug",
              message.replyTo || attachments.length > 0
                ? BUBBLE_BLOCK_PAD
                : "px-3 py-1.5",
              !first && (mine ? "rounded-tr-[5px]" : "rounded-tl-[5px]"),
              !last && (mine ? "rounded-br-[5px]" : "rounded-bl-[5px]"),
            )}
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest("a, button")) return;
              if (react || reply) setActionsOpen((open) => !open);
            }}
          >
            {message.replyTo && (
              <QuotedReply reply={message.replyTo} mine={mine} />
            )}
            {attachments.length > 0 && (
              <Attachments
                attachments={attachments}
                all={allAttachments}
                mine={mine}
              />
            )}
            {message.body && (
              <span
                className={cn(
                  "whitespace-pre-wrap",
                  attachments.length > 0 && "mt-1.5",
                  (message.replyTo || attachments.length > 0) && "block px-1.5",
                )}
              >
                <MessageBody
                  body={message.body}
                  highlight={highlight}
                  mentionNames={mentionNames}
                  mine={mine}
                />
              </span>
            )}
          </BubbleContent>
          {reactions.length > 0 && (
            <Tapbacks reactions={reactions} mine={mine} onToggle={react} />
          )}
          {(react || reply) && (
            <TapbackBar mine={mine} onReact={react} onReply={reply} />
          )}
        </Bubble>
        {latestOwn && last && (
          <MessageFooter className="mr-1 text-[11px] text-muted-foreground">
            Delivered
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

/**
 * Stock scroll-to-end button; while the reader is away from the live edge it also
 * counts messages that arrived from others, so nothing is missed offscreen.
 */
function JumpToLatest<T extends ChatMessageLike>({
  messages,
  currentUserId,
}: {
  messages: T[];
  currentUserId: number | null | undefined;
}) {
  const { end: awayFromEnd } = useMessageScrollerScrollable();
  const [unseen, setUnseen] = React.useState(0);
  const seenCount = React.useRef(messages.length);
  React.useEffect(() => {
    const arrived = messages
      .slice(seenCount.current)
      .filter((message) => message.senderUserId !== currentUserId).length;
    seenCount.current = messages.length;
    if (arrived > 0 && awayFromEnd) setUnseen((count) => count + arrived);
  }, [messages, currentUserId, awayFromEnd]);
  React.useEffect(() => {
    if (!awayFromEnd) setUnseen(0);
  }, [awayFromEnd]);

  if (unseen === 0)
    return <MessageScrollerButton className="rounded-full shadow-md" />;
  return (
    <MessageScrollerButton
      size="sm"
      className="rounded-full shadow-md"
      data-testid="new-messages"
    >
      {unseen === 1 ? "1 new message" : `${unseen} new messages`}
      <ArrowDown />
    </MessageScrollerButton>
  );
}

/**
 * iMessage-style transcript on the shadcn MessageScroller: timestamp labels,
 * clustered runs with one tail, tapbacks on the bubble corner, a floating
 * tapback bar, quoted replies that jump, image and file attachments.
 */
function ChatThread<T extends ChatMessageLike>({
  messages,
  currentUserId,
  onReply,
  onReact,
  showSenders = true,
  emptyText = "No messages yet",
  className,
  highlight,
  focusMessageId,
  mentionNames,
}: ChatThreadProps<T>) {
  const rows = React.useMemo(
    () => buildRows(messages, currentUserId),
    [messages, currentUserId],
  );
  const { reactionsFor, toggle } = useOptimisticReactions(messages);
  const allAttachments = React.useMemo(
    () => messages.flatMap((message) => message.attachments ?? []),
    [messages],
  );

  return (
    <MessageScrollerProvider defaultScrollPosition="end" autoScroll>
      <MessageScroller className={cn("flex-1", className)}>
        <MessageScrollerViewport
          // Never a horizontal bar: one appearing would shrink the height and flicker the vertical one.
          className="overflow-x-hidden px-4 py-3 md:px-6"
          data-testid="chat-viewport"
        >
          {/* Short chats sit at the bottom, like iMessage, instead of floating at the top. */}
          <MessageScrollerContent
            aria-label="Messages"
            className="justify-end gap-0.5"
          >
            {messages.length === 0 && (
              <MessageScrollerItem messageId="empty" className="flex-1">
                <Empty className="h-full">
                  <EmptyHeader>
                    <EmptyDescription>{emptyText}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </MessageScrollerItem>
            )}
            {rows.map((row) => {
              if (row.kind === "stamp") {
                const { day, time } = formatTimestampLabel(row.at);
                return (
                  <MessageScrollerItem
                    key={row.key}
                    messageId={row.key}
                    className="pt-4 pb-2"
                  >
                    <Marker className="justify-center text-[11px]">
                      <MarkerContent>
                        <span className="font-semibold">{day}</span> {time}
                      </MarkerContent>
                    </Marker>
                  </MessageScrollerItem>
                );
              }
              const { message, first, last, latestOwn } = row;
              const mine =
                currentUserId != null && message.senderUserId === currentUserId;
              const reactions = reactionsFor(message);
              return (
                <MessageScrollerItem
                  key={row.key}
                  messageId={String(message.id)}
                  // The stock item paints with containment, which would clip the
                  // tapbacks and the floating bar that hang outside the bubble.
                  className={cn(
                    "contain-none [content-visibility:visible]",
                    "animate-in fade-in slide-in-from-bottom-2 duration-300",
                    first && "mt-1.5",
                    reactions.length > 0 && "mt-4",
                  )}
                  data-testid="chat-message"
                  data-mine={mine || undefined}
                >
                  <MessageRow
                    message={message}
                    first={first}
                    last={last}
                    latestOwn={latestOwn}
                    mine={mine}
                    reactions={reactions}
                    showSenders={showSenders}
                    highlight={highlight}
                    mentionNames={mentionNames}
                    focused={
                      focusMessageId != null && focusMessageId === message.id
                    }
                    allAttachments={allAttachments}
                    onReact={
                      onReact
                        ? (emoji) => {
                            toggle(message, emoji);
                            onReact(message.id, emoji);
                          }
                        : undefined
                    }
                    onReply={onReply ? () => onReply(message) : undefined}
                  />
                </MessageScrollerItem>
              );
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <JumpToLatest messages={messages} currentUserId={currentUserId} />
        <AttachmentViewer />
        <FocusMessage messageId={focusMessageId} />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

export { ChatThread };
