import type { documentsTable } from "@workspace/db";
import type { ExtractedFile } from "../assistant/core";

export type DocumentRow = typeof documentsTable.$inferSelect;

/** File content a reader can work with: text (PDF/Word/plain) or an image. */
export type ReadableContent = Extract<ExtractedFile, { kind: "text" | "image" }>;

/**
 * One extractor in the document reading system. A reader is bound to the
 * document categories it understands, turns the file into structured `data`
 * (model first, text heuristics as the fallback) and can push that data onto
 * the client's record.
 */
export interface DocumentReader<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable name stored on the reading row, e.g. "proof_of_income". */
  key: string;
  /** Document categories (onboarding keys) this reader handles. */
  categories: readonly string[];
  /** System prompt for the model; it must answer with JSON only. */
  systemInstruction: string;
  /** Coerces whatever the model returned into the reader's shape (nulls for the unknown). */
  normalise(raw: unknown): T;
  /** Best effort from extracted text when no model is available; may return all nulls. */
  heuristic(text: string, document: DocumentRow): T;
  /** Combines the model result with the heuristic one (model wins, heuristic fills gaps). */
  merge(primary: T, fallback: T): T;
  /**
   * Writes the reading onto the client record. Returns the names of the
   * fields it filled so the UI can show where a value came from.
   */
  apply(document: DocumentRow, data: T, actorName: string): Promise<string[]>;
}
