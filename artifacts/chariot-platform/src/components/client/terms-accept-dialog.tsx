import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAcceptClientTerms,
  getGetClientQueryKey,
  getListClientsQueryKey,
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "@/components/ui/toast";
import { apiErrorMessage } from "@/components/add/utils";

type Via = "signed_upload" | "staff";

/**
 * Staff record that the client accepted the Terms of Business outside the
 * portal: a signed copy came back, or they agreed by phone / in person.
 */
export function TermsAcceptDialog({
  open,
  onOpenChange,
  clientId,
  onAccepted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
  onAccepted?: () => void;
}) {
  const qc = useQueryClient();
  const accept = useAcceptClientTerms();
  const [via, setVia] = useState<Via>("signed_upload");
  const [note, setNote] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark the Terms of Business accepted</DialogTitle>
          <DialogDescription>
            For an acceptance given outside the portal. Upload the signed copy to the tile first if you have one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ToggleGroup
            type="single"
            variant="outline"
            value={via}
            onValueChange={(value) => value && setVia(value as Via)}
            className="w-full"
          >
            <ToggleGroupItem value="signed_upload" className="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              Signed copy received
            </ToggleGroupItem>
            <ToggleGroupItem value="staff" className="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              Agreed by phone / in person
            </ToggleGroupItem>
          </ToggleGroup>
          <Field>
            <FieldLabel htmlFor="terms-note">Note</FieldLabel>
            <Textarea
              id="terms-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Where the signed copy is, or how they agreed"
              className="min-h-20"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={accept.isPending}
            onClick={() =>
              accept.mutate(
                { id: clientId, data: { via, note: note.trim() || undefined } },
                {
                  onSuccess: (client) => {
                    qc.setQueryData(getGetClientQueryKey(clientId), client);
                    qc.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
                    qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
                    onAccepted?.();
                    onOpenChange(false);
                    setNote("");
                    toast.add({ title: "Terms of Business accepted", type: "success" });
                  },
                  onError: (error) =>
                    toast.add({ title: "Couldn't record the acceptance", description: apiErrorMessage(error, "Please try again."), type: "error" }),
                },
              )
            }
          >
            {accept.isPending ? "Saving…" : "Mark accepted"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
