/**
 * Shared contract of the assistant core. The browser mirrors the transcript
 * and event types in `components/assistant/core/types.ts`; keep them in sync.
 */

/** The minimum a tool context must carry; projects extend it (API caller, request…). */
export type BaseContext = {
  user: { id: number; displayName: string; role: string };
};

export type ToolKind =
  /** Runs immediately, no confirmation. */
  | "read"
  /** Shown as a proposal; runs only after the user approves it. */
  | "write"
  /** Pauses the turn to ask the user something (rendered as a dropdown). */
  | "ask";

/** A record the UI links to, wherever its title appears in the reply. */
export type Entity = {
  type: string;
  id: number | string;
  title: string;
  href: string;
};

/** A record rendered as a card in the chat, with any files attached to it. */
export type RecordDisplay = {
  type: string;
  id: number;
  title: string;
  subtitle: string | null;
  badge: string | null;
  href: string;
  fields: Array<{ label: string; value: string; href?: string | null }>;
  media: Array<{
    kind: "image" | "pdf" | "audio" | "file";
    id: number;
    name: string;
    url: string;
    detail?: string;
  }>;
};

/** What the user sees before approving a write. */
export type WritePreview = {
  title: string;
  summary: string;
  target: {
    type: string;
    id: number | null;
    title: string;
    href: string | null;
  } | null;
  changes: Array<{ field: string; from: string | null; to: string | null }>;
  destructive: boolean;
};

/** A question the assistant needs answered before it can continue. */
export type Question = {
  question: string;
  options: Array<{
    value: string;
    label: string;
    detail?: string | null;
    /** When the option is a record, so the UI can show its icon and link it. */
    type?: string | null;
    id?: number | null;
  }>;
  allowFreeText?: boolean;
};

export type ToolResult = {
  /** JSON handed back to the model. */
  content: unknown;
  /** Cards for the chat UI; not sent to the model. */
  displays?: RecordDisplay[];
  /** Records mentioned in the result, so the UI can link their titles in prose. */
  entities?: Entity[];
};

export type Tool<Ctx extends BaseContext = BaseContext> = {
  name: string;
  description: string;
  kind: ToolKind;
  parameters: Record<string, unknown>;
  run: (ctx: Ctx, args: Record<string, unknown>) => Promise<ToolResult>;
  /** Write tools: what the user is asked to approve. */
  preview?: (ctx: Ctx, args: Record<string, unknown>) => Promise<WritePreview>;
  /** Ask tools: the question to render. */
  question?: (ctx: Ctx, args: Record<string, unknown>) => Promise<Question>;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/* ----------------------------------------------------------------------------
 * Transcript: what the browser stores and sends back each turn
 * ------------------------------------------------------------------------- */

export type TranscriptAttachment = {
  id: number;
  name: string;
  contentType: string;
  byteSize: number;
};

export type TranscriptMessage =
  | { role: "user"; content: string; attachments?: TranscriptAttachment[] }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | {
      role: "tool";
      tool_call_id: string;
      name: string;
      content: string;
      status: "ok" | "error" | "rejected" | "answered";
      displays?: RecordDisplay[];
      entities?: Entity[];
    };

/** Server-sent events streamed to the browser during one turn. */
export type AssistantEvent =
  | { type: "status"; phase: "thinking" | "writing" }
  /** A slice of the model's visible reasoning, when reasoning is enabled. */
  | { type: "reasoning"; delta: string }
  | { type: "text"; delta: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      id: string;
      name: string;
      status: "ok" | "error" | "rejected" | "answered";
      displays?: RecordDisplay[];
      entities?: Entity[];
    }
  | {
      type: "proposal";
      id: string;
      name: string;
      args: Record<string, unknown>;
      preview: WritePreview;
    }
  | { type: "question"; id: string; name: string; question: Question }
  | { type: "transcript"; messages: TranscriptMessage[] }
  | { type: "error"; message: string }
  | { type: "done"; awaiting: "approval" | "answer" | null };

/** The user's decision on a question, keyed by tool-call id in the next request. */
export type Answer = { value: string; label?: string };
