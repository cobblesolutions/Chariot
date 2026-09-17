import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  Flag,
  Plus,
  Search,
} from "lucide-react";
import { useListCases, useListClients, type Client, type Case } from "@workspace/api-client-react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { StageBadge } from "@/components/stage-badge";
import { cn } from "@/lib/utils";
import { LIFECYCLE_LABELS, enquiryTypeLabel, sourceLabel } from "@/lib/enquiry";

const ONBOARDING_LABEL: Record<string, string> = {
  not_started: "Onboarding not started",
  in_progress: "Onboarding in progress",
  complete: "Onboarding complete",
};

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString("en-GB");
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";

type Row = { client: Client; cases: Case[]; latest: string };
type Scope = "all" | "mine";

/**
 * The Add landing page: one toolbar (search, whose, and the two ways to
 * start), then the work itself grouped by step — enquiries waiting for a
 * decision, accepted clients still filling in advanced information (and their
 * cases at Submission details), and, folded away, the ones that were closed.
 */
export function AddDrafts({
  onNewClient,
  onExistingClient,
}: {
  onNewClient: () => void;
  onExistingClient: () => void;
}) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { data: clients, isLoading: clientsLoading } = useListClients();
  const { data: cases, isLoading: casesLoading } = useListCases();
  const [showClosed, setShowClosed] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");

  const groups = useMemo(() => {
    const openCases = (cases ?? []).filter(
      (item) => item.status === "active" && item.stageIndex <= 1,
    );
    const needle = query.trim().toLowerCase();
    const rows: Row[] = (clients ?? [])
      .filter((client) => scope === "all" || client.assignee?.id === user?.id)
      .filter(
        (client) =>
          !needle ||
          [client.name, client.email, client.companyName, client.enquirySummary ?? ""]
            .some((value) => value.toLowerCase().includes(needle)),
      )
      .map((client) => {
        const clientCases = openCases.filter((item) => item.clientId === client.id);
        const latest = [client.createdAt, client.enquiryReceivedAt, ...clientCases.map((item) => item.updatedAt)]
          .sort()
          .at(-1)!;
        return { client, cases: clientCases, latest };
      });
    const byLatest = (a: Row, b: Row) => b.latest.localeCompare(a.latest);
    return {
      awaiting: rows.filter(({ client }) => client.lifecycle === "enquiry").sort(byLatest),
      advanced: rows
        .filter(
          ({ client, cases: clientCases }) =>
            client.lifecycle === "onboarding" ||
            (client.lifecycle === "active" && (client.onboardingStatus !== "complete" || clientCases.length > 0)),
        )
        .sort(byLatest),
      closed: rows
        .filter(({ client }) => client.lifecycle === "declined" || client.lifecycle === "lost")
        .sort(byLatest),
    };
  }, [clients, cases, query, scope, user?.id]);

  const isLoading = clientsLoading || casesLoading;
  const filtering = query.trim().length > 0 || scope === "mine";
  const open = (client: Client, firstCase?: Case) =>
    navigate(`/add/${client.id}${firstCase ? `?case=${firstCase.id}` : ""}`);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Add</h1>

      {/* One line: search, whose enquiries, and the two ways to start. */}
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full bg-background sm:max-w-sm">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email, company or what they asked for"
            aria-label="Search in progress"
          />
        </InputGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          value={scope}
          onValueChange={(value) => value && setScope(value as Scope)}
          className="bg-background"
          aria-label="Show enquiries for"
        >
          <ToggleGroupItem
            value="all"
            className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground"
          >
            Everyone
          </ToggleGroupItem>
          <ToggleGroupItem
            value="mine"
            className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground"
          >
            Mine
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={onExistingClient}>
            <Search /> Existing client
          </Button>
          <Button onClick={onNewClient}>
            <Plus /> New enquiry
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          <Group
            id="add-awaiting"
            title="Awaiting acceptance"
            hint="Basic details are in. Accept to send the welcome email, or decline."
            count={groups.awaiting.length}
            empty={filtering ? "No enquiries match." : "No enquiries waiting. New ones land here."}
          >
            {groups.awaiting.map(({ client, latest }) => (
              <Row
                key={client.id}
                onClick={() => open(client)}
                latest={latest}
                client={client}
                secondary={client.enquirySummary ?? client.email}
              >
                {client.enquiryType ? (
                  <Badge variant="secondary">{enquiryTypeLabel(client.enquiryType)}</Badge>
                ) : null}
                {client.source ? <Badge variant="outline">{sourceLabel(client.source)}</Badge> : null}
                {client.stale ? (
                  <Badge variant="destructive">
                    <Flag /> Waiting
                  </Badge>
                ) : null}
              </Row>
            ))}
          </Group>

          <Group
            id="add-advanced"
            title="Advanced information"
            hint="Accepted. Client details, property and case still being completed."
            count={groups.advanced.length}
            empty={filtering ? "No clients match." : "Nothing here. Every accepted client is set up and every case has moved on."}
          >
            {groups.advanced.map(({ client, cases: clientCases, latest }) => (
              <Row
                key={client.id}
                onClick={() => open(client, clientCases[0])}
                latest={latest}
                client={client}
                secondary={client.email}
              >
                <Badge variant={client.onboardingStatus === "complete" ? "default" : "outline"}>
                  {ONBOARDING_LABEL[client.onboardingStatus] ?? client.onboardingStatus}
                </Badge>
                {clientCases.length === 0 ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    <Briefcase /> No case yet
                  </Badge>
                ) : (
                  clientCases.map((item) => (
                    <span key={item.id} className="flex items-center gap-1">
                      <Badge variant="secondary">{item.reference}</Badge>
                      <StageBadge stage={item.stage} stageIndex={item.stageIndex} />
                    </span>
                  ))
                )}
              </Row>
            ))}
          </Group>

          {groups.closed.length > 0 ? (
            <Collapsible open={showClosed} onOpenChange={setShowClosed} id="add-closed">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown
                    className={cn("size-3.5 transition-transform", !showClosed && "-rotate-90")}
                  />
                  Declined &amp; lost
                  <span className="font-normal">{groups.closed.length}</span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-3 divide-y overflow-hidden rounded-lg border bg-card">
                  {groups.closed.map(({ client, latest }) => (
                    <Row
                      key={client.id}
                      onClick={() => open(client)}
                      latest={latest}
                      client={client}
                      secondary={client.outcomeReason ?? client.email}
                      muted
                    >
                      <Badge variant="destructive">{LIFECYCLE_LABELS[client.lifecycle]}</Badge>
                    </Row>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </>
      )}
    </div>
  );
}

function Group({
  id,
  title,
  hint,
  count,
  empty,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
          <span className="font-normal">{count}</span>
        </h2>
        <p className="hidden text-xs text-muted-foreground sm:block">{hint}</p>
      </div>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">{children}</ul>
      )}
    </section>
  );
}

function Row({
  client,
  latest,
  secondary,
  onClick,
  muted,
  children,
}: {
  client: Client;
  latest: string;
  secondary: string;
  onClick: () => void;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50",
          muted && "opacity-70",
        )}
      >
        <Avatar>
          <AvatarFallback>{initials(client.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {client.name}
            {client.companyName ? (
              <span className="font-normal text-muted-foreground"> · {client.companyName}</span>
            ) : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">{secondary}</p>
        </div>
        <div className="hidden shrink-0 flex-wrap items-center justify-end gap-1.5 md:flex">{children}</div>
        <div className="hidden w-36 shrink-0 items-center justify-end gap-2 text-xs text-muted-foreground lg:flex">
          {client.assignee ? (
            <Avatar size="sm" title={client.assignee.displayName}>
              <AvatarFallback className="text-[10px]">{initials(client.assignee.displayName)}</AvatarFallback>
            </Avatar>
          ) : null}
          <span className="tabular-nums">{relativeTime(latest)}</span>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}
