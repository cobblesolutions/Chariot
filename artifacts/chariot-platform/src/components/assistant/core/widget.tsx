import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Maximize2, Minimize2, SquarePen, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AssistantComposer } from "./composer";
import { useAssistantConfig } from "./config";
import { AssistantStatus, AssistantThread } from "./thread";
import { useAssistant } from "./use-assistant";

function AssistantPanel({
  expanded,
  onToggleExpand,
  onClose,
  mobile,
}: {
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  mobile: boolean;
}) {
  const { title, subtitle } = useAssistantConfig();
  const state = useAssistant();

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="assistant-panel">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="text-sm leading-tight font-semibold">
            {title}
          </DialogPrimitive.Title>
          {/* The dialog needs a description for assistive tech even when none is shown. */}
          <DialogPrimitive.Description
            className={
              subtitle
                ? "truncate text-[11px] text-muted-foreground"
                : "sr-only"
            }
          >
            {subtitle ?? "Reads and updates your data, with your approval"}
          </DialogPrimitive.Description>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New conversation"
              onClick={state.reset}
              disabled={state.messages.length === 0 && !state.streaming}
            >
              <SquarePen />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New conversation</TooltipContent>
        </Tooltip>
        {!mobile && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={expanded ? "Shrink" : "Expand"}
                onClick={onToggleExpand}
              >
                {expanded ? <Minimize2 /> : <Maximize2 />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{expanded ? "Shrink" : "Expand"}</TooltipContent>
          </Tooltip>
        )}
        {!mobile && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close assistant"
            onClick={onClose}
          >
            <X />
          </Button>
        )}
      </div>
      <AssistantThread state={state} />
      <AssistantStatus state={state} />
      <AssistantComposer
        autoFocus
        streaming={state.streaming}
        onStop={state.stop}
        onSend={({ content, attachments }) => state.send(content, attachments)}
      />
    </div>
  );
}

function Unavailable({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      {onClose && (
        <div className="flex justify-end p-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close assistant"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      )}
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <Sparkles className="size-6" />
        <DialogPrimitive.Title className="font-medium text-foreground">
          Assistant not configured
        </DialogPrimitive.Title>
        <DialogPrimitive.Description>
          Set <code>OPENROUTER_API_KEY</code> on the API server to enable it.
        </DialogPrimitive.Description>
        <Badge variant="secondary">Staff only</Badge>
      </div>
    </div>
  );
}

const OPEN_KEY = "assistant.open";

/**
 * The corner assistant: a launcher pinned bottom-right that opens a modal
 * popup (blurred backdrop, pops in from the corner, animates between sizes)
 * or a bottom sheet on phones. ⌘J / Ctrl+J toggles it.
 */
function AssistantWidget({
  configured = true,
  mobile = false,
  /** Changes when the app navigates; the popup closes so the page is usable. */
  locationKey,
}: {
  configured?: boolean;
  mobile?: boolean;
  locationKey?: string;
}) {
  const [open, setOpen] = React.useState(
    () => sessionStorage.getItem(OPEN_KEY) === "1",
  );
  const [expanded, setExpanded] = React.useState(false);
  const lastLocation = React.useRef(locationKey);

  React.useEffect(() => {
    sessionStorage.setItem(OPEN_KEY, open ? "1" : "0");
  }, [open]);

  React.useEffect(() => {
    if (lastLocation.current !== locationKey) {
      lastLocation.current = locationKey;
      setOpen(false);
    }
  }, [locationKey]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "j"
      ) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const launcher = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-lg"
          className={cn(
            "fixed right-5 bottom-5 z-40 size-14 rounded-full shadow-lg transition-transform duration-200 [&_svg:not([class*='size-'])]:size-6",
            "hover:scale-105 active:scale-95",
            open && !mobile && "pointer-events-none scale-75 opacity-0",
          )}
          aria-label="Open assistant"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          data-testid="assistant-launcher"
        >
          <Sparkles />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left" className="flex items-center gap-2">
        Assistant <Kbd>⌘J</Kbd>
      </TooltipContent>
    </Tooltip>
  );

  if (mobile) {
    return (
      <>
        {launcher}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="h-[92dvh] gap-0 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Assistant</SheetTitle>
              <SheetDescription>Chat with the assistant</SheetDescription>
            </SheetHeader>
            {open &&
              (configured ? (
                <AssistantPanel
                  expanded={false}
                  onToggleExpand={() => undefined}
                  onClose={() => setOpen(false)}
                  mobile
                />
              ) : (
                <Unavailable />
              ))}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <>
      {launcher}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal>
          <DialogOverlay className="bg-black/40 backdrop-blur-sm" />
          <DialogPrimitive.Content
            data-slot="dialog-content"
            aria-label="Assistant"
            data-testid="assistant-window"
            className={cn(
              "fixed right-5 bottom-5 z-50 flex origin-bottom-right flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl outline-none",
              "h-[min(720px,calc(100dvh-2.5rem))] transition-[width,height] duration-300 ease-out",
              expanded
                ? "w-[min(820px,calc(100vw-2.5rem))]"
                : "w-[min(440px,calc(100vw-2.5rem))]",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-90 data-[state=open]:slide-in-from-bottom-4 data-[state=open]:duration-300",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-90 data-[state=closed]:slide-out-to-bottom-4 data-[state=closed]:duration-200",
            )}
          >
            {configured ? (
              <AssistantPanel
                expanded={expanded}
                onToggleExpand={() => setExpanded((value) => !value)}
                onClose={() => setOpen(false)}
                mobile={false}
              />
            ) : (
              <Unavailable onClose={() => setOpen(false)} />
            )}
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  );
}

export { AssistantWidget };
