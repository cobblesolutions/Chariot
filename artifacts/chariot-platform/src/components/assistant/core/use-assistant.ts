import * as React from "react";
import { useAssistantConfig } from "./config";
import type {
  Answer,
  AssistantEvent,
  Entity,
  PendingQuestion,
  Proposal,
  RecordDisplay,
  ToolStatus,
  TranscriptAttachment,
  TranscriptMessage,
} from "./types";
import { ASK_TOOL_NAME, READ_TOOL_NAMES } from "./types";

/** A tool call in flight (or finished) during the current streamed turn. */
export type Activity = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | ToolStatus;
  displays?: RecordDisplay[];
};

/** What the assistant is doing right now, for the status line. */
export type Phase = "connecting" | "thinking" | "tool" | "writing" | null;

type Persisted = {
  messages: TranscriptMessage[];
  proposals: Proposal[];
  questions: PendingQuestion[];
};

const MAX_STORED_MESSAGES = 300;

function load(key: string): Persisted {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { messages: [], proposals: [], questions: [] };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    };
  } catch {
    return { messages: [], proposals: [], questions: [] };
  }
}

function save(key: string, state: Persisted) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        ...state,
        messages: state.messages.slice(-MAX_STORED_MESSAGES),
      }),
    );
  } catch {
    // storage full or unavailable: the thread just won't persist
  }
}

/** Reads `data:` lines from an SSE body and yields parsed events. */
async function* readEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AssistantEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const chunk = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf("\n\n");
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          yield JSON.parse(line.slice(5).trim()) as AssistantEvent;
        } catch {
          // ignore malformed frames
        }
      }
    }
  }
}

/** Every record any tool result has mentioned, newest last, de-duplicated. */
export function collectEntities(
  messages: TranscriptMessage[],
  live: Entity[] = [],
): Entity[] {
  const seen = new Map<string, Entity>();
  const add = (entity: Entity) => {
    if (entity.title && entity.title.length >= 3)
      seen.set(`${entity.type}:${entity.id}`, entity);
  };
  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const entity of message.entities ?? []) add(entity);
    for (const display of message.displays ?? []) {
      add({
        type: display.type,
        id: display.id,
        title: display.title,
        href: display.href,
      });
    }
  }
  for (const entity of live) add(entity);
  return [...seen.values()];
}

/**
 * Owns the assistant conversation for one user: the persisted transcript,
 * pending proposals and questions, and the live state of a streaming turn.
 */
export function useAssistant() {
  const config = useAssistantConfig();
  const { endpoint, storageKey } = config;
  const [messages, setMessages] = React.useState<TranscriptMessage[]>(
    () => load(storageKey).messages,
  );
  const [proposals, setProposals] = React.useState<Proposal[]>(
    () => load(storageKey).proposals,
  );
  const [questions, setQuestions] = React.useState<PendingQuestion[]>(
    () => load(storageKey).questions,
  );
  const [streaming, setStreaming] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>(null);
  const [streamText, setStreamText] = React.useState("");
  const [reasoning, setReasoning] = React.useState("");
  const [activity, setActivity] = React.useState<Activity[]>([]);
  const [liveEntities, setLiveEntities] = React.useState<Entity[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const onDataChanged = React.useRef(config.onDataChanged);
  onDataChanged.current = config.onDataChanged;
  const currentPath = React.useRef(config.currentPath);
  currentPath.current = config.currentPath;

  React.useEffect(() => {
    save(storageKey, { messages, proposals, questions });
  }, [storageKey, messages, proposals, questions]);

  const run = React.useCallback(
    async (
      transcript: TranscriptMessage[],
      decisions: {
        approvals?: Record<string, boolean>;
        answers?: Record<string, Answer>;
      } = {},
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setPhase("connecting");
      setStreamText("");
      setReasoning("");
      setActivity([]);
      setLiveEntities([]);
      setError(null);

      let wroteSomething = false;
      try {
        const response = await fetch(`${endpoint}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: transcript,
            approvals: decisions.approvals,
            answers: decisions.answers,
            page: { path: currentPath.current?.() ?? window.location.pathname },
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.error ??
              `The assistant is unavailable (${response.status})`,
          );
        }
        for await (const event of readEvents(response.body)) {
          if (controller.signal.aborted) break;
          switch (event.type) {
            case "status":
              setPhase(event.phase);
              if (event.phase === "thinking") setReasoning("");
              break;
            case "reasoning":
              setReasoning((text) => (text + event.delta).slice(-400));
              break;
            case "text":
              setPhase("writing");
              setStreamText((text) => text + event.delta);
              break;
            case "tool_call":
              setPhase("tool");
              setActivity((items) => [
                ...items,
                {
                  id: event.id,
                  name: event.name,
                  args: event.args,
                  status: "running",
                },
              ]);
              if (
                !READ_TOOL_NAMES.has(event.name) &&
                event.name !== ASK_TOOL_NAME
              )
                wroteSomething = true;
              break;
            case "tool_result":
              setActivity((items) =>
                items.some((item) => item.id === event.id)
                  ? items.map((item) =>
                      item.id === event.id
                        ? {
                            ...item,
                            status: event.status,
                            displays: event.displays,
                          }
                        : item,
                    )
                  : [
                      ...items,
                      {
                        id: event.id,
                        name: event.name,
                        args: {},
                        status: event.status,
                        displays: event.displays,
                      },
                    ],
              );
              if (event.entities?.length)
                setLiveEntities((items) => [...items, ...event.entities!]);
              break;
            case "proposal":
              setProposals((items) => [
                ...items.filter((item) => item.id !== event.id),
                {
                  id: event.id,
                  name: event.name,
                  args: event.args,
                  preview: event.preview,
                },
              ]);
              break;
            case "question":
              setQuestions((items) => [
                ...items.filter((item) => item.id !== event.id),
                { id: event.id, name: event.name, question: event.question },
              ]);
              break;
            case "transcript":
              setMessages([...transcript, ...event.messages]);
              setStreamText("");
              setActivity([]);
              setLiveEntities([]);
              break;
            case "error":
              setError(event.message);
              break;
            case "done":
              break;
          }
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error ? caught.message : "The assistant failed",
          );
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setStreaming(false);
          setPhase(null);
          setStreamText("");
          setReasoning("");
          setActivity([]);
          setLiveEntities([]);
        }
        // Approved writes changed data the rest of the app may be showing.
        if (wroteSomething) onDataChanged.current?.();
      }
    },
    [endpoint],
  );

  /** A new message implicitly declines open proposals and skips open questions. */
  const send = React.useCallback(
    (content: string, attachments: TranscriptAttachment[] = []) => {
      const message: TranscriptMessage = {
        role: "user",
        content,
        attachments: attachments.length ? attachments : undefined,
      };
      const approvals = Object.fromEntries(
        proposals.map((proposal) => [proposal.id, false]),
      );
      setProposals([]);
      setQuestions([]);
      const transcript = [...messages, message];
      setMessages(transcript);
      void run(transcript, {
        approvals: Object.keys(approvals).length ? approvals : undefined,
      });
    },
    [messages, proposals, run],
  );

  const decide = React.useCallback(
    (approvals: Record<string, boolean>) => {
      setProposals([]);
      void run(messages, { approvals });
    },
    [messages, run],
  );

  const answer = React.useCallback(
    (answers: Record<string, Answer>) => {
      setQuestions([]);
      void run(messages, { answers });
    },
    [messages, run],
  );

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = React.useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setProposals([]);
    setQuestions([]);
    setStreamText("");
    setActivity([]);
    setError(null);
  }, []);

  const entities = React.useMemo(
    () => collectEntities(messages, liveEntities),
    [messages, liveEntities],
  );

  return {
    messages,
    proposals,
    questions,
    entities,
    streaming,
    phase,
    streamText,
    reasoning,
    activity,
    error,
    send,
    decide,
    answer,
    stop,
    reset,
  };
}

export type AssistantState = ReturnType<typeof useAssistant>;
