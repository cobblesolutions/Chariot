import type { Request } from "express";

/**
 * Live progress for AI reads (email extraction, document readers). Messages are
 * appended as the model call moves through its stages — including which JSON
 * keys the model has produced so far, which is the closest thing to "what it
 * is thinking about" a one-shot extraction has. Kept in memory: a read lasts
 * seconds to a couple of minutes and only this process runs it.
 *
 * Browsers name a read with an `x-ai-progress` token on the request and poll
 * `GET /ai/progress/:token`; background document reads use `document:<id>`
 * and surface the latest message on the reading itself.
 */
export interface AiProgress {
  messages: string[];
  done: boolean;
  error: string | null;
  startedAt: number;
  updatedAt: number;
}

const entries = new Map<string, AiProgress>();
const TTL_MS = 10 * 60 * 1000;

export const PROGRESS_HEADER = "x-ai-progress";

export function progressTokenFrom(req: Request): string | null {
  const token = req.header(PROGRESS_HEADER);
  return token && /^[A-Za-z0-9:_-]{6,80}$/.test(token) ? token : null;
}

export function progressStart(token: string | null | undefined, first?: string) {
  if (!token) return;
  sweep();
  const now = Date.now();
  entries.set(token, { messages: first ? [first] : [], done: false, error: null, startedAt: now, updatedAt: now });
}

export function progressReport(token: string | null | undefined, message: string) {
  if (!token) return;
  const entry = entries.get(token);
  if (!entry || entry.done) return;
  if (entry.messages[entry.messages.length - 1] === message) return;
  entry.messages.push(message);
  entry.updatedAt = Date.now();
}

export function progressFinish(token: string | null | undefined, error?: string | null) {
  if (!token) return;
  const entry = entries.get(token);
  if (!entry) return;
  entry.done = true;
  entry.error = error ?? null;
  entry.updatedAt = Date.now();
}

export function progressGet(token: string): AiProgress | null {
  return entries.get(token) ?? null;
}

/** Latest message for a read still in flight, or null. */
export function progressCurrent(token: string): string | null {
  const entry = entries.get(token);
  if (!entry || entry.done) return null;
  return entry.messages[entry.messages.length - 1] ?? null;
}

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [token, entry] of entries) {
    if (entry.updatedAt < cutoff) entries.delete(token);
  }
}

/**
 * Turns the model's stream into progress lines: the first time a key with a
 * label shows up in the JSON, its label is reported; while a thinking model
 * is still reasoning, the latest sentence of its reasoning is shown instead —
 * the closest thing to what it is actually thinking about.
 */
export function keyProgress(token: string | null | undefined, labels: Record<string, string>) {
  const seen = new Set<string>();
  let started = false;
  let lastThoughtAt = 0;
  const onDelta = (accumulated: string) => {
    if (!token) return;
    if (!started) {
      started = true;
      progressReport(token, "Writing the answer…");
    }
    for (const match of accumulated.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g)) {
      const key = match[1]!;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = labels[key];
      if (label) progressReport(token, label);
    }
  };
  const onReasoning = (accumulated: string) => {
    if (!token || started) return;
    const now = Date.now();
    if (now - lastThoughtAt < 1500) return;
    const thought = latestThought(accumulated);
    if (thought) {
      lastThoughtAt = now;
      progressReport(token, `Thinking: ${thought}`);
    }
  };
  return { onDelta, onReasoning };
}

/** The last complete-ish sentence of a reasoning stream, trimmed to one line. */
function latestThought(text: string): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 20) return null;
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const last = (sentences.length > 1 ? sentences[sentences.length - 2] : sentences[0]) ?? "";
  const line = last.length > 110 ? `…${last.slice(-105)}` : last;
  return line.length >= 12 ? line : null;
}
