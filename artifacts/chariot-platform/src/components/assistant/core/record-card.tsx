import * as React from "react";
import { ArrowUpRight, Download, FileText, Music } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { useAssistantConfig } from "./config";
import type { RecordDisplay } from "./types";

type Media = RecordDisplay["media"][number];

/** Icon tile in the host app's colour language for a record type. */
function TypeTile({ type, className }: { type: string; className?: string }) {
  const { typeMeta } = useAssistantConfig();
  const meta = typeMeta(type);
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md border",
        meta.tile,
        className,
      )}
    >
      <meta.icon className="size-4" />
    </span>
  );
}

/** Full-size preview for an image or PDF; audio plays inline so it needs none. */
function MediaViewer({
  item,
  open,
  onOpenChange,
}: {
  item: Media;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{item.name}</DialogTitle>
          <DialogDescription>
            {item.detail ?? (item.kind === "pdf" ? "PDF document" : "Image")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md bg-muted">
          {item.kind === "image" ? (
            <img
              src={item.url}
              alt={item.name}
              className="mx-auto max-h-[70dvh] w-auto object-contain"
            />
          ) : (
            <iframe
              title={item.name}
              src={item.url}
              className="h-[70dvh] w-full"
            />
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" asChild>
            <a href={item.url} download={item.name}>
              <Download />
              Download
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MediaItem({ item }: { item: Media }) {
  const [open, setOpen] = React.useState(false);

  if (item.kind === "audio") {
    return (
      <div className="flex w-full items-center gap-2 rounded-md border bg-background p-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <Music className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{item.name}</div>
          <audio
            controls
            preload="none"
            src={item.url}
            className="mt-1 h-8 w-full"
          />
        </div>
      </div>
    );
  }

  const previewable = item.kind === "image" || item.kind === "pdf";
  const body = (
    <>
      <AttachmentMedia variant={item.kind === "image" ? "image" : "icon"}>
        {item.kind === "image" ? (
          <img src={item.url} alt={item.name} loading="lazy" />
        ) : (
          <FileText />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{item.name}</AttachmentTitle>
        {item.detail && (
          <AttachmentDescription>{item.detail}</AttachmentDescription>
        )}
      </AttachmentContent>
    </>
  );

  return (
    <>
      <Attachment size="sm" state="done" className="max-w-full">
        {previewable ? (
          <AttachmentTrigger
            aria-label={`Open ${item.name}`}
            onClick={() => setOpen(true)}
          >
            {body}
          </AttachmentTrigger>
        ) : (
          <AttachmentTrigger asChild>
            <a href={item.url} download={item.name}>
              {body}
            </a>
          </AttachmentTrigger>
        )}
      </Attachment>
      {previewable && (
        <MediaViewer item={item} open={open} onOpenChange={setOpen} />
      )}
    </>
  );
}

/** A record the assistant fetched, shown inline with its files; every value that is a record links to it. */
function RecordCard({
  record,
  className,
}: {
  record: RecordDisplay;
  className?: string;
}) {
  const { Link } = useAssistantConfig();
  const [showAll, setShowAll] = React.useState(false);
  const fields = showAll ? record.fields : record.fields.slice(0, 6);
  const media = record.media.filter((item) => item.kind !== "audio");
  const audio = record.media.filter((item) => item.kind === "audio");

  return (
    <Item
      variant="outline"
      size="sm"
      className={cn(
        "w-full max-w-md flex-col items-stretch gap-2 bg-card",
        className,
      )}
      data-testid="assistant-record-card"
    >
      <div className="flex w-full items-start gap-2">
        <ItemMedia>
          <Link href={record.href} aria-label={`Open ${record.title}`}>
            <TypeTile type={record.type} />
          </Link>
        </ItemMedia>
        <ItemContent className="min-w-0 gap-0">
          <div className="flex items-center gap-2">
            <Link
              href={record.href}
              className="truncate text-sm font-medium hover:underline"
            >
              {record.title}
            </Link>
            {record.badge && (
              <Badge variant="secondary" className="shrink-0">
                {record.badge}
              </Badge>
            )}
          </div>
          {record.subtitle && (
            <div className="truncate text-xs text-muted-foreground">
              {record.subtitle}
            </div>
          )}
        </ItemContent>
        <Button variant="ghost" size="icon-xs" asChild aria-label="Open record">
          <Link href={record.href}>
            <ArrowUpRight />
          </Link>
        </Button>
      </div>

      {fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {fields.map((field) => (
            <React.Fragment key={field.label}>
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="min-w-0 truncate" title={field.value}>
                {field.href ? (
                  <Link
                    href={field.href}
                    className="font-medium text-primary hover:underline"
                  >
                    {field.value}
                  </Link>
                ) : (
                  field.value
                )}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {record.fields.length > 6 && (
        <Button
          variant="link"
          size="xs"
          className="h-auto self-start p-0"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "Show less" : `Show ${record.fields.length - 6} more`}
        </Button>
      )}

      {media.length > 0 && (
        <AttachmentGroup className="w-full">
          {media.map((item) => (
            <MediaItem key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </AttachmentGroup>
      )}
      {audio.length > 0 && (
        <div className="flex w-full flex-col gap-1.5">
          {audio.map((item) => (
            <MediaItem key={`audio-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </Item>
  );
}

export { RecordCard, TypeTile };
