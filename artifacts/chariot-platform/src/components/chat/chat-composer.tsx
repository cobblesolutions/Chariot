import * as React from "react";
import { ArrowUp, FileText, Mic, Plus, Smile, Square, X } from "lucide-react";
import { toast } from "@/components/ui/toast";
import type {
  MessageAttachment,
  MessageReplyPreview,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { AudioLevelMeter } from "./audio-level-meter";
import { EmojiPicker } from "./emoji-picker";
import { useDictation } from "./use-dictation";
import { documentUploadHeaders, uploadRequest } from "@/lib/upload";
import { attachmentUrl, formatBytes, isImageAttachment } from "./chat-thread";
import { avatarColor, initials } from "./format";

export type ChatComposerSubmit = { body: string; attachmentIds: number[] };

/** Someone (or everyone) that can be @mentioned in this thread. */
export type Mentionable = {
  id: string | number;
  label: string;
  detail?: string;
};

/** The "@partial" token ending at the caret, if the user is mid-mention. */
function mentionAtCaret(text: string, caret: number) {
  if (caret < 0) return null;
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([^@\s]{0,30}(?: [^@\s]{0,30})?)$/.exec(before);
  if (!match) return null;
  return { query: match[1]!, start: caret - match[1]!.length - 1 };
}

type ChatComposerProps = {
  /** Resolve to clear the composer; reject/throw to keep the draft. */
  onSend: (input: ChatComposerSubmit) => Promise<unknown> | unknown;
  isPending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  replyTo?: MessageReplyPreview | null;
  onCancelReply?: () => void;
  autoFocus?: boolean;
  className?: string;
  /** Enables "@" autocomplete for these people. */
  mentionables?: Mentionable[];
};

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function uploadAttachment(
  file: File,
  onProgress: (percent: number) => void,
): Promise<MessageAttachment> {
  return uploadRequest<MessageAttachment>({
    url: "/api/chat/attachments",
    headers: documentUploadHeaders(file),
    body: file,
    onProgress,
  });
}

/** A file still on its way up, shown as a chip with its own progress bar. */
type PendingUpload = { name: string; percent: number };

/** iMessage-style composer: "+" for files, a pill field with emoji and a round send arrow. */
function ChatComposer({
  onSend,
  isPending = false,
  disabled = false,
  placeholder = "Message",
  replyTo,
  onCancelReply,
  autoFocus,
  className,
  mentionables = [],
}: ChatComposerProps) {
  const [text, setText] = React.useState("");
  const [caret, setCaret] = React.useState(0);
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [attachments, setAttachments] = React.useState<MessageAttachment[]>([]);
  const [uploading, setUploading] = React.useState<PendingUpload[]>([]);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Voice typing: the dictated passage is appended after whatever was typed before it started.
  const dictationBase = React.useRef("");
  const dictation = useDictation({
    onTranscript: (spoken, done) => {
      const base = dictationBase.current;
      const glue = base && !/s$/.test(base) && spoken ? " " : "";
      setText(`${base}${glue}${spoken}${done && spoken ? " " : ""}`);
      requestAnimationFrame(resize);
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

  // "@" autocomplete: candidates for the token under the caret, if any.
  const mention = React.useMemo(
    () => (mentionables.length ? mentionAtCaret(text, caret) : null),
    [mentionables.length, text, caret],
  );
  const candidates = React.useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return mentionables
      .filter((person) => person.label.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, mentionables]);
  const mentionOpen = candidates.length > 0;
  React.useEffect(() => {
    setMentionIndex(0);
  }, [mention?.query]);

  const pickMention = (person: Mentionable) => {
    if (!mention) return;
    const element = textareaRef.current;
    const insert = `@${person.label} `;
    const next = `${text.slice(0, mention.start)}${insert}${text.slice(caret)}`;
    const position = mention.start + insert.length;
    setText(next);
    setCaret(position);
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      element.setSelectionRange(position, position);
      resize();
    });
  };

  const busy = disabled || isPending;
  const canSend =
    !busy &&
    uploading.length === 0 &&
    (text.trim().length > 0 || attachments.length > 0);

  React.useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  const resize = () => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  };

  const insertEmoji = (emoji: string) => {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      element.setSelectionRange(start + emoji.length, start + emoji.length);
      resize();
    });
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const picked = Array.from(files);
    if (attachments.length + picked.length > MAX_ATTACHMENTS) {
      toast.add({
        title: `You can attach up to ${MAX_ATTACHMENTS} files per message`,
        type: "error",
      });
      return;
    }
    for (const file of picked) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.add({ title: `${file.name} is larger than 25MB`, type: "error" });
        continue;
      }
      setUploading((pending) => [...pending, { name: file.name, percent: 0 }]);
      try {
        const attachment = await uploadAttachment(file, (percent) =>
          setUploading((pending) =>
            pending.map((item) =>
              item.name === file.name ? { ...item, percent } : item,
            ),
          ),
        );
        setAttachments((current) => [...current, attachment]);
      } catch (error) {
        toast.add({
          title: "Attachment upload failed",
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

  const submit = async () => {
    if (!canSend) return;
    try {
      await onSend({
        body: text.trim(),
        attachmentIds: attachments.map((attachment) => attachment.id),
      });
      setText("");
      setAttachments([]);
      requestAnimationFrame(resize);
    } catch {
      // keep the draft; the caller reports the error
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-t bg-card px-3 py-2.5 md:px-4",
        className,
      )}
    >
      {replyTo && (
        <div className="flex items-start gap-2 rounded-2xl bg-muted px-3 py-2 animate-in fade-in slide-in-from-bottom-1">
          <div className="min-w-0 flex-1 text-[13px] leading-snug">
            <div className="font-semibold">Replying to {replyTo.sender}</div>
            <div className="truncate text-muted-foreground">
              {replyTo.body || "Attachment"}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="rounded-full"
            aria-label="Cancel reply"
            onClick={onCancelReply}
          >
            <X />
          </Button>
        </div>
      )}

      {(attachments.length > 0 || uploading.length > 0) && (
        <AttachmentGroup data-testid="composer-attachments">
          {attachments.map((attachment) => (
            <Attachment key={attachment.id} size="xs" state="done">
              <AttachmentMedia
                variant={isImageAttachment(attachment) ? "image" : "icon"}
              >
                {isImageAttachment(attachment) ? (
                  <img src={attachmentUrl(attachment)} alt={attachment.name} />
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
          void submit();
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
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
          <Plus />
        </Button>
        <Popover open={mentionOpen}>
          <PopoverAnchor asChild>
            <div
              className={cn(
                "flex min-h-9 min-w-0 flex-1 items-end gap-0.5 rounded-lg border bg-background py-0.5 pr-0.5 pl-4 transition-[color,box-shadow]",
                "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
                listening && "border-destructive/60",
              )}
              data-testid="composer-field"
            >
              <Textarea
                ref={textareaRef}
                value={text}
                autoFocus={autoFocus}
                placeholder={listening ? "Listening…" : placeholder}
                disabled={busy}
                rows={1}
                aria-label="Message"
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
                onKeyDown={(event) => {
                  if (mentionOpen) {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      setMentionIndex(
                        (index) =>
                          (index +
                            (event.key === "ArrowDown" ? 1 : -1) +
                            candidates.length) %
                          candidates.length,
                      );
                      return;
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                      event.preventDefault();
                      pickMention(candidates[mentionIndex]!);
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setCaret(-1);
                      return;
                    }
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
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
                  disabled={busy}
                  onClick={toggleDictation}
                >
                  {listening ? <Square className="fill-current" /> : <Mic />}
                </Button>
              )}
              <EmojiPicker onPick={insertEmoji} align="end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 rounded-full"
                  aria-label="Add emoji"
                >
                  <Smile />
                </Button>
              </EmojiPicker>
              <Button
                type="submit"
                size="icon-sm"
                className="size-7 rounded-full disabled:opacity-40"
                disabled={!canSend}
                aria-label="Send message"
              >
                {isPending ? <Spinner /> : <ArrowUp />}
              </Button>
            </div>
          </PopoverAnchor>
          <PopoverContent
            side="top"
            align="start"
            className="w-64 p-1"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            data-testid="mention-menu"
          >
            <div
              role="listbox"
              aria-label="Mention someone"
              className="flex flex-col"
            >
              {candidates.map((person, index) => (
                <button
                  key={person.id}
                  type="button"
                  role="option"
                  aria-selected={index === mentionIndex}
                  onMouseEnter={() => setMentionIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickMention(person)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    index === mentionIndex && "bg-muted",
                  )}
                >
                  <Avatar className="size-6 text-[10px]">
                    <AvatarFallback
                      className={cn(
                        "font-medium text-white",
                        avatarColor(person.label).bg,
                      )}
                    >
                      {initials(person.label)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{person.label}</span>
                    {person.detail && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {person.detail}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </form>
    </div>
  );
}

export { ChatComposer };
