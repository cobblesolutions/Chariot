import { useEffect, useMemo, useRef, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFeatures,
} from "@/components/data-table";
import { Link, useLocation, useSearch } from "wouter";
import {
  useListProperties,
  useDeleteProperty,
  getListPropertiesQueryKey,
  useListClients,
  type PropertyListItem,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyDescription,
} from "@/components/ui/empty";
import { Building2, Plus, Trash2, Pencil, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { StageBadge } from "@/components/stage-badge";
import PropertyDialog from "./property-dialog";
import { formatAddress } from "@/lib/address";

const columnHelper = createColumnHelper<DataTableFeatures, PropertyListItem>();

export default function PropertiesList() {
  const { data: properties, isLoading } = useListProperties();
  const { data: clients } = useListClients();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const highlightId = new URLSearchParams(search).get("highlight");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const deleteProperty = useDeleteProperty();

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<PropertyListItem | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const openCreate = () => {
    setEditing(null);
    setIsOpen(true);
  };
  const openEdit = (p: PropertyListItem) => {
    setEditing(p);
    setIsOpen(true);
  };
  const handleDelete = (id: number) => setPendingId(id);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor((p) => formatAddress(p), {
          id: "address",
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Address" />
          ),
          sortFn: "text",
          meta: { cellClassName: "font-medium max-w-[280px] truncate" },
        }),
        columnHelper.accessor(
          (p) =>
            p.clientName ||
            clients?.find((c) => c.id === p.clientId)?.name ||
            `Client #${p.clientId}`,
          {
            id: "client",
            header: ({ column }) => (
              <DataTableColumnHeader column={column} title="Client" />
            ),
            sortFn: "text",
            meta: {
              cellClassName: "text-muted-foreground max-w-[200px] truncate",
            },
          },
        ),
        columnHelper.accessor("matterType", {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Matter Type" />
          ),
          sortFn: "text",
          cell: ({ getValue }) => (
            <span className="capitalize">{getValue().replace(/_/g, " ")}</span>
          ),
        }),
        columnHelper.accessor("value", {
          header: ({ column }) => (
            <DataTableColumnHeader
              column={column}
              title="Value"
              className="justify-end"
            />
          ),
          sortFn: "basic",
          meta: {
            headerClassName: "text-right",
            cellClassName:
              "text-right font-medium tabular-nums whitespace-nowrap",
          },
          cell: ({ getValue }) => `£${getValue().toLocaleString()}`,
        }),
        columnHelper.accessor("loanAmount", {
          header: ({ column }) => (
            <DataTableColumnHeader
              column={column}
              title="Loan Amount"
              className="justify-end"
            />
          ),
          sortFn: "basic",
          meta: {
            headerClassName: "text-right",
            cellClassName:
              "text-right font-medium tabular-nums whitespace-nowrap",
          },
          cell: ({ getValue }) => `£${getValue().toLocaleString()}`,
        }),
        columnHelper.accessor((p) => p.activeCases[0]?.reference ?? "", {
          id: "activeCase",
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Active Case" />
          ),
          sortFn: "alphanumeric",
          meta: { cellClassName: "whitespace-nowrap" },
          cell: ({ row }) => {
            const [first, ...rest] = row.original.activeCases;
            if (!first) {
              return <span className="text-muted-foreground/70">—</span>;
            }
            return (
              <div className="flex items-center gap-2">
                <Link
                  href={`/cases/${first.id}`}
                  className="font-medium hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {first.reference}
                </Link>
                {rest.length > 0 && (
                  <span
                    className="text-muted-foreground text-xs"
                    title={rest.map((c) => c.reference).join(", ")}
                  >
                    +{rest.length} more
                  </span>
                )}
              </div>
            );
          },
        }),
        columnHelper.accessor((p) => p.activeCases[0]?.stage ?? "", {
          id: "stage",
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Stage" />
          ),
          sortFn: "text",
          meta: { cellClassName: "whitespace-nowrap" },
          cell: ({ row }) => {
            const first = row.original.activeCases[0];
            return first ? (
              <StageBadge stage={first.stage} />
            ) : (
              <span className="text-muted-foreground/70">—</span>
            );
          },
        }),
        columnHelper.display({
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          meta: { headerClassName: "w-12", cellClassName: "w-12 text-right" },
          cell: ({ row }) => {
            const p = row.original;
            return (
              <div onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Actions">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(p)}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => handleDelete(p.id)}
                    >
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          },
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients],
  );

  const confirmHandleDelete = (id: number) => {
    deleteProperty.mutate(
      { id },
      {
        onSuccess: () => {
          toast.add({ title: "Property deleted", type: "success" });
          qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
        },
      },
    );
  };

  useEffect(() => {
    if (!highlightId || !properties) return;
    const el = rowRefs.current[highlightId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlighted(highlightId);
      const timeout = setTimeout(() => setHighlighted(null), 2000);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [highlightId, properties]);

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <div className="flex justify-between items-start md:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Properties</h1>
          <p className="text-muted-foreground mt-1">
            Global view of all properties.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus /> Add Property
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={properties ?? []}
        initialSorting={[{ id: "address", desc: false }]}
        onRowClick={(p) => setLocation(`/properties/${p.id}`)}
        isRowSelected={(p) => highlighted === p.id.toString()}
        rowProps={(row) => ({
          ref: (el: HTMLTableRowElement | null) => {
            rowRefs.current[row.original.id.toString()] = el;
          },
        })}
        emptyMessage={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Building2 />
              </EmptyMedia>
              <EmptyDescription>No properties found.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />

      <PropertyDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        property={editing}
      />
      <ConfirmDialog
        open={pendingId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingId(null);
        }}
        title="Delete this property?"
        description="Active cases linked to it might break."
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingId !== null) confirmHandleDelete(pendingId);
          setPendingId(null);
        }}
      />
    </div>
  );
}
