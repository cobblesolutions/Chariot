import { eq, inArray } from "drizzle-orm";
import { db, documentReadingsTable, documentsTable, type DocumentReadingStatus } from "@workspace/db";
import { logger } from "../../lib/logger";
import { progressCurrent, progressFinish, progressReport, progressStart } from "../ai-progress";
import { extractFileContent } from "../assistant/core";
import { documentStorage } from "../document-storage";
import { documentModelEnabled, readWithModel } from "./model";
import { bankStatementsReader } from "./readers/bank-statements";
import { creditReportReader } from "./readers/credit-report";
import { identityReader } from "./readers/identity";
import { portfolioReader } from "./readers/portfolio";
import { proofOfIncomeReader } from "./readers/proof-of-income";
import type { DocumentReader, ReadableContent } from "./types";
import { XLSX_TYPES, xlsxToCsv } from "./xlsx";

export { documentChecks, type DocumentCheck } from "./checks";

/**
 * Document reading system: uploaded files are turned into structured data by
 * the reader registered for their category, and that data is pushed onto the
 * client record. Register new readers here.
 */
const READERS: DocumentReader[] = [identityReader, bankStatementsReader, proofOfIncomeReader, creditReportReader, portfolioReader];

export const progressToken = (documentId: number) => `document:${documentId}`;

export function readerForCategory(category: string): DocumentReader | null {
  return READERS.find((reader) => reader.categories.includes(category)) ?? null;
}

/** Categories that have a reader — the UI shows reading state for these. */
export const READABLE_CATEGORIES = READERS.flatMap((reader) => reader.categories);

export interface DocumentReadingView {
  reader: string;
  status: DocumentReadingStatus;
  source: "ai" | "heuristic" | null;
  model: string | null;
  data: Record<string, unknown> | null;
  error: string | null;
  appliedFields: string[];
  readAt: string;
  /** What the reader is doing right now, while status is pending. */
  progress: string | null;
}

export function readingView(row: typeof documentReadingsTable.$inferSelect): DocumentReadingView {
  return {
    reader: row.reader,
    status: row.status as DocumentReadingStatus,
    source: row.source === "ai" || row.source === "heuristic" ? row.source : null,
    model: row.model,
    data: (row.data as Record<string, unknown> | null) ?? null,
    error: row.error,
    appliedFields: Array.isArray(row.appliedFields) ? (row.appliedFields as string[]) : [],
    readAt: row.updatedAt.toISOString(),
    progress: row.status === "pending" ? progressCurrent(progressToken(row.documentId)) : null,
  };
}

/** Readings keyed by document id, for attaching to document lists. */
export async function readingsForDocuments(documentIds: number[]) {
  const map = new Map<number, DocumentReadingView>();
  if (documentIds.length === 0) return map;
  const rows = await db.select().from(documentReadingsTable).where(inArray(documentReadingsTable.documentId, documentIds));
  for (const row of rows) map.set(row.documentId, readingView(row));
  return map;
}

/** Runs the reader after an upload without holding the response. */
export function queueDocumentReading(documentId: number, actorName = "System") {
  void readDocument(documentId, actorName).catch((error) =>
    logger.warn({ err: error, documentId }, "Document reading failed"));
}

/**
 * Reads one document with its category's reader and stores the result. Returns
 * null when no reader handles the category. Failures are recorded on the
 * reading row rather than thrown, so an upload never fails because of reading.
 */
export async function readDocument(documentId: number, actorName = "System"): Promise<DocumentReadingView | null> {
  const [document] = await db.select().from(documentsTable).where(eq(documentsTable.id, documentId));
  if (!document) return null;
  const reader = readerForCategory(document.category);
  if (!reader) return null;

  await db.insert(documentReadingsTable)
    .values({ documentId, reader: reader.key, status: "pending" })
    .onConflictDoUpdate({
      target: documentReadingsTable.documentId,
      set: { reader: reader.key, status: "pending", error: null, updatedAt: new Date() },
    });

  const token = progressToken(documentId);
  progressStart(token, "Opening the file…");
  const finish = async (patch: Partial<typeof documentReadingsTable.$inferInsert>) => {
    progressFinish(token, patch.error ?? null);
    const [row] = await db.update(documentReadingsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(documentReadingsTable.documentId, documentId))
      .returning();
    return readingView(row!);
  };

  try {
    if (!document.objectPath) return finish({ status: "unsupported", error: "No file is stored for this document" });
    const bytes = await documentStorage.get(document.objectPath);
    const contentType = document.contentType ?? "application/octet-stream";
    progressReport(token, contentType.startsWith("image/") ? "Preparing the image…" : XLSX_TYPES.has(contentType) ? "Reading the spreadsheet…" : "Extracting the text…");
    // Spreadsheets (portfolio schedules) become CSV text so the text readers can take them.
    const extracted = XLSX_TYPES.has(contentType) || /\.xlsx?$/i.test(document.name)
      ? { kind: "text" as const, text: xlsxToCsv(bytes), truncated: false }
      : await extractFileContent(bytes, contentType);
    if (extracted.kind === "unsupported") return finish({ status: "unsupported", error: extracted.reason });
    if (extracted.kind === "text" && !extracted.text.trim()) {
      return finish({ status: "unsupported", error: "No readable text — a scanned PDF needs to be uploaded as an image" });
    }
    const content: ReadableContent = extracted;

    progressReport(token, "Looking for the usual patterns…");
    const heuristic = content.kind === "text" ? reader.heuristic(content.text, document) : null;
    let data: Record<string, unknown> | null = null;
    let source: "ai" | "heuristic" | null = null;
    let model: string | null = null;
    if (documentModelEnabled()) {
      try {
        const result = await readWithModel({
          systemInstruction: reader.systemInstruction,
          content,
          context: { reader: reader.key, filename: document.name, contentType: document.contentType },
          progress: { token, labels: reader.progressLabels ?? {} },
        });
        progressReport(token, "Checking the answer against the text…");
        const ai = reader.normalise(result.data);
        data = heuristic ? reader.merge(ai, heuristic) : ai;
        source = "ai";
        model = result.model;
      } catch (error) {
        logger.warn({ err: error, documentId }, "Document model read failed; using text patterns");
      }
    }
    if (!data) {
      if (!heuristic) {
        return finish({ status: "unsupported", error: "Images can only be read when the AI reader is configured" });
      }
      data = heuristic;
      source = "heuristic";
    }
    // `apply` may annotate `data` (e.g. the ids of properties it created), so it is stored afterwards.
    progressReport(token, "Filling in the record…");
    const appliedFields = await reader.apply(document, data, actorName);
    return finish({ status: "completed", source, model, data, error: null, appliedFields });
  } catch (error) {
    logger.warn({ err: error, documentId }, "Document reading failed");
    return finish({ status: "failed", error: error instanceof Error ? error.message : "Reading failed" });
  }
}
