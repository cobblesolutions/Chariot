import * as React from "react";
import {
  ArrowUp,
  FileText,
  Mic,
  Music,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { AudioLevelMeter } from "./audio-level-meter";
import { useAssistantConfig, type SuggestionHit } from "./config";
import { TypeTile } from "./record-card";
import { encodeRef, type RecordRef, type TranscriptAttachment } from "./types";

/** A file still on its way up, shown as a chip with its own progress bar. */
type PendingUpload = { name: string; percent: number };
import { useDictation } from "./use-dictation";

export type ComposerSubmit = {
  content: string;
  attachments: TranscriptAttachment[];
};

const MAX_ATTACHMENTS = 10;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_ACCEPT =
  "image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.mp3,.m4a,.wav,.ogg";
const DEBOUNCE_MS = 200;

/** Words that never start a record lookup on their own. */
const STOP_WORDS = new Set(
  "a an and the for to of on in at is it this that with by from about as my me please update change set add create show find open get what who when where how can you do does his her their our new all any some into up out send make give tell list check look see i we am are be been was were has have had will would should could not no yes ok okay hi hello".split(
    " ",
  ),
);

type Suggestion = { hit: SuggestionHit; span: number };

/**
 * What to look up for the text under the caret. An explicit `@query` wins;
 * otherwise the trailing one, two and three words of the current phrase are
 * tried so "for John Sm" still finds John Smith.
 */
function lookupCandidates(
  text: string,
  caret: number,
): Array<{ q: string; span: number }> {
  const before = text.slice(0, Math.max(0, caret));
  const explicit = /(?:^|\s)@([^@\n]{0,60})$/.exec(before);
  if (explicit) {
    const q = explicit[1]!.trim();
    return q.length >= 2 ? [{ q, span: explicit[1]!.length + 1 }] : [];
  }
  const phrase = /[^\n.,;:!?()]*$/.exec(before)?.[0] ?? "";
  if (/\s$/.test(phrase)) return [];
  const words = phrase.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const last = words[words.length - 1]!;
  // A single character ("Worker A", "Plot 4") is never searched on its own,
  // but it can complete the words before it.
  const lastShort = last.length < 2;
  if (!lastShort && STOP_WORDS.has(last.toLowerCase())) return [];
  const candidates: Array<{ q: string; span: number }> = [];
  for (let count = Math.min(3, words.length); count >= 1; count -= 1) {
    if (count === 1 && lastShort) continue;
    const tail = words.slice(-count);
    if (STOP_WORDS.has(tail[0]!.toLowerCase())) continue;
    const q = tail.join(" ");
    if (q.length >= 2) candidates.push({ q, span: q.length });
  }
  return candidates;
}

/**
 * How much of the text before the caret a picked hit replaces: the longest
 * run of trailing words that each start a word of the hit's title ("Sophie
 * Mar" for "Sophie Marchetti"), falling back to the query that found it.
 */
function spanFor(
  hit: SuggestionHit,
  text: string,
  caret: number,
  fallback: number,
) {
  const before = text.slice(0, caret);
  if (/(?:^|\s)@[^@\n]{0,60}$/.test(before)) return fallback;
  const phrase = /[^\n.,;:!?()]*$/.exec(before)?.[0] ?? "";
  const titleWords = hit.title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const tokens = phrase.split(/(\s+)/);
  let span = 0;
  let matched = 0;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      const previous = tokens[index - 1]?.toLowerCase();
      if (!previous || !titleWords.some((word) => word.startsWith(previous)))
        break;
      span += token.length;
      continue;
    }
    if (!titleWords.some((word) => word.startsWith(token.toLowerCase()))) break;
    span += token.length;
    matched += 1;
  }
  return matched > 0 ? span : fallback;
}

/** Runs `suggest` for every candidate phrase (debounced, cached, cancellable). */
function useSuggestions(
  candidates: Array<{ q: string; span: number }>,
  refs: RecordRef[],
) {
  const { suggest } = useAssistantConfig();
  const cache = React.useRef(new Map<string, SuggestionHit[]>());
  const [results, setResults] = React.useState<Record<string, SuggestionHit[]>>(
    {},
  );
  const [searching, setSearching] = React.useState(false);
  const key = candidates.map((item) => item.q).join("|");

  React.useEffect(() => {
    if (!candidates.length) {
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const pending = candidates.filter((item) => !cache.current.has(item.q));
      if (pending.length) setSearching(true);
      await Promise.all(
        pending.map(async (item) => {
          try {
            const hits = await suggest(item.q, controller.signal);
            cache.current.set(item.q, hits);
          } catch {
            if (!controller.signal.aborted) cache.current.set(item.q, []);
          }
        }),
      );
      if (controller.signal.aborted) return;
      setSearching(false);
      setResults(
        Object.fromEntries(
          candidates.map((item) => [item.q, cache.current.get(item.q) ?? []]),
        ),
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, suggest]);

  return React.useMemo(() => {
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    for (const candidate of candidates) {
      for (const hit of results[candidate.q] ?? []) {
        const id = `${hit.type}:${hit.id}`;
        if (
          seen.has(id) ||
          refs.some((ref) => ref.type === hit.type && ref.id === hit.id)
        )
          continue;
        seen.add(id);
        out.push({ hit, span: candidate.span });
      }
    }
    // A hit whose title contains the typed words beats one that only matched a note or address.
    const terms = (candidates[0]?.q ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const rank = (item: Suggestion) =>
      terms.every((term) => item.hit.title.toLowerCase().includes(term))
        ? 0
        : 1;
    return {
      suggestions: out
        .map((item, index) => ({ item, index, rank: rank(item) }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map(({ item }) => item)
        .slice(0, 7),
      searching,
    };
  }, [candidates, results, refs, searching]);
}

/**
 * The assistant's input: a pill field that suggests matching records as you
 * type (any name, address, reference, task or message), links them into the
 * message as chips, and takes file uploads.
 */
function AssistantComposer({
  onSend,
  onStop,
  streaming,
  disabled,
  autoFocus,
  placeholder = "Ask anything…",
}: {
  onSend: (input: ComposerSubmit) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const config = useAssistantConfig();
  const [text, setText] = React.useState("");
  const [caret, setCaret] = React.useState(0);
  const [refs, setRefs] = React.useState<RecordRef[]>([]);
  const [attachments, setAttachments] = React.useState<TranscriptAttachment[]>(
    [],
  );
  const [uploading, setUploading] = React.useState<PendingUpload[]>([]);
  const [highlight, setHighlight] = React.useState(-1);
  const [suppressedFor, setSuppressedFor] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const candidates = React.useMemo(
    () => lookupCandidates(text, caret),
    [text, caret],
  );
  const candidateKey = candidates.map((item) => item.q).join("|");
  const { suggestions, searching } = useSuggestions(candidates, refs);
  const menuOpen =
    focused && suggestions.length > 0 && suppressedFor !== candidateKey;

  React.useEffect(() => {
    setHighlight(-1);
  }, [candidateKey]);

  const resize = React.useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, []);

  // One line tall at rest and after clearing; grows with the text.
  React.useEffect(() => {
    resize();
  }, [resize, text]);

  // Voice typing: the dictated passage is appended after whatever was typed before it started.
  const dictationBase = React.useRef("");
  const dictation = useDictation({
    onTranscript: (spoken, done) => {
      const base = dictationBase.current;
      const glue = base && !/s$/.test(base) && spoken ? " " : "";
      const next = `${base}${glue}${spoken}${done && spoken ? " " : ""}`;
      setText(next);
      setCaret(next.length);
    },
    onError: (message) => toast.add({ title: message, type: "error" }),
  });
  const listening = dictation.state === "listening";
  const toggleDictation = () => {
    if (listening) {
      dictation.stop();
      return;
    }
    dictationBase.current = text;
    dictation.start();
    textareaRef.current?.focus();
  };

  const pick = (suggestion: Suggestion) => {
    const element = textareaRef.current;
    const label = suggestion.hit.title;
    const insert = `@${label} `;
    const start = Math.max(
      0,
      caret - spanFor(suggestion.hit, text, caret, suggestion.span),
    );
    const next = `${text.slice(0, start)}${insert}${text.slice(caret)}`;
    const position = start + insert.length;
    setText(next);
    setCaret(position);
    setRefs((current) =>
      current.some(
        (ref) =>
          ref.type === suggestion.hit.type && ref.id === suggestion.hit.id,
      )
        ? current
        : [
            ...current,
            { type: suggestion.hit.type, id: suggestion.hit.id, label },
          ],
    );
    setSuppressedFor(null);
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      element.setSelectionRange(position, position);
      resize();
    });
  };

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const picked = Array.from(files);
    if (!picked.length) return;
    if (attachments.length + picked.length > MAX_ATTACHMENTS) {
      toast.add({
        title: `You can attach up to ${MAX_ATTACHMENTS} files`,
        type: "error",
      });
      return;
    }
    const maxBytes = config.maxAttachmentBytes ?? DEFAULT_MAX_BYTES;
    for (const file of picked) {
      if (file.size > maxBytes) {
        toast.add({
          title: `${file.name} is larger than ${Math.round(maxBytes / 1024 / 1024)}MB`,
          type: "error",
        });
        continue;
      }
      setUploading((pending) => [...pending, { name: file.name, percent: 0 }]);
      try {
        const attachment = await config.uploadAttachment(file, (percent) =>
          setUploading((pending) =>
            pending.map((item) =>
              item.name === file.name ? { ...item, percent } : item,
            ),
          ),
        );
        setAttachments((current) => [...current, attachment]);
      } catch (error) {
        toast.add({
          title: "Upload failed",
          description: error instanceof Error ? error.message : undefined,
          type: "error",
        });
      } finally {
        setUploading((pending) => {
          const index = pending.findIndex((item) => item.name === file.name);
          return index === -1 ? pending : pending.toSpliced(index, 1);
        });
      }
    }
  };

  const busy = !!disabled || streaming;
  const canSend =
    !busy &&
    uploading.length === 0 &&
    (text.trim().length > 0 || attachments.length > 0);

  const submit = () => {
    if (!canSend) return;
    let content = text.trim();
    // Linked records travel as `@[Label](type:id)` so the model gets the ids.
    for (const ref of [...refs].sort(
      (a, b) => b.label.length - a.label.length,
    )) {
      content = content.split(`@${ref.label}`).join(encodeRef(ref));
    }
    onSend({ content, attachments });
    setText("");
    setRefs([]);
    setAttachments([]);
    setCaret(0);
    requestAnimationFrame(resize);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((index) => {
          const count = suggestions.length;
          if (index < 0) return event.key === "ArrowDown" ? 0 : count - 1;
          return (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
        });
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        pick(suggestions[Math.max(0, highlight)]!);
        return;
      }
      if (event.key === "Enter" && highlight >= 0 && !event.shiftKey) {
        event.preventDefault();
        pick(suggestions[highlight]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSuppressedFor(candidateKey);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const formatBytes = (bytes: number) =>
    bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div
      className="flex flex-col gap-2 border-t bg-card px-3 py-2.5"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        void addFiles(event.dataTransfer.files);
      }}
      data-testid="assistant-composer"
    >
      {refs.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid="assistant-refs">
          {refs.map((ref) => (
            <Badge
              key={`${ref.type}:${ref.id}`}
              variant="secondary"
              className="gap-1 pr-1"
            >
              <span className="text-muted-foreground">
                {config.typeMeta(ref.type).label}
              </span>
              <span className="max-w-40 truncate">{ref.label}</span>
              <button
                type="button"
                aria-label={`Unlink ${ref.label}`}
                className="rounded-full hover:bg-foreground/10"
                onClick={() =>
                  setRefs((current) => current.filter((item) => item !== ref))
                }
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {(attachments.length > 0 || uploading.length > 0) && (
        <AttachmentGroup data-testid="assistant-attachments">
          {attachments.map((attachment) => (
            <Attachment key={attachment.id} size="xs" state="done">
              <AttachmentMedia
                variant={
                  attachment.contentType.startsWith("image/") ? "image" : "icon"
                }
              >
                {attachment.contentType.startsWith("image/") ? (
                  <img
                    src={config.attachmentUrl(attachment.id)}
                    alt={attachment.name}
                  />
                ) : attachment.contentType.startsWith("audio/") ? (
                  <Music />
                ) : (
                  <FileText />
                )}
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{attachment.name}</AttachmentTitle>
                <AttachmentDescription>
                  {formatBytes(attachment.byteSize)}
                </AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    )
                  }
                >
                  <X />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          ))}
          {uploading.map(({ name, percent }, index) => (
            <Attachment key={`${name}-${index}`} size="xs" state="uploading">
              <AttachmentMedia>
                <Spinner />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{name}</AttachmentTitle>
                <AttachmentDescription>
                  {percent >= 100 ? "Processing…" : `Uploading ${percent}%`}
                </AttachmentDescription>
                <Progress
                  value={percent}
                  className="mt-1 h-0.5 w-32 max-w-full"
                  aria-label={`Uploading ${name}`}
                />
              </AttachmentContent>
            </Attachment>
          ))}
        </AttachmentGroup>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept={config.acceptFiles ?? DEFAULT_ACCEPT}
          onChange={(event) => {
            void addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0 rounded-full"
          aria-label="Attach files"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip />
        </Button>
        <Popover open={menuOpen}>
          <PopoverAnchor asChild>
            <div
              className={cn(
                "flex min-h-9 min-w-0 flex-1 items-end gap-0.5 rounded-lg border bg-background py-[3px] pr-[3px] pl-3 transition-[color,box-shadow]",
                "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
                listening && "border-destructive/60",
              )}
            >
              <Textarea
                ref={textareaRef}
                value={text}
                autoFocus={autoFocus}
                placeholder={listening ? "Listening…" : placeholder}
                disabled={!!disabled}
                rows={1}
                aria-label="Message the assistant"
                aria-autocomplete="list"
                aria-expanded={menuOpen}
                className="max-h-40 min-h-7 flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-1 text-[15px] leading-snug shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
                onChange={(event) => {
                  setText(event.target.value);
                  setCaret(
                    event.target.selectionStart ?? event.target.value.length,
                  );
                  resize();
                }}
                onSelect={(event) =>
                  setCaret(event.currentTarget.selectionStart ?? 0)
                }
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={onKeyDown}
                onPaste={(event) => {
                  const files = event.clipboardData?.files;
                  if (files && files.length > 0) {
                    event.preventDefault();
                    void addFiles(files);
                  }
                }}
              />
              {listening && <AudioLevelMeter className="mr-1 self-center" />}
              {dictation.supported && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "size-7 rounded-full",
                    listening && "text-destructive hover:text-destructive",
                  )}
                  aria-label={listening ? "Stop dictation" : "Dictate"}
                  aria-pressed={listening}
                  disabled={!!disabled}
                  onClick={toggleDictation}
                >
                  {listening ? <Square className="fill-current" /> : <Mic />}
                </Button>
              )}
              {searching && focused && (
                <Spinner className="mr-1 mb-1.5 size-3.5 text-muted-foreground" />
              )}
              {streaming ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  className="size-7 rounded-full"
                  aria-label="Stop"
                  onClick={onStop}
                >
                  <Square className="fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  className="size-7 rounded-full disabled:opacity-40"
                  disabled={!canSend}
                  aria-label="Send"
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
          </PopoverAnchor>
          <PopoverContent
            side="top"
            align="start"
            className="w-80 p-1"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            data-testid="assistant-suggestions"
          >
            <div
              role="listbox"
              aria-label="Matching records"
              className="flex flex-col"
            >
              {suggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.hit.type}:${suggestion.hit.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(suggestion)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    index === highlight && "bg-muted",
                  )}
                >
                  <TypeTile
                    type={suggestion.hit.type}
                    className="size-7 [&_svg]:size-3.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {suggestion.hit.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {config.typeMeta(suggestion.hit.type).label}
                      {suggestion.hit.subtitle
                        ? ` · ${suggestion.hit.subtitle}`
                        : ""}
                      {suggestion.hit.detail
                        ? ` · ${suggestion.hit.detail}`
                        : ""}
                    </span>
                  </span>
                  {suggestion.hit.badge && (
                    <Badge variant="secondary" className="shrink-0">
                      {suggestion.hit.badge}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 px-2 pt-1 pb-0.5 text-[11px] text-muted-foreground">
              <Kbd>Tab</Kbd> link record <span className="mx-1">·</span>{" "}
              <Kbd>Esc</Kbd> dismiss
            </div>
          </PopoverContent>
        </Popover>
      </form>
    </div>
  );
}

export { AssistantComposer };
