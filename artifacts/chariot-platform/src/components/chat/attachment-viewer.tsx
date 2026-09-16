import * as React from "react";
import type { MessageAttachment } from "@workspace/api-client-react";
import { ChevronLeft, ChevronRight, Download, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { attachmentUrl, formatBytes, isImageAttachment } from "./chat-thread";

/* ---------- store: any attachment anywhere in the chat opens in the one viewer ---------- */

type ViewerState = { items: MessageAttachment[]; index: number } | null;

let state: ViewerState = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** Opens the viewer on `id`, with `items` (same thread) available for previous/next. */
export function openAttachmentViewer(items: MessageAttachment[], id: number) {
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === id),
  );
  state = { items, index };
  emit();
}

function useViewerState() {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

const previewable = (attachment: MessageAttachment) =>
  isImageAttachment(attachment) ||
  attachment.contentType === "application/pdf" ||
  attachment.contentType === "text/plain";

function Preview({ attachment }: { attachment: MessageAttachment }) {
  const url = attachmentUrl(attachment);
  if (isImageAttachment(attachment)) {
    return (
      <img
        src={url}
        alt={attachment.name}
        className="max-h-[calc(100dvh-10rem)] max-w-full object-contain"
        data-testid="viewer-image"
      />
    );
  }
  if (previewable(attachment)) {
    return (
      <iframe
        src={url}
        title={attachment.name}
        className="h-[calc(100dvh-10rem)] w-full rounded-md bg-background"
        data-testid="viewer-frame"
      />
    );
  }
  return (
    <Empty className="h-64">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileText />
        </EmptyMedia>
        <EmptyDescription>
          No preview for this file type — download it to open.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// Only one viewer renders even if several ChatThreads are mounted on a page.
let mounted = 0;

/** Popup viewer for chat attachments: image / PDF / text inline, arrows and ←→ between files, download. */
export function AttachmentViewer() {
  const [primary] = React.useState(() => mounted++ === 0);
  React.useEffect(() => () => void mounted--, []);
  const current = useViewerState();
  if (!primary) return null;

  const attachment = current?.items[current.index];
  const count = current?.items.length ?? 0;
  const step = (delta: number) => {
    if (!current || count < 2) return;
    state = { ...current, index: (current.index + delta + count) % count };
    emit();
  };
  const close = () => {
    state = null;
    emit();
  };

  return (
    <Dialog open={!!attachment} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col gap-3 p-4 sm:max-w-5xl"
        data-testid="attachment-viewer"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") step(-1);
          if (event.key === "ArrowRight") step(1);
        }}
      >
        {attachment && (
          <>
            <div className="flex min-w-0 items-center gap-3 pr-8">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-sm font-medium">
                  {attachment.name}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {formatBytes(attachment.byteSize)}
                  {count > 1 && ` · ${current!.index + 1} of ${count}`}
                </DialogDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href={attachmentUrl(attachment)} download={attachment.name}>
                  <Download />
                  Download
                </a>
              </Button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-muted/40">
              <Preview key={attachment.id} attachment={attachment} />
              {count > 1 && (
                <>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    className={cn("absolute left-2 rounded-full shadow-sm")}
                    aria-label="Previous file"
                    onClick={() => step(-1)}
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    className="absolute right-2 rounded-full shadow-sm"
                    aria-label="Next file"
                    onClick={() => step(1)}
                  >
                    <ChevronRight />
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
