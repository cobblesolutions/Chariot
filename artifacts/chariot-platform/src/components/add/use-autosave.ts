import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Saves `payload` a moment after it stops changing, and immediately on
 * `flush()` (call it from the form's onBlur). Nothing is sent while the
 * serialised payload equals the last saved one, so loading a record never
 * triggers a request. `validate` can block a save with a message.
 */
export function useAutosave<T>({
  enabled,
  payload,
  save,
  validate,
  delay = 700,
  seedKey,
}: {
  enabled: boolean;
  payload: T;
  save: (payload: T) => Promise<unknown>;
  validate?: (payload: T) => string | null;
  delay?: number;
  /** Changes when a different record is loaded; the current payload becomes the baseline. */
  seedKey: string | number | null;
}) {
  const serialised = JSON.stringify(payload);
  const lastSaved = useRef<string>(serialised);
  const lastSeedKey = useRef(seedKey);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<string | null>(null);
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // A different record loaded: treat its current values as already saved.
  if (lastSeedKey.current !== seedKey) {
    lastSeedKey.current = seedKey;
    lastSaved.current = serialised;
  }

  const latest = useRef({ payload, serialised, save, validate, enabled });
  latest.current = { payload, serialised, save, validate, enabled };

  const run = useCallback(async () => {
    const { payload, serialised, save, validate, enabled } = latest.current;
    if (!enabled || serialised === lastSaved.current) return;
    if (inFlight.current === serialised) return;
    const problem = validate?.(payload) ?? null;
    if (problem) {
      setError(problem);
      setStatus("error");
      return;
    }
    inFlight.current = serialised;
    setError(null);
    setStatus("saving");
    try {
      await save(payload);
      lastSaved.current = serialised;
      // Something may have changed while saving; leave it dirty for the next tick.
      setStatus(latest.current.serialised === serialised ? "saved" : "dirty");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't save");
      setStatus("error");
    } finally {
      inFlight.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    void run();
  }, [run]);

  useEffect(() => {
    if (!enabled) return;
    if (serialised === lastSaved.current) {
      if (status === "dirty") setStatus("saved");
      return;
    }
    setStatus((current) => (current === "saving" ? current : "dirty"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void run();
    }, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialised, enabled, delay]);

  // Leaving the form (switching record, navigating away) saves what is pending.
  useEffect(() => {
    return () => {
      if (latest.current.serialised !== lastSaved.current) void run();
    };
  }, [run]);

  return { status, error, flush };
}
