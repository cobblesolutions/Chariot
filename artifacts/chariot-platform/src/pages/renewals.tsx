import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import {
  useListRenewals,
  useCreateRenewal,
  useUpdateRenewalStatus,
  getListRenewalsQueryKey,
  useListClients,
  useListCases,
  type RenewalInput,
  type RenewalStatusInput,
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
import { Repeat, Plus, Calendar, Clock, CheckCircle } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";

export default function RenewalsPage() {
  const { data: renewals, isLoading } = useListRenewals();

  // `/renewals?renewal=<id>` (from site search): scroll to that card and ring it.
  const searchString = useSearch();
  const focusRenewalId = useMemo(() => {
    const value = Number(new URLSearchParams(searchString).get("renewal"));
    return value > 0 ? value : null;
  }, [searchString]);
  useEffect(() => {
    if (focusRenewalId == null || !renewals) return;
    const timer = setTimeout(() => {
      document
        .getElementById(`renewal-${focusRenewalId}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
    return () => clearTimeout(timer);
  }, [focusRenewalId, renewals]);
  const { data: clients } = useListClients();
  const { data: cases } = useListCases();
  const createRenewal = useCreateRenewal();
  const updateStatus = useUpdateRenewalStatus();
  const qc = useQueryClient();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [caseId, setCaseId] = useState("none");
  const [type, setType] = useState<RenewalInput["type"]>("fixed_rate");
  const [rateEndDate, setRateEndDate] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  const [notes, setNotes] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) {
      toast.add({ title: "Client required", type: "error" });
      return;
    }

    createRenewal.mutate(
      {
        data: {
          clientId: parseInt(clientId),
          caseId: caseId !== "none" ? parseInt(caseId) : null,
          type,
          rateEndDate: rateEndDate || null,
          completionDate: completionDate || null,
          notes,
        },
      },
      {
        onSuccess: () => {
          toast.add({ title: "Renewal scheduled", type: "success" });
          setIsDialogOpen(false);
          setClientId("");
          setCaseId("none");
          setType("fixed_rate");
          setRateEndDate("");
          setCompletionDate("");
          setNotes("");
          qc.invalidateQueries({ queryKey: getListRenewalsQueryKey() });
        },
      },
    );
  };

  const handleUpdateStatus = (
    id: number,
    status: RenewalStatusInput["status"],
  ) => {
    updateStatus.mutate(
      { id, data: { status } },
      {
        onSuccess: () =>
          qc.invalidateQueries({ queryKey: getListRenewalsQueryKey() }),
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

  const upcoming = renewals?.filter((r) => r.status === "upcoming") || [];
  const contacted =
    renewals?.filter(
      (r) => r.status === "contacted" || r.status === "in_progress",
    ) || [];
  const completed =
    renewals?.filter((r) => r.status === "completed" || r.status === "lost") ||
    [];

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Renewals</h1>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus /> Schedule Renewal
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Schedule Renewal</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="pt-4">
              <FieldGroup>
                <Field>
                  <FieldLabel>Client (Required)</FieldLabel>
                  <Select value={clientId} onValueChange={setClientId} required>
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
                  <FieldLabel>Linked Case (Optional)</FieldLabel>
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
                  <FieldLabel>Renewal Type</FieldLabel>
                  <Select
                    value={type}
                    onValueChange={(value) =>
                      setType(value as RenewalInput["type"])
                    }
                    required
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
                    </SelectContent>
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel>Rate End Date</FieldLabel>
                    <DatePicker value={rateEndDate} onChange={setRateEndDate} />
                  </Field>
                  <Field>
                    <FieldLabel>Completion Date (for ref)</FieldLabel>
                    <DatePicker
                      value={completionDate}
                      onChange={setCompletionDate}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel>Notes</FieldLabel>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </Field>
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

      {!renewals || renewals.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Repeat />
            </EmptyMedia>
            <EmptyDescription>No renewals scheduled.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" /> Upcoming Action
                Required
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {upcoming.map((r) => (
                  <RenewalCard
                    key={r.id}
                    renewal={r}
                    highlighted={r.id === focusRenewalId}
                    clients={clients}
                    updateStatus={handleUpdateStatus}
                    isPending={updateStatus.isPending}
                  />
                ))}
              </div>
            </div>
          )}

          {contacted.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Repeat className="h-5 w-5 text-secondary" /> In Progress
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {contacted.map((r) => (
                  <RenewalCard
                    key={r.id}
                    renewal={r}
                    highlighted={r.id === focusRenewalId}
                    clients={clients}
                    updateStatus={handleUpdateStatus}
                    isPending={updateStatus.isPending}
                  />
                ))}
              </div>
            </div>
          )}

          {completed.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-muted-foreground" />{" "}
                Historical
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 opacity-60">
                {completed.map((r) => (
                  <RenewalCard
                    key={r.id}
                    renewal={r}
                    highlighted={r.id === focusRenewalId}
                    clients={clients}
                    updateStatus={handleUpdateStatus}
                    isPending={updateStatus.isPending}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RenewalCard({
  renewal: r,
  highlighted = false,
  clients,
  updateStatus,
  isPending,
}: {
  renewal: any;
  highlighted?: boolean;
  clients: any;
  updateStatus: (id: number, status: RenewalStatusInput["status"]) => void;
  isPending: boolean;
}) {
  const clientName =
    clients?.find((c: any) => c.id === r.clientId)?.name ||
    `Client #${r.clientId}`;

  return (
    <Card
      id={`renewal-${r.id}`}
      className={cn(highlighted && "ring-2 ring-primary ring-offset-2")}
    >
      <CardHeader>
        <div className="flex justify-between items-start gap-2">
          <CardTitle className="truncate" title={clientName}>
            {clientName}
          </CardTitle>
          <Badge variant="outline" className="capitalize shrink-0">
            {r.status.replace("_", " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm">
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Type</span>
            <span className="font-medium capitalize">
              {r.type.replace("_", " ")}
            </span>
          </div>
          {r.rateEndDate && (
            <div className="flex justify-between py-1 text-destructive font-medium">
              <span>Rate Expiry</span>
              <span>{formatDate(r.rateEndDate)}</span>
            </div>
          )}
          {r.nextReminderDate && (
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Action Date</span>
              <span className="font-medium flex items-center gap-1">
                <Calendar className="h-3 w-3" />{" "}
                {formatDate(r.nextReminderDate)}
              </span>
            </div>
          )}
        </div>
        {r.notes && (
          <p
            className="text-xs text-muted-foreground italic truncate"
            title={r.notes}
          >
            {r.notes}
          </p>
        )}

        <div className="pt-2 flex gap-2">
          {r.status === "upcoming" && (
            <Button
              size="sm"
              className="w-full"
              onClick={() => updateStatus(r.id, "contacted")}
              disabled={isPending}
            >
              Mark Contacted
            </Button>
          )}
          {(r.status === "contacted" || r.status === "in_progress") && (
            <ButtonGroup className="w-full" aria-label="Renewal outcome">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => updateStatus(r.id, "completed")}
                disabled={isPending}
              >
                Completed
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-destructive"
                onClick={() => updateStatus(r.id, "lost")}
                disabled={isPending}
              >
                Lost
              </Button>
            </ButtonGroup>
          )}
          {(r.status === "completed" || r.status === "lost") && (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => updateStatus(r.id, "upcoming")}
              disabled={isPending}
            >
              Reopen
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
