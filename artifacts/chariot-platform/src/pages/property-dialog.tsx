import { useEffect, useState } from "react";
import {
  useCreateProperty,
  useUpdateProperty,
  getListPropertiesQueryKey,
  getGetPropertyQueryKey,
  useListClients,
  type Property,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/date-picker";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AddressFields, type AddressValue } from "@/components/address-fields";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CommaInput } from "@/components/ui/comma-input";
import { toast } from "@/components/ui/toast";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import CreateClientDialog from "./create-client-dialog";

const ADD_CLIENT_VALUE = "__add_client__";
const NO_CLIENT_VALUE = "__none__";
const OWNER_OCCUPIED = "owner_occupied";
const TENANTED = "tenanted";
const VACANT = "vacant";

function parseAmountInput(value: string) {
  return parseFloat(value.replace(/,/g, ""));
}

type PropertyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set the dialog edits this property; otherwise it creates one. */
  property?: Property | null;
  onSaved?: (property: Property) => void;
};

/** Add / edit property form shared by the properties list and property detail. */
export default function PropertyDialog({
  open,
  onOpenChange,
  property,
  onSaved,
}: PropertyDialogProps) {
  const qc = useQueryClient();
  const { data: clients } = useListClients();
  const createProperty = useCreateProperty();
  const updateProperty = useUpdateProperty();
  const isPending = createProperty.isPending || updateProperty.isPending;

  const [isCreateClientOpen, setIsCreateClientOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [address, setAddress] = useState<AddressValue>({ address: "", city: "", postcode: "" });
  const [matterType, setMatterType] = useState("remortgage");
  const [value, setValue] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [rent, setRent] = useState("");
  const [gdv, setGdv] = useState("");
  const [occupancy, setOccupancy] = useState("");
  const [tenancyType, setTenancyType] = useState("");
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [propertyType, setPropertyType] = useState("");
  const [tenure, setTenure] = useState("");
  const [leaseYearsRemaining, setLeaseYearsRemaining] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [yearBuilt, setYearBuilt] = useState("");
  const [epcRating, setEpcRating] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [currentLender, setCurrentLender] = useState("");
  const [currentRatePct, setCurrentRatePct] = useState("");
  const [currentBalance, setCurrentBalance] = useState("");
  const [currentRateEndDate, setCurrentRateEndDate] = useState("");
  const [notes, setNotes] = useState("");

  // Seed the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setClientId(property?.clientId ? String(property.clientId) : "");
    setAddress({
      address: property?.address ?? "",
      city: property?.city ?? "",
      postcode: property?.postcode ?? "",
    });
    setMatterType(property?.matterType ?? "remortgage");
    setValue(property ? String(property.value) : "");
    setLoanAmount(property ? String(property.loanAmount) : "");
    setRent(property?.rent ? String(property.rent) : "");
    setGdv(property?.gdv ? String(property.gdv) : "");
    setOccupancy(property?.occupancy ?? "");
    setTenancyType(property?.tenancyType ?? "");
    setPropertyType(property?.propertyType ?? "");
    setTenure(property?.tenure ?? "");
    setLeaseYearsRemaining(property?.leaseYearsRemaining != null ? String(property.leaseYearsRemaining) : "");
    setBedrooms(property?.bedrooms != null ? String(property.bedrooms) : "");
    setYearBuilt(property?.yearBuilt != null ? String(property.yearBuilt) : "");
    setEpcRating(property?.epcRating ?? "");
    setPurchasePrice(property?.purchasePrice != null ? String(property.purchasePrice) : "");
    setPurchaseDate(property?.purchaseDate ?? "");
    setCurrentLender(property?.currentLender ?? "");
    setCurrentRatePct(property?.currentRatePct != null ? String(property.currentRatePct) : "");
    setCurrentBalance(property?.currentBalance != null ? String(property.currentBalance) : "");
    setCurrentRateEndDate(property?.currentRateEndDate ?? "");
    setNotes(property?.notes ?? "");
    setShowMoreDetails(false);
  }, [open, property]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      clientId: clientId ? parseInt(clientId) : null,
      address: address.address.trim(),
      city: address.city.trim() || null,
      postcode: address.postcode.trim() || null,
      matterType,
      value: parseAmountInput(value),
      loanAmount: parseAmountInput(loanAmount),
      rent: rent ? parseAmountInput(rent) : null,
      gdv: gdv ? parseAmountInput(gdv) : null,
      occupancy: occupancy || null,
      tenancyType: occupancy === TENANTED ? tenancyType.trim() || null : null,
      propertyType: propertyType.trim() || null,
      tenure: tenure.trim() || null,
      leaseYearsRemaining: leaseYearsRemaining ? parseInt(leaseYearsRemaining) : null,
      bedrooms: bedrooms ? parseInt(bedrooms) : null,
      yearBuilt: yearBuilt ? parseInt(yearBuilt) : null,
      epcRating: epcRating.trim() || null,
      purchasePrice: purchasePrice ? parseAmountInput(purchasePrice) : null,
      purchaseDate: purchaseDate || null,
      currentLender: currentLender.trim() || null,
      currentRatePct: currentRatePct ? parseFloat(currentRatePct) : null,
      currentBalance: currentBalance ? parseAmountInput(currentBalance) : null,
      currentRateEndDate: currentRateEndDate || null,
      notes: notes.trim() || null,
    };
    const onError = (err: any) => {
      if (err.status === 409)
        toast.add({
          title: "Conflict",
          description: "Property address already exists.",
          type: "error",
        });
      else
        toast.add({
          title: property ? "Update failed" : "Create failed",
          type: "error",
        });
    };
    const onSuccess = (saved: Property) => {
      toast.add({
        title: property ? "Property updated" : "Property created",
        type: "success",
      });
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetPropertyQueryKey(saved.id) });
      onSaved?.(saved);
    };

    if (property) {
      updateProperty.mutate(
        { id: property.id, data: payload },
        { onSuccess, onError },
      );
    } else {
      createProperty.mutate({ data: payload }, { onSuccess, onError });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {property ? "Edit Property" : "Add Property"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="pt-4">
            <FieldGroup>
              <Field>
                <FieldLabel>Client</FieldLabel>
                <Select
                  value={clientId}
                  onValueChange={(selected) => {
                    if (selected === ADD_CLIENT_VALUE) {
                      setIsCreateClientOpen(true);
                      return;
                    }
                    setClientId(selected === NO_CLIENT_VALUE ? "" : selected);
                  }}
                  disabled={!!property}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="No client selected" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CLIENT_VALUE}>No client</SelectItem>
                    <SelectItem value={ADD_CLIENT_VALUE}>
                      Add client...
                    </SelectItem>
                    {clients?.map((c) => (
                      <SelectItem key={c.id} value={c.id.toString()}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <AddressFields
                idPrefix="property"
                value={address}
                onChange={setAddress}
                required
              />
              <Field>
                <FieldLabel>Matter Type</FieldLabel>
                <Select
                  value={matterType}
                  onValueChange={setMatterType}
                  required
                >
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
                  <FieldLabel>Loan Amount (£)</FieldLabel>
                  <CommaInput
                    value={loanAmount}
                    onChange={setLoanAmount}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>Expected Rent (£/mo)</FieldLabel>
                  <CommaInput value={rent} onChange={setRent} min="0" />
                </Field>
                <Field>
                  <FieldLabel>GDV (£)</FieldLabel>
                  <CommaInput value={gdv} onChange={setGdv} min="0" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>Occupancy</FieldLabel>
                  <Select value={occupancy} onValueChange={setOccupancy}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={OWNER_OCCUPIED}>
                        Owner-occupied
                      </SelectItem>
                      <SelectItem value={TENANTED}>Tenanted</SelectItem>
                      <SelectItem value={VACANT}>Vacant</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {occupancy === TENANTED && (
                  <Field>
                    <FieldLabel>Tenancy Type</FieldLabel>
                    <Input
                      value={tenancyType}
                      onChange={(e) => setTenancyType(e.target.value)}
                      placeholder="e.g. AST"
                    />
                  </Field>
                )}
              </div>

              <Collapsible open={showMoreDetails} onOpenChange={setShowMoreDetails}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 transition-transform",
                        showMoreDetails && "rotate-180",
                      )}
                    />
                    More property details
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel>Property Type</FieldLabel>
                      <Input
                        value={propertyType}
                        onChange={(e) => setPropertyType(e.target.value)}
                        placeholder="e.g. Flat"
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Tenure</FieldLabel>
                      <Input
                        value={tenure}
                        onChange={(e) => setTenure(e.target.value)}
                        placeholder="e.g. Leasehold"
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Lease Years Remaining</FieldLabel>
                      <Input
                        type="number"
                        min="0"
                        value={leaseYearsRemaining}
                        onChange={(e) => setLeaseYearsRemaining(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Bedrooms</FieldLabel>
                      <Input
                        type="number"
                        min="0"
                        value={bedrooms}
                        onChange={(e) => setBedrooms(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Year Built</FieldLabel>
                      <Input
                        type="number"
                        min="1000"
                        value={yearBuilt}
                        onChange={(e) => setYearBuilt(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>EPC Rating</FieldLabel>
                      <Input
                        value={epcRating}
                        onChange={(e) => setEpcRating(e.target.value)}
                        placeholder="e.g. C"
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Purchase Price (£)</FieldLabel>
                      <CommaInput
                        value={purchasePrice}
                        onChange={setPurchasePrice}
                        min="0"
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Purchase Date</FieldLabel>
                      <DatePicker value={purchaseDate} onChange={setPurchaseDate} />
                    </Field>
                    <Field>
                      <FieldLabel>Current Lender</FieldLabel>
                      <Input
                        value={currentLender}
                        onChange={(e) => setCurrentLender(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Current Rate (%)</FieldLabel>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={currentRatePct}
                        onChange={(e) => setCurrentRatePct(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Current Balance (£)</FieldLabel>
                      <CommaInput
                        value={currentBalance}
                        onChange={setCurrentBalance}
                        min="0"
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Rate End Date</FieldLabel>
                      <DatePicker
                        value={currentRateEndDate}
                        onChange={setCurrentRateEndDate}
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel>Notes</FieldLabel>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                    />
                  </Field>
                </CollapsibleContent>
              </Collapsible>

              <DialogFooter>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Property"}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
      <CreateClientDialog
        open={isCreateClientOpen}
        onOpenChange={setIsCreateClientOpen}
        redirectOnSuccess={false}
        onCreated={(client) => setClientId(String(client.id))}
      />
    </>
  );
}
