import type {
  InboxThread,
  MessageAttachment,
} from "@workspace/api-client-react";
import {
  Archive,
  BellOff,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Pin,
  X,
} from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { StageBadge } from "@/components/stage-badge";
import { openAttachmentViewer } from "./attachment-viewer";
import { attachmentUrl, formatBytes, isImageAttachment } from "./chat-thread";
import { EditableTitle } from "./editable-title";
import { avatarColor, formatRelativeStamp, initials } from "./format";
import { ThreadAvatar } from "./thread-list";
import type { ThreadActions } from "./use-thread-actions";

export type SharedFile = MessageAttachment & { sender: string; sentAt: string };

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-1 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

/**
 * Right-hand details column: who is in the thread, the case it belongs to,
 * the files shared in it, and the user's own pin / mute / archive settings.
 */
export function ThreadInfoPanel({
  thread,
  files,
  actions,
  onClose,
  className,
}: {
  thread: InboxThread;
  files: SharedFile[];
  actions: ThreadActions;
  onClose?: () => void;
  className?: string;
}) {
  const settings = [
    {
      key: "pinned",
      icon: Pin,
      title: "Pinned",
      checked: thread.pinned,
      toggle: () => actions.togglePinned(thread),
    },
    {
      key: "muted",
      icon: BellOff,
      title: "Muted",
      checked: thread.muted,
      toggle: () => actions.toggleMuted(thread),
    },
    {
      key: "archived",
      icon: Archive,
      title: "Archived",
      checked: thread.archived,
      toggle: () => actions.toggleArchived(thread),
    },
  ];

  return (
    <div
      className={cn("flex min-h-0 flex-col bg-muted/30", className)}
      data-testid="thread-info"
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b pr-2 pl-4">
        <h2 className="text-sm font-semibold">Details</h2>
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label="Hide details"
            onClick={onClose}
          >
            <X />
          </Button>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
        <div className="space-y-5 p-4">
          <div className="flex flex-col items-center gap-2 text-center">
            <ThreadAvatar
              kind={thread.kind}
              title={thread.title}
              linkedToCase={thread.caseId != null}
              className="size-16 text-xl"
            />
            <div className="flex w-full min-w-0 flex-col items-center">
              {thread.conversationId != null ? (
                <EditableTitle
                  value={thread.title}
                  label="Rename chat"
                  onSave={(next) => actions.rename(thread, next)}
                  className="font-semibold"
                  inputClassName="w-full font-semibold"
                />
              ) : (
                <div className="max-w-full truncate font-semibold">
                  {thread.title}
                </div>
              )}
              <div className="truncate text-xs text-muted-foreground">
                {thread.subtitle}
              </div>
            </div>
          </div>

          {thread.case && (
            <Section title="Case">
              <div className="space-y-1.5">
                <Fact label="Reference">{thread.case.reference}</Fact>
                <Fact label="Client">{thread.case.clientName}</Fact>
                <Fact label="Stage">
                  <StageBadge
                    stage={thread.case.stage}
                    stageIndex={thread.case.stageIndex}
                  />
                </Fact>
                <Fact label="Assigned to">{thread.case.assignedTo}</Fact>
                {thread.case.lenderName && (
                  <Fact label="Lender">{thread.case.lenderName}</Fact>
                )}
                <Fact label="Property">
                  <span className="line-clamp-2">
                    {thread.case.propertyAddress}
                  </span>
                </Fact>
              </div>
              <Button variant="outline" size="sm" className="w-full" asChild>
                <Link href={`/cases/${thread.case.id}`}>
                  <ExternalLink />
                  Open case
                </Link>
              </Button>
            </Section>
          )}

          {thread.participants.length > 0 && (
            <Section title={`People · ${thread.participants.length}`}>
              <ItemGroup className="gap-1">
                {thread.participants.map((person) => (
                  <Item key={person.id} size="sm" className="px-1 py-1">
                    <ItemMedia>
                      <Avatar className="size-7 text-[11px]">
                        <AvatarFallback
                          className={cn(
                            "font-medium text-white",
                            avatarColor(person.displayName).bg,
                          )}
                        >
                          {initials(person.displayName)}
                        </AvatarFallback>
                      </Avatar>
                    </ItemMedia>
                    <ItemContent className="gap-0">
                      <ItemTitle className="text-sm">
                        {person.displayName}
                      </ItemTitle>
                      <ItemDescription className="text-xs capitalize">
                        {person.role.replaceAll("_", " ")}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            </Section>
          )}
          {thread.kind === "case" && (
            <Section title="People">
              <p className="px-1 text-sm text-muted-foreground">
                All staff can read and post in a case chat.
              </p>
            </Section>
          )}

          <Section title={`Shared files · ${files.length}`}>
            {files.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">
                No files yet.
              </p>
            ) : (
              <ItemGroup className="gap-1" data-testid="shared-files">
                {files.slice(0, 30).map((file) => (
                  <Item key={file.id} size="sm" className="relative px-1 py-1">
                    {/* The row itself opens the file in the viewer; the trailing button downloads. */}
                    <button
                      type="button"
                      className="absolute inset-0 rounded-md"
                      aria-label={`Open ${file.name}`}
                      onClick={() => openAttachmentViewer(files, file.id)}
                    />
                    <ItemMedia variant="icon">
                      {isImageAttachment(file) ? <ImageIcon /> : <FileText />}
                    </ItemMedia>
                    <ItemContent className="gap-0">
                      <ItemTitle className="truncate text-sm">
                        {file.name}
                      </ItemTitle>
                      <ItemDescription className="text-xs">
                        {formatBytes(file.byteSize)} · {file.sender} ·{" "}
                        {formatRelativeStamp(file.sentAt)}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions className="relative">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Download ${file.name}`}
                        asChild
                      >
                        <a href={attachmentUrl(file)} download={file.name}>
                          <Download />
                        </a>
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </Section>

          <Separator />

          <Section title="Your settings">
            <ItemGroup className="gap-1">
              {settings.map((setting) => (
                <Item key={setting.key} size="sm" className="px-1 py-1">
                  <ItemMedia variant="icon">
                    <setting.icon />
                  </ItemMedia>
                  <ItemContent className="gap-0">
                    <ItemTitle className="text-sm">{setting.title}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      checked={setting.checked}
                      onCheckedChange={setting.toggle}
                      aria-label={setting.title}
                    />
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </Section>
        </div>
      </ScrollArea>
    </div>
  );
}
