import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListInvoicesQueryKey,
  getListRenewalsQueryKey,
  useCreateInvoice,
  useCreateRenewal,
  useListCases,
  useListClients,
  useListInvoices,
  useListRenewals,
  useUpdateRenewalStatus,
  type RenewalInput,
  type RenewalStatusInput,
} from "@workspace/api-client-react";
import { CalendarClock, Plus, Receipt, Repeat } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { CommaInput } from "@/components/ui/comma-input";
import { Separator } from "@/components/ui/separator";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty";
import { isFullAccess } from "@/lib/roles";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { formatDate, formatMoney } from "@/lib/utils";

type ContextProps = {
  clientId: number;
  caseId?: number;
};

export function ContextInvoices({ clientId, caseId }: ContextProps) {
  const { data: invoices, isLoading } = useListInvoices();
  const createInvoice = useCreateInvoice();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  const contextualInvoices = (invoices ?? []).filter((invoice) =>
    caseId ? invoice.caseId === caseId : invoice.clientId === clientId,
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsedAmount = Number(amount.replace(/,/g, ""));
    if (
      !description.trim() ||
      !Number.isFinite(parsedAmount) ||
      parsedAmount <= 0
    )
      return;
    createInvoice.mutate(
      {
        data: {
          clientId,
          caseId: caseId ?? null,
          lineItems: [
            {
              description: description.trim(),
              quantity: 1,
              unitAmount: parsedAmount,
            },
          ],
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          setDescription("");
          setAmount("");
          qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          toast.add({ title: "Draft invoice created", type: "success" });
        },
        onError: () =>
          toast.add({ title: "Invoice could not be created", type: "error" }),
      },
    );
  };

  return (
    <>
      <Separator />
      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" /> Invoices
            </h2>
          </div>
          {isFullAccess(user?.role) && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus /> Create Invoice
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Draft Invoice</DialogTitle>
                </DialogHeader>
                <form onSubmit={submit} className="pt-2">
                  <FieldGroup>
                    <Field>
                      <FieldLabel
                        htmlFor={`invoice-description-${caseId ?? clientId}`}
                      >
                        Line item
                      </FieldLabel>
                      <Input
                        id={`invoice-description-${caseId ?? clientId}`}
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel
                        htmlFor={`invoice-amount-${caseId ?? clientId}`}
                      >
                        Amount (£)
                      </FieldLabel>
                      <CommaInput
                        id={`invoice-amount-${caseId ?? clientId}`}
                        min="0.01"
                        step="0.01"
                        value={amount}
                        onChange={setAmount}
                        required
                      />
                    </Field>
                    <DialogFooter>
                      <Button type="submit" disabled={createInvoice.isPending}>
                        {createInvoice.isPending
                          ? "Creating..."
                          : "Create Draft"}
                      </Button>
                    </DialogFooter>
                  </FieldGroup>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : contextualInvoices.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyDescription>No invoices linked here yet.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <ItemGroup className="divide-y">
              {contextualInvoices.map((invoice) => (
                <Item key={invoice.id} className="rounded-none" asChild>
                  <Link href={`/invoices/${invoice.id}`}>
                    <ItemContent>
                      <ItemTitle>{invoice.invoiceNumber}</ItemTitle>
                      <ItemDescription>
                        Due {formatDate(invoice.dueDate)}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions className="text-right">
                      <div>
                        <div className="font-semibold">
                          {formatMoney(invoice.total)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatMoney(invoice.outstanding ?? 0)} outstanding
                        </div>
                      </div>
                      <Badge
                        variant={
                          invoice.status === "paid"
                            ? "default"
                            : invoice.status === "void"
                              ? "secondary"
                              : "outline"
                        }
                        className="capitalize"
                      >
                        {invoice.status}
                      </Badge>
                    </ItemActions>
                  </Link>
                </Item>
              ))}
            </ItemGroup>
          </Card>
        )}
      </section>
    </>
  );
}

export function ContextRenewal({
  clientId,
  caseId,
  matterType,
}: ContextProps & { matterType: string }) {
  const { data: renewals, isLoading } = useListRenewals();
  const createRenewal = useCreateRenewal();
  const updateStatus = useUpdateRenewalStatus();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const isBridging = matterType.toLowerCase().includes("bridg");
  const [type, setType] = useState<RenewalInput["type"]>(
    isBridging ? "bridging" : "fixed_rate",
  );
  const [rateEndDate, setRateEndDate] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  const [notes, setNotes] = useState("");
  const caseRenewals = (renewals ?? []).filter(
    (renewal) => renewal.caseId === caseId,
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (type === "bridging" ? !completionDate : !rateEndDate) {
      toast.add({
        title:
          type === "bridging"
            ? "Completion date required"
            : "Rate end date required",
        type: "error",
      });
      return;
    }
    createRenewal.mutate(
      {
        data: {
          clientId,
          caseId: caseId ?? null,
          type,
          rateEndDate: rateEndDate || null,
          completionDate: completionDate || null,
          notes,
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          setRateEndDate("");
          setCompletionDate("");
          setNotes("");
          qc.invalidateQueries({ queryKey: getListRenewalsQueryKey() });
          toast.add({ title: "Renewal scheduled", type: "success" });
        },
        onError: () =>
          toast.add({ title: "Renewal could not be scheduled", type: "error" }),
      },
    );
  };

  const mark = (id: number, status: RenewalStatusInput["status"]) =>
    updateStatus.mutate(
      { id, data: { status } },
      {
        onSuccess: () =>
          qc.invalidateQueries({ queryKey: getListRenewalsQueryKey() }),
      },
    );

  return (
    <>
      <Separator />
      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Repeat className="h-5 w-5 text-primary" /> Renewal
            </h2>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus /> Schedule Renewal
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Schedule Case Renewal</DialogTitle>
              </DialogHeader>
              <form onSubmit={submit} className="pt-2">
                <FieldGroup>
                  <Field>
                    <FieldLabel>Renewal type</FieldLabel>
                    <Select
                      value={type}
                      onValueChange={(value) =>
                        setType(value as RenewalInput["type"])
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed_rate">
                          Fixed Rate Expiry
                        </SelectItem>
                        <SelectItem value="tracker">Tracker Review</SelectItem>
                        <SelectItem value="annual_review">
                          Annual Review
                        </SelectItem>
                        <SelectItem value="bridging">
                          Bridging Follow-up
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {type === "bridging" ? (
                    <Field>
                      <FieldLabel>Completion date</FieldLabel>
                      <DatePicker
                        value={completionDate}
                        onChange={setCompletionDate}
                      />
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel>Rate end date</FieldLabel>
                      <DatePicker
                        value={rateEndDate}
                        onChange={setRateEndDate}
                      />
                    </Field>
                  )}
                  <Field>
                    <FieldLabel>Notes</FieldLabel>
                    <Input
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                    />
                  </Field>
                  <p className="text-xs text-muted-foreground">
                    {type === "bridging"
                      ? "Follow-up begins six weeks after completion."
                      : "Renewal activity begins six months before rate expiry."}
                  </p>
                  <DialogFooter>
                    <Button type="submit" disabled={createRenewal.isPending}>
                      {createRenewal.isPending
                        ? "Scheduling..."
                        : "Schedule Renewal"}
                    </Button>
                  </DialogFooter>
                </FieldGroup>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : caseRenewals.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyDescription>
                No renewal scheduled for this case.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-3">
            {caseRenewals.map((renewal) => (
              <Item key={renewal.id} variant="outline" className="block">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <CalendarClock className="h-4 w-4 text-primary" />
                      <span className="font-medium capitalize">
                        {renewal.type.replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      Action date:{" "}
                      {formatDate(renewal.nextReminderDate ?? renewal.dueDate)}
                    </div>
                    {renewal.notes && (
                      <p className="mt-2 text-sm">{renewal.notes}</p>
                    )}
                  </div>
                  <Badge
                    variant={
                      renewal.status === "completed" ? "default" : "outline"
                    }
                    className="capitalize"
                  >
                    {renewal.status.replaceAll("_", " ")}
                  </Badge>
                </div>
                {!["completed", "lost"].includes(renewal.status) && (
                  <ButtonGroup className="mt-4" aria-label="Renewal progress">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => mark(renewal.id, "contacted")}
                      disabled={updateStatus.isPending}
                    >
                      Mark Contacted
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => mark(renewal.id, "completed")}
                      disabled={updateStatus.isPending}
                    >
                      Complete
                    </Button>
                  </ButtonGroup>
                )}
              </Item>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export function DashboardRenewals() {
  const { data: renewals, isLoading } = useListRenewals();
  const { data: clients } = useListClients();
  const { data: cases } = useListCases();
  const active = (renewals ?? [])
    .filter((renewal) => !["completed", "lost"].includes(renewal.status))
    .sort((a, b) =>
      (a.nextReminderDate ?? a.dueDate).localeCompare(
        b.nextReminderDate ?? b.dueDate,
      ),
    )
    .slice(0, 5);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Repeat className="h-5 w-5 text-primary" /> Renewal Follow-ups
        </h2>
      </div>
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : active.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>No upcoming renewals.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <ItemGroup className="divide-y">
            {active.map((renewal) => {
              const client = clients?.find(
                (item) => item.id === renewal.clientId,
              );
              const caseItem = cases?.find(
                (item) => item.id === renewal.caseId,
              );
              const actionDate = renewal.nextReminderDate ?? renewal.dueDate;
              const isOverdue = actionDate < today;
              const href = renewal.caseId
                ? `/cases/${renewal.caseId}`
                : `/clients/${renewal.clientId}`;
              return (
                <Item key={renewal.id} className="rounded-none" asChild>
                  <Link href={href}>
                    <ItemContent>
                      <ItemTitle>
                        {client?.name ?? "Client"}
                        {caseItem ? ` · ${caseItem.reference}` : ""}
                      </ItemTitle>
                      <ItemDescription className="capitalize">
                        {renewal.type.replaceAll("_", " ")}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions className="flex-col items-end">
                      <div
                        className={
                          isOverdue
                            ? "font-medium text-destructive"
                            : "font-medium"
                        }
                      >
                        {formatDate(actionDate)}
                      </div>
                      <Badge
                        variant={isOverdue ? "destructive" : "outline"}
                        className="capitalize"
                      >
                        {isOverdue
                          ? "Overdue"
                          : renewal.status.replaceAll("_", " ")}
                      </Badge>
                    </ItemActions>
                  </Link>
                </Item>
              );
            })}
          </ItemGroup>
        </Card>
      )}
    </section>
  );
}
