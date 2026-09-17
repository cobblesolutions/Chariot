import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Mail, PencilLine, RotateCcw, X } from "lucide-react";
import {
  useAcceptClientEnquiry,
  useDeclineClientEnquiry,
  useReopenClientEnquiry,
  useUpdateClient,
  getGetClientQueryKey,
  getListClientsQueryKey,
  getListTasksQueryKey,
  getGetDashboardQueryKey,
  type ClientDetail,
} from "@workspace/api-client-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { enquiryTypeLabel, sourceLabel } from "@/lib/enquiry";
import { AssigneeSelect } from "./assignee-select";
import { WelcomeTemplateDialog } from "./welcome-template-dialog";
import { apiErrorMessage } from "./utils";
import { formatAddress } from "@/lib/address";

/**
 * Step 2 of the Add page. What came in, who owns it, and the decision:
 * accept (welcome email for a new client, then the advanced-info tasks go
 * out) or decline. Also the "welcome email didn't send" recovery.
 */
export function AcceptPanel({ client }: { client: ClientDetail }) {
  const qc = useQueryClient();
  const accept = useAcceptClientEnquiry();
  const decline = useDeclineClientEnquiry();
  const reopen = useReopenClientEnquiry();
  const updateClient = useUpdateClient();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetClientQueryKey(client.id) });
    qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
    qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };

  const handleAccept = () => {
    accept.mutate(
      { id: client.id },
      {
        onSuccess: (updated) => {
          invalidate();
          const delivery = updated.welcomeDelivery?.status;
          toast.add({
            title: `${client.name} accepted`,
            description:
              delivery === "sent"
                ? `Welcome email sent to ${client.email}.`
                : delivery === "failed"
                  ? "The welcome email could not be sent — you can resend it from this page."
                  : "Email sending is not active, so no welcome email went out.",
            type: delivery === "failed" ? "error" : "success",
          });
        },
        onError: (error) =>
          toast.add({
            title: "Couldn't accept the enquiry",
            description: apiErrorMessage(error, "Please try again."),
            type: "error",
          }),
      },
    );
  };

  const handleReopen = () => {
    reopen.mutate(
      { id: client.id },
      {
        onSuccess: () => {
          invalidate();
          toast.add({ title: `${client.name} reopened`, type: "success" });
        },
        onError: (error) =>
          toast.add({
            title: "Couldn't reopen",
            description: apiErrorMessage(error, "Please try again."),
            type: "error",
          }),
      },
    );
  };

  const handleAssignee = (userId: number | null) => {
    updateClient.mutate(
      {
        id: client.id,
        data: { name: client.name, email: client.email, phone: client.phone, companyName: client.companyName, assignedUserId: userId },
      },
      {
        onSuccess: () => invalidate(),
        onError: (error) =>
          toast.add({
            title: "Couldn't change the reviewer",
            description: apiErrorMessage(error, "Please try again."),
            type: "error",
          }),
      },
    );
  };

  const closed = client.lifecycle === "declined" || client.lifecycle === "lost";
  const pending = client.lifecycle === "enquiry";
  const property = client.properties[0];
  const openCase = client.cases.find((item) => item.status === "active");
  const facts = [
    { label: "Wants", value: enquiryTypeLabel(client.enquiryType) },
    { label: "Timescale", value: client.enquiryTimescale ?? null },
    { label: "Source", value: sourceLabel(client.source) },
    { label: "Referred by", value: client.introducerName ?? null },
    { label: "Company", value: client.companyName || null },
    { label: "Property", value: property ? formatAddress(property) : null },
    { label: "Value", value: property?.value ? formatMoney(property.value) : null },
    { label: "Loan", value: property?.loanAmount ? formatMoney(property.loanAmount) : null },
    { label: "Rent", value: property?.rent ? `${formatMoney(property.rent)}/mo` : null },
    { label: "Case", value: openCase ? `${openCase.reference} · ${openCase.stage}` : null },
  ].filter((fact): fact is { label: string; value: string } => !!fact.value);

  if (closed) {
    return (
      <section className="rounded-lg border border-destructive/30 bg-card p-5 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold text-destructive">
              {client.lifecycle === "declined" ? "Enquiry declined" : "Client lost"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatDate(client.closedAt ?? client.enquiryReceivedAt)}
              {client.outcomeReason ? ` — ${client.outcomeReason}` : ""}
            </p>
          </div>
          <Button variant="outline" size="sm" disabled={reopen.isPending} onClick={handleReopen}>
            <RotateCcw /> Reopen
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border bg-card">
      {/* The decision sits at the top: it is the one thing this step is for. */}
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
        <div>
          <h2 className="text-base font-semibold">Enquiry</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Received {formatDate(client.enquiryReceivedAt)}
            {client.stale ? (
              <span className="text-amber-700 dark:text-amber-400">
                {" "}· waiting {daysSince(client.enquiryReceivedAt)} days
              </span>
            ) : null}
          </p>
        </div>
        {pending ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setDeclineOpen(true)}>
              <X /> Decline
            </Button>
            <Button disabled={accept.isPending} onClick={handleAccept}>
              <Check /> {accept.isPending ? "Accepting…" : "Accept & send welcome"}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-5 p-5 md:p-6">
        {client.enquirySummary ? (
          <p className="text-sm leading-relaxed">{client.enquirySummary}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No summary was recorded at intake.</p>
        )}

        {facts.length > 0 ? (
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {facts.map((fact) => (
              <div key={fact.label} className="grid grid-cols-[6rem_1fr] gap-2">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="min-w-0 font-medium">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {client.enquiryEmailText ? (
          <Collapsible open={showEmail} onOpenChange={setShowEmail}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <Mail className="size-4" /> Original email
                <ChevronDown className={cn("size-4 transition-transform", showEmail && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs">
                {client.enquiryEmailSubject ? `Subject: ${client.enquiryEmailSubject}
` : ""}
                {client.enquiryEmailFrom ? `From: ${client.enquiryEmailFrom}

` : ""}
                {client.enquiryEmailText}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 border-t bg-muted/30 px-5 py-4 sm:flex-row sm:items-end sm:justify-between md:px-6">
        <div className="w-full sm:max-w-xs">
          <AssigneeSelect
            section="client"
            value={client.assignee?.id ?? null}
            onChange={handleAssignee}
            disabled={updateClient.isPending}
            label="Reviewed by"
          />
        </div>
        {pending ? (
          <p className="text-xs text-muted-foreground sm:text-right">
            Accepting emails {client.email} and opens the advanced step.{" "}
            <button
              type="button"
              className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setTemplateOpen(true)}
            >
              <PencilLine className="size-3" /> Edit welcome email text
            </button>
          </p>
        ) : null}
      </div>

      <WelcomeTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} clientId={client.id} />

      <DeclineDialog
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        clientName={client.name}
        pending={decline.isPending}
        onConfirm={(status, reason) =>
          decline.mutate(
            { id: client.id, data: { status, reason } },
            {
              onSuccess: () => {
                setDeclineOpen(false);
                invalidate();
                toast.add({ title: `${client.name} marked ${status}`, type: "success" });
              },
              onError: (error) =>
                toast.add({
                  title: "Couldn't close the enquiry",
                  description: apiErrorMessage(error, "Please try again."),
                  type: "error",
                }),
            },
          )
        }
      />
    </section>
  );
}

/** Compact chip for the client header when the welcome email did not go out. */
export function WelcomeDeliveryNotice({ client }: { client: ClientDetail }) {
  const qc = useQueryClient();
  const accept = useAcceptClientEnquiry();
  const delivery = client.welcomeDelivery;
  if (!delivery || delivery.status === "sent" || delivery.status === "pending") return null;
  const resend = () =>
    accept.mutate(
      { id: client.id },
      {
        onSuccess: (updated) => {
          qc.invalidateQueries({ queryKey: getGetClientQueryKey(client.id) });
          toast.add({
            title: updated.welcomeDelivery?.status === "sent" ? "Welcome email sent" : "Welcome email still not sent",
            description: updated.welcomeDelivery?.error ?? undefined,
            type: updated.welcomeDelivery?.status === "sent" ? "success" : "error",
          });
        },
        onError: (error) =>
          toast.add({ title: "Couldn't resend", description: apiErrorMessage(error, "Please try again."), type: "error" }),
      },
    );
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 py-0.5 pr-0.5 pl-2 text-xs dark:border-amber-700 dark:bg-amber-950/40"
      title={delivery.status === "disabled" ? "Email sending is not active." : delivery.error ?? "Delivery failed."}
    >
      <Mail className="size-3.5 text-amber-700 dark:text-amber-300" />
      Welcome email not sent
      <Button size="xs" variant="ghost" className="h-6 px-1.5 text-xs" disabled={accept.isPending} onClick={resend}>
        {accept.isPending ? "Sending…" : "Resend"}
      </Button>
    </span>
  );
}

function DeclineDialog({
  open,
  onOpenChange,
  clientName,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string;
  pending: boolean;
  onConfirm: (status: "declined" | "lost", reason: string) => void;
}) {
  const [status, setStatus] = useState<"declined" | "lost">("declined");
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setStatus("declined");
          setReason("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close {clientName}'s enquiry</DialogTitle>
          <DialogDescription>
            The record stays on file and can be reopened. No email is sent.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ToggleGroup
            type="single"
            variant="outline"
            value={status}
            onValueChange={(value) => value && setStatus(value as "declined" | "lost")}
            className="w-full"
          >
            <ToggleGroupItem value="declined" className="flex-1">
              We declined
            </ToggleGroupItem>
            <ToggleGroupItem value="lost" className="flex-1">
              They went elsewhere
            </ToggleGroupItem>
          </ToggleGroup>
          <Field>
            <FieldLabel htmlFor="decline-reason">Reason</FieldLabel>
            <Textarea
              id="decline-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={status === "declined" ? "Outside our criteria, adverse credit, …" : "Went direct, chose another broker, no response, …"}
              className="min-h-20"
              autoFocus
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || pending}
            onClick={() => onConfirm(status, reason.trim())}
          >
            {pending ? "Closing…" : status === "declined" ? "Decline enquiry" : "Mark as lost"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}
