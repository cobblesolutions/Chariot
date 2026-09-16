import * as React from "react";
import {
  EmojiPicker as EmojiPickerPrimitive,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
} from "frimousse";
import { Smile } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  EmojiPicker as EmojiPickerRoot,
  EmojiPickerSearch,
} from "@/components/ui/emoji-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Emoji, rememberEmoji, useRecentEmojis } from "./emoji";

/** The reactions offered on message hover, and the quick row before anything has been used. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "✅"];

const COLUMNS = 9;

/* ---------- list parts (SVG emoji instead of the native glyphs) ---------- */

function Row({ children, ...props }: EmojiPickerListRowProps) {
  return (
    <div {...props} className="scroll-my-1 px-1.5" data-slot="emoji-picker-row">
      {children}
    </div>
  );
}

function EmojiButton({
  emoji,
  className,
  ...props
}: EmojiPickerListEmojiProps) {
  return (
    <button
      {...props}
      type="button"
      className={cn(
        "flex size-8 items-center justify-center rounded-md transition-colors data-[active]:bg-muted",
        className,
      )}
      data-slot="emoji-picker-emoji"
    >
      <Emoji emoji={emoji.emoji} className="size-6" />
    </button>
  );
}

function CategoryHeader({
  category,
  ...props
}: EmojiPickerListCategoryHeaderProps) {
  return (
    <div
      {...props}
      className="bg-popover px-3 pt-3 pb-1.5 text-[11px] leading-none font-medium tracking-wider text-muted-foreground uppercase"
      data-slot="emoji-picker-category-header"
    >
      {category.label}
    </div>
  );
}

/** Recently used emoji (or the default quick set) for one-tap picking. */
function QuickRow({ onPick }: { onPick: (emoji: string) => void }) {
  const recent = useRecentEmojis();
  const items = recent.length ? recent.slice(0, COLUMNS) : QUICK_REACTIONS;
  return (
    <div className="border-b px-1.5 pt-2 pb-1.5" data-testid="emoji-quick">
      <div className="px-1.5 pb-1 text-[11px] leading-none font-medium tracking-wider text-muted-foreground uppercase">
        {recent.length ? "Recent" : "Quick"}
      </div>
      <div className="flex">
        {items.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="flex size-8 items-center justify-center rounded-md transition-colors"
            aria-label={emoji}
            onClick={() => onPick(emoji)}
          >
            <Emoji emoji={emoji} className="size-6" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Six hand swatches; the chosen tone applies to every emoji that supports one. */
function SkinTones() {
  return (
    <EmojiPickerPrimitive.SkinTone emoji="👋">
      {({ skinTone, setSkinTone, skinToneVariations }) => (
        <div
          className="flex items-center gap-0.5"
          role="radiogroup"
          aria-label="Skin tone"
          data-testid="emoji-skin-tones"
        >
          {skinToneVariations.map((variation) => (
            <button
              key={variation.skinTone}
              type="button"
              role="radio"
              aria-checked={variation.skinTone === skinTone}
              aria-label={`Skin tone: ${variation.skinTone}`}
              onClick={() => setSkinTone(variation.skinTone)}
              className={cn(
                "flex size-6 items-center justify-center rounded-md transition-colors",
                variation.skinTone === skinTone && "bg-muted ring-1 ring-ring",
              )}
            >
              <Emoji emoji={variation.emoji} className="size-4" />
            </button>
          ))}
        </div>
      )}
    </EmojiPickerPrimitive.SkinTone>
  );
}

type EmojiPickerProps = {
  onPick: (emoji: string) => void;
  /** Custom trigger; defaults to a ghost smiley icon button. */
  children?: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  triggerLabel?: string;
};

/**
 * Full emoji palette in a Popover: search-as-you-type over every emoji
 * (Emojibase data), a recent row, sticky categories, keyboard navigation,
 * a preview footer and a skin-tone switch. Every glyph is a Twemoji SVG.
 */
function EmojiPicker({
  onPick,
  children,
  align = "end",
  side = "top",
  triggerLabel = "Add emoji",
}: EmojiPickerProps) {
  const [open, setOpen] = React.useState(false);
  const pick = (emoji: string) => {
    rememberEmoji(emoji);
    onPick(emoji);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ?? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={triggerLabel}
          >
            <Smile />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        className="w-auto p-0"
        data-testid="emoji-picker"
      >
        <EmojiPickerRoot
          className="h-96"
          columns={COLUMNS}
          onEmojiSelect={({ emoji }) => pick(emoji)}
        >
          <EmojiPickerSearch autoFocus placeholder="Search emoji" />
          <QuickRow onPick={pick} />
          <EmojiPickerPrimitive.Viewport
            className="relative flex-1 outline-hidden"
            data-slot="emoji-picker-viewport"
          >
            <EmojiPickerPrimitive.Loading className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <Spinner />
            </EmojiPickerPrimitive.Loading>
            <EmojiPickerPrimitive.Empty className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              {({ search }) => `Nothing for “${search}”`}
            </EmojiPickerPrimitive.Empty>
            <EmojiPickerPrimitive.List
              className="pb-1.5 select-none"
              components={{ Row, Emoji: EmojiButton, CategoryHeader }}
              data-slot="emoji-picker-list"
            />
          </EmojiPickerPrimitive.Viewport>
          <div className="flex w-full min-w-0 max-w-(--frimousse-viewport-width) items-center gap-2 border-t px-2 py-1.5">
            <EmojiPickerPrimitive.ActiveEmoji>
              {({ emoji }) =>
                emoji ? (
                  <>
                    <Emoji emoji={emoji.emoji} className="size-6 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {emoji.label}
                    </span>
                  </>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    Type to search, ↑↓ to browse
                  </span>
                )
              }
            </EmojiPickerPrimitive.ActiveEmoji>
            <SkinTones />
          </div>
        </EmojiPickerRoot>
      </PopoverContent>
    </Popover>
  );
}

export { EmojiPicker };
