import * as React from "react";
import {
  AlertCircle,
  Check,
  CircleX,
  FileText,
  Music,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import { useAssistantConfig } from "./config";
import { Markdown } from "./markdown";
import { ProposalCard } from "./proposal-card";
import { QuestionCard } from "./question-card";
import { RecordCard, TypeTile } from "./record-card";
import {
  ASK_TOOL_NAME,
  READ_TOOL_NAMES,
  REF_PATTERN,
  type Answer,
  type Entity,
  type PendingQuestion,
  type Proposal,
  type RecordDisplay,
  type ToolCall,
  type TranscriptAttachment,
  type TranscriptMessage,
} from "./types";
import type { Activity, AssistantState } from "./use-assistant";

type ToolMessage = Extract<TranscriptMessage, { role: "tool" }>;
type UserMessage = Extract<TranscriptMessage, { role: "user" }>;

type Row =
  | { kind: "user"; key: string; message: UserMessage }
  | { kind: "assistant"; key: string; content: string }
  | {
      kind: "activity";
      key: string;
      call: ToolCall;
      result: ToolMessage | null;
    }
  | {
      kind: "question";
      key: string;
      call: ToolCall;
      result: ToolMessage | null;
    }
  | { kind: "write"; key: string; call: ToolCall; result: ToolMessage | null };

function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.function.arguments || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseContent(
  result: ToolMessage | null,
): Record<string, unknown> | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result.content);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

const humanize = (name: string) =>
  name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** "Searching for “smith”…" while running; "Searched for “smith” · 3 found" once done. */
export function activityLabel(
  name: string,
  args: Record<string, unknown>,
  result: ToolMessage | null,
  running: boolean,
) {
  const content = parseContent(result);
  const display = result?.displays?.[0];
  switch (name) {
    case "lookup_record":
      return running
        ? `Looking up “${String(args.query ?? "")}”…`
        : display
          ? `Found ${display.title}`
          : `Looked up “${String(args.query ?? "")}”`;
    case "search_records":
      return running
        ? `Searching for “${String(args.query ?? "")}”…`
        : `Searched for “${String(args.query ?? "")}”${typeof content?.total === "number" ? ` · ${content.total} found` : ""}`;
    case "get_record":
      return running
        ? `Opening ${String(args.type ?? "record").replace(/_/g, " ")}…`
        : display
          ? `Opened ${display.title}`
          : `Opened ${String(args.type ?? "record")} #${String(args.id ?? "")}`;
    case "list_records":
      return running
        ? `Listing ${String(args.kind ?? "records")}…`
        : `Listed ${String(args.kind ?? "records")}${typeof content?.returned === "number" ? ` · ${content.returned}` : ""}`;
    case "read_file":
      return running
        ? "Reading file…"
        : `Read ${content?.name ? String(content.name) : `${String(args.source ?? "file")} #${String(args.id ?? "")}`}`;
    default:
      return running
        ? `${humanize(name).replace(/^(\w+)/, (verb) => verb.replace(/e$/, "") + "ing")}…`
        : humanize(name);
  }
}

/** Splits a user message into text and linked-record chips. */
function UserText({ content }: { content: string }) {
  const { Link, recordHref } = useAssistantConfig();
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of content.matchAll(REF_PATTERN)) {
    const [whole, label, type, id] = match;
    const index = match.index ?? 0;
    if (index > last) parts.push(content.slice(last, index));
    parts.push(
      <Link
        key={`${type}:${id}:${index}`}
        href={recordHref(type!, Number(id))}
        className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md bg-primary-foreground/15 px-1.5 py-0.5 align-baseline text-[13px] font-medium hover:bg-primary-foreground/25"
      >
        <TypeTile
          type={type!}
          className="size-4 rounded-sm border-0 bg-primary-foreground/20 text-primary-foreground [&_svg]:size-2.5"
        />
        <span className="truncate">{label}</span>
      </Link>,
    );
    last = index + whole.length;
  }
  if (last < content.length) parts.push(content.slice(last));
  return <span className="whitespace-pre-wrap">{parts}</span>;
}

function UserAttachments({
  attachments,
}: {
  attachments: TranscriptAttachment[];
}) {
  const { attachmentUrl } = useAssistantConfig();
  return (
    <AttachmentGroup className="mb-1.5">
      {attachments.map((file) => {
        const url = attachmentUrl(file.id);
        const image = file.contentType.startsWith("image/");
        return (
          <Attachment
            key={file.id}
            size="xs"
            state="done"
            className="bg-primary-foreground/10 text-primary-foreground"
          >
            <AttachmentTrigger asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <AttachmentMedia
                  variant={image ? "image" : "icon"}
                  className="bg-primary-foreground/15 text-primary-foreground"
                >
                  {image ? (
                    <img src={url} alt={file.name} />
                  ) : file.contentType.startsWith("audio/") ? (
                    <Music />
                  ) : (
                    <FileText />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{file.name}</AttachmentTitle>
                </AttachmentContent>
              </a>
            </AttachmentTrigger>
          </Attachment>
        );
      })}
    </AttachmentGroup>
  );
}

function UserRow({ message }: { message: UserMessage }) {
  return (
    <Message align="end" className="gap-0">
      <Bubble variant="default" align="end" className="max-w-[85%] gap-0">
        <BubbleContent className="rounded-lg px-3 py-1.5 text-[15px] leading-snug">
          {message.attachments && message.attachments.length > 0 && (
            <UserAttachments attachments={message.attachments} />
          )}
          {message.content && <UserText content={message.content} />}
        </BubbleContent>
      </Bubble>
    </Message>
  );
}

function AssistantRow({
  content,
  entities,
  streaming,
}: {
  content: string;
  entities: Entity[];
  streaming?: boolean;
}) {
  return (
    <Message align="start" className="gap-0">
      <Bubble variant="muted" align="start" className="max-w-[92%] gap-0">
        <BubbleContent className="rounded-lg px-3 py-2 text-[14px] leading-normal">
          <Markdown entities={entities}>{content}</Markdown>
          {streaming && (
            <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse rounded-sm bg-foreground/60 align-middle" />
          )}
        </BubbleContent>
      </Bubble>
    </Message>
  );
}

function Cards({ displays }: { displays?: RecordDisplay[] }) {
  if (!displays?.length) return null;
  return (
    <div className="flex flex-col gap-2 py-1">
      {displays.map((display) => (
        <RecordCard key={`${display.type}-${display.id}`} record={display} />
      ))}
    </div>
  );
}

function ActivityMarker({
  label,
  status,
}: {
  label: string;
  status: Activity["status"];
}) {
  return (
    <Marker className="justify-start px-1 text-xs text-muted-foreground">
      <MarkerIcon>
        {status === "running" ? (
          <Spinner className="size-3" />
        ) : status === "ok" || status === "answered" ? (
          <Check className="size-3" />
        ) : status === "rejected" ? (
          <X className="size-3" />
        ) : (
          <AlertCircle className="size-3 text-destructive" />
        )}
      </MarkerIcon>
      <MarkerContent className={cn(status === "error" && "text-destructive")}>
        {label}
      </MarkerContent>
    </Marker>
  );
}

function ActivityRow({
  call,
  result,
}: {
  call: ToolCall;
  result: ToolMessage | null;
}) {
  const args = parseArgs(call);
  const content = parseContent(result);
  const status = result ? result.status : "running";
  const label = activityLabel(
    call.function.name,
    args,
    result,
    status === "running",
  );
  return (
    <div className="flex flex-col">
      <ActivityMarker
        label={
          status === "error" && content?.error
            ? `${label} · ${String(content.error)}`
            : label
        }
        status={status}
      />
      <Cards displays={result?.displays} />
    </div>
  );
}

/** A write tool call after the user has answered it, or is answering it. */
function WriteRow({
  call,
  result,
  proposal,
  decision,
  onDecide,
  disabled,
}: {
  call: ToolCall;
  result: ToolMessage | null;
  proposal: Proposal | undefined;
  decision: boolean | undefined;
  onDecide: (approved: boolean) => void;
  disabled: boolean;
}) {
  const args = parseArgs(call);
  const label = humanize(call.function.name);
  if (result) {
    const content = parseContent(result);
    const text =
      result.status === "rejected"
        ? `${label} · declined`
        : result.status === "error"
          ? `${label} · failed${content?.error ? `: ${String(content.error)}` : ""}`
          : `${label} · done`;
    return (
      <div className="flex flex-col">
        <ActivityMarker label={text} status={result.status} />
        <Cards displays={result.displays} />
      </div>
    );
  }
  // A proposal whose preview was lost (storage cleared): fall back to the raw arguments.
  const fallback: Proposal = proposal ?? {
    id: call.id,
    name: call.function.name,
    args,
    preview: {
      title: label,
      summary: label,
      target: null,
      changes: Object.entries(
        (args.data as Record<string, unknown> | undefined) ?? args,
      ).map(([field, value]) => ({
        field,
        from: null,
        to: typeof value === "string" ? value : JSON.stringify(value),
      })),
      destructive: /delete|archive/.test(call.function.name),
    },
  };
  return (
    <div className="py-1">
      <ProposalCard
        proposal={fallback}
        decision={decision}
        onDecide={onDecide}
        disabled={disabled}
      />
    </div>
  );
}

function QuestionRow({
  call,
  result,
  pending,
  onAnswer,
  disabled,
}: {
  call: ToolCall;
  result: ToolMessage | null;
  pending: PendingQuestion | undefined;
  onAnswer: (answer: Answer) => void;
  disabled: boolean;
}) {
  const args = parseArgs(call);
  if (result) {
    const content = parseContent(result);
    const label = content?.answered
      ? `Chose ${String(content.label ?? content.value)}`
      : "Question skipped";
    return (
      <ActivityMarker
        label={label}
        status={content?.answered ? "answered" : "rejected"}
      />
    );
  }
  const fallback: PendingQuestion = pending ?? {
    id: call.id,
    name: call.function.name,
    question: {
      question: String(args.question ?? "Which one?"),
      options: Array.isArray(args.options)
        ? (args.options as Array<Record<string, unknown>>).map((option) => ({
            value: String(option.value ?? option.label ?? ""),
            label: String(option.label ?? option.value ?? ""),
            detail: option.detail ? String(option.detail) : null,
            type: option.type ? String(option.type) : null,
            id: typeof option.id === "number" ? option.id : null,
          }))
        : [],
      allowFreeText: args.allowFreeText === true,
    },
  };
  return (
    <div className="py-1">
      <QuestionCard
        pending={fallback}
        answered={undefined}
        onAnswer={onAnswer}
        disabled={disabled}
      />
    </div>
  );
}

/** Transcript → rows, resolving each tool call to its result. */
function buildRows(messages: TranscriptMessage[]): Row[] {
  const results = new Map<string, ToolMessage>();
  for (const message of messages) {
    if (message.role === "tool") results.set(message.tool_call_id, message);
  }
  const rows: Row[] = [];
  messages.forEach((message, index) => {
    if (message.role === "user") {
      rows.push({ kind: "user", key: `u-${index}`, message });
    } else if (message.role === "assistant") {
      if (message.content.trim())
        rows.push({
          kind: "assistant",
          key: `a-${index}`,
          content: message.content,
        });
      for (const call of message.tool_calls ?? []) {
        const result = results.get(call.id) ?? null;
        const name = call.function.name;
        rows.push({
          kind: READ_TOOL_NAMES.has(name)
            ? "activity"
            : name === ASK_TOOL_NAME
              ? "question"
              : "write",
          key: `t-${call.id}`,
          call,
          result,
        });
      }
    }
  });
  return rows;
}

/**
 * The assistant transcript on the shadcn MessageScroller: user turns anchor
 * near the top with a peek of the previous turn, replies stream in below,
 * and a saved thread reopens at the last user message.
 */
function AssistantThread({ state }: { state: AssistantState }) {
  const { intro, starters, title } = useAssistantConfig();
  const {
    messages,
    proposals,
    questions,
    entities,
    streaming,
    streamText,
    activity,
    error,
  } = state;
  const rows = React.useMemo(() => buildRows(messages), [messages]);
  const [decisions, setDecisions] = React.useState<Record<string, boolean>>({});
  const [answers, setAnswers] = React.useState<Record<string, Answer>>({});
  const proposalById = React.useMemo(
    () => new Map(proposals.map((item) => [item.id, item])),
    [proposals],
  );
  const questionById = React.useMemo(
    () => new Map(questions.map((item) => [item.id, item])),
    [questions],
  );
  const pendingWrites = rows.filter(
    (row): row is Extract<Row, { kind: "write" }> =>
      row.kind === "write" && !row.result,
  );
  const pendingQuestions = rows.filter(
    (row): row is Extract<Row, { kind: "question" }> =>
      row.kind === "question" && !row.result,
  );

  React.useEffect(() => {
    setDecisions({});
    setAnswers({});
  }, [messages]);

  const decide = (id: string, approved: boolean) => {
    const next = { ...decisions, [id]: approved };
    setDecisions(next);
    if (pendingWrites.every((row) => next[row.call.id] !== undefined))
      state.decide(next);
  };
  const decideAll = (approved: boolean) =>
    state.decide(
      Object.fromEntries(pendingWrites.map((row) => [row.call.id, approved])),
    );
  const answerOne = (id: string, answer: Answer) => {
    const next = { ...answers, [id]: answer };
    setAnswers(next);
    if (pendingQuestions.every((row) => next[row.call.id] !== undefined))
      state.answer(next);
  };

  return (
    <MessageScrollerProvider
      defaultScrollPosition="last-anchor"
      autoScroll
      scrollPreviousItemPeek={64}
    >
      <MessageScroller className="flex-1">
        <MessageScrollerViewport
          className="overflow-x-hidden px-3 py-3"
          data-testid="assistant-viewport"
        >
          <MessageScrollerContent
            aria-label={`${title} conversation`}
            aria-busy={streaming}
            className="gap-2"
          >
            {rows.length === 0 && !streaming && (
              <MessageScrollerItem messageId="empty" className="flex-1">
                <Empty className="h-full py-6">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Sparkles />
                    </EmptyMedia>
                    <EmptyTitle>{title}</EmptyTitle>
                    <EmptyDescription>{intro}</EmptyDescription>
                  </EmptyHeader>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {starters.map((starter) => (
                      <Button
                        key={starter}
                        variant="outline"
                        size="xs"
                        onClick={() => state.send(starter)}
                      >
                        {starter}
                      </Button>
                    ))}
                  </div>
                </Empty>
              </MessageScrollerItem>
            )}

            {rows.map((row) => {
              if (row.kind === "user") {
                return (
                  <MessageScrollerItem
                    key={row.key}
                    messageId={row.key}
                    scrollAnchor
                  >
                    <UserRow message={row.message} />
                  </MessageScrollerItem>
                );
              }
              if (row.kind === "assistant") {
                return (
                  <MessageScrollerItem key={row.key} messageId={row.key}>
                    <AssistantRow content={row.content} entities={entities} />
                  </MessageScrollerItem>
                );
              }
              if (row.kind === "activity") {
                return (
                  <MessageScrollerItem key={row.key} messageId={row.key}>
                    <ActivityRow call={row.call} result={row.result} />
                  </MessageScrollerItem>
                );
              }
              if (row.kind === "question") {
                return (
                  <MessageScrollerItem key={row.key} messageId={row.key}>
                    <QuestionRow
                      call={row.call}
                      result={row.result}
                      pending={questionById.get(row.call.id)}
                      onAnswer={(answer) => answerOne(row.call.id, answer)}
                      disabled={streaming}
                    />
                  </MessageScrollerItem>
                );
              }
              return (
                <MessageScrollerItem key={row.key} messageId={row.key}>
                  <WriteRow
                    call={row.call}
                    result={row.result}
                    proposal={proposalById.get(row.call.id)}
                    decision={decisions[row.call.id]}
                    onDecide={(approved) => decide(row.call.id, approved)}
                    disabled={streaming}
                  />
                </MessageScrollerItem>
              );
            })}

            {pendingWrites.length > 1 && !streaming && (
              <MessageScrollerItem messageId="decide-all">
                <div className="flex items-center gap-2 py-1">
                  <Badge variant="secondary">
                    {pendingWrites.length} changes waiting
                  </Badge>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => decideAll(false)}
                  >
                    <CircleX />
                    Decline all
                  </Button>
                  <Button size="xs" onClick={() => decideAll(true)}>
                    <Check />
                    Approve all
                  </Button>
                </div>
              </MessageScrollerItem>
            )}

            {streaming &&
              activity.map((item) => (
                <MessageScrollerItem
                  key={`live-${item.id}`}
                  messageId={`live-${item.id}`}
                >
                  <div className="flex flex-col">
                    <ActivityMarker
                      label={activityLabel(
                        item.name,
                        item.args,
                        null,
                        item.status === "running",
                      )}
                      status={item.status}
                    />
                    <Cards displays={item.displays} />
                  </div>
                </MessageScrollerItem>
              ))}
            {streaming && streamText && (
              <MessageScrollerItem messageId="live-text">
                <AssistantRow
                  content={streamText}
                  entities={entities}
                  streaming
                />
              </MessageScrollerItem>
            )}
            {streaming &&
              !streamText &&
              activity.every((item) => item.status !== "running") && (
                <MessageScrollerItem messageId="live-thinking">
                  <Marker className="justify-start px-1 text-xs text-muted-foreground">
                    <MarkerIcon>
                      <Spinner className="size-3" />
                    </MarkerIcon>
                    <MarkerContent>
                      {state.phase === "connecting"
                        ? "Connecting…"
                        : "Thinking…"}
                    </MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}
            {error && (
              <MessageScrollerItem messageId="error">
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>The assistant hit a problem</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton
          className="rounded-full shadow-md"
          aria-label="Jump to latest"
        />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

/** One line under the transcript saying what the assistant is doing right now. */
function AssistantStatus({ state }: { state: AssistantState }) {
  const { phase, activity, streaming, reasoning } = state;
  if (!streaming || !phase) return null;
  // With reasoning enabled the model narrates its plan; show the tail of it.
  const thought = reasoning.trim().split(/\n+/).pop()?.trim();
  const running = [...activity]
    .reverse()
    .find((item) => item.status === "running");
  const label =
    phase === "connecting"
      ? "Connecting…"
      : phase === "writing"
        ? "Writing reply…"
        : running
          ? activityLabel(running.name, running.args, null, true)
          : thought
            ? `Thinking… ${thought.slice(-90)}`
            : "Thinking…";
  return (
    <div
      className="flex items-center gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground animate-in fade-in"
      role="status"
      aria-live="polite"
      data-testid="assistant-status"
    >
      <Spinner className="size-3" />
      <span className="truncate">{label}</span>
    </div>
  );
}

export { AssistantStatus, AssistantThread };
