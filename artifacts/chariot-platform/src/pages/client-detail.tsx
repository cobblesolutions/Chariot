import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearch } from "wouter";
import {
  getGetClientQueryKey,
  getListDocumentsQueryKey,
  getListStaffQueryKey,
  useGetClient,
  useListDocuments,
  useListStaff,
  useListTasks,
  type ClientDetail as ClientDetailModel,
} from "@workspace/api-client-react";
import {
  ArrowRight,
  Building2,
  Check,
  Download,
  ListTodo,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  RotateCcw,
  User as UserIcon,
  Users,
  X,
} from "lucide-react";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BackButton } from "@/components/back-button";
import { StageBadge } from "@/components/stage-badge";
import { ClientProfile } from "@/components/client/client-profile";
import { useAuth } from "@/components/auth-provider";
import { useNavTitle } from "@/lib/nav-history";
import { isFullAccess } from "@/lib/roles";
import { enquiryTypeLabel, sourceLabel } from "@/lib/enquiry";
import { formatAddress } from "@/lib/address";
import CreateCaseDialog from "@/pages/create-case-dialog";
import { QuickAdd, type QuickAddHandle } from "@/components/tasks/quick-add";
import { TaskInspector } from "@/components/tasks/task-inspector";
import { TaskRow } from "@/components/tasks/task-row";
import { dueKey, priorityRank } from "@/components/tasks/task-model";
import { useTaskMutations } from "@/components/tasks/use-task-mutations";
import { AddPropertyDialog } from "@/components/clients/add-property-dialog";
import { ClientDocuments } from "@/components/clients/client-documents";
import { ClientNotes } from "@/components/clients/client-notes";
import { ClientTimeline } from "@/components/clients/client-timeline";
import { InteractionList, LogInteraction, type LogInteractionHandle } from "@/components/clients/interaction-log";
import { DeclineDialog, FollowUpButton, OwnerPicker } from "@/components/clients/client-primitives";
import { lifecycleBadgeVariant, lifecycleLabel, relativeTime } from "@/components/clients/client-model";
import { useClientMutations } from "@/components/clients/use-client-mutations";

type TabKey = "activity" | "interactions" | "tasks" | "documents" | "profile";
const TABS = new Set<string>(["activity", "interactions", "tasks", "documents", "profile"]);

const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

function exportPropertyPortfolio(client: ClientDetailModel) {
  const rows = [
    ["Address", "Matter Type", "Value (£)", "Loan Amount (£)", "Expected Rent (£/mo)", "GDV (£)"],
    ...(client.properties ?? []).map((property) => [
      formatAddress(property),
      property.matterType,
      property.value,
      property.loanAmount,
      property.rent,
      property.gdv,
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${client.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "client"}-property-portfolio.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 overflow-hidden" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex h-7 min-w-0 items-center truncate text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </>
  );
}

/** A quiet titled section inside a panel: small caps heading, optional count and action. */
function Panel({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex h-6 items-center gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
        {count !== undefined && count > 0 && <span className="text-xs tabular-nums text-muted-foreground/70">{count}</span>}
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}

export default function ClientDetail() {
  const params = useParams();
  const id = params.id ? parseInt(params.id, 10) : 0;
  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);
  const searchString = useSearch();

  const { data: client, isLoading } = useGetClient(id, {
    query: { enabled: !!id, queryKey: getGetClientQueryKey(id) },
  });
  const { data: staff } = useListStaff({ query: { queryKey: getListStaffQueryKey() } });
  const { data: documents } = useListDocuments(
    { clientId: id },
    { query: { enabled: !!id, queryKey: getListDocumentsQueryKey({ clientId: id }) } },
  );
  const { data: tasks } = useListTasks();
  const taskMutations = useTaskMutations();
  const mutations = useClientMutations();
  useNavTitle(`/clients/${id}`, client?.name);

  const [tab, setTab] = useState<TabKey>(() => {
    const value = new URLSearchParams(window.location.search).get("tab") ?? "";
    return TABS.has(value) ? (value as TabKey) : "activity";
  });
  useEffect(() => {
    const value = new URLSearchParams(searchString).get("tab") ?? "";
    if (TABS.has(value)) setTab(value as TabKey);
  }, [searchString]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === "activity") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState(window.history.state, "", url);
  }, [tab]);

  const [propertyOpen, setPropertyOpen] = useState(false);
  const [caseOpen, setCaseOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [showDoneTasks, setShowDoneTasks] = useState(false);
  const logRef = useRef<LogInteractionHandle>(null);
  const quickAddRef = useRef<QuickAddHandle>(null);

  const clientTasks = useMemo(() => {
    if (!client) return [];
    const caseIds = new Set(client.cases.map((item) => item.id));
    return (tasks ?? [])
      .filter((task) => task.clientId === client.id || (task.caseId != null && caseIds.has(task.caseId)))
      .sort(
        (a, b) =>
          Number(a.status === "done") - Number(b.status === "done") ||
          dueKey(a).localeCompare(dueKey(b)) ||
          priorityRank[a.priority] - priorityRank[b.priority] ||
          a.id - b.id,
      );
  }, [tasks, client]);
  const openTasks = clientTasks.filter((task) => task.status !== "done");
  const uploadedDocuments = (documents ?? []).filter((document) => document.uploadedAt).length;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-page space-y-6 p-6 md:p-8">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!client) {
    return (
      <div className="mx-auto max-w-page space-y-6 p-6 md:p-8">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>Client not found</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <BackButton variant="outline" size="default" fallback={{ href: "/clients", label: "Clients" }} />
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const closed = client.lifecycle === "declined" || client.lifecycle === "lost";
  const onboardingPct = client.onboarding.total
    ? Math.round((client.onboarding.completed / client.onboarding.total) * 100)
    : 0;
  const openCases = client.cases.filter((item) => item.status !== "completed" && !item.archivedAt);

  const nextStep =
    client.lifecycle === "enquiry" ? (
      <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-50/70 p-4 dark:bg-amber-500/10">
        <p className="text-sm font-medium">Awaiting a decision</p>
        <p className="text-xs text-muted-foreground">
          Received {relativeTime(client.enquiryReceivedAt)}
          {client.stale ? " · waiting more than 3 days" : ""}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => mutations.acceptClient(client)} disabled={mutations.isAccepting}>
            <Check /> Accept
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDeclineOpen(true)}>
            <X /> Decline
          </Button>
        </div>
        <Button size="xs" variant="ghost" className="-ml-2" asChild>
          <Link href={`/add/${client.id}`}>
            Review on Add page <ArrowRight />
          </Link>
        </Button>
      </div>
    ) : client.lifecycle === "onboarding" ? (
      <div className="space-y-2 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Advanced information</p>
          <span className="text-xs tabular-nums text-muted-foreground">
            {client.onboarding.completed}/{client.onboarding.total}
          </span>
        </div>
        <Progress value={onboardingPct} aria-label={`Onboarding ${onboardingPct}%`} />
        <p className="text-xs text-muted-foreground">
          {client.welcomeDelivery?.status === "failed"
            ? "Welcome email failed to send."
            : client.welcomeDelivery?.status === "sent"
              ? "Welcome email sent."
              : "Client · property · case details still to complete."}
        </p>
        <Button size="xs" variant="ghost" className="-ml-2" asChild>
          <Link href={`/add/${client.id}`}>
            Continue on Add page <ArrowRight />
          </Link>
        </Button>
      </div>
    ) : closed ? (
      <div className="space-y-2 rounded-xl border bg-card p-4">
        <p className="text-sm font-medium">
          {client.lifecycle === "declined" ? "Declined" : "Lost"}
          {client.closedAt ? ` · ${formatDate(client.closedAt)}` : ""}
        </p>
        {client.outcomeReason && <p className="text-xs text-muted-foreground">{client.outcomeReason}</p>}
        <Button size="sm" variant="outline" onClick={() => mutations.reopenClient(client)}>
          <RotateCcw /> Reopen
        </Button>
      </div>
    ) : null;

  return (
    <div className="flex flex-col pb-8 lg:h-[100dvh] lg:overflow-hidden lg:pb-0">
      {/* Hero band, like the case page: identity and actions on the brand colour,
          with the key numbers card overlapping its lower edge. */}
      <div
        className={cn(
          "shrink-0 bg-primary pt-4 pb-16 text-primary-foreground md:pt-6 md:pb-20",
          "[&_[data-variant=outline]]:border-white/30 [&_[data-variant=outline]]:bg-white/10 [&_[data-variant=outline]]:text-white [&_[data-variant=outline]]:shadow-none [&_[data-variant=outline]]:hover:bg-white/20 [&_[data-variant=outline]]:hover:text-white [&_[data-variant=outline]]:aria-expanded:bg-white/20 [&_[data-variant=outline]]:aria-expanded:text-white",
          "[&_[data-variant=default]]:bg-card [&_[data-variant=default]]:text-foreground [&_[data-variant=default]]:hover:bg-card/90 [&_[data-variant=default]]:hover:text-foreground",
        )}
      >
        <div className="mx-auto max-w-page px-6 md:px-8">
          <BackButton
            fallback={{ href: "/clients", label: "Clients" }}
            className="-ml-2 text-white/80 hover:bg-white/10 hover:text-white"
          />
          <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/15">
                {client.companyName ? <Building2 className="size-6" /> : <UserIcon className="size-6" />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-semibold tracking-tight">{client.name}</h1>
                  <Badge variant="outline" className="border-white/30 text-white">
                    {lifecycleLabel(client.lifecycle)}
                    {client.stale ? " · waiting" : ""}
                  </Badge>
                </div>
                <dl className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-white/85">
                  {client.companyName && (
                    <div className="flex items-center gap-1.5">
                      <Building2 className="size-3.5 text-white/60" />
                      <dd>{client.companyName}</dd>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Mail className="size-3.5 text-white/60" />
                    <dd>
                      <a href={`mailto:${client.email}`} className="decoration-white/40 underline-offset-4 hover:underline">
                        {client.email}
                      </a>
                    </dd>
                  </div>
                  {client.phone && (
                    <div className="flex items-center gap-1.5">
                      <Phone className="size-3.5 text-white/60" />
                      <dd>
                        <a href={`tel:${client.phone}`} className="decoration-white/40 underline-offset-4 hover:underline">
                          {client.phone}
                        </a>
                      </dd>
                    </div>
                  )}
                  {(client.source || client.introducerName) && (
                    <div className="flex items-center gap-1.5 text-white/60">
                      <dd>
                        {sourceLabel(client.source)}
                        {client.introducerName ? ` · ${client.introducerName}` : ""}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setTab("activity");
                  window.setTimeout(() => logRef.current?.focus(), 0);
                }}
              >
                <Phone /> Log interaction
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCaseOpen(true)}>
                <Plus /> Case
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportPropertyPortfolio(client)} disabled={!client.properties.length}>
                <Download /> Export properties
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="outline" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setPropertyOpen(true)}>
                    <Plus /> Add property
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`mailto:${client.email}`}>
                      <Mail /> Email client
                    </a>
                  </DropdownMenuItem>
                  {client.lifecycle !== "active" && (
                    <DropdownMenuItem asChild>
                      <Link href={`/add/${client.id}`}>
                        <ArrowRight /> {client.lifecycle === "enquiry" ? "Review enquiry" : "Open on Add page"}
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {closed ? (
                    <DropdownMenuItem onClick={() => mutations.reopenClient(client)}>
                      <RotateCcw /> Reopen client
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem variant="destructive" onClick={() => setDeclineOpen(true)}>
                      <X /> Decline / mark lost
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-page min-h-0 flex-1 flex-col gap-6 px-6 md:px-8 lg:pb-6">
        <Card className="relative -mt-10 shrink-0 py-4 md:-mt-12">
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 sm:grid-cols-3 lg:grid-cols-[1.5fr_1fr_0.8fr_1fr_1fr_0.8fr]">
            <Stat label="Owner" value={<OwnerPicker client={client} staff={staff ?? []} canEdit={isAdmin} className="-ml-2 h-7 w-full max-w-full border-0 bg-transparent px-2 text-sm font-semibold text-foreground shadow-none hover:bg-muted dark:bg-transparent dark:text-foreground [&>svg:first-child]:hidden [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]_span_span]:hidden" />} />
            <Stat label="Next follow-up" value={<FollowUpButton client={client} size="xs" className="-ml-2 h-7 border-0 px-2 text-sm font-semibold shadow-none hover:bg-muted" />} />
            <Stat label="Open cases" value={openCases.length} hint={`${client.cases.length} in total`} />
            <Stat label="Borrowing" value={formatMoney(client.loanTotal)} hint="Loan amounts across open cases" />
            <Stat
              label="Last contact"
              value={client.lastContactedAt ? relativeTime(client.lastContactedAt) : "—"}
              hint={client.lastContactedAt ? formatDate(client.lastContactedAt) : "No interaction logged"}
            />
            <Stat label="Open tasks" value={openTasks.length} />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[16rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_18rem]">
          {/* Left: what to do next, then the quiet facts. */}
          <aside className="space-y-6 lg:min-h-0 lg:overflow-y-auto">
            {nextStep}
            <Card className="gap-0 py-0">
              <CardContent className="space-y-5 px-5 py-5">
                <Panel title="Details">
                  <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1.5 text-sm">
                    {client.enquiryType && <DetailRow label="Looking for">{enquiryTypeLabel(client.enquiryType)}</DetailRow>}
                    {client.enquiryTimescale && <DetailRow label="Timescale">{client.enquiryTimescale}</DetailRow>}
                    <DetailRow label="Added">{formatDate(client.createdAt)}</DetailRow>
                    {client.acceptedAt && <DetailRow label="Accepted">{formatDate(client.acceptedAt)}</DetailRow>}
                    <DetailRow label="Onboarding">
                      {client.onboarding.status === "complete"
                        ? "Complete"
                        : `${client.onboarding.completed}/${client.onboarding.total} items`}
                    </DetailRow>
                    <DetailRow label="Properties">{client.properties.length}</DetailRow>
                  </dl>
                  {client.enquirySummary && (
                    <p className="mt-3 text-sm text-muted-foreground">{client.enquirySummary}</p>
                  )}
                </Panel>
                <Separator />
                <ClientNotes clientId={client.id} />
              </CardContent>
            </Card>
          </aside>

          {/* Centre: the feed. */}
          <main className="min-w-0 lg:min-h-0">
            <Card className="gap-0 py-0 lg:h-full lg:min-h-0 lg:overflow-hidden">
              <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)} className="min-h-0 flex-1 gap-0">
                <div className="shrink-0 px-6">
                  <TabsList variant="line" className="h-14 w-full justify-start gap-6 rounded-none border-b p-0">
                    {(
                      [
                        { value: "activity", label: "Activity" },
                        { value: "interactions", label: "Interactions" },
                        { value: "tasks", label: "Tasks", count: openTasks.length },
                        { value: "documents", label: "Documents", count: uploadedDocuments },
                        { value: "profile", label: "Profile" },
                      ] as { value: TabKey; label: string; count?: number }[]
                    ).map((item) => (
                      <TabsTrigger
                        key={item.value}
                        value={item.value}
                        className="h-full flex-none rounded-none px-1 text-[15px] font-semibold text-foreground/55 group-data-[orientation=horizontal]/tabs:after:-bottom-px after:h-[3px] after:rounded-full after:bg-primary data-[state=active]:text-primary"
                      >
                        {item.label}
                        {item.count ? (
                          <Badge variant="secondary" className="ml-1 px-1.5 tabular-nums">
                            {item.count}
                          </Badge>
                        ) : null}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
                <TabsContent value="activity" className="space-y-6 p-6">
                  <LogInteraction ref={logRef} client={client} collapsible />
                  <ClientTimeline clientId={client.id} filterable />
                </TabsContent>
                <TabsContent value="interactions" className="space-y-4 p-6">
                  <LogInteraction client={client} collapsible />
                  <InteractionList clientId={client.id} />
                </TabsContent>
                <TabsContent value="tasks" className="p-6">
                  <div className="space-y-3">
                    <QuickAdd
                      ref={quickAddRef}
                      staff={staff ?? []}
                      pending={taskMutations.isCreating}
                      onCreate={(input, reset) =>
                        taskMutations.createTask({ ...input, clientId: client.id }, { onSuccess: () => reset() })
                      }
                    />
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Tasks about this client and their cases.</p>
                      <Button variant="ghost" size="xs" onClick={() => setShowDoneTasks((value) => !value)}>
                        {showDoneTasks ? "Hide completed" : "Show completed"}
                      </Button>
                    </div>
                    {(showDoneTasks ? clientTasks : openTasks).length === 0 ? (
                      <Empty className="py-10">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <ListTodo />
                          </EmptyMedia>
                          <EmptyTitle>No open tasks</EmptyTitle>
                          <EmptyDescription>Add one above — it will be linked to this client.</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      <div className="-mx-2">
                        {(showDoneTasks ? clientTasks : openTasks).map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            active={activeTaskId === task.id}
                            showAssignee
                            readOnly={!isAdmin && task.assignedUserId !== user?.id}
                            onOpen={(item) => setActiveTaskId(item.id)}
                            onToggleDone={taskMutations.toggleDone}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="documents" className="p-6">
                  <ClientDocuments client={client} />
                </TabsContent>
                <TabsContent value="profile" className="p-6">
                  <ClientProfile client={client} />
                </TabsContent>
                </ScrollArea>
              </Tabs>
            </Card>
          </main>

          {/* Right: linked records, one quiet panel. */}
          <aside className="lg:col-span-2 lg:min-h-0 lg:overflow-y-auto xl:col-span-1">
            <Card className="gap-0 py-0">
              <CardContent className="space-y-5 px-5 py-5">
                <Panel
                  title="Cases"
                  count={client.cases.length}
                  action={
                    <Button size="xs" variant="ghost" onClick={() => setCaseOpen(true)}>
                      <Plus /> New
                    </Button>
                  }
                >
                  {client.cases.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No cases yet.</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {[...client.cases]
                        .sort((a, b) => Number(!!a.archivedAt || a.status === "completed") - Number(!!b.archivedAt || b.status === "completed"))
                        .map((item) => (
                          <li key={item.id}>
                            <Link
                              href={`/cases/${item.id}`}
                              className={cn(
                                "-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60",
                                (item.archivedAt || item.status === "completed") && "opacity-60",
                              )}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  <span className="truncate font-medium">{item.reference}</span>
                                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatMoney(item.loanAmount)}</span>
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {item.archivedAt ? "Archived · " : item.status === "completed" ? "Completed · " : `${item.stage} · `}
                                  {item.propertyAddress}
                                </span>
                              </span>
                            </Link>
                          </li>
                        ))}
                    </ul>
                  )}
                </Panel>
                <Separator />
                <Panel
                  title="Properties"
                  count={client.properties.length}
                  action={
                    <Button size="xs" variant="ghost" onClick={() => setPropertyOpen(true)}>
                      <Plus /> Add
                    </Button>
                  }
                >
                  {client.properties.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No properties in the portfolio.</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {client.properties.map((property) => (
                        <li key={property.id}>
                          <Link
                            href={`/properties/${property.id}`}
                            className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{formatAddress(property)}</span>
                              <span className="block text-xs text-muted-foreground capitalize">
                                {property.matterType.replace("_", " ")} · {formatMoney(property.value)}
                              </span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                {client.onboarding.status !== "complete" && (
                  <>
                    <Separator />
                    <Panel title="Onboarding" count={client.onboarding.total - client.onboarding.completed}>
                      <div className="space-y-2">
                        <Progress value={onboardingPct} aria-label={`Onboarding ${onboardingPct}%`} />
                        <p className="text-xs text-muted-foreground">
                          {client.onboarding.completed} of {client.onboarding.total} required items complete.
                        </p>
                        <Button size="xs" variant="ghost" className="-ml-2" onClick={() => setTab("profile")}>
                          Complete in profile <ArrowRight />
                        </Button>
                      </div>
                    </Panel>
                  </>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>

      <Sheet open={activeTaskId !== null} onOpenChange={(open) => !open && setActiveTaskId(null)}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-md" onOpenAutoFocus={(event) => event.preventDefault()}>
          <SheetHeader className="sr-only">
            <SheetTitle>Task details</SheetTitle>
            <SheetDescription>Edit the selected task.</SheetDescription>
          </SheetHeader>
          <TaskInspector
            taskId={activeTaskId}
            staff={staff ?? []}
            onClose={() => setActiveTaskId(null)}
            onDeleted={() => setActiveTaskId(null)}
            hideClose
          />
        </SheetContent>
      </Sheet>

      <AddPropertyDialog client={client} open={propertyOpen} onOpenChange={setPropertyOpen} />
      <CreateCaseDialog open={caseOpen} onOpenChange={setCaseOpen} fixedClientId={client.id} />
      <DeclineDialog client={client} open={declineOpen} onOpenChange={setDeclineOpen} />
    </div>
  );
}
