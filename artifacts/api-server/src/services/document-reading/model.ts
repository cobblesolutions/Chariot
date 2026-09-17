import { DEFAULT_MODEL, DEFAULT_VISION_MODEL } from "../assistant/models";
import type { ReadableContent } from "./types";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Document reading uses the same OpenRouter key as the staff assistant. The
 * text model handles PDFs, Word and plain text; images go to the vision model.
 * Override with DOCUMENT_READER_MODEL / DOCUMENT_READER_VISION_MODEL.
 */
export function documentModelEnabled() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function documentModelFor(content: ReadableContent) {
  return content.kind === "image"
    ? process.env.DOCUMENT_READER_VISION_MODEL || process.env.ASSISTANT_VISION_MODEL || DEFAULT_VISION_MODEL
    : process.env.DOCUMENT_READER_MODEL || process.env.ASSISTANT_MODEL || DEFAULT_MODEL;
}

/** One-shot JSON extraction over the document content. Throws on transport or parse failure. */
export async function readWithModel(options: {
  systemInstruction: string;
  content: ReadableContent;
  context: Record<string, unknown>;
}): Promise<{ data: unknown; model: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  const model = documentModelFor(options.content);
  const preface = { type: "text" as const, text: JSON.stringify(options.context) };
  const userContent = options.content.kind === "image"
    ? [preface, { type: "image_url" as const, image_url: { url: options.content.dataUrl } }]
    : [preface, { type: "text" as const, text: `DOCUMENT TEXT:\n${options.content.text}` }];
  const response = await fetch(ENDPOINT, {
    method: "POST",
    // Cheap models can be slow on long statements; a hung call must not leave the reading "pending" forever.
    signal: AbortSignal.timeout(180_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.PORTAL_URL ?? "http://localhost",
      "X-Title": "Chariot Financial Solutions",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: options.systemInstruction },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Document model request failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new Error("Document model returned no content");
  const json = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return { data: JSON.parse(json), model };
}
