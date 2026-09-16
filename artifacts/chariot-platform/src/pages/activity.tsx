import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListActivities,
  getListActivitiesQueryKey,
  type ActivityListItem,
} from "@workspace/api-client-react";
import {
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isToday,
  isYesterday,
} from "date-fns";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  ArrowDownUp,
  Briefcase,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleOff,
  RotateCcw,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import {
  classifyNotification,
  notificationHref,
  NOTIFICATION_GROUPS,
  TONE_CLASSES,
  type NotificationGroup,
} from "@/lib/notification-kinds";

const PAGE_SIZE = 25;
type Filter = "all" | NotificationGroup;

function dayLabel(date: Date) {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  if (differenceInCalendarDays(new Date(), date) < 7) {
    return format(date, "EEEE");
  }
  return format(date, "EEEE d MMMM");
}

function relativeTime(date: Date) {
  if (differenceInCalendarDays(new Date(), date) >= 7) return formatDate(date);
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function ActivityItem({ act }: { act: ActivityListItem }) {
  const kind = classifyNotification(act.title);
  const tone = TONE_CLASSES[kind.tone];
  const Icon = kind.icon;
  const occurred = new Date(act.occurredAt);

  return (
    <Item
      size="sm"
      asChild
      className={cn(
        "rounded-none border-0 border-b border-l-2 flex-nowrap py-2 hover:bg-accent/50 last:border-b-0",
        "border-b-border/40",
        tone.accent,
      )}
    >
      <Link href={notificationHref(act)} data-testid={`activity-${act.id}`}>
        <ItemMedia variant="icon" className={cn("size-7", tone.tile)}>
          <Icon className="size-3.5" />
        </ItemMedia>
        <ItemTitle className="shrink-0 max-sm:min-w-0 max-sm:flex-1 max-sm:shrink max-sm:overflow-hidden">
          <span className="truncate">{act.title}</span>
        </ItemTitle>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground max-sm:hidden">
          {act.detail}
        </span>
        <ItemActions className="shrink-0 text-xs text-muted-foreground">
          <Badge variant="outline" className={cn("max-md:hidden", tone.chip)}>
            {kind.label}
          </Badge>
          {act.caseId && (
            <Badge variant="outline" className="max-sm:hidden">
              <Briefcase />
              {act.caseReference ?? `Case #${act.caseId}`}
            </Badge>
          )}
          <span className="flex w-28 items-center gap-1.5 truncate max-lg:hidden">
            <Avatar className="size-5">
              <AvatarFallback className="text-[10px]">
                {initials(act.actorName)}
              </AvatarFallback>
            </Avatar>
            {act.actorName}
          </span>
          <time
            dateTime={act.occurredAt}
            title={format(occurred, "EEEE d MMMM yyyy, HH:mm")}
            className="w-24 text-right tabular-nums max-sm:w-auto"
          >
            {relativeTime(occurred)}
          </time>
          <ChevronRight className="size-4" />
        </ItemActions>
      </Link>
    </Item>
  );
}

const DEFAULT_PRIORITY = NOTIFICATION_GROUPS.map((g) => g.value);

export default function ActivityPage() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>("all");
  const [priority, setPriority] =
    useState<NotificationGroup[]>(DEFAULT_PRIORITY);

  function movePriority(index: number, direction: -1 | 1) {
    setPriority((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  const { data, isLoading, error } = useListActivities(
    { page, pageSize: PAGE_SIZE },
    {
      query: {
        queryKey: getListActivitiesQueryKey({ page, pageSize: PAGE_SIZE }),
      },
    },
  );

  const items = data?.items ?? [];

  const sections = useMemo(() => {
    const visible =
      filter === "all"
        ? items
        : items.filter(
            (act) => classifyNotification(act.title).group === filter,
          );
    const byDay = new Map<string, ActivityListItem[]>();
    for (const act of visible) {
      const key = format(new Date(act.occurredAt), "yyyy-MM-dd");
      byDay.set(key, [...(byDay.get(key) ?? []), act]);
    }
    const rank = (act: ActivityListItem) => {
      const idx = priority.indexOf(classifyNotification(act.title).group);
      return idx === -1 ? priority.length : idx;
    };
    return [...byDay.entries()].map(([key, list]) => ({
      key,
      label: dayLabel(new Date(list[0]!.occurredAt)),
      items: [...list].sort((a, b) => rank(a) - rank(b)),
    }));
  }, [items, filter, priority]);

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;
  const filterLabel =
    NOTIFICATION_GROUPS.find((g) => g.value === filter)?.label.toLowerCase() ??
    "";

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <h1 className="text-3xl font-bold tracking-tight">Activity</h1>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          className="max-w-full overflow-x-auto"
        >
          <TabsList className="h-auto gap-1 p-1">
            <TabsTrigger value="all" className="px-3 py-1.5">
              <Activity /> All
            </TabsTrigger>
            {NOTIFICATION_GROUPS.map((group) => (
              <TabsTrigger
                key={group.value}
                value={group.value}
                className="px-3 py-1.5"
              >
                <group.icon /> {group.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <ArrowDownUp /> Priority
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <PopoverHeader>
              <div className="flex items-center justify-between gap-2">
                <PopoverTitle>Activity priority</PopoverTitle>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Reset to default order"
                  onClick={() => setPriority(DEFAULT_PRIORITY)}
                >
                  <RotateCcw />
                </Button>
              </div>
              <PopoverDescription>
                Rank activity types to control which show first within each
                day.
              </PopoverDescription>
            </PopoverHeader>
            <ul className="mt-3 space-y-1">
              {priority.map((value, index) => {
                const group = NOTIFICATION_GROUPS.find(
                  (g) => g.value === value,
                )!;
                return (
                  <li
                    key={value}
                    className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5"
                  >
                    <span className="w-4 text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <group.icon className="size-4 text-muted-foreground" />
                    <span className="flex-1 text-sm">{group.label}</span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      disabled={index === 0}
                      onClick={() => movePriority(index, -1)}
                      aria-label={`Move ${group.label} up`}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      disabled={index === priority.length - 1}
                      onClick={() => movePriority(index, 1)}
                      aria-label={`Move ${group.label} down`}
                    >
                      <ChevronDown />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      {isLoading ? (
        <div className="rounded-lg border bg-card">
          <ItemGroup>
            {Array.from({ length: 8 }).map((_, i) => (
              <Item
                key={i}
                size="sm"
                className="rounded-none border-b last:border-b-0"
              >
                <Skeleton className="size-7 rounded-sm" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
              </Item>
            ))}
          </ItemGroup>
        </div>
      ) : error || !data ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleOff />
            </EmptyMedia>
            <EmptyTitle>Couldn&apos;t load activity</EmptyTitle>
            <EmptyDescription>Please refresh to try again.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : sections.length === 0 ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Activity />
            </EmptyMedia>
            <EmptyTitle>
              {filter === "all" ? "No activity yet" : "Nothing here"}
            </EmptyTitle>
            <EmptyDescription>
              {filter === "all"
                ? "Activity will show up here as it happens."
                : `No ${filterLabel} activity on this page.`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          {sections.map((section) => (
            <section key={section.key}>
              <h2 className="border-b bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section.label}
              </h2>
              <ItemGroup>
                {section.items.map((act) => (
                  <ActivityItem key={act.id} act={act} />
                ))}
              </ItemGroup>
            </section>
          ))}
        </div>
      )}

      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {totalPages}
          </p>
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  aria-disabled={page <= 1}
                  className={
                    page <= 1 ? "pointer-events-none opacity-50" : undefined
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    setPage((p) => Math.max(1, p - 1));
                  }}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink
                  href="#"
                  isActive
                  onClick={(event) => event.preventDefault()}
                >
                  {page}
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  href="#"
                  aria-disabled={!data.hasMore}
                  className={
                    !data.hasMore ? "pointer-events-none opacity-50" : undefined
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    setPage((p) => p + 1);
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
