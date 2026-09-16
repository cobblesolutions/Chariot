import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  getGetDashboardQueryKey,
  getListClientsQueryKey,
  getListTasksQueryKey,
  useCreateClient,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { AssigneeSelect } from "@/components/add/assignee-select";

/**
 * Step one of adding a client, wherever it starts: just the basics. The
 * assigned worker gets a task to review the enquiry and gather the advanced
 * details — the same two-step flow as the Add page.
 */
export default function CreateClientDialog({
  open,
  onOpenChange,
  onCreated,
  redirectOnSuccess = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (client: { id: number; name: string }) => void;
  /** Go to the new client's page once created (off when used inside another form). */
  redirectOnSuccess?: boolean;
}) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const createClient = useCreateClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [assignedUserId, setAssignedUserId] = useState<number | null>(null);

  const reset = () => {
    setName("");
    setEmail("");
    setPhone("");
    setCompanyName("");
    setAssignedUserId(null);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.add({ title: "Name and email are required", type: "error" });
      return;
    }
    createClient.mutate(
      {
        data: {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          companyName: companyName.trim(),
          assignedUserId,
        },
      },
      {
        onSuccess: (client) => {
          qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
          qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          toast.add({
            title: `${client.name} added`,
            description: client.assignee
              ? `${client.assignee.displayName} has a task to review the details and complete the advanced information.`
              : "A task has been raised to review the details and complete the advanced information.",
            type: "success",
          });
          onOpenChange(false);
          reset();
          onCreated?.(client);
          if (redirectOnSuccess) setLocation(`/clients/${client.id}`);
        },
        onError: (error: unknown) => {
          const status = (error as { status?: number }).status;
          const message = (error as { data?: { error?: string } }).data?.error;
          toast.add({
            title: status === 409 ? "A client with this email already exists" : "Couldn't create client",
            description: status === 409 ? undefined : message,
            type: "error",
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
          <DialogDescription>
            Just the basics for now. The assigned worker is tasked with gathering everything else.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-client-name">Name</FieldLabel>
              <Input
                id="new-client-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="new-client-email">Email</FieldLabel>
                <Input
                  id="new-client-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-client-phone">Phone</FieldLabel>
                <Input
                  id="new-client-phone"
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="new-client-company">Company</FieldLabel>
              <Input
                id="new-client-company"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="Optional — for limited company borrowers"
              />
            </Field>
            <AssigneeSelect section="client" value={assignedUserId} onChange={setAssignedUserId} label="Handled by" />
            <FieldDescription>
              They get a task to review the enquiry, send the welcome email and complete the advanced details.
            </FieldDescription>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createClient.isPending}>
                {createClient.isPending ? "Adding…" : "Add client"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
