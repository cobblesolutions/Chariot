import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetClientQueryKey,
  getListPropertiesQueryKey,
  useCreateProperty,
  type ClientDetail,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { CommaInput } from "@/components/ui/comma-input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";

const parseAmountInput = (value: string) => parseFloat(value.replace(/,/g, ""));

/** Add a property to the client's portfolio (moved out of the old detail page verbatim). */
export function AddPropertyDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ClientDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const createProperty = useCreateProperty();
  const [address, setAddress] = useState("");
  const [matterType, setMatterType] = useState("remortgage");
  const [value, setValue] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [rent, setRent] = useState("");
  const [gdv, setGdv] = useState("");

  const reset = () => {
    setAddress("");
    setMatterType("remortgage");
    setValue("");
    setLoanAmount("");
    setRent("");
    setGdv("");
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    createProperty.mutate(
      {
        data: {
          clientId: client.id,
          address,
          matterType,
          value: parseAmountInput(value),
          loanAmount: parseAmountInput(loanAmount),
          rent: rent ? parseFloat(rent) : null,
          gdv: gdv ? parseFloat(gdv) : null,
        },
      },
      {
        onSuccess: () => {
          toast.add({ title: "Property added", type: "success" });
          onOpenChange(false);
          reset();
          qc.invalidateQueries({ queryKey: getGetClientQueryKey(client.id) });
          qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
        },
        onError: (error: unknown) => {
          const status = (error as { status?: number }).status;
          toast.add({
            title: status === 409 ? "Property address already exists" : "Failed to add property",
            type: "error",
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add property</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="pt-2">
          <FieldGroup>
            <Field>
              <FieldLabel>Client</FieldLabel>
              <Input value={client.name} disabled className="bg-muted" />
            </Field>
            <Field>
              <FieldLabel>Address</FieldLabel>
              <Input value={address} onChange={(event) => setAddress(event.target.value)} required />
            </Field>
            <Field>
              <FieldLabel>Matter type</FieldLabel>
              <Select value={matterType} onValueChange={setMatterType} required>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="remortgage">Remortgage</SelectItem>
                  <SelectItem value="purchase">Purchase</SelectItem>
                  <SelectItem value="btl">BTL</SelectItem>
                  <SelectItem value="bridging">Bridging</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel>Value (£)</FieldLabel>
                <CommaInput value={value} onChange={setValue} required />
              </Field>
              <Field>
                <FieldLabel>Loan amount (£)</FieldLabel>
                <CommaInput value={loanAmount} onChange={setLoanAmount} required />
              </Field>
              <Field>
                <FieldLabel>Expected rent (£/mo)</FieldLabel>
                <CommaInput value={rent} onChange={setRent} min="0" />
              </Field>
              <Field>
                <FieldLabel>GDV (£)</FieldLabel>
                <CommaInput value={gdv} onChange={setGdv} min="0" />
              </Field>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createProperty.isPending}>
                {createProperty.isPending ? "Adding..." : "Add property"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
