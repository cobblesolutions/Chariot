/**
 * Browser half of the assistant contract. Mirrors the server's
 * `services/assistant/core/types.ts`; keep the two in sync.
 */

export type Entity = {
  type: string;
  id: number | string;
  title: string;
  href: string;
};

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

export type Question = {
  question: string;
  options: Array<{
    value: string;
    label: string;
    detail?: string | null;
    type?: string | null;
    id?: number | null;
  }>;
  allowFreeText?: boolean;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type TranscriptAttachment = {
  id: number;
  name: string;
  contentType: string;
  byteSize: number;
};

export type ToolStatus = "ok" | "error" | "rejected" | "answered";

export type TranscriptMessage =
  | { role: "user"; content: string; attachments?: TranscriptAttachment[] }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | {
      role: "tool";
      tool_call_id: string;
      name: string;
      content: string;
      status: ToolStatus;
      displays?: RecordDisplay[];
      entities?: Entity[];
    };

export type Proposal = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  preview: WritePreview;
};

export type PendingQuestion = {
  id: string;
  name: string;
  question: Question;
};

export type Answer = { value: string; label?: string };

export type AssistantEvent =
  | { type: "status"; phase: "thinking" | "writing" }
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
      status: ToolStatus;
      displays?: RecordDisplay[];
      entities?: Entity[];
    }
  | ({ type: "proposal" } & Proposal)
  | ({ type: "question" } & PendingQuestion)
  | { type: "transcript"; messages: TranscriptMessage[] }
  | { type: "error"; message: string }
  | { type: "done"; awaiting: "approval" | "answer" | null };

/** A record the user linked into their message from the autofill menu. */
export type RecordRef = {
  type: string;
  id: number;
  label: string;
};

/** `@[John Smith](client:12)` — how a linked record travels inside message text. */
export const REF_PATTERN = /@\[([^\]]+)\]\(([a-z_]+):(\d+)\)/g;

export function encodeRef(ref: RecordRef) {
  return `@[${ref.label}](${ref.type}:${ref.id})`;
}

/** Tools that run without confirmation; everything else pauses the turn. */
export const READ_TOOL_NAMES = new Set([
  "lookup_record",
  "search_records",
  "get_record",
  "list_records",
  "read_file",
]);
export const ASK_TOOL_NAME = "ask_user";
