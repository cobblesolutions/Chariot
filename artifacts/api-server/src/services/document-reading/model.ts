import { streamJsonCompletion, type JsonMessageContent } from "../../integrations/openrouter-stream";
import { DEFAULT_MODEL, DEFAULT_VISION_MODEL } from "../assistant/models";
import { keyProgress, progressReport } from "../ai-progress";
import type { ReadableContent } from "./types";

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
  /** Progress token (document:<id>) and what to say as each key of the answer appears. */
  progress?: { token: string; labels: Record<string, string> };
}): Promise<{ data: unknown; model: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  const model = documentModelFor(options.content);
  const preface = { type: "text" as const, text: JSON.stringify(options.context) };
  const userContent: JsonMessageContent = options.content.kind === "image"
    ? [preface, { type: "image_url" as const, image_url: { url: options.content.dataUrl } }]
    : [preface, { type: "text" as const, text: `DOCUMENT TEXT:
${options.content.text}` }];
  progressReport(options.progress?.token, options.content.kind === "image" ? "Sending the image to the model…" : "Sending the text to the model…");
  const { data } = await streamJsonCompletion({
    apiKey,
    model,
    system: options.systemInstruction,
    user: userContent,
    ...keyProgress(options.progress?.token, options.progress?.labels ?? {}),
  });
  return { data, model };
}
