import { useState } from "react";
import type { Property } from "@workspace/api-client-react";
import {
  getListPortalPropertiesQueryKey,
  useListPortalProperties,
  useUpdatePortalProperty,
} from "@workspace/api-client-react";
import { Building2, Pencil } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyDescription,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { AddressFields, type AddressValue } from "@/components/address-fields";
import { formatAddress } from "@/lib/address";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CommaInput } from "@/components/ui/comma-input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";

function formatAmountInput(rawValue: string) {
  const cleaned = rawValue.replace(/[^\d.]/g, "");
  const [whole = "", ...decimalParts] = cleaned.split(".");
  const formattedWhole = whole
    .replace(/^0+(?=\d)/, "")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = decimalParts.join("").slice(0, 2);
  return decimalParts.length > 0
    ? `${formattedWhole || "0"}.${decimals}`
    : formattedWhole;
}

function parseAmountInput(value: string) {
  return Number(value.replace(/,/g, ""));
}

function formatMatterType(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "Not provided";
  return `£${value.toLocaleString("en-GB")}`;
}

export function ClientPortalProperties() {
  const { data: properties, isLoading } = useListPortalProperties();
  const updateProperty = useUpdatePortalProperty();
  const queryClient = useQueryClient();
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [address, setAddress] = useState<AddressValue>({ address: "", city: "", postcode: "" });
  const [matterType, setMatterType] = useState("remortgage");
  const [value, setValue] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [rent, setRent] = useState("");
  const [gdv, setGdv] = useState("");

  const openEdit = (property: Property) => {
    setEditingProperty(property);
    setAddress({
      address: property.address,
      city: property.city ?? "",
      postcode: property.postcode ?? "",
    });
    setMatterType(property.matterType);
    setValue(formatAmountInput(String(property.value)));
    setLoanAmount(formatAmountInput(String(property.loanAmount)));
    setRent(
      property.rent == null ? "" : formatAmountInput(String(property.rent)),
    );
    setGdv(property.gdv == null ? "" : formatAmountInput(String(property.gdv)));
  };

  const closeEdit = () => {
    if (updateProperty.isPending) return;
    setEditingProperty(null);
  };

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingProperty) return;

    updateProperty.mutate(
      {
        id: editingProperty.id,
        data: {
          address: address.address.trim(),
          city: address.city.trim() || null,
          postcode: address.postcode.trim() || null,
          matterType,
          value: parseAmountInput(value),
          loanAmount: parseAmountInput(loanAmount),
          rent: rent ? parseAmountInput(rent) : null,
          gdv: gdv ? parseAmountInput(gdv) : null,
        },
      },
      {
        onSuccess: () => {
          toast.add({ title: "Property updated", type: "success" });
          setEditingProperty(null);
          queryClient.invalidateQueries({
            queryKey: getListPortalPropertiesQueryKey(),
          });
        },
        onError: () => {
          toast.add({
            title: "Could not update property",
            description: "Please check the details and try again.",
            type: "error",
          });
        },
      },
    );
  };

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Your properties</h2>
        </div>
        {properties && properties.length > 0 && (
          <Badge variant="secondary">
            {properties.length}{" "}
            {properties.length === 1 ? "property" : "properties"}
          </Badge>
        )}
      </div>

      {!properties || properties.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2 />
            </EmptyMedia>
            <EmptyDescription>
              No properties have been added to your portfolio yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {properties.map((property) => (
            <Card key={property.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle>{formatAddress(property)}</CardTitle>
                    <CardDescription>
                      {formatMatterType(property.matterType)}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => openEdit(property)}
                  >
                    <Pencil />
                    Edit
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Property value</dt>
                    <dd className="font-medium mt-1">
                      {formatCurrency(property.value)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Loan amount</dt>
                    <dd className="font-medium mt-1">
                      {formatCurrency(property.loanAmount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Expected rent</dt>
                    <dd className="font-medium mt-1">
                      {formatCurrency(property.rent)}
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        / month
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">GDV</dt>
                    <dd className="font-medium mt-1">
                      {formatCurrency(property.gdv)}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!editingProperty}
        onOpenChange={(open) => !open && closeEdit()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit property</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="pt-2">
            <FieldGroup>
              <AddressFields
                idPrefix="portal-property"
                value={address}
                onChange={setAddress}
                required
              />
              <Field>
                <FieldLabel>Matter type</FieldLabel>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="portal-property-value">
                    Property value (£)
                  </FieldLabel>
                  <CommaInput
                    id="portal-property-value"
                    value={value}
                    onChange={setValue}
                    required
                    min="0"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="portal-property-loan">
                    Loan amount (£)
                  </FieldLabel>
                  <CommaInput
                    id="portal-property-loan"
                    value={loanAmount}
                    onChange={setLoanAmount}
                    required
                    min="0"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="portal-property-rent">
                    Expected rent (£/mo)
                  </FieldLabel>
                  <CommaInput
                    id="portal-property-rent"
                    value={rent}
                    onChange={setRent}
                    min="0"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="portal-property-gdv">GDV (£)</FieldLabel>
                  <CommaInput
                    id="portal-property-gdv"
                    value={gdv}
                    onChange={setGdv}
                    min="0"
                  />
                </Field>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeEdit}
                  disabled={updateProperty.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={updateProperty.isPending}>
                  {updateProperty.isPending ? "Saving..." : "Save changes"}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
