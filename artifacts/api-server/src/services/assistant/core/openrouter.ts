/**
 * Thin OpenRouter chat-completions client for the assistant core: streaming
 * with tool calls, plus a one-shot vision helper. Any OpenAI-compatible
 * endpoint works by changing `endpoint`.
 */

import type { ToolCall } from "./types";

export type ModelClientConfig = {
  apiKey: string | undefined;
  model: string;
  /** Model used to read images; may be the same as `model` if it accepts images. */
  visionModel: string;
  endpoint?: string;
  /** Sent as HTTP-Referer / X-Title so OpenRouter attributes usage. */
  referer?: string;
  title?: string;
  temperature?: number;
  /**
   * Reasoning (thinking) effort for models that support it. "off" gives the
   * fastest first token; higher effort helps multi-step planning but adds
   * seconds before anything appears.
   */
  reasoning?: "off" | "low" | "medium" | "high";
  /**
   * OpenRouter provider routing. "latency" (default) picks the provider with
   * the fastest time-to-first-token, which matters more than anything else
   * for a chat that pays ~10k tokens of prefill per call.
   */
  providerSort?: "latency" | "throughput" | "price";
  /** Called after each streamed call with timings, for diagnostics. */
  onCall?: (info: {
    ttftMs: number | null;
    totalMs: number;
    promptTokens?: number;
    cachedTokens?: number;
    provider?: string;
  }) => void;
};

export type ChatMessage =
  | { role: "system"; content: string }
  | {
      role: "user";
      content:
        | string
        | Array<
            | { type: "text"; text: string }
            | { type: "image_url"; image_url: { url: string } }
          >;
    }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type StreamOutcome = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

export type ModelClient = {
  enabled: boolean;
  model: string;
  visionModel: string;
  streamChat: (options: {
    messages: ChatMessage[];
    tools: ToolDefinition[];
    signal?: AbortSignal;
    onText: (delta: string) => void;
    onReasoning?: (delta: string) => void;
  }) => Promise<StreamOutcome>;
  describeImage: (dataUrl: string, question?: string) => Promise<string>;
};

const DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export function createModelClient(config: ModelClientConfig): ModelClient {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const headers = () => {
    if (!config.apiKey)
      throw new Error("The assistant API key is not configured");
    return {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.referer ?? "http://localhost",
      "X-Title": config.title ?? "Assistant",
    };
  };

  /**
   * Streams one completion. Text deltas are surfaced as they arrive; tool
   * calls are assembled from their indexed fragments and returned whole.
   */
  const streamChat: ModelClient["streamChat"] = async (options) => {
    const startedAt = Date.now();
    let firstTokenAt: number | null = null;
    let provider: string | undefined;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: headers(),
      signal: options.signal,
      body: JSON.stringify({
        model: config.model,
        messages: options.messages,
        tools: options.tools,
        tool_choice: "auto",
        parallel_tool_calls: true,
        temperature: config.temperature ?? 0.2,
        reasoning:
          !config.reasoning || config.reasoning === "off"
            ? { enabled: false }
            : { effort: config.reasoning },
        provider: { sort: config.providerSort ?? "latency" },
        usage: { include: true },
        stream: true,
      }),
    });
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Model request failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      );
    }

    const outcome: StreamOutcome = {
      content: "",
      toolCalls: [],
      finishReason: null,
    };
    const partial = new Map<number, ToolCall>();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";

    const handle = (line: string) => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let event: {
        choices?: Array<{
          delta?: {
            content?: string | null;
            reasoning?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string | null;
        }>;
        usage?: StreamOutcome["usage"];
        provider?: string;
        error?: { message?: string };
      };
      try {
        event = JSON.parse(data);
      } catch {
        return;
      }
      if (event.error?.message) throw new Error(event.error.message);
      if (event.usage) outcome.usage = event.usage;
      if (event.provider) provider = event.provider;
      const choice = event.choices?.[0];
      if (!choice) return;
      if (
        firstTokenAt === null &&
        (choice.delta?.content || choice.delta?.tool_calls?.length)
      )
        firstTokenAt = Date.now();
      if (choice.delta?.reasoning)
        options.onReasoning?.(choice.delta.reasoning);
      if (choice.delta?.content) {
        outcome.content += choice.delta.content;
        options.onText(choice.delta.content);
      }
      for (const fragment of choice.delta?.tool_calls ?? []) {
        const index = fragment.index ?? 0;
        let call = partial.get(index);
        if (!call) {
          call = {
            id: fragment.id ?? `call_${index}`,
            type: "function",
            function: { name: "", arguments: "" },
          };
          partial.set(index, call);
        }
        if (fragment.id) call.id = fragment.id;
        if (fragment.function?.name)
          call.function.name += fragment.function.name;
        if (fragment.function?.arguments)
          call.function.arguments += fragment.function.arguments;
      }
      if (choice.finish_reason) outcome.finishReason = choice.finish_reason;
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        handle(buffer.slice(0, newline).replace(/\r$/, ""));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    if (buffer.trim()) handle(buffer.trim());

    outcome.toolCalls = [...partial.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, call]) => call);
    config.onCall?.({
      ttftMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
      totalMs: Date.now() - startedAt,
      promptTokens: outcome.usage?.prompt_tokens,
      cachedTokens: outcome.usage?.prompt_tokens_details?.cached_tokens,
      provider,
    });
    return outcome;
  };

  /** Describes / transcribes an image with the vision model, returning plain text. */
  const describeImage: ModelClient["describeImage"] = async (
    dataUrl,
    question,
  ) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model: config.visionModel,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  (question ? `${question}\n\n` : "") +
                  "Describe this image and transcribe every piece of text, number, name, address, date and amount you can read, verbatim. If it is a document, say what kind of document it is.",
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!response.ok)
      throw new Error(`Image reading failed (${response.status})`);
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return (
      payload.choices?.[0]?.message?.content?.trim() ||
      "(no text could be read from the image)"
    );
  };

  return {
    enabled: !!config.apiKey,
    model: config.model,
    visionModel: config.visionModel,
    streamChat,
    describeImage,
  };
}
