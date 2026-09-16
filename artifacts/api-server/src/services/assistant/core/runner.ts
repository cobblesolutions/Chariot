import type { ChatMessage, ModelClient, ToolDefinition } from "./openrouter";
import type {
  Answer,
  AssistantEvent,
  BaseContext,
  Entity,
  Question,
  RecordDisplay,
  Tool,
  ToolCall,
  TranscriptMessage,
  WritePreview,
} from "./types";

const MAX_ITERATIONS = 12;
const MAX_MODEL_MESSAGES = 80;
const MAX_TOOL_CONTENT = 40_000;

export type RunOptions<Ctx extends BaseContext> = {
  ctx: Ctx;
  tools: Map<string, Tool<Ctx>>;
  client: ModelClient;
  systemPrompt: string;
  transcript: TranscriptMessage[];
  /** Decisions on write proposals from the previous turn, by tool-call id. */
  approvals?: Record<string, boolean>;
  /** Answers to questions from the previous turn, by tool-call id. */
  answers?: Record<string, Answer>;
  signal: AbortSignal;
  emit: (event: AssistantEvent) => void;
  log?: (entry: { tool: string; ms: number; status: string }) => void;
};

export function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.function.arguments || "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function toolDefinitions<Ctx extends BaseContext>(
  tools: Iterable<Tool<Ctx>>,
): ToolDefinition[] {
  return [...tools].map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function toolMessage(
  call: ToolCall,
  status: Extract<TranscriptMessage, { role: "tool" }>["status"],
  content: unknown,
  extras?: { displays?: RecordDisplay[]; entities?: Entity[] },
): TranscriptMessage {
  let text =
    typeof content === "string" ? content : JSON.stringify(content ?? null);
  if (text.length > MAX_TOOL_CONTENT)
    text = `${text.slice(0, MAX_TOOL_CONTENT)}… (truncated)`;
  return {
    role: "tool",
    tool_call_id: call.id,
    name: call.function.name,
    content: text,
    status,
    displays: extras?.displays,
    entities: extras?.entities,
  };
}

/** Transcript → model messages: strip UI-only fields, describe attachments, bound the window. */
function modelMessages(
  system: string,
  transcript: TranscriptMessage[],
): ChatMessage[] {
  let window = transcript;
  if (window.length > MAX_MODEL_MESSAGES) {
    window = window.slice(-MAX_MODEL_MESSAGES);
    // Never start mid-turn: the first message must be a user message.
    const firstUser = window.findIndex((message) => message.role === "user");
    window = firstUser > 0 ? window.slice(firstUser) : window;
  }
  const messages: ChatMessage[] = [{ role: "system", content: system }];
  for (const message of window) {
    if (message.role === "user") {
      const files = (message.attachments ?? [])
        .map(
          (file) =>
            `[Attached file #${file.id}: ${file.name} (${file.contentType}, ${Math.round(file.byteSize / 1024)} KB)]`,
        )
        .join("\n");
      messages.push({
        role: "user",
        content: files ? `${message.content}\n\n${files}` : message.content,
      });
    } else if (message.role === "assistant") {
      messages.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: message.tool_calls?.length ? message.tool_calls : undefined,
      });
    } else {
      messages.push({
        role: "tool",
        tool_call_id: message.tool_call_id,
        content: message.content,
      });
    }
  }
  return messages;
}

async function runTool<Ctx extends BaseContext>(
  options: RunOptions<Ctx>,
  call: ToolCall,
): Promise<TranscriptMessage> {
  const { ctx, emit } = options;
  const tool = options.tools.get(call.function.name);
  const args = parseArgs(call);
  emit({ type: "tool_call", id: call.id, name: call.function.name, args });
  if (!tool) {
    emit({
      type: "tool_result",
      id: call.id,
      name: call.function.name,
      status: "error",
    });
    return toolMessage(call, "error", {
      error: `Unknown tool ${call.function.name}`,
    });
  }
  const startedAt = Date.now();
  try {
    const result = await tool.run(ctx, args);
    const failed =
      !!result.content &&
      typeof result.content === "object" &&
      "error" in (result.content as object);
    const status = failed ? "error" : "ok";
    options.log?.({
      tool: call.function.name,
      ms: Date.now() - startedAt,
      status,
    });
    emit({
      type: "tool_result",
      id: call.id,
      name: call.function.name,
      status,
      displays: result.displays,
      entities: result.entities,
    });
    return toolMessage(call, status, result.content, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool failed";
    options.log?.({
      tool: call.function.name,
      ms: Date.now() - startedAt,
      status: "error",
    });
    emit({
      type: "tool_result",
      id: call.id,
      name: call.function.name,
      status: "error",
    });
    return toolMessage(call, "error", { error: message });
  }
}

async function previewFor<Ctx extends BaseContext>(
  tool: Tool<Ctx>,
  ctx: Ctx,
  call: ToolCall,
  args: Record<string, unknown>,
): Promise<WritePreview> {
  try {
    if (tool.preview) return await tool.preview(ctx, args);
  } catch (error) {
    return {
      title: call.function.name,
      summary:
        error instanceof Error ? error.message : "Could not build a preview",
      target: null,
      changes: Object.entries(args).map(([field, value]) => ({
        field,
        from: null,
        to: JSON.stringify(value),
      })),
      destructive: false,
    };
  }
  return {
    title: call.function.name,
    summary: call.function.name,
    target: null,
    changes: [],
    destructive: false,
  };
}

async function questionFor<Ctx extends BaseContext>(
  tool: Tool<Ctx>,
  ctx: Ctx,
  args: Record<string, unknown>,
): Promise<Question> {
  if (tool.question) return tool.question(ctx, args);
  return { question: String(args.question ?? "Which one?"), options: [] };
}

/**
 * Runs one assistant turn: resolves proposals / questions the user just
 * answered, then loops model → read tools until the model either answers or
 * needs the user (a write to approve, or a question to answer).
 */
export async function runAssistantTurn<Ctx extends BaseContext>(
  options: RunOptions<Ctx>,
): Promise<void> {
  const { ctx, emit, signal, tools } = options;
  const messages = [...options.transcript];
  const startLength = messages.length;
  const definitions = toolDefinitions(tools.values());

  // 1. Pending tool calls from the previous turn (proposals and questions).
  const lastAssistant = [...messages]
    .reverse()
    .find(
      (message) => message.role === "assistant" && message.tool_calls?.length,
    );
  if (lastAssistant && lastAssistant.role === "assistant") {
    const index = messages.lastIndexOf(lastAssistant);
    const answered = new Set(
      messages
        .slice(index + 1)
        .flatMap((message) =>
          message.role === "tool" ? [message.tool_call_id] : [],
        ),
    );
    const pending = (lastAssistant.tool_calls ?? []).filter(
      (call) => !answered.has(call.id),
    );
    for (const call of pending) {
      const tool = tools.get(call.function.name);
      if (tool?.kind === "write") {
        if (options.approvals?.[call.id] === true) {
          messages.push(await runTool(options, call));
        } else {
          emit({
            type: "tool_result",
            id: call.id,
            name: call.function.name,
            status: "rejected",
          });
          messages.push(
            toolMessage(call, "rejected", {
              status: "declined",
              detail:
                "The user declined this action. Do not retry it unless asked.",
            }),
          );
        }
      } else if (tool?.kind === "ask") {
        const answer = options.answers?.[call.id];
        emit({
          type: "tool_result",
          id: call.id,
          name: call.function.name,
          status: "answered",
        });
        messages.push(
          toolMessage(
            call,
            "answered",
            answer
              ? {
                  answered: true,
                  value: answer.value,
                  label: answer.label ?? answer.value,
                }
              : {
                  answered: false,
                  detail:
                    "The user did not pick an option; read their next message instead.",
                },
          ),
        );
      } else {
        // A read tool that somehow went unanswered is simply run now.
        messages.push(await runTool(options, call));
      }
      if (signal.aborted) return;
    }
  }

  // 2. Model ↔ read-tool loop.
  let awaiting: "approval" | "answer" | null = null;
  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      emit({ type: "status", phase: "thinking" });
      let announcedWriting = false;
      const outcome = await options.client.streamChat({
        messages: modelMessages(options.systemPrompt, messages),
        tools: definitions,
        signal,
        onText: (delta) => {
          if (!announcedWriting) {
            announcedWriting = true;
            emit({ type: "status", phase: "writing" });
          }
          emit({ type: "text", delta });
        },
        onReasoning: (delta) => emit({ type: "reasoning", delta }),
      });
      if (signal.aborted) return;

      messages.push({
        role: "assistant",
        content: outcome.content,
        tool_calls: outcome.toolCalls.length ? outcome.toolCalls : undefined,
      });
      if (!outcome.toolCalls.length) break;

      const paused: ToolCall[] = [];
      for (const call of outcome.toolCalls) {
        const tool = tools.get(call.function.name);
        if (tool?.kind === "write" || tool?.kind === "ask") {
          paused.push(call);
          continue;
        }
        messages.push(await runTool(options, call));
        if (signal.aborted) return;
      }

      if (paused.length) {
        for (const call of paused) {
          const tool = tools.get(call.function.name)!;
          const args = parseArgs(call);
          if (tool.kind === "ask") {
            emit({
              type: "question",
              id: call.id,
              name: call.function.name,
              question: await questionFor(tool, ctx, args),
            });
            awaiting ??= "answer";
          } else {
            emit({
              type: "proposal",
              id: call.id,
              name: call.function.name,
              args,
              preview: await previewFor(tool, ctx, call, args),
            });
            awaiting = "approval";
          }
        }
        break;
      }
    }
  } catch (error) {
    if (signal.aborted) return;
    emit({
      type: "error",
      message: error instanceof Error ? error.message : "The assistant failed",
    });
  }

  emit({ type: "transcript", messages: messages.slice(startLength) });
  emit({ type: "done", awaiting });
}
