import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClock, Check, HandCoins, Mail, Send, UserCheck, X } from "lucide-react";
import {
  useAcceptClientEnquiry,
  useDeclineClientEnquiry,
  useListStaff,
  useRecheckAlert,
  useRecordInvoicePayment,
  useRemindClientOnboarding,
  useSendCaseAdvice,
  useUpdateCase,
  useUpdateCaseSubmission,
  useUpdateRenewalStatus,
  useUpdateTask,
  getListAlertsQueryKey,
  getGetAlertSummaryQueryKey,
  getListTasksQueryKey,
  getListCasesQueryKey,
  getListClientsQueryKey,
  type Alert,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { DatePicker } from "@/components/date-picker";
import { AssigneePicker } from "@/components/assignee-picker";
import { apiErrorMessage } from "@/components/add/utils";
import { useAuth } from "@/components/auth-provider";
import { isFullAccess } from "@/lib/roles";

/**
 * The fix for an alert, right on its card: one or two buttons per kind that
 * call the same endpoints the record pages use, then re-check the alert so
 * it clears straight away instead of at the next scheduled run.
 */
export function AlertActions({ alert }: { alert: Alert }) {
  const qc = useQueryClient();
  const recheck = useRecheckAlert();

  /** After any fix: re-check this alert (resolves it if the cause is gone) and refresh the lists. */
  const settle = (done: string) => {
    recheck.mutate({ id: alert.id }, {
      onSettled: () => {
        qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetAlertSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
      },
    });
    toast.add({ title: done, type: "success" });
  };
  const fail = (what: string) => (error: unknown) =>
    toast.add({ title: what, description: apiErrorMessage(error, "Please try again."), type: "error" });

  switch (alert.kind) {
    case "task_overdue":
      return <TaskActions alert={alert} settle={settle} fail={fail} />;
    case "stage_overdue":
    case "unassigned_case":
      return <ReassignAction alert={alert} settle={settle} fail={fail} />;
    case "enquiry_stale":
      return <EnquiryActions alert={alert} settle={settle} fail={fail} />;
    case "approval_unanswered":
      return <ResendAdviceAction alert={alert} settle={settle} fail={fail} />;
    case "valuation_passed":
      return <ValuationActions alert={alert} settle={settle} fail={fail} />;
    case "invoice_overdue":
      return <PaymentAction alert={alert} settle={settle} fail={fail} />;
    case "renewal_due":
      return <RenewalActions alert={alert} settle={settle} fail={fail} />;
    case "onboarding_stalled":
      return <RemindAction alert={alert} settle={settle} fail={fail} />;
    case "terms_not_accepted":
      // Signing is driven from the case (send / chase the agreement), so the row's link is the action.
      return null;
    default:
      return null;
  }
}

type ActionProps = { alert: Alert; settle: (done: string) => void; fail: (what: string) => (error: unknown) => void };

function TaskActions({ alert, settle, fail }: ActionProps) {
  const update = useUpdateTask();
  const { user } = useAuth();
  // Rescheduling is an administrator's call (the tasks API enforces it); workers complete.
  const canMove = isFullAccess(user?.role);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  if (alert.taskId == null) return null;
  return (
    <>
      <Button size="sm" variant="outline" disabled={update.isPending} onClick={() =>
        update.mutate({ id: alert.taskId!, data: { status: "done" } }, { onSuccess: () => settle("Task done"), onError: fail("Couldn't complete the task") })}>
        <Check /> Done
      </Button>
      {canMove ? <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost"><CalendarClock /> Move</Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-3" align="end">
          <Field>
            <FieldLabel>New due date</FieldLabel>
            <DatePicker value={date} onChange={setDate} />
          </Field>
          <Button size="sm" className="w-full" disabled={!date || update.isPending} onClick={() =>
            update.mutate({ id: alert.taskId!, data: { dueDate: date } }, { onSuccess: () => { setOpen(false); settle("Task moved"); }, onError: fail("Couldn't move the task") })}>
            Save
          </Button>
        </PopoverContent>
      </Popover> : null}
    </>
  );
}

function ReassignAction({ alert, settle, fail }: ActionProps) {
  const update = useUpdateCase();
  const { data: staff } = useListStaff();
  const [open, setOpen] = useState(false);
  if (alert.caseId == null) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline"><UserCheck /> {alert.kind === "unassigned_case" ? "Assign" : "Reassign"}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2" align="end">
        <Field>
          <FieldLabel>Case handler</FieldLabel>
          <AssigneePicker
            staff={(staff ?? []).map((u) => ({ id: u.id, displayName: u.displayName, role: u.role }))}
            value={alert.assignedUserId != null ? String(alert.assignedUserId) : undefined}
            disabled={update.isPending}
            onValueChange={(value) =>
              update.mutate({ id: alert.caseId!, data: { assignedUserId: Number(value) } }, {
                onSuccess: () => { setOpen(false); settle("Case reassigned"); },
                onError: fail("Couldn't reassign the case"),
              })}
          />
        </Field>
      </PopoverContent>
    </Popover>
  );
}

function EnquiryActions({ alert, settle, fail }: ActionProps) {
  const accept = useAcceptClientEnquiry();
  const decline = useDeclineClientEnquiry();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (alert.clientId == null) return null;
  return (
    <>
      <Button size="sm" variant="outline" disabled={accept.isPending} onClick={() =>
        accept.mutate({ id: alert.clientId! }, { onSuccess: () => settle("Enquiry accepted — welcome email sent"), onError: fail("Couldn't accept the enquiry") })}>
        <Check /> Accept
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setDeclineOpen(true)}><X /> Decline</Button>
      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Decline this enquiry</DialogTitle>
            <DialogDescription>{alert.clientName ?? "The client"} will be closed with the reason on file; it can be reopened.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`decline-${alert.id}`}>Reason</FieldLabel>
            <Textarea id={`decline-${alert.id}`} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-20" placeholder="Outside our criteria, no response…" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={!reason.trim() || decline.isPending} onClick={() =>
              decline.mutate({ id: alert.clientId!, data: { status: "declined", reason: reason.trim() } }, {
                onSuccess: () => { setDeclineOpen(false); settle("Enquiry declined"); },
                onError: fail("Couldn't decline the enquiry"),
              })}>
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResendAdviceAction({ alert, settle, fail }: ActionProps) {
  const send = useSendCaseAdvice();
  if (alert.caseId == null) return null;
  return (
    <Button size="sm" variant="outline" disabled={send.isPending} onClick={() =>
      send.mutate({ id: alert.caseId! }, { onSuccess: () => settle("Advice re-sent with a fresh link"), onError: fail("Couldn't resend the advice") })}>
      <Send /> Resend advice
    </Button>
  );
}

function ValuationActions({ alert, settle, fail }: ActionProps) {
  const update = useUpdateCaseSubmission();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  if (alert.caseId == null || alert.submissionId == null) return null;
  const ids = { id: alert.caseId, submissionId: alert.submissionId };
  return (
    <>
      <Button size="sm" variant="outline" disabled={update.isPending} onClick={() =>
        update.mutate({ ...ids, data: { valuationCompletedAt: new Date().toISOString() } }, { onSuccess: () => settle("Valuation marked as done"), onError: fail("Couldn't record the valuation") })}>
        <Check /> Valuation done
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost"><CalendarClock /> Rebook</Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-3" align="end">
          <Field>
            <FieldLabel>New valuation date</FieldLabel>
            <DatePicker value={date} onChange={setDate} />
          </Field>
          <Button size="sm" className="w-full" disabled={!date || update.isPending} onClick={() =>
            update.mutate({ ...ids, data: { valuationDate: new Date(`${date}T09:00:00`).toISOString() } }, { onSuccess: () => { setOpen(false); settle("Valuation rebooked"); }, onError: fail("Couldn't rebook the valuation") })}>
            Save
          </Button>
        </PopoverContent>
      </Popover>
    </>
  );
}

function PaymentAction({ alert, settle, fail }: ActionProps) {
  const record = useRecordInvoicePayment();
  const [open, setOpen] = useState(false);
  const outstanding = /£([\d,]+)/.exec(alert.detail)?.[1]?.replace(/,/g, "") ?? "";
  const [amount, setAmount] = useState(outstanding);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reference, setReference] = useState("");
  if (alert.invoiceId == null) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><HandCoins /> Record payment</Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>{alert.title}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`amt-${alert.id}`}>Amount (£)</FieldLabel>
            <Input id={`amt-${alert.id}`} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>Received</FieldLabel>
            <DatePicker value={date} onChange={setDate} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor={`ref-${alert.id}`}>Reference</FieldLabel>
            <Input id={`ref-${alert.id}`} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank reference" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!(Number(amount) > 0) || record.isPending} onClick={() =>
            record.mutate({ id: alert.invoiceId!, data: { amount: Number(amount), receivedAt: new Date(`${date}T12:00:00`).toISOString(), reference: reference || undefined } }, {
              onSuccess: () => { setOpen(false); settle("Payment recorded"); },
              onError: fail("Couldn't record the payment"),
            })}>
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenewalActions({ alert, settle, fail }: ActionProps) {
  const update = useUpdateRenewalStatus();
  if (alert.renewalId == null) return null;
  const set = (status: "contacted" | "completed", done: string) =>
    update.mutate({ id: alert.renewalId!, data: { status } }, { onSuccess: () => settle(done), onError: fail("Couldn't update the renewal") });
  return (
    <>
      <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => set("contacted", "Marked as contacted")}><Mail /> Contacted</Button>
      <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => set("completed", "Renewal completed")}><Check /> Done</Button>
    </>
  );
}

function RemindAction({ alert, settle, fail }: ActionProps) {
  const remind = useRemindClientOnboarding();
  if (alert.clientId == null) return null;
  return (
    <Button size="sm" variant="outline" disabled={remind.isPending} onClick={() =>
      remind.mutate({ id: alert.clientId! }, {
        onSuccess: (result: { status: string }) => settle(result.status === "sent" ? "Reminder sent" : "Reminder logged — email sending is not active"),
        onError: fail("Couldn't send the reminder"),
      })}>
      <Mail /> Remind client
    </Button>
  );
}
