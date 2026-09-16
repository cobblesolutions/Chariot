import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListCases,
  getListCasesQueryKey,
  type Case,
} from "@workspace/api-client-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Empty,
  EmptyHeader,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Search,
  Plus,
  Flag,
  Archive,
  Briefcase,
  Check,
  CircleDot,
  Clock,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { StageBadge } from "@/components/stage-badge";
import { createColumnHelper } from "@tanstack/react-table";
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFeatures,
} from "@/components/data-table";
import CreateCaseDialog from "./create-case-dialog";

const columnHelper = createColumnHelper<DataTableFeatures, Case>();

// Status is shown as an icon only; the label lives in the tooltip. In-progress
// states are faint outlines, completed is a solid filled check so it stands out.
const PENDING_STATUS_ICONS: Record<string, { icon: typeof CircleDot; label: string }> = {
  active: { icon: CircleDot, label: "Active" },
  awaiting_client: { icon: Clock, label: "Awaiting client" },
};

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span
        className="inline-flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
        role="img"
        aria-label="Completed"
        title="Completed"
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  const { icon: Icon, label } = PENDING_STATUS_ICONS[status] ?? {
    icon: CircleDot,
    label: status.replace(/_/g, " "),
  };
  return (
    <Icon
      className="size-4 text-muted-foreground/60"
      aria-label={label}
      role="img"
    >
      <title>{label}</title>
    </Icon>
  );
}

const columns = columnHelper.columns([
  columnHelper.accessor("reference", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Reference" />
    ),
    sortFn: "alphanumeric",
  }),
  columnHelper.accessor("clientName", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Client" />
    ),
    sortFn: "text",
    cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
  }),
  columnHelper.accessor("propertyAddress", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Property" />
    ),
    sortFn: "text",
    meta: { cellClassName: "max-w-[200px] truncate" },
  }),
  columnHelper.accessor("matterType", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Type" />
    ),
    sortFn: "text",
    cell: ({ getValue }) => (
      <span className="capitalize">{getValue().replace("_", " ")}</span>
    ),
  }),
  // Sorts by pipeline position (stageIndex) rather than alphabetically by name.
  columnHelper.accessor("stageIndex", {
    id: "stage",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Stage" />
    ),
    sortFn: "basic",
    cell: ({ row }) => {
      const c = row.original;
      return (
        <div className="flex items-center gap-1.5">
          <StageBadge stage={c.stage} stageIndex={c.stageIndex} />
          {c.stageFlagged && (
            <Badge
              variant="destructive"
              className="gap-1"
              title={`On this stage for ${c.stageDays} days (flags after ${c.stageThresholdDays})`}
            >
              <Flag className="h-3 w-3" /> Stalled
            </Badge>
          )}
        </div>
      );
    },
  }),
  columnHelper.accessor("status", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    sortFn: "text",
    meta: { cellClassName: "w-px" },
    cell: ({ getValue }) => <StatusIcon status={getValue()} />,
  }),
  columnHelper.accessor("loanAmount", {
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Value"
        className="justify-end"
      />
    ),
    sortFn: "basic",
    meta: { cellClassName: "text-right font-medium" },
    cell: ({ getValue }) => formatMoney(getValue()),
  }),
]);

export default function CasesList() {
  const [, setLocation] = useLocation();
  const [showArchived, setShowArchived] = useState(false);
  const { data: cases, isLoading } = useListCases(
    showArchived ? { archived: true } : undefined,
    {
      query: {
        queryKey: getListCasesQueryKey(
          showArchived ? { archived: true } : undefined,
        ),
      },
    },
  );
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered =
    cases?.filter(
      (c) =>
        c.clientName.toLowerCase().includes(search.toLowerCase()) ||
        c.propertyAddress.toLowerCase().includes(search.toLowerCase()) ||
        c.reference.toLowerCase().includes(search.toLowerCase()),
    ) || [];

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto h-full flex flex-col">
      <div className="shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Cases</h1>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 shrink-0">
        <InputGroup className="w-full max-w-sm bg-card">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search reference, client or address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
        <Tabs
          value={showArchived ? "archived" : "active"}
          onValueChange={(v) => setShowArchived(v === "archived")}
        >
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="archived">
              <Archive /> Archived
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          className="w-full sm:w-auto sm:ml-auto"
          onClick={() => setCreateOpen(true)}
        >
          <Plus />
          New Case
        </Button>
      </div>

      <div className="flex-1 overflow-auto -mx-6 px-6 md:mx-0 md:px-0 pb-12">
        {isLoading ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyDescription>Loading pipeline...</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <DataTable
            columns={columns}
            data={filtered}
            initialSorting={[{ id: "stage", desc: false }]}
            emptyMessage={
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Briefcase />
                  </EmptyMedia>
                  <EmptyDescription>
                    No cases match your search.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            }
            onRowClick={(c) => setLocation(`/cases/${c.id}`)}
          />
        )}
      </div>
      <CreateCaseDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
