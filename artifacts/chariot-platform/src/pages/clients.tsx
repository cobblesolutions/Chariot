import { useState } from "react";
import { useLocation } from "wouter";
import { useListClients } from "@workspace/api-client-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Search, Plus, Building2, User as UserIcon, Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatDate } from "@/lib/utils";
import { createColumnHelper } from "@tanstack/react-table";
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFeatures,
} from "@/components/data-table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import CreateClientDialog from "./create-client-dialog";
import type { Client } from "@workspace/api-client-react";
import { LIFECYCLE_LABELS, isClosedLifecycle } from "@/lib/enquiry";
import {
  exportClientsCsv,
  followUpLabel,
  followUpTone,
  isFollowUpDue,
  relativeTime,
} from "@/components/clients/client-model";

type StageFilter = "all" | "open" | "enquiry" | "onboarding" | "active" | "followups" | "closed";

const STAGE_FILTERS: { value: StageFilter; label: string }[] = [
  { value: "all", label: "All stages" },
  { value: "open", label: "Open (not closed)" },
  { value: "enquiry", label: "Awaiting acceptance" },
  { value: "onboarding", label: "Advanced info" },
  { value: "active", label: "Active" },
  { value: "followups", label: "Follow-up due" },
  { value: "closed", label: "Declined / lost" },
];

const matchesStage = (client: Client, stage: StageFilter) => {
  switch (stage) {
    case "open":
      return !isClosedLifecycle(client.lifecycle);
    case "closed":
      return isClosedLifecycle(client.lifecycle);
    case "followups":
      return !isClosedLifecycle(client.lifecycle) && isFollowUpDue(client);
    case "all":
      return true;
    default:
      return client.lifecycle === stage;
  }
};

const columnHelper = createColumnHelper<DataTableFeatures, Client>();

const FOLLOW_UP_CLASS = {
  overdue: "text-destructive",
  today: "text-amber-700 dark:text-amber-400",
  soon: "text-foreground",
  later: "text-muted-foreground",
} as const;

const columns = columnHelper.columns([
  columnHelper.accessor("name", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Client" />
    ),
    sortFn: "text",
    cell: ({ row }) => {
      const client = row.original;
      return (
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback className="bg-primary/10 text-primary">
              {client.companyName ? (
                <Building2 className="size-4" />
              ) : (
                <UserIcon className="size-4" />
              )}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium text-foreground">{client.name}</div>
            {client.companyName && (
              <div className="text-xs text-muted-foreground">
                {client.companyName}
              </div>
            )}
          </div>
        </div>
      );
    },
  }),
  columnHelper.accessor("email", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Contact" />
    ),
    sortFn: "text",
    cell: ({ row }) => (
      <div>
        <div className="text-sm">{row.original.email}</div>
        <div className="text-xs text-muted-foreground">
          {row.original.phone}
        </div>
      </div>
    ),
  }),
  columnHelper.accessor((client) => client.assignee?.displayName ?? "", {
    id: "owner",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Owner" />
    ),
    sortFn: "text",
    cell: ({ getValue }) =>
      getValue() ? (
        <span>{getValue()}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  }),
  columnHelper.accessor("lifecycle", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Stage" />
    ),
    sortFn: "text",
    cell: ({ getValue, row }) => {
      const lifecycle = getValue();
      return (
        <Badge
          variant={
            isClosedLifecycle(lifecycle)
              ? "destructive"
              : lifecycle === "active"
                ? "default"
                : "outline"
          }
        >
          {LIFECYCLE_LABELS[lifecycle]}
          {row.original.stale ? " · waiting" : ""}
        </Badge>
      );
    },
  }),
  columnHelper.accessor("onboardingStatus", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Onboarding" />
    ),
    sortFn: "text",
    cell: ({ getValue }) => {
      const status = getValue();
      return (
        <Badge variant={status === "complete" ? "default" : "secondary"}>
          {status === "not_started"
            ? "Needs information"
            : status.replace("_", " ")}
        </Badge>
      );
    },
  }),
  columnHelper.accessor((client) => client.lastContactedAt ?? "", {
    id: "lastContact",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Last contact" />
    ),
    sortFn: "text",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">
        {getValue() ? relativeTime(getValue()) : "—"}
      </span>
    ),
  }),
  columnHelper.accessor((client) => client.nextFollowUpAt ?? "", {
    id: "followUp",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Follow-up" />
    ),
    sortFn: "text",
    cell: ({ row }) => {
      const tone = followUpTone(row.original);
      return tone ? (
        <span className={cn("text-sm", FOLLOW_UP_CLASS[tone])}>
          {followUpLabel(row.original.nextFollowUpAt)}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  }),
  columnHelper.accessor("createdAt", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Added" />
    ),
    sortFn: "datetime",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{formatDate(getValue())}</span>
    ),
  }),
]);

export default function ClientsList() {
  const { data: clients, isLoading } = useListClients();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [stage, setStage] = useState<StageFilter>("all");

  const needle = search.toLowerCase();
  const filtered =
    clients?.filter(
      (c) =>
        matchesStage(c, stage) &&
        (c.name.toLowerCase().includes(needle) ||
          c.email.toLowerCase().includes(needle) ||
          (c.companyName && c.companyName.toLowerCase().includes(needle)) ||
          (c.assignee?.displayName ?? "").toLowerCase().includes(needle)),
    ) || [];

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto flex flex-col h-full max-h-[100dvh]">
      <div className="shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Clients</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <InputGroup className="w-full max-w-sm bg-card">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search by name, email, company or owner..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
        <Select value={stage} onValueChange={(value) => setStage(value as StageFilter)}>
          <SelectTrigger className="w-48 bg-card" aria-label="Filter by stage">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGE_FILTERS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => exportClientsCsv(filtered)}
            disabled={filtered.length === 0}
          >
            <Download /> Export CSV
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            New Client
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          initialSorting={[{ id: "name", desc: false }]}
          emptyMessage={
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Users />
                </EmptyMedia>
                <EmptyDescription>No clients found.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          }
          onRowClick={(client) => setLocation(`/clients/${client.id}`)}
        />
      )}

      <CreateClientDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
