import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import {
  useGetProperty,
  useDeleteProperty,
  useListTasks,
  useListStaff,
  useListDocuments,
  useListActivities,
  useListPropertyValuations,
  useCreatePropertyValuation,
  getGetPropertyQueryKey,
  getListPropertiesQueryKey,
  getListDocumentsQueryKey,
  getListActivitiesQueryKey,
  getListPropertyValuationsQueryKey,
  getListStaffQueryKey,
  type Case,
  type Property,
  type ActivityListItem,
} from "@workspace/api-client-react";
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFeatures,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import { useNavTitle } from "@/lib/nav-history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CommaInput } from "@/components/ui/comma-input";
import { DatePicker } from "@/components/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StageBadge } from "@/components/stage-badge";
import { toast } from "@/components/ui/toast";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { formatAddress } from "@/lib/address";
import { DocumentFile } from "@/components/document-file";
import { QuickAdd, type QuickAddHandle } from "@/components/tasks/quick-add";
import { TaskInspector } from "@/components/tasks/task-inspector";
import { TaskRow } from "@/components/tasks/task-row";
import { dueKey, priorityRank } from "@/components/tasks/task-model";
import { useTaskMutations } from "@/components/tasks/use-task-mutations";
import { classifyNotification, notificationHref, TONE_CLASSES } from "@/lib/notification-kinds";
import {
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isToday,
  isYesterday,
} from "date-fns";
import {
  Activity,
  Banknote,
  Building2,
  CreditCard,
  FileText,
  FolderOpen,
  ListTodo,
  Pencil,
  Plus,
  Trash2,
  User,
} from "lucide-react";
import PropertyDialog from "./property-dialog";
import CreateCaseDialog from "./create-case-dialog";

const columnHelper = createColumnHelper<DataTableFeatures, Case>();

const caseColumns = columnHelper.columns([
  columnHelper.accessor("reference", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Reference" />
    ),
    sortFn: "alphanumeric",
    meta: { cellClassName: "font-medium whitespace-nowrap" },
  }),
  columnHelper.accessor("serviceType", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Service" />
    ),
    sortFn: "text",
    cell: ({ getValue }) => (
      <span className="capitalize">{getValue().replace(/_/g, " ")}</span>
    ),
  }),
  columnHelper.accessor("stageIndex", {
    id: "stage",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Stage" />
    ),
    sortFn: "basic",
    meta: { cellClassName: "whitespace-nowrap" },
    cell: ({ row }) => (
      <StageBadge
        stage={row.original.stage}
        stageIndex={row.original.stageIndex}
      />
    ),
  }),
  columnHelper.accessor("status", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    sortFn: "text",
    cell: ({ row }) => {
      const c = row.original;
      return (
        <Badge
          variant={
            c.archivedAt
              ? "destructive"
              : c.status === "completed"
                ? "default"
                : "secondary"
          }
          className="capitalize"
        >
          {c.archivedAt ? "Archived" : c.status.replace(/_/g, " ")}
        </Badge>
      );
    },
  }),
  columnHelper.accessor("lenderName", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Lender" />
    ),
    sortFn: "text",
    meta: { cellClassName: "text-muted-foreground" },
    cell: ({ getValue }) => getValue() ?? "—",
  }),
  columnHelper.accessor("loanAmount", {
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Loan"
        className="justify-end"
      />
    ),
    sortFn: "basic",
    meta: {
      headerClassName: "text-right",
      cellClassName: "text-right font-medium tabular-nums whitespace-nowrap",
    },
    cell: ({ getValue }) => formatMoney(getValue()),
  }),
  columnHelper.accessor("updatedAt", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Updated" />
    ),
    sortFn: "datetime",
    meta: { cellClassName: "text-muted-foreground whitespace-nowrap" },
    cell: ({ getValue }) => formatDate(getValue()),
  }),
]);

/** Label / value row for the summary cards. Hidden when the value is empty. */
function Fact({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode | null | undefined;
}) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between gap-4 py-2 border-b last:border-b-0 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

const OCCUPANCY_TENANTED = new Set(["tenanted", "let", "let out", "rented"]);
const OCCUPANCY_VACANT = new Set(["vacant", "empty"]);
const occupancyLabel = (occupancy: string | null | undefined) => {
  if (!occupancy) return null;
  const key = occupancy.toLowerCase();
  if (OCCUPANCY_TENANTED.has(key)) return "Tenanted";
  if (OCCUPANCY_VACANT.has(key)) return "Vacant";
  if (key === "owner_occupied") return "Owner-occupied";
  return occupancy.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
};

const categoryLabel = (category: string) =>
  category
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

function relativeTime(date: Date) {
  if (differenceInCalendarDays(new Date(), date) >= 7) return formatDate(date);
  return formatDistanceToNowStrict(date, { addSuffix: true });
}
function dayLabel(iso: string) {
  const date = new Date(iso);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEE d MMM yyyy");
}

function ActivityRow({ act }: { act: ActivityListItem }) {
  const kind = classifyNotification(act.title);
  const tone = TONE_CLASSES[kind.tone];
  const Icon = kind.icon;
  const occurred = new Date(act.occurredAt);
  return (
    <Link
      href={notificationHref(act)}
      className="-mx-2 flex items-start gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60"
    >
      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border", tone.tile)}>
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{act.title}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground/80">{relativeTime(occurred)}</span>
        </span>
        {act.detail && (
          <span className="block truncate text-sm text-muted-foreground">{act.detail}</span>
        )}
        <span className="block text-xs text-muted-foreground/70">
          {act.actorName}
          {act.caseReference ? ` · ${act.caseReference}` : ""}
        </span>
      </span>
    </Link>
  );
}

/** Everything logged against this property directly, or against one of its cases. */
function PropertyActivity({ propertyId }: { propertyId: number }) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ActivityListItem[]>([]);
  // A record's own timeline keeps the routine rows the activity page hides.
  const params = { propertyId, page, pageSize: 25, includeRoutine: true };
  const { data, isLoading } = useListActivities(params, {
    query: { queryKey: getListActivitiesQueryKey(params) },
  });
  useEffect(() => {
    if (!data) return;
    setItems((prev) => (page === 1 ? data.items : [...prev, ...data.items]));
  }, [data, page]);

  const groups = useMemo(() => {
    const byDay = new Map<string, ActivityListItem[]>();
    for (const item of items) {
      const key = item.occurredAt.slice(0, 10);
      byDay.set(key, [...(byDay.get(key) ?? []), item]);
    }
    return [...byDay.entries()];
  }, [items]);

  if (isLoading && page === 1) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing has happened on this property yet.</p>;
  }
  return (
    <div className="space-y-4">
      {groups.map(([day, dayItems]) => (
        <section key={day} className="space-y-1">
          <h4 className="px-0 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
            {dayLabel(dayItems[0]!.occurredAt)}
          </h4>
          {dayItems.map((item) => (
            <ActivityRow key={item.id} act={item} />
          ))}
        </section>
      ))}
      {data?.hasMore && (
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setPage((p) => p + 1)}>
          Show more
        </Button>
      )}
    </div>
  );
}

/** Read-only: documents belong to the property's cases and client, not the property directly. */
function PropertyDocuments({ propertyId }: { propertyId: number }) {
  const { data, isLoading } = useListDocuments(
    { propertyId },
    { query: { queryKey: getListDocumentsQueryKey({ propertyId }) } },
  );
  const documents = data ?? [];

  if (isLoading) return <Skeleton className="h-12 w-full" />;
  if (documents.length === 0) {
    return <p className="text-sm text-muted-foreground">No documents on this property&apos;s cases yet.</p>;
  }
  return (
    <div className="-mx-2 space-y-0.5">
      {documents.map((document) => (
        <div key={document.id} className="flex items-center gap-2">
          <DocumentFile
            id={document.id}
            name={document.name}
            byteSize={document.byteSize}
            className="min-w-0 flex-1"
          />
          <span className="hidden w-44 shrink-0 truncate text-xs text-muted-foreground sm:block">
            {categoryLabel(document.category)}
            {document.uploadedAt ? ` · ${formatDate(document.uploadedAt)}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function RecordValuationDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const createValuation = useCreatePropertyValuation();
  const [amount, setAmount] = useState("");
  const [valuedAt, setValuedAt] = useState("");
  const [source, setSource] = useState("manual");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setValuedAt(new Date().toISOString().slice(0, 10));
    setSource("manual");
    setNotes("");
  }, [open]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    createValuation.mutate(
      {
        id: propertyId,
        data: {
          amount: parseFloat(amount.replace(/,/g, "")),
          valuedAt,
          source,
          notes: notes.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.add({ title: "Valuation recorded", type: "success" });
          onOpenChange(false);
          qc.invalidateQueries({ queryKey: getListPropertyValuationsQueryKey(propertyId) });
          qc.invalidateQueries({ queryKey: getGetPropertyQueryKey(propertyId) });
          qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
        },
        onError: () => toast.add({ title: "Could not record valuation", type: "error" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a valuation</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="pt-4">
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel>Amount (£)</FieldLabel>
                <CommaInput value={amount} onChange={setAmount} required />
              </Field>
              <Field>
                <FieldLabel>Date</FieldLabel>
                <DatePicker value={valuedAt} onChange={setValuedAt} />
              </Field>
            </div>
            <Field>
              <FieldLabel>Source</FieldLabel>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="estimate">Estimate</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Notes</FieldLabel>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={createValuation.isPending || !amount}>
                {createValuation.isPending ? "Saving..." : "Record valuation"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PropertyValuations({ property }: { property: Property }) {
  const { data: valuations, isLoading } = useListPropertyValuations(property.id, {
    query: { queryKey: getListPropertyValuationsQueryKey(property.id) },
  });
  const [isRecordOpen, setIsRecordOpen] = useState(false);

  return (
    <div className="space-y-3">
      {isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : !valuations?.length ? (
        <p className="text-sm text-muted-foreground">
          No valuations recorded.
        </p>
      ) : (
        <div className="-mx-2 space-y-0.5">
          {valuations.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-sm">
              <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{formatDate(v.valuedAt)}</span>
              <span className="w-28 shrink-0 font-medium tabular-nums">{formatMoney(v.amount)}</span>
              <Badge variant="outline" className="capitalize">
                {v.source.replace(/_/g, " ")}
              </Badge>
              {v.caseId && v.caseReference && (
                <Link href={`/cases/${v.caseId}`} className="text-xs text-muted-foreground hover:underline">
                  {v.caseReference}
                </Link>
              )}
              {v.notes && (
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{v.notes}</span>
              )}
              <span className="ml-auto shrink-0 text-xs text-muted-foreground/70">
                {v.recordedByName ?? "System"}
              </span>
            </div>
          ))}
        </div>
      )}
      <Button size="sm" variant="outline" onClick={() => setIsRecordOpen(true)}>
        <Plus /> Record valuation
      </Button>
      <RecordValuationDialog propertyId={property.id} open={isRecordOpen} onOpenChange={setIsRecordOpen} />
    </div>
  );
}

export default function PropertyDetail() {
  const [, params] = useRoute("/properties/:id");
  const id = parseInt(params?.id || "0");
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: property, isLoading } = useGetProperty(id, {
    query: { enabled: !!id, queryKey: getGetPropertyQueryKey(id) },
  });
  useNavTitle(`/properties/${id}`, property ? formatAddress(property) : undefined);
  const deleteProperty = useDeleteProperty();
  const { data: staff } = useListStaff({ query: { queryKey: getListStaffQueryKey() } });
  const { data: tasks } = useListTasks();
  const taskMutations = useTaskMutations();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCaseOpen, setIsCaseOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [showDoneTasks, setShowDoneTasks] = useState(false);
  const quickAddRef = useRef<QuickAddHandle>(null);

  const cases = useMemo(() => property?.cases ?? [], [property]);
  const activeCases = cases.filter(
    (c) => !c.archivedAt && c.status !== "completed",
  );
  const caseIds = useMemo(() => new Set(cases.map((c) => c.id)), [cases]);

  const propertyTasks = useMemo(() => {
    if (!property) return [];
    return (tasks ?? [])
      .filter((task) => task.propertyId === property.id || (task.caseId != null && caseIds.has(task.caseId)))
      .sort(
        (a, b) =>
          Number(a.status === "done") - Number(b.status === "done") ||
          dueKey(a).localeCompare(dueKey(b)) ||
          priorityRank[a.priority] - priorityRank[b.priority] ||
          a.id - b.id,
      );
  }, [tasks, property, caseIds]);
  const openTasks = propertyTasks.filter((task) => task.status !== "done");

  if (isLoading)
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!property)
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2 />
            </EmptyMedia>
            <EmptyTitle>Property not found</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <BackButton
              variant="outline"
              size="default"
              fallback={{ href: "/properties", label: "Properties" }}
            />
          </EmptyContent>
        </Empty>
      </div>
    );

  const ltv =
    property.value > 0
      ? `${Math.round((property.loanAmount / property.value) * 100)}%`
      : null;

  const confirmDelete = () => {
    deleteProperty.mutate(
      { id },
      {
        onSuccess: () => {
          toast.add({ title: "Property deleted", type: "success" });
          qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
          setLocation("/properties");
        },
        onError: (err: any) => {
          toast.add({
            title: "Delete failed",
            description:
              err.status === 409
                ? "This property is referenced by a case."
                : undefined,
            type: "error",
          });
        },
      },
    );
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <div>
        <BackButton
          className="mb-4 -ml-3"
          fallback={{ href: "/properties", label: "Properties" }}
        />
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">
                {formatAddress(property)}
              </h1>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {property.clientId ? (
                  <Link
                    href={`/clients/${property.clientId}`}
                    className="flex items-center gap-1.5 font-medium text-foreground hover:underline"
                  >
                    <User className="h-4 w-4 text-muted-foreground/70" />
                    {property.clientName ?? `Client #${property.clientId}`}
                  </Link>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <User className="h-4 w-4 text-muted-foreground/70" /> No
                    client
                  </span>
                )}
                <span className="flex items-center gap-1.5 capitalize">
                  <FolderOpen className="h-4 w-4 text-muted-foreground/70" />
                  {property.matterType.replace(/_/g, " ")}
                </span>
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <CreditCard className="h-4 w-4 text-muted-foreground/70" />
                  {formatMoney(property.loanAmount)}
                  {ltv && (
                    <span className="text-muted-foreground font-normal">
                      ({ltv} LTV)
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" onClick={() => setIsEditOpen(true)}>
              <Pencil /> Edit
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setIsDeleteOpen(true)}
              disabled={cases.length > 0}
              title={
                cases.length > 0
                  ? "Cannot delete a property with cases"
                  : undefined
              }
            >
              <Trash2 /> Delete
            </Button>
            <Button onClick={() => setIsCaseOpen(true)}>
              <Plus /> New Case
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Finance</CardTitle>
          </CardHeader>
          <CardContent>
            <Fact label="Value" value={formatMoney(property.value)} />
            <Fact
              label="Loan amount"
              value={formatMoney(property.loanAmount)}
            />
            <Fact label="LTV" value={ltv} />
            <Fact
              label="Rent"
              value={property.rent ? `${formatMoney(property.rent)}/mo` : null}
            />
            <Fact
              label="GDV"
              value={property.gdv ? formatMoney(property.gdv) : null}
            />
            <Fact
              label="Purchase price"
              value={
                property.purchasePrice
                  ? formatMoney(property.purchasePrice)
                  : null
              }
            />
            <Fact
              label="Purchase date"
              value={
                property.purchaseDate ? formatDate(property.purchaseDate) : null
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Property</CardTitle>
          </CardHeader>
          <CardContent>
            <Fact
              label="Type"
              value={
                property.propertyType ? (
                  <span className="capitalize">
                    {property.propertyType.replace(/_/g, " ")}
                  </span>
                ) : null
              }
            />
            <Fact
              label="Tenure"
              value={
                property.tenure ? (
                  <span className="capitalize">{property.tenure}</span>
                ) : null
              }
            />
            <Fact
              label="Lease remaining"
              value={
                property.leaseYearsRemaining != null
                  ? `${property.leaseYearsRemaining} years`
                  : null
              }
            />
            <Fact label="Bedrooms" value={property.bedrooms} />
            <Fact label="Year built" value={property.yearBuilt} />
            <Fact label="EPC rating" value={property.epcRating} />
            <Fact label="Occupancy" value={occupancyLabel(property.occupancy)} />
            <Fact
              label="Tenancy"
              value={
                property.tenancyType ? (
                  <span className="capitalize">
                    {property.tenancyType.replace(/_/g, " ")}
                  </span>
                ) : null
              }
            />
            {!property.propertyType &&
              !property.tenure &&
              property.leaseYearsRemaining == null &&
              property.bedrooms == null &&
              property.yearBuilt == null &&
              !property.epcRating &&
              !property.occupancy &&
              !property.tenancyType && (
                <p className="text-sm text-muted-foreground">
                  No property details recorded.
                </p>
              )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Current Mortgage</CardTitle>
          </CardHeader>
          <CardContent>
            <Fact label="Lender" value={property.currentLender} />
            <Fact
              label="Rate"
              value={
                property.currentRatePct != null
                  ? `${property.currentRatePct}%`
                  : null
              }
            />
            <Fact
              label="Balance"
              value={
                property.currentBalance != null
                  ? formatMoney(property.currentBalance)
                  : null
              }
            />
            <Fact
              label="Rate ends"
              value={
                property.currentRateEndDate
                  ? formatDate(property.currentRateEndDate)
                  : null
              }
            />
            {!property.currentLender &&
              property.currentRatePct == null &&
              property.currentBalance == null &&
              !property.currentRateEndDate && (
                <p className="text-sm text-muted-foreground">
                  No current mortgage recorded.
                </p>
              )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-muted-foreground" /> Valuations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PropertyValuations property={property} />
        </CardContent>
      </Card>

      {property.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{property.notes}</p>
          </CardContent>
        </Card>
      )}

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Cases</h2>
          <Badge variant="outline" className="tabular-nums">
            {activeCases.length} active · {cases.length} total
          </Badge>
        </div>
        <DataTable
          columns={caseColumns}
          data={cases}
          initialSorting={[{ id: "updatedAt", desc: true }]}
          onRowClick={(c) => setLocation(`/cases/${c.id}`)}
          emptyMessage={
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderOpen />
                </EmptyMedia>
                <EmptyDescription>
                  No cases for this property yet.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          }
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-muted-foreground" /> Tasks
            {openTasks.length > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {openTasks.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <QuickAdd
            ref={quickAddRef}
            staff={staff ?? []}
            pending={taskMutations.isCreating}
            onCreate={(input, reset) =>
              taskMutations.createTask({ ...input, propertyId: property.id }, { onSuccess: () => reset() })
            }
          />
          <div className="flex justify-end">
            {propertyTasks.length > openTasks.length && (
              <Button variant="ghost" size="xs" onClick={() => setShowDoneTasks((value) => !value)}>
                {showDoneTasks ? "Hide completed" : "Show completed"}
              </Button>
            )}
          </div>
          {(showDoneTasks ? propertyTasks : openTasks).length === 0 ? (
            <p className="text-sm text-muted-foreground">No open tasks.</p>
          ) : (
            <div className="-mx-2">
              {(showDoneTasks ? propertyTasks : openTasks).map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  active={activeTaskId === task.id}
                  showAssignee
                  onOpen={(item) => setActiveTaskId(item.id)}
                  onToggleDone={taskMutations.toggleDone}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" /> Documents
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PropertyDocuments propertyId={property.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" /> Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PropertyActivity propertyId={property.id} />
        </CardContent>
      </Card>

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

      <PropertyDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        property={property}
      />
      <CreateCaseDialog
        open={isCaseOpen}
        onOpenChange={setIsCaseOpen}
        fixedClientId={property.clientId ?? undefined}
        fixedPropertyId={property.id}
      />
      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Delete this property?"
        description="This cannot be undone."
        actionLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
