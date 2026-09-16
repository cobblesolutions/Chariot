import { useState } from "react";
import { format } from "date-fns";
import type { StaffUser } from "@workspace/api-client-react";
import { CalendarClock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AssigneePicker } from "@/components/assignee-picker";
import { followUpLabel, followUpTone, type Client } from "./client-model";
import { useClientMutations } from "./use-client-mutations";

const NO_OWNER = "__none__";

/** Who owns the relationship. Admins can change it; everyone else sees the name. */
export function OwnerPicker({
  client,
  staff,
  canEdit,
  className,
}: {
  client: Pick<Client, "id" | "assignee">;
  staff: StaffUser[];
  canEdit: boolean;
  className?: string;
}) {
  const mutations = useClientMutations();
  if (!canEdit) {
    return (
      <span className={cn("text-sm", className)}>
        {client.assignee?.displayName ?? <span className="text-muted-foreground">No owner</span>}
      </span>
    );
  }
  return (
    <AssigneePicker
      value={client.assignee ? String(client.assignee.id) : NO_OWNER}
      onValueChange={(next) =>
        mutations.setOwner(
          client,
          next === NO_OWNER ? null : (staff.find((member) => String(member.id) === next) ?? null),
        )
      }
      staff={staff}
      leading={[{ value: NO_OWNER, label: "No owner" }]}
      placeholder="Owner"
      className={cn("h-8 text-xs", className)}
      aria-label="Client owner"
    />
  );
}

const TONE_CLASS = {
  overdue: "border-destructive/50 text-destructive",
  today: "border-amber-500/60 text-amber-700 dark:text-amber-400",
  soon: "",
  later: "",
} as const;

/** The next follow-up date as a chip that opens a calendar; clear from the popover. */
export function FollowUpButton({
  client,
  size = "sm",
  className,
}: {
  client: Pick<Client, "id" | "nextFollowUpAt">;
  size?: "sm" | "xs";
  className?: string;
}) {
  const mutations = useClientMutations();
  const [open, setOpen] = useState(false);
  const tone = followUpTone(client);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={size}
          className={cn(tone && TONE_CLASS[tone], !tone && "text-muted-foreground", className)}
          aria-label={client.nextFollowUpAt ? `Follow up ${followUpLabel(client.nextFollowUpAt)}` : "Set a follow-up"}
        >
          <CalendarClock />
          {client.nextFollowUpAt ? followUpLabel(client.nextFollowUpAt) : "Follow-up"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={client.nextFollowUpAt ? new Date(client.nextFollowUpAt) : undefined}
          onSelect={(selected) => {
            mutations.setFollowUp(client, selected ? format(selected, "yyyy-MM-dd") : null);
            setOpen(false);
          }}
        />
        {client.nextFollowUpAt && (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                mutations.setFollowUp(client, null);
                setOpen(false);
              }}
            >
              <X /> Clear follow-up
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Close an enquiry or client as declined / lost with a reason. */
export function DeclineDialog({
  client,
  open,
  onOpenChange,
  onDone,
}: {
  client: Pick<Client, "id" | "name">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const mutations = useClientMutations();
  const [status, setStatus] = useState<"declined" | "lost">("declined");
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close {client.name}</DialogTitle>
          <DialogDescription>They stay on the register and can be reopened later.</DialogDescription>
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
            <FieldLabel htmlFor="client-close-reason">Reason</FieldLabel>
            <Textarea
              id="client-close-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="A line for whoever picks this up later"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || mutations.isDeclining}
            onClick={() =>
              mutations.declineClient(
                client,
                { status, reason: reason.trim() },
                {
                  onSuccess: () => {
                    onOpenChange(false);
                    setReason("");
                    onDone?.();
                  },
                },
              )
            }
          >
            {status === "declined" ? "Decline" : "Mark as lost"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
