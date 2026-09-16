import { useMemo, type ReactNode } from "react";
import { Link } from "wouter";
import {
  useGetDashboard,
  useListTasks,
  useListInbox,
  useListCalendarEvents,
  getGetDashboardQueryKey,
  getListTasksQueryKey,
  getListInboxQueryKey,
  getListCalendarEventsQueryKey,
  type CalendarEvent,
  type Dashboard as DashboardData,
  type InboxThread,
  type Task,
} from "@workspace/api-client-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CountBubble } from "@/components/count-bubble";
import {
  DueLabel,
  PriorityFlag,
  StatusToggle,
} from "@/components/tasks/task-primitives";
import { useTaskMutations } from "@/components/tasks/use-task-mutations";
import {
  daysUntilDue,
  isOpen,
  priorityRank,
} from "@/components/tasks/task-model";
import { ThreadAvatar } from "@/components/chat/thread-list";
import {
  badgeUnread,
  byActivity,
  threadHref,
} from "@/components/chat/inbox-model";
import { formatRelativeStamp } from "@/components/chat/format";
import {
  Activity as ActivityIcon,
  ArrowRight,
  AtSign,
  Briefcase,
  CalendarDays,
  CheckSquare,
  Hourglass,
  Inbox,
  Layers,
  MessagesSquare,
  Paperclip,
  Plus,
} from "lucide-react";
import { cn, formatMoney } from "@/lib/utils";
import { CASE_STAGES, stageClasses } from "@/lib/stages";
import {
  dateKey,
  eventTypeMeta,
  formatTime,
  relativeDayLabel,
} from "@/lib/calendar";
import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";

/** Personal lists (tasks, inbox) refresh on this cadence; the sidebar badges share the same queries. */
const POLL_MS = 5000;
/** Pipeline totals and the schedule change slowly; poll them less often. */
const SLOW_POLL_MS = 30000;

/** How many rows each list shows before deferring to its full page. */
const TASK_LIMIT = 7;
const MESSAGE_LIMIT = 5;
const EVENT_LIMIT = 6;
const ACTIVITY_LIMIT = 6;
/** The schedule looks this many days ahead. */
const SCHEDULE_DAYS = 7;

const longDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** £8.4m / £925k / £4,200 — compact money for a stat tile. */
function compactMoney(amount: number) {
  if (amount >= 1_000_000)
    return `£${(amount / 1_000_000).toLocaleString("en-GB", { maximumFractionDigits: 1 })}m`;
  if (amount >= 10_000) return `£${Math.round(amount / 1000)}k`;
  return formatMoney(amount);
}

const plural = (n: number, word: string, pluralWord = `${word}s`) =>
  `${n} ${n === 1 ? word : pluralWord}`;

/* ---------- header ---------- */

function PageHeader({
  firstName,
  summary,
}: {
  firstName?: string;
  summary: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {longDate.format(new Date())}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-muted-foreground">{summary}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" asChild>
          <Link href="/calendar">
            <CalendarDays />
            Calendar
          </Link>
        </Button>
        <Button asChild>
          <Link href="/add">
            <Plus />
            Add
          </Link>
        </Button>
      </div>
    </div>
  );
}

/* ---------- stat tiles ---------- */

type Stat = {
  label: string;
  value: string | number;
  /** One line of context under the value; `attention` turns it red. */
  detail: string;
  attention?: boolean;
  href: string;
  icon: React.ElementType;
};

function StatTile({ stat }: { stat: Stat }) {
  return (
    <Link
      href={stat.href}
      className="group flex items-center gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <stat.icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-muted-foreground">
          {stat.label}
        </span>
        <span className="block text-2xl font-semibold tabular-nums tracking-tight">
          {stat.value}
        </span>
        <span
          className={cn(
            "block truncate text-xs",
            stat.attention
              ? "font-medium text-red-600 dark:text-red-400"
              : "text-muted-foreground",
          )}
        >
          {stat.detail}
        </span>
      </span>
      <ArrowRight
        className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}

/* ---------- pipeline ---------- */

function PipelineCard({ data }: { data: DashboardData }) {
  const counts = new Map(data.stageCounts.map((s) => [s.stage, s.count]));
  const stages = CASE_STAGES.map((stage) => ({
    stage,
    count: counts.get(stage) ?? 0,
  }));
  const total = stages.reduce((sum, s) => sum + s.count, 0);
  const inFlight = stages.filter((s) => s.count > 0);

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="size-5 text-primary" aria-hidden="true" />
          Pipeline
        </CardTitle>
        <CardDescription>
          {plural(total, "case")} in progress ·{" "}
          {formatMoney(data.pipelineValue)} in play ·{" "}
          {plural(data.completionsThisMonth, "completion")} this month
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/cases">
              All cases <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">
            No cases in progress. New cases appear here as they move through the
            pipeline.
          </p>
        ) : (
          <div
            role="img"
            aria-label={inFlight
              .map((s) => `${s.stage}: ${s.count}`)
              .join(", ")}
            className="flex h-3 w-full gap-0.5"
          >
            {inFlight.map((s) => (
              <Tooltip key={s.stage}>
                <TooltipTrigger asChild>
                  <Link
                    href="/cases"
                    aria-label={`${s.stage}: ${plural(s.count, "case")}`}
                    className={cn(
                      "block h-full min-w-1.5 rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      stageClasses(s.stage).bg,
                    )}
                    style={{ flexGrow: s.count }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {s.stage} · {plural(s.count, "case")}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {stages.map((s) => (
            <li key={s.stage}>
              <Link
                href="/cases"
                className={cn(
                  "inline-flex items-center gap-1.5 text-sm hover:underline underline-offset-4",
                  s.count === 0 && "text-muted-foreground/60",
                )}
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    s.count === 0
                      ? "bg-muted-foreground/30"
                      : stageClasses(s.stage).bg,
                  )}
                  aria-hidden="true"
                />
                {s.stage}
                <span className="font-semibold tabular-nums">{s.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/* ---------- shared card pieces ---------- */

function SectionCard({
  icon: Icon,
  title,
  description,
  count,
  href,
  linkLabel,
  footer,
  children,
  className,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  count?: number;
  href: string;
  linkLabel: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-5 text-primary" aria-hidden="true" />
          {title}
          {count != null && <CountBubble count={count} />}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link href={href}>
              {linkLabel} <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-3">{children}</CardContent>
      {footer && <CardFooter className="pt-0">{footer}</CardFooter>}
    </Card>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pt-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground first:pt-0">
      {children}
    </p>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <Empty className="py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** A "N more …" link under a capped list. */
function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button variant="link" size="sm" className="h-auto px-3" asChild>
      <Link href={href}>
        {children} <ArrowRight />
      </Link>
    </Button>
  );
}

/* ---------- tasks ---------- */

type TaskGroups = {
  overdue: Task[];
  today: Task[];
  upcoming: Task[];
  /** Every open task assigned to the user, for the "N more" count. */
  openCount: number;
};

function groupMyTasks(tasks: Task[] | undefined, userId?: number): TaskGroups {
  const mine = (tasks ?? [])
    .filter((t) => t.assignedUserId === userId && isOpen(t))
    .sort(
      (a, b) =>
        daysUntilDue(a) - daysUntilDue(b) ||
        priorityRank[a.priority] - priorityRank[b.priority],
    );
  return {
    overdue: mine.filter((t) => daysUntilDue(t) < 0),
    today: mine.filter((t) => daysUntilDue(t) === 0),
    upcoming: mine.filter((t) => daysUntilDue(t) > 0),
    openCount: mine.length,
  };
}

function TaskRow({
  task,
  onToggle,
}: {
  task: Task;
  onToggle: (task: Task) => void;
}) {
  const context = [task.caseReference, task.clientName]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-accent/50">
      <StatusToggle task={task} onToggle={() => onToggle(task)} />
      <Link
        href={`/tasks?task=${task.id}`}
        className="min-w-0 flex-1 focus-visible:outline-none focus-visible:underline"
      >
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{task.title}</span>
          <PriorityFlag priority={task.priority} className="shrink-0" />
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {context || "No case"}
          {task.checklistNext ? ` · Next: ${task.checklistNext}` : ""}
        </span>
      </Link>
      <DueLabel task={task} className="shrink-0" />
      {task.caseId && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="hidden shrink-0 text-muted-foreground sm:inline-flex"
          asChild
        >
          <Link href={`/cases/${task.caseId}`} aria-label="Open case">
            <ArrowRight />
          </Link>
        </Button>
      )}
    </li>
  );
}

function TasksCard({
  groups,
  onToggle,
}: {
  groups: TaskGroups;
  onToggle: (task: Task) => void;
}) {
  const due = [...groups.overdue, ...groups.today];
  // Fill the card with what is coming up when today is light, so it never
  // feels empty while there is still work on the list.
  const upcoming =
    due.length < TASK_LIMIT
      ? groups.upcoming.slice(0, Math.min(3, TASK_LIMIT - due.length))
      : [];
  const shown = due.slice(0, TASK_LIMIT);
  const hidden = groups.openCount - shown.length - upcoming.length;

  const sections: { label: string; tasks: Task[] }[] = [
    { label: "Overdue", tasks: shown.filter((t) => daysUntilDue(t) < 0) },
    { label: "Today", tasks: shown.filter((t) => daysUntilDue(t) === 0) },
    { label: "Coming up", tasks: upcoming },
  ].filter((s) => s.tasks.length > 0);

  return (
    <SectionCard
      icon={CheckSquare}
      title="Your tasks"
      description="Assigned to you, due today or overdue."
      count={due.length}
      href="/tasks"
      linkLabel="All tasks"
      footer={
        hidden > 0 ? (
          <MoreLink href="/tasks">{plural(hidden, "more open task")}</MoreLink>
        ) : undefined
      }
    >
      {sections.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="You're all clear"
          description="Nothing assigned to you is due. New tasks will land here."
        />
      ) : (
        sections.map((section) => (
          <div key={section.label}>
            <GroupLabel>{section.label}</GroupLabel>
            <ul className="flex flex-col">
              {section.tasks.map((task) => (
                <TaskRow key={task.id} task={task} onToggle={onToggle} />
              ))}
            </ul>
          </div>
        ))
      )}
    </SectionCard>
  );
}

/* ---------- messages ---------- */

function pickThreads(threads: InboxThread[] | undefined) {
  return (threads ?? [])
    .filter((t) => t.lastMessage && !t.archived)
    .sort((a, b) => {
      const aUnread = a.unreadCount > 0 && !a.muted;
      const bUnread = b.unreadCount > 0 && !b.muted;
      if (aUnread !== bUnread) return aUnread ? -1 : 1;
      return byActivity(a, b);
    })
    .slice(0, MESSAGE_LIMIT);
}

function ThreadRow({ thread }: { thread: InboxThread }) {
  const unread = thread.unreadCount > 0 && !thread.muted;
  const message = thread.lastMessage!;
  return (
    <li>
      <Link
        href={threadHref(thread)}
        className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ThreadAvatar
          kind={thread.kind}
          title={thread.title}
          linkedToCase={thread.caseId != null}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                "truncate text-sm",
                unread ? "font-semibold" : "font-medium",
              )}
            >
              {thread.title}
            </span>
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              {thread.subtitle}
            </span>
            <span
              className={cn(
                "ml-auto shrink-0 text-xs tabular-nums",
                unread ? "font-medium text-primary" : "text-muted-foreground",
              )}
            >
              {formatRelativeStamp(message.createdAt)}
            </span>
          </span>
          <span
            className={cn(
              "flex items-center gap-1 text-xs",
              unread ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {thread.mentionsMe && (
              <AtSign
                className="size-3 shrink-0 text-primary"
                aria-label="Mentions you"
              />
            )}
            {message.hasAttachment && !message.body && (
              <Paperclip className="size-3 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">
              {message.sender}: {message.body || "Attachment"}
            </span>
          </span>
        </span>
        {unread && <CountBubble count={thread.unreadCount} />}
      </Link>
    </li>
  );
}

function MessagesCard({
  threads,
  unread,
}: {
  threads: InboxThread[];
  unread: number;
}) {
  return (
    <SectionCard
      icon={MessagesSquare}
      title="Messages"
      description="Latest chats, unread first."
      count={unread}
      href="/messages"
      linkLabel="Inbox"
    >
      {threads.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No messages yet"
          description="Case chats and conversations with colleagues show up here."
        />
      ) : (
        <ul className="flex flex-col">
          {threads.map((thread) => (
            <ThreadRow key={thread.key} thread={thread} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ---------- schedule ---------- */

type ScheduleDay = { key: string; label: string; events: CalendarEvent[] };

function upcomingSchedule(events: CalendarEvent[] | undefined): {
  days: ScheduleDay[];
  todayCount: number;
  total: number;
} {
  const today = startOfDay(new Date());
  const end = addDays(today, SCHEDULE_DAYS);
  const inRange = (events ?? [])
    .filter((e) => {
      const at = new Date(e.eventDate);
      return !e.completed && at >= today && at < end;
    })
    .sort(
      (a, b) =>
        new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime(),
    );
  const days: ScheduleDay[] = [];
  for (const event of inRange.slice(0, EVENT_LIMIT)) {
    const at = new Date(event.eventDate);
    const key = dateKey(at);
    const day = days.find((d) => d.key === key);
    if (day) day.events.push(event);
    else days.push({ key, label: relativeDayLabel(at), events: [event] });
  }
  return {
    days,
    todayCount: inRange.filter(
      (e) => differenceInCalendarDays(new Date(e.eventDate), today) === 0,
    ).length,
    total: inRange.length,
  };
}

function EventRow({ event }: { event: CalendarEvent }) {
  const meta = eventTypeMeta(event.eventType);
  const context = [event.caseReference, event.clientName]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <Link
        href={`/calendar?event=${event.id}`}
        className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatTime(event.eventDate)}
        </span>
        <span
          className={cn("h-8 w-1 shrink-0 rounded-full", meta.dot)}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {event.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {meta.label}
            {context ? ` · ${context}` : ""}
          </span>
        </span>
      </Link>
    </li>
  );
}

function ScheduleCard({
  schedule,
}: {
  schedule: ReturnType<typeof upcomingSchedule>;
}) {
  const hidden =
    schedule.total - schedule.days.reduce((n, d) => n + d.events.length, 0);
  return (
    <SectionCard
      icon={CalendarDays}
      title="Schedule"
      description={`The next ${SCHEDULE_DAYS} days.`}
      href="/calendar"
      linkLabel="Calendar"
      footer={
        hidden > 0 ? (
          <MoreLink href="/calendar">
            {plural(hidden, "more event")} this week
          </MoreLink>
        ) : undefined
      }
    >
      {schedule.days.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Nothing scheduled"
          description="Valuations, completions and reminders for the week ahead appear here."
        />
      ) : (
        schedule.days.map((day) => (
          <div key={day.key}>
            <GroupLabel>{day.label}</GroupLabel>
            <ul className="flex flex-col">
              {day.events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
          </div>
        ))
      )}
    </SectionCard>
  );
}

/* ---------- activity ---------- */

function ActivityCard({
  activity,
}: {
  activity: DashboardData["recentActivity"];
}) {
  const items = activity.slice(0, ACTIVITY_LIMIT);
  return (
    <SectionCard
      icon={ActivityIcon}
      title="Activity"
      description="Latest changes, newest first."
      href="/activity"
      linkLabel="All activity"
    >
      {items.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="No recent activity"
          description="Changes to cases, clients and documents will be listed here."
        />
      ) : (
        <ol className="relative flex flex-col gap-1 before:absolute before:top-4 before:bottom-4 before:left-[15px] before:w-px before:bg-muted-foreground/20">
          {items.map((act) => (
            <li key={act.id} className="flex gap-3 px-2 py-1.5">
              <span
                className="relative mt-1.5 flex size-4 shrink-0 items-center justify-center"
                aria-hidden="true"
              >
                <span className="size-2 rounded-full bg-primary ring-4 ring-card" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium">
                    {act.title}
                  </span>
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatRelativeStamp(act.occurredAt)}
                  </span>
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {act.detail}
                </span>
                <span className="block truncate text-xs text-muted-foreground/70">
                  {act.actorName}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

/* ---------- page ---------- */

function DashboardSkeleton() {
  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-32" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-80" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-72" />
          <Skeleton className="h-96" />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading, error } = useGetDashboard({
    query: {
      queryKey: getGetDashboardQueryKey(),
      refetchInterval: SLOW_POLL_MS,
    },
  });
  const { data: tasks } = useListTasks({
    query: { queryKey: getListTasksQueryKey(), refetchInterval: POLL_MS },
  });
  const { data: inbox } = useListInbox({
    query: { queryKey: getListInboxQueryKey(), refetchInterval: POLL_MS },
  });
  const { data: events } = useListCalendarEvents({
    query: {
      queryKey: getListCalendarEventsQueryKey(),
      refetchInterval: SLOW_POLL_MS,
    },
  });
  const { toggleDone } = useTaskMutations();

  const groups = useMemo(
    () => groupMyTasks(tasks, user?.id),
    [tasks, user?.id],
  );
  const threads = useMemo(() => pickThreads(inbox), [inbox]);
  const unread = useMemo(() => badgeUnread(inbox ?? []), [inbox]);
  const mentions = useMemo(
    () => (inbox ?? []).filter((t) => t.mentionsMe && !t.muted).length,
    [inbox],
  );
  const schedule = useMemo(() => upcomingSchedule(events), [events]);

  if (isLoading) return <DashboardSkeleton />;

  if (error || !data) {
    return (
      <div className="p-6 md:p-8 max-w-page mx-auto">
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ActivityIcon />
            </EmptyMedia>
            <EmptyTitle>Couldn&apos;t load your overview</EmptyTitle>
            <EmptyDescription>Refresh the page to try again.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const dueCount = groups.overdue.length + groups.today.length;

  const summaryParts: ReactNode[] = [];
  if (groups.overdue.length > 0)
    summaryParts.push(
      <span
        key="overdue"
        className="font-medium text-red-600 dark:text-red-400"
      >
        {plural(groups.overdue.length, "task")} overdue
      </span>,
    );
  if (groups.today.length > 0)
    summaryParts.push(`${plural(groups.today.length, "task")} due today`);
  if (unread > 0) summaryParts.push(`${unread} unread`);
  if (schedule.todayCount > 0)
    summaryParts.push(`${plural(schedule.todayCount, "event")} today`);
  const summary =
    summaryParts.length > 0
      ? summaryParts.flatMap((part, i) => (i > 0 ? [" · ", part] : [part]))
      : "Nothing is waiting on you right now.";

  const stats: Stat[] = [
    {
      label: "Tasks due",
      value: dueCount,
      detail:
        groups.overdue.length > 0
          ? `${groups.overdue.length} overdue`
          : data.urgentTasks > 0
            ? `${plural(data.urgentTasks, "urgent task")} team-wide`
            : "Nothing overdue",
      attention: groups.overdue.length > 0 || data.urgentTasks > 0,
      href: "/tasks",
      icon: CheckSquare,
    },
    {
      label: "Unread messages",
      value: unread,
      detail:
        mentions > 0 ? `${plural(mentions, "mention")} of you` : "No mentions",
      attention: mentions > 0,
      href: "/messages",
      icon: MessagesSquare,
    },
    {
      label: "New enquiries",
      value: data.awaitingAcceptance,
      detail:
        data.awaitingAcceptance === 0
          ? "Nothing waiting to be accepted"
          : "Waiting to be accepted",
      attention: data.awaitingAcceptance > 0,
      href: "/add",
      icon: Inbox,
    },
    {
      label: "Awaiting client",
      value: data.awaitingClient,
      detail:
        data.awaitingClient === 0
          ? "No cases waiting on a client"
          : `${Math.round((data.awaitingClient / data.activeCases) * 100)}% of active cases`,
      href: "/cases",
      icon: Hourglass,
    },
    {
      label: "Active cases",
      value: data.activeCases,
      detail: `${compactMoney(data.pipelineValue)} in the pipeline`,
      href: "/cases",
      icon: Briefcase,
    },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <PageHeader
        firstName={user?.displayName?.split(" ")[0]}
        summary={summary}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map((stat) => (
          <StatTile key={stat.label} stat={stat} />
        ))}
      </div>

      <PipelineCard data={data} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <TasksCard groups={groups} onToggle={toggleDone} />
          <MessagesCard threads={threads} unread={unread} />
        </div>
        <div className="space-y-6">
          <ScheduleCard schedule={schedule} />
          <ActivityCard activity={data.recentActivity} />
        </div>
      </div>
    </div>
  );
}
