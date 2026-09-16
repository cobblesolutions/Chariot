import { useState } from "react";
import {
  useGetInvoice,
  useIssueInvoice,
  useVoidInvoice,
  useRecordInvoicePayment,
  getGetInvoiceQueryKey,
  getListInvoicesQueryKey,
} from "@workspace/api-client-react";
import { useRoute, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyContent,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Receipt,
  Calendar,
  CreditCard,
  Ban,
  Send,
  AlertTriangle,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import { useNavTitle } from "@/lib/nav-history";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/auth-provider";
import { isFullAccess } from "@/lib/roles";
import { CommaInput } from "@/components/ui/comma-input";

export default function InvoiceDetail() {
  const [, params] = useRoute("/invoices/:id");
  const id = parseInt(params?.id || "0");
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);

  const { data: invoice, isLoading } = useGetInvoice(id, {
    query: { enabled: !!id, queryKey: getGetInvoiceQueryKey(id) },
  });
  useNavTitle(`/invoices/${id}`, invoice?.invoiceNumber);

  const issueInvoice = useIssueInvoice();
  const voidInvoice = useVoidInvoice();
  const recordPayment = useRecordInvoicePayment();

  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [payReference, setPayReference] = useState("");

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Receipt />
            </EmptyMedia>
            <EmptyTitle>Invoice not found</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <BackButton
              variant="outline"
              size="default"
              fallback={{ href: "/invoices", label: "Invoices" }}
            />
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const handleIssue = () => setIssueOpen(true);

  const confirmHandleIssue = () => {
    issueInvoice.mutate(
      { id },
      {
        onSuccess: () => {
          toast.add({ title: "Invoice issued", type: "success" });
          qc.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        },
      },
    );
  };

  const handleVoid = () => {
    const reason = prompt("Enter reason for voiding this invoice:");
    if (reason) {
      voidInvoice.mutate(
        { id, data: { reason } },
        {
          onSuccess: () => {
            toast.add({ title: "Invoice voided", type: "success" });
            qc.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
            qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          },
        },
      );
    }
  };

  const handlePayment = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(payAmount.replace(/,/g, ""));
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.add({ title: "Invalid amount", type: "error" });
      return;
    }

    recordPayment.mutate(
      {
        id,
        data: {
          amount: amountNum,
          receivedAt: new Date().toISOString(),
          notes: payNotes,
          reference: payReference,
        },
      },
      {
        onSuccess: () => {
          toast.add({ title: "Payment recorded", type: "success" });
          setIsPaymentOpen(false);
          setPayAmount("");
          setPayNotes("");
          setPayReference("");
          qc.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        },
      },
    );
  };

  const isDraft = invoice.status === "draft";
  const isVoid = invoice.status === "void";
  const isPaid = invoice.status === "paid";
  const canPay = !isDraft && !isVoid && !isPaid;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <div>
        <BackButton
          className="mb-4 -ml-3"
          fallback={{ href: "/invoices", label: "Invoices" }}
        />
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">
                {invoice.invoiceNumber}
              </h1>
              <Badge
                variant={
                  invoice.status === "paid"
                    ? "default"
                    : invoice.status === "void"
                      ? "secondary"
                      : invoice.status === "overdue"
                        ? "destructive"
                        : "default"
                }
                className="capitalize"
              >
                {invoice.status}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Due:{" "}
              {formatDate(invoice.dueDate)}
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              {isDraft && (
                <Button onClick={handleIssue} disabled={issueInvoice.isPending}>
                  <Send /> Issue Invoice
                </Button>
              )}
              {canPay && (
                <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <CreditCard /> Record Payment
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Record Payment</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handlePayment} className="pt-4">
                      <FieldGroup>
                        <Field>
                          <FieldLabel>Amount (£)</FieldLabel>
                          <CommaInput
                            min="0.01"
                            max={invoice.outstanding || undefined}
                            value={payAmount}
                            onChange={setPayAmount}
                            required
                          />
                          <FieldDescription>
                            Outstanding: £
                            {invoice.outstanding?.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </FieldDescription>
                        </Field>
                        <Field>
                          <FieldLabel>Reference (Optional)</FieldLabel>
                          <Input
                            value={payReference}
                            onChange={(e) => setPayReference(e.target.value)}
                            placeholder="e.g. BACS transfer, Check #123"
                          />
                        </Field>
                        <Field>
                          <FieldLabel>Notes (Optional)</FieldLabel>
                          <Input
                            value={payNotes}
                            onChange={(e) => setPayNotes(e.target.value)}
                          />
                        </Field>
                        <DialogFooter>
                          <Button
                            type="submit"
                            disabled={recordPayment.isPending}
                          >
                            {recordPayment.isPending
                              ? "Recording..."
                              : "Save Payment"}
                          </Button>
                        </DialogFooter>
                      </FieldGroup>
                    </form>
                  </DialogContent>
                </Dialog>
              )}
              {!isVoid && !isPaid && (
                <Button
                  variant="destructive"
                  onClick={handleVoid}
                  disabled={voidInvoice.isPending}
                >
                  <Ban /> Void
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_300px] gap-6 items-start">
        <div className="space-y-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Line Items</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.lineItems.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-center">
                        {item.quantity}
                      </TableCell>
                      <TableCell className="text-right">
                        £
                        {item.unitAmount.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        £
                        {(item.quantity * item.unitAmount).toLocaleString(
                          undefined,
                          { minimumFractionDigits: 2 },
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="p-4 border-t bg-muted/20 flex justify-between items-center text-lg font-bold">
                <span>Total</span>
                <span>
                  £
                  {invoice.total.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
            </CardContent>
          </Card>

          {invoice.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{invoice.notes}</p>
              </CardContent>
            </Card>
          )}

          {invoice.payments && invoice.payments.length > 0 && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Payment History</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Payment</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">
                            £
                            {p.amount.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(p.receivedAt)}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {p.reference && <div>Ref: {p.reference}</div>}
                          {p.notes && <div className="italic">{p.notes}</div>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">Total Billed</span>
                <span className="font-medium">
                  £
                  {invoice.total.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b text-success">
                <span>Amount Paid</span>
                <span className="font-medium">
                  £
                  {invoice.paid.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 text-lg font-bold">
                <span>Outstanding</span>
                <span
                  className={
                    invoice.outstanding && invoice.outstanding > 0
                      ? "text-primary"
                      : "text-muted-foreground"
                  }
                >
                  £
                  {(invoice.outstanding || 0).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>

              {invoice.overdueReminderDue && (
                <Alert variant="destructive" className="mt-4">
                  <AlertTriangle />
                  <AlertTitle>Overdue Reminder Due</AlertTitle>
                  <AlertDescription>
                    This invoice is &gt;7 days overdue. Follow up with the
                    client.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        title="Issue this invoice?"
        description="This will lock line items and make it due immediately."
        actionLabel="Issue invoice"
        onConfirm={confirmHandleIssue}
      />
    </div>
  );
}
