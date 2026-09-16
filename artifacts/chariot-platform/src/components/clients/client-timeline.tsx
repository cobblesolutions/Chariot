import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  getGetClientTimelineQueryKey,
  useGetClientTimeline,
  type ClientTimelineItem,
  type ClientTimelineItemKind,
} from "@workspace/api-client-react";
import { Activity, Briefcase, FileText, ListTodo, Mail, MessageSquareText, type LucideIcon } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { interactionIcon, relativeTime } from "./client-model";

const KIND_META: Record<ClientTimelineItemKind, { label: string; icon: LucideIcon; className: string }> = {
  interaction: { label: "Interactions", icon: MessageSquareText, className: "bg-primary/10 text-primary" },
  activity: { label: "Activity", icon: Activity, className: "bg-muted text-muted-foreground" },
  task: { label: "Tasks", icon: ListTodo, className: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  document: { label: "Documents", icon: FileText, className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  case: { label: "Cases", icon: Briefcase, className: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  email: { label: "Emails", icon: Mail, className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
};

const PAGE = 25;

const FILTERS: ClientTimelineItemKind[] = ["interaction", "activity", "task", "document", "case", "email"];

function dayLabel(iso: string) {
  const date = new Date(iso);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEE d MMM yyyy");
}

export function TimelineEntry({ item, compact = false }: { item: ClientTimelineItem; compact?: boolean }) {
  const meta = KIND_META[item.kind];
  const Icon = item.kind === "interaction" ? interactionIcon(item.interactionKind) : meta.icon;
  const body = (
    <>
      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", meta.className)}>
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{item.title}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground/80">
                {!compact && <span className="hidden sm:inline">{item.actorName} · </span>}
                {relativeTime(item.occurredAt)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {item.actorName} · {formatDate(item.occurredAt)} {format(new Date(item.occurredAt), "HH:mm")}
            </TooltipContent>
          </Tooltip>
        </span>
        {item.detail && (
          <span className={cn("block text-sm text-muted-foreground", compact ? "truncate" : "line-clamp-2")}>
            {item.detail}
          </span>
        )}
      </span>
    </>
  );
  const className = cn(
    "flex gap-3 rounded-md px-2 py-1.5 -mx-2",
    item.href && "hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none",
  );
  return item.href ? (
    <Link href={item.href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * Everything that happened on the relationship, newest first and grouped by
 * day. `limit` trims it for overview panels; `filterable` adds kind chips.
 */
export function ClientTimeline({
  clientId,
  limit,
  filterable = false,
  compact = false,
  className,
}: {
  clientId: number;
  limit?: number;
  filterable?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const { data, isLoading } = useGetClientTimeline(clientId, {
    query: { queryKey: getGetClientTimelineQueryKey(clientId) },
  });
  const [kind, setKind] = useState<ClientTimelineItemKind | "all">("all");
  const [shown, setShown] = useState(PAGE);

  const filtered = useMemo(() => {
    const items = kind === "all" ? (data ?? []) : (data ?? []).filter((item) => item.kind === kind);
    return limit ? items.slice(0, limit) : items;
  }, [data, kind, limit]);

  const groups = useMemo(() => {
    const items = filtered.slice(0, shown);
    const byDay = new Map<string, ClientTimelineItem[]>();
    for (const item of items) {
      const key = item.occurredAt.slice(0, 10);
      byDay.set(key, [...(byDay.get(key) ?? []), item]);
    }
    return [...byDay.entries()];
  }, [filtered, shown]);

  const available = useMemo(() => new Set((data ?? []).map((item) => item.kind)), [data]);

  if (isLoading) {
    return (
      <div className={cn("space-y-3", className)}>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {filterable && (
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Timeline</h3>
          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value as ClientTimelineItemKind | "all");
              setShown(PAGE);
            }}
          >
            <SelectTrigger size="sm" className="w-40 border-0 bg-transparent shadow-none" aria-label="Filter timeline">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">Everything</SelectItem>
              {FILTERS.filter((item) => available.has(item)).map((item) => (
                <SelectItem key={item} value={item}>
                  {KIND_META[item].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {groups.length === 0 ? (
        <Empty className="border-0 py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Activity />
            </EmptyMedia>
            <EmptyDescription>
              {kind !== "all" ? "Nothing of that kind yet." : "Nothing has happened on this client yet."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        groups.map(([day, items]) => (
          <section key={day} className="space-y-1">
            <h4 className="px-0 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
              {dayLabel(items[0].occurredAt)}
            </h4>
            {items.map((item) => (
              <TimelineEntry key={item.id} item={item} compact={compact} />
            ))}
          </section>
        ))
      )}
      {filtered.length > shown && (
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setShown((value) => value + PAGE)}>
          Show {Math.min(PAGE, filtered.length - shown)} more
        </Button>
      )}
    </div>
  );
}
