import { useState } from "react";
import {
  useListInvoices,
  useCreateInvoice,
  getListInvoicesQueryKey,
  useListClients,
  useListCases,
  type Invoice,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyDescription,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, Plus, AlertTriangle, PoundSterling } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { createColumnHelper } from "@tanstack/react-table";
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFeatures,
} from "@/components/data-table";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/components/auth-provider";
import { isFullAccess } from "@/lib/roles";
import { CommaInput } from "@/components/ui/comma-input";

const columnHelper = createColumnHelper<DataTableFeatures, Invoice>();

const columns = columnHelper.columns([
  columnHelper.accessor("invoiceNumber", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Invoice #" />
    ),
    sortFn: "alphanumeric",
    meta: { cellClassName: "font-semibold" },
  }),
  columnHelper.accessor("status", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    sortFn: "text",
    cell: ({ getValue }) => {
      const status = getValue();
      return (
        <Badge
          variant={
            status === "paid"
              ? "default"
              : status === "void"
                ? "secondary"
                : status === "overdue"
                  ? "destructive"
                  : "default"
          }
          className="capitalize"
        >
          {status}
        </Badge>
      );
    },
  }),
  columnHelper.accessor("dueDate", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Due Date" />
    ),
    sortFn: "datetime",
    meta: { cellClassName: "text-muted-foreground" },
    cell: ({ getValue }) => formatDate(getValue()),
  }),
  columnHelper.accessor("total", {
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Total"
        className="justify-end"
      />
    ),
    sortFn: "basic",
    meta: { cellClassName: "text-right font-medium" },
    cell: ({ getValue }) => (
      <>£{getValue().toLocaleString(undefined, { minimumFractionDigits: 2 })}</>
    ),
  }),
  columnHelper.accessor("outstanding", {
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Outstanding"
        className="justify-end"
      />
    ),
    sortFn: "basic",
    meta: { cellClassName: "text-right" },
    cell: ({ getValue }) => (
      <>
        £
        {(getValue() ?? 0).toLocaleString(undefined, {
          minimumFractionDigits: 2,
        })}
      </>
    ),
  }),
]);

export default function InvoicesPage() {
  const { data: invoices, isLoading } = useListInvoices();
  const [, setLocation] = useLocation();
  const { data: clients } = useListClients();
  const { data: cases } = useListCases();
  const createInvoice = useCreateInvoice();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [caseId, setCaseId] = useState("none");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  // The fee agreed on the case under the Terms of Business: a percentage of the loan or a flat amount.
  const selectedCase = caseId !== "none" ? cases?.find((c) => c.id === parseInt(caseId)) : undefined;
  const agreedFee = selectedCase
    ? selectedCase.brokerFeeBasis === "flat"
      ? selectedCase.brokerFeeFlat && selectedCase.brokerFeeFlat > 0
        ? { description: "Broker fee (agreed flat fee)", amount: selectedCase.brokerFeeFlat, summary: `£${selectedCase.brokerFeeFlat.toLocaleString("en-GB")} flat` }
        : null
      : selectedCase.brokerFeePct > 0
        ? { description: `Broker fee — ${selectedCase.brokerFeePct}% of the £${selectedCase.loanAmount.toLocaleString("en-GB")} loan`, amount: Math.round(selectedCase.loanAmount * selectedCase.brokerFeePct) / 100, summary: `${selectedCase.brokerFeePct}% = £${(Math.round(selectedCase.loanAmount * selectedCase.brokerFeePct) / 100).toLocaleString("en-GB")}` }
        : null
    : null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) {
      toast.add({ title: "Client required", type: "error" });
      return;
    }

    const numAmount = parseFloat(amount.replace(/,/g, ""));
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.add({ title: "Invalid amount", type: "error" });
      return;
    }

    const payload = {
      clientId: parseInt(clientId),
      caseId: caseId !== "none" ? parseInt(caseId) : null,
      lineItems: [{ description, quantity: 1, unitAmount: numAmount }],
    };

    createInvoice.mutate(
      { data: payload },
      {
        onSuccess: () => {
          toast.add({ title: "Invoice created", type: "success" });
          setIsDialogOpen(false);
          setClientId("");
          setCaseId("none");
          setDescription("");
          setAmount("");
          qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        },
        onError: () => {
          toast.add({ title: "Failed to create invoice", type: "error" });
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const activeInvoices =
    invoices?.filter((i) => i.status !== "paid" && i.status !== "void") || [];
  const totalOutstanding = activeInvoices.reduce(
    (sum, i) => sum + (i.outstanding || 0),
    0,
  );
  const overdueInvoices = activeInvoices.filter(
    (i) => i.status === "overdue" || new Date(i.dueDate).getTime() < Date.now(),
  );

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Invoices</h1>
        </div>

        {isAdmin && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus /> New Invoice
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Draft Invoice</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="pt-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel>Client (Required)</FieldLabel>
                    <Select
                      value={clientId}
                      onValueChange={setClientId}
                      required
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select Client" />
                      </SelectTrigger>
                      <SelectContent>
                        {clients?.map((c) => (
                          <SelectItem key={c.id} value={c.id.toString()}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Case (Optional)</FieldLabel>
                    <Select
                      value={caseId}
                      onValueChange={setCaseId}
                      disabled={!clientId}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select Case" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">-- No Case --</SelectItem>
                        {cases
                          ?.filter((c) => c.clientId.toString() === clientId)
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id.toString()}>
                              {c.reference}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel>Primary Line Item Description</FieldLabel>
                      {selectedCase && agreedFee ? (
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setDescription(agreedFee.description); setAmount(String(agreedFee.amount)); }}>
                          Use the agreed fee ({agreedFee.summary})
                        </Button>
                      ) : null}
                    </div>
                    <Input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Amount (£)</FieldLabel>
                    <CommaInput
                      value={amount}
                      onChange={setAmount}
                      required
                      min="0.01"
                      step="0.01"
                    />
                  </Field>
                  <DialogFooter>
                    <Button type="submit" disabled={createInvoice.isPending}>
                      {createInvoice.isPending
                        ? "Creating..."
                        : "Create Invoice"}
                    </Button>
                  </DialogFooter>
                </FieldGroup>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Item variant="outline">
          <ItemContent>
            <ItemTitle className="text-muted-foreground">
              Total Outstanding
            </ItemTitle>
            <div className="text-3xl font-bold">
              £
              {totalOutstanding.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </ItemContent>
          <ItemActions>
            <PoundSterling className="size-4 text-primary" />
          </ItemActions>
        </Item>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle className="text-muted-foreground">
              Overdue Invoices
            </ItemTitle>
            <div className="text-3xl font-bold text-destructive">
              {overdueInvoices.length}
            </div>
          </ItemContent>
          <ItemActions>
            <AlertTriangle className="size-4 text-primary" />
          </ItemActions>
        </Item>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle className="text-muted-foreground">
              Active Invoices
            </ItemTitle>
            <div className="text-3xl font-bold">{activeInvoices.length}</div>
          </ItemContent>
          <ItemActions>
            <Receipt className="size-4 text-primary" />
          </ItemActions>
        </Item>
      </div>

      <DataTable
        columns={columns}
        data={invoices ?? []}
        initialSorting={[{ id: "dueDate", desc: true }]}
        onRowClick={(inv) => setLocation(`/invoices/${inv.id}`)}
        emptyMessage={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Receipt />
              </EmptyMedia>
              <EmptyDescription>No invoices found.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />
    </div>
  );
}
