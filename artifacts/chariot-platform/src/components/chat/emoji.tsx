import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Emoji are drawn from the Twemoji SVG set (jdecked/twemoji, the maintained
 * fork) so they look the same on every OS instead of falling back to whatever
 * colour font the device has.
 */
const TWEMOJI_BASE =
  "https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets/svg";

/** Twemoji file name for an emoji: code points joined by "-", VS16 dropped unless the sequence uses ZWJ. */
export function twemojiCode(emoji: string) {
  const text = emoji.includes("\u200D") ? emoji : emoji.replace(/\uFE0F/g, "");
  return [...text].map((char) => char.codePointAt(0)!.toString(16)).join("-");
}

export function twemojiUrl(emoji: string) {
  return `${TWEMOJI_BASE}/${twemojiCode(emoji)}.svg`;
}

/** Matches one emoji (incl. flags, skin tones and ZWJ sequences) inside text. */
export const EMOJI_PATTERN =
  /(\p{RI}\p{RI}|\p{Extended_Pictographic}(?:\p{EMod}|️|‍\p{Extended_Pictographic}(?:\p{EMod}|️)?)*|[#*0-9]️?⃣)/u;

/** An emoji rendered as a Twemoji SVG; falls back to the native glyph if the image can't load. */
export function Emoji({
  emoji,
  className,
  ...props
}: Omit<React.ComponentProps<"img">, "src" | "alt"> & { emoji: string }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [emoji]);
  if (failed)
    return (
      <span
        className={cn("inline-block leading-none", className)}
        role="img"
        aria-label={emoji}
      >
        {emoji}
      </span>
    );
  return (
    <img
      src={twemojiUrl(emoji)}
      alt={emoji}
      draggable={false}
      loading="lazy"
      decoding="async"
      data-emoji={emoji}
      onError={() => setFailed(true)}
      className={cn(
        "inline-block size-[1.2em] select-none align-[-0.25em]",
        className,
      )}
      {...props}
    />
  );
}

/** Text with every emoji swapped for its SVG, other characters untouched. */
export function EmojiText({ text }: { text: string }) {
  const parts = React.useMemo(
    () =>
      text.split(new RegExp(EMOJI_PATTERN.source, `${EMOJI_PATTERN.flags}g`)),
    [text],
  );
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Emoji key={index} emoji={part} />
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

/* ---------- recently used ---------- */

const RECENT_KEY = "chariot.emoji.recent";
const RECENT_MAX = 18;
const listeners = new Set<() => void>();
let recent: string[] = load();

function load(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string) {
  recent = [emoji, ...recent.filter((item) => item !== emoji)].slice(
    0,
    RECENT_MAX,
  );
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // storage unavailable: the in-memory list still works this session
  }
  listeners.forEach((listener) => listener());
}

export function useRecentEmojis() {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => recent,
    () => recent,
  );
}
