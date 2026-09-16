import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import {
  getListClientInteractionsQueryKey,
  useListClientInteractions,
  type Client,
  type ClientInteraction,
  type InteractionKind,
} from "@workspace/api-client-react";
import { CalendarClock, Phone, Trash2, X } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/components/auth-provider";
import { isFullAccess } from "@/lib/roles";
import { format } from "date-fns";
import { INTERACTION_KINDS, followUpLabel, interactionIcon, relativeTime } from "./client-model";
import { useClientMutations } from "./use-client-mutations";

export interface LogInteractionHandle {
  focus: () => void;
}

/**
 * The "what just happened" strip: pick call / email / meeting / note, write a
 * line, optionally set the next follow-up, submit with ⌘↵.
 */
export const LogInteraction = forwardRef<
  LogInteractionHandle,
  {
    client: Pick<Client, "id" | "nextFollowUpAt">;
    className?: string;
    /** Start as a single quiet line; the full composer opens on click (or on `focus()`). */
    collapsible?: boolean;
  }
>(
  function LogInteraction({ client, className, collapsible = false }, ref) {
    const mutations = useClientMutations();
    const [kind, setKind] = useState<InteractionKind>("call");
    const [summary, setSummary] = useState("");
    const [followUp, setFollowUp] = useState<string | null>(null);
    const [dateOpen, setDateOpen] = useState(false);
    const [open, setOpen] = useState(!collapsible);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => ({
      focus: () => {
        setOpen(true);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      },
    }));

    const submit = () => {
      const text = summary.trim();
      if (!text) return;
      mutations.addInteraction(
        client,
        { kind, summary: text, ...(followUp !== null ? { nextFollowUpAt: followUp } : {}) },
        {
          onSuccess: () => {
            setSummary("");
            setFollowUp(null);
            if (collapsible) setOpen(false);
          },
        },
      );
    };
    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    };
    const KindIcon = interactionIcon(kind);

    if (!open) {
      return (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            window.setTimeout(() => textareaRef.current?.focus(), 0);
          }}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40",
            className,
          )}
        >
          <Phone className="size-4 shrink-0" />
          Log a call, email, meeting or note…
        </button>
      );
    }

    return (
      <div className={cn("space-y-2 rounded-lg border bg-muted/20 p-3", className)}>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={kind}
          onValueChange={(value) => value && setKind(value as InteractionKind)}
          aria-label="Interaction type"
        >
          {INTERACTION_KINDS.map((item) => (
            <ToggleGroupItem key={item.value} value={item.value} aria-label={item.label} className="gap-1.5 px-2.5">
              <item.icon className="size-3.5" />
              <span className="hidden sm:inline">{item.label}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Textarea
          ref={textareaRef}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`What was the ${kind === "note" ? "note" : kind} about?`}
          rows={2}
          className="min-h-16 resize-none"
          aria-label="Interaction summary"
        />
        <div className="flex items-center gap-2">
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button variant={followUp ? "secondary" : "outline"} size="sm" aria-label="Set next follow-up">
                <CalendarClock />
                {followUp ? `Follow up ${followUpLabel(followUp).toLowerCase()}` : "Follow-up"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={followUp ? new Date(followUp) : undefined}
                onSelect={(selected) => {
                  setFollowUp(selected ? format(selected, "yyyy-MM-dd") : null);
                  setDateOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          {followUp && (
            <Button variant="ghost" size="icon-sm" onClick={() => setFollowUp(null)} aria-label="Clear follow-up">
              <X />
            </Button>
          )}
          {collapsible && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => {
                setOpen(false);
                setSummary("");
                setFollowUp(null);
              }}
            >
              Cancel
            </Button>
          )}
          <Button size="sm" className={cn(!collapsible && "ml-auto")} onClick={submit} disabled={!summary.trim() || mutations.isLogging}>
            <KindIcon /> Log {kind}
            <Kbd className="ml-1 hidden bg-primary-foreground/20 text-primary-foreground sm:inline-flex">⌘↵</Kbd>
          </Button>
        </div>
      </div>
    );
  },
);

/** One logged touchpoint. */
export function InteractionItem({
  interaction,
  onDelete,
}: {
  interaction: ClientInteraction;
  onDelete?: () => void;
}) {
  const Icon = interactionIcon(interaction.kind);
  return (
    <div className="group/item flex gap-3 py-2">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm whitespace-pre-wrap">{interaction.summary}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {INTERACTION_KINDS.find((item) => item.value === interaction.kind)?.label} · {interaction.createdByName} ·{" "}
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{relativeTime(interaction.occurredAt)}</span>
            </TooltipTrigger>
            <TooltipContent>{formatDate(interaction.occurredAt)}</TooltipContent>
          </Tooltip>
        </p>
      </div>
      {onDelete && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
          onClick={onDelete}
          aria-label="Delete interaction"
        >
          <Trash2 />
        </Button>
      )}
    </div>
  );
}

/** The client's logged interactions, newest first, with delete for the author or an admin. */
export function InteractionList({ clientId, limit }: { clientId: number; limit?: number }) {
  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);
  const mutations = useClientMutations();
  const { data, isLoading } = useListClientInteractions(clientId, {
    query: { queryKey: getListClientInteractionsQueryKey(clientId) },
  });
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  const items = limit ? (data ?? []).slice(0, limit) : (data ?? []);
  if (items.length === 0) {
    return (
      <Empty className="border-0 py-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarClock />
          </EmptyMedia>
          <EmptyDescription>No calls, emails or meetings logged yet.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="divide-y">
      {items.map((interaction) => (
        <InteractionItem
          key={interaction.id}
          interaction={interaction}
          onDelete={
            isAdmin || interaction.createdByUserId === user?.id
              ? () => mutations.deleteInteraction(clientId, interaction.id)
              : undefined
          }
        />
      ))}
    </div>
  );
}
