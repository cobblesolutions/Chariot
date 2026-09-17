/**
 * One-shot JSON completion over OpenRouter, streamed so the caller can watch
 * the answer take shape (see services/ai-progress.ts). Shared by the workflow
 * runner and the document readers.
 */
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export type JsonMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
      | { type: "file"; file: { filename: string; file_data: string } }
    >;

export async function streamJsonCompletion(options: {
  apiKey: string;
  model: string;
  system: string;
  user: JsonMessageContent;
  /** Called with the content so far after every streamed chunk. */
  onDelta?: (accumulated: string) => void;
  /** Called with the model's reasoning so far, for models that think out loud before answering. */
  onReasoning?: (accumulated: string) => void;
  timeoutMs?: number;
}): Promise<{ content: string; data: unknown }> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.PORTAL_URL ?? "http://localhost",
      "X-Title": "Chariot Financial Solutions",
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0,
      stream: true,
      response_format: { type: "json_object" },
      // Extraction does not need chain-of-thought, and thinking models spend most of their time on it.
      reasoning: { enabled: false },
      provider: { sort: "throughput" },
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ],
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`OpenRouter request failed with status ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let errorMessage: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let event: { choices?: Array<{ delta?: { content?: string; reasoning?: string } }>; error?: { message?: string } };
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.error?.message) errorMessage = event.error.message;
      const delta = event.choices?.[0]?.delta;
      if (delta?.reasoning) {
        reasoning += delta.reasoning;
        options.onReasoning?.(reasoning);
      }
      if (delta?.content) {
        content += delta.content;
        options.onDelta?.(content);
      }
    }
  }
  if (!content.trim()) throw new Error(errorMessage ?? "OpenRouter returned no structured result");
  const json = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return { content, data: JSON.parse(json) };
}
