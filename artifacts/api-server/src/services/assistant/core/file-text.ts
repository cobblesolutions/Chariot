import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const MAX_CHARS = 60_000;

export type ExtractedFile =
  | { kind: "text"; text: string; truncated: boolean; pages?: number }
  | { kind: "image"; dataUrl: string }
  | { kind: "unsupported"; reason: string };

/**
 * Turns an uploaded file into something the model can read: plain text for
 * PDFs, Word documents, spreadsheets-as-CSV and text files; a data URL for
 * images (handed to a vision-capable model); otherwise a reason.
 */
export async function extractFileContent(
  bytes: Buffer,
  contentType: string,
): Promise<ExtractedFile> {
  const type = contentType.toLowerCase();
  if (type.startsWith("image/")) {
    if (bytes.byteLength > 8 * 1024 * 1024) {
      return { kind: "unsupported", reason: "Image is larger than 8 MB" };
    }
    return {
      kind: "image",
      dataUrl: `data:${type};base64,${bytes.toString("base64")}`,
    };
  }
  if (type === "application/pdf") {
    const { PDFParse } = require("pdf-parse") as typeof import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      return clip(result.text, result.total);
    } finally {
      await parser.destroy();
    }
  }
  if (
    type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    type === "application/msword"
  ) {
    const mammoth = require("mammoth") as typeof import("mammoth");
    const result = await mammoth.extractRawText({ buffer: bytes });
    return clip(result.value);
  }
  if (type.startsWith("text/") || type === "application/json") {
    return clip(bytes.toString("utf8"));
  }
  if (type.startsWith("audio/")) {
    return {
      kind: "unsupported",
      reason: "Audio files can be played in the chat but not transcribed",
    };
  }
  return {
    kind: "unsupported",
    reason: `Cannot read files of type ${contentType}`,
  };
}

function clip(text: string, pages?: number): ExtractedFile {
  const clean = text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return {
    kind: "text",
    text: clean.slice(0, MAX_CHARS),
    truncated: clean.length > MAX_CHARS,
    pages,
  };
}
