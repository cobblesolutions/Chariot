import { useState, useEffect } from "react";
import { type Resolver, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  useCreateCase,
  getListCasesQueryKey,
  useListClients,
  useListLenders,
  useListProperties,
  useCreateProperty,
  getListPropertiesQueryKey,
  getGetClientQueryKey,
  type Property,
  type Client,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus } from "lucide-react";
import { FEE_BASIS_OPTIONS } from "@/lib/fees";
import { toast } from "@/components/ui/toast";
import { SERVICE_TYPES } from "@/lib/service-types";
import CreateClientDialog from "./create-client-dialog";
import { CommaInput } from "@/components/ui/comma-input";
import { formatAddress } from "@/lib/address";

const schema = z.object({
  clientId: z.coerce.number().min(1, "Client is required"),
  propertyId: z.coerce.number().min(1, "Property is required"),
  serviceType: z.enum(["full_advice", "light_advice", "execution_only"]),
  loanAmount: z.coerce.number().min(0),
  propertyValue: z.coerce.number().min(0),
  assignedTo: z.string().min(1, "Assignee is required"),
  lenderId: z.coerce.number().optional(),
  procFeePct: z.coerce.number().min(0).max(100),
  brokerFeePct: z.coerce.number().min(0).max(100),
  brokerFeeBasis: z.enum(["percent", "flat"]),
  brokerFeeFlat: z.coerce.number().min(0).optional(),
});

export default function CreateCaseDialog({
  open,
  onOpenChange,
  fixedClientId,
  fixedPropertyId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fixedClientId?: number;
  /** Preselects this property (and its value / loan) when the dialog opens. */
  fixedPropertyId?: number;
}) {
  const form = useForm<z.infer<typeof schema>>({
    // z.coerce fields make the schema input `unknown`; the form works with parsed output values.
    resolver: zodResolver(schema) as Resolver<z.infer<typeof schema>>,
    defaultValues: {
      clientId: fixedClientId || 0,
      propertyId: 0,
      serviceType: "full_advice",
      loanAmount: 0,
      propertyValue: 0,
      assignedTo: "staff_1",
      lenderId: undefined,
      procFeePct: 1,
      brokerFeePct: 0.5,
      brokerFeeBasis: "percent",
    },
  });

  const { data: clients } = useListClients();
  const { data: lenders } = useListLenders();
  const { data: properties } = useListProperties();
  const createCase = useCreateCase();
  const createProperty = useCreateProperty();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const [isPropertyOpen, setIsPropertyOpen] = useState(false);
  const [isClientOpen, setIsClientOpen] = useState(false);
  const [newPropAddress, setNewPropAddress] = useState("");
  const [newPropMatterType, setNewPropMatterType] = useState("residential");
  const [newPropValue, setNewPropValue] = useState("");
  const [newPropLoanAmount, setNewPropLoanAmount] = useState("");
  const [newPropRent, setNewPropRent] = useState("");
  const [newPropGdv, setNewPropGdv] = useState("");
  const [recentlyCreatedProperty, setRecentlyCreatedProperty] =
    useState<Property | null>(null);

  const currentClientId = useWatch({ control: form.control, name: "clientId" });
  const clientProperties: Property[] =
    properties?.filter((p) => p.clientId === currentClientId) || [];
  if (
    recentlyCreatedProperty &&
    recentlyCreatedProperty.clientId === currentClientId &&
    !clientProperties.some(
      (property) => property.id === recentlyCreatedProperty.id,
    )
  ) {
    clientProperties.push(recentlyCreatedProperty);
  }

  // If fixedClientId changes, update form
  useEffect(() => {
    if (fixedClientId && fixedClientId !== form.getValues("clientId")) {
      form.setValue("clientId", fixedClientId);
      form.setValue("propertyId", 0);
      form.setValue("propertyValue", 0);
      form.setValue("loanAmount", 0);
    }
  }, [fixedClientId, form]);

  const handleClientChange = (clientId: number) => {
    form.setValue("clientId", clientId);
    form.setValue("propertyId", 0);
    form.setValue("propertyValue", 0);
    form.setValue("loanAmount", 0);
  };

  const handlePropertyChange = (propertyId: number) => {
    form.setValue("propertyId", propertyId);
    const selectedProp = clientProperties.find((p) => p.id === propertyId);
    if (selectedProp) {
      form.setValue("propertyValue", selectedProp.value);
      form.setValue("loanAmount", selectedProp.loanAmount);
    }
  };

  // Preselect the property once its client's properties have loaded.
  useEffect(() => {
    if (!open || !fixedPropertyId) return;
    if (form.getValues("propertyId") === fixedPropertyId) return;
    const selectedProp = properties?.find((p) => p.id === fixedPropertyId);
    if (!selectedProp) return;
    if (selectedProp.clientId) form.setValue("clientId", selectedProp.clientId);
    form.setValue("propertyId", selectedProp.id);
    form.setValue("propertyValue", selectedProp.value);
    form.setValue("loanAmount", selectedProp.loanAmount);
  }, [open, fixedPropertyId, properties, form]);

  const onSubmit = (data: z.infer<typeof schema>) => {
    createCase.mutate(
      {
        data: {
          ...data,
          lenderId: data.lenderId || undefined,
          brokerFeeFlat: data.brokerFeeBasis === "flat" ? data.brokerFeeFlat ?? 0 : undefined,
        },
      },
      {
        onSuccess: (newCase) => {
          qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
          // Also invalidate client detail just in case it's fixed client
          if (fixedClientId) {
            qc.invalidateQueries({
              queryKey: getGetClientQueryKey(fixedClientId),
            });
          }
          onOpenChange(false);
          form.reset();
          setLocation(`/cases/${newCase.id}`);
        },
        onError: () => {
          toast.add({ title: "Failed to create case", type: "error" });
        },
      },
    );
  };

  const handleAddProperty = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentClientId) {
      toast.add({ title: "Please select a client first", type: "error" });
      return;
    }

    const payload = {
      clientId: currentClientId,
      address: newPropAddress,
      matterType: newPropMatterType,
      value: parseFloat(newPropValue),
      loanAmount: parseFloat(newPropLoanAmount),
      rent: newPropRent ? parseFloat(newPropRent) : null,
      gdv: newPropGdv ? parseFloat(newPropGdv) : null,
    };

    createProperty.mutate(
      { data: payload },
      {
        onSuccess: (newProp) => {
          toast.add({ title: "Property added successfully", type: "success" });
          setIsPropertyOpen(false);
          setNewPropAddress("");
          setNewPropMatterType("residential");
          setNewPropValue("");
          setNewPropLoanAmount("");
          setNewPropRent("");
          setNewPropGdv("");

          qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
          qc.invalidateQueries({
            queryKey: getGetClientQueryKey(currentClientId),
          });

          // Keep the new property visible while the properties query refreshes,
          // then select it and prefill the case values immediately.
          setRecentlyCreatedProperty(newProp);
          form.setValue("propertyId", newProp.id, {
            shouldValidate: true,
            shouldDirty: true,
          });
          form.setValue("propertyValue", newProp.value, {
            shouldValidate: true,
            shouldDirty: true,
          });
          form.setValue("loanAmount", newProp.loanAmount, {
            shouldValidate: true,
            shouldDirty: true,
          });
        },
        onError: (err: any) => {
          if (err.status === 409)
            toast.add({
              title: "Conflict",
              description: "Property address already exists.",
              type: "error",
            });
          else toast.add({ title: "Failed to add property", type: "error" });
        },
      },
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Case</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4 pt-4"
            >
              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-end pb-1">
                      <FormLabel>Client</FormLabel>
                      {!fixedClientId && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => setIsClientOpen(true)}
                        >
                          <Plus /> New Client
                        </Button>
                      )}
                    </div>
                    <Combobox
                      items={clients ?? []}
                      itemToStringLabel={(c) => c.name}
                      itemToStringValue={(c) =>
                        c.companyName ? `${c.name} ${c.companyName}` : c.name
                      }
                      value={clients?.find((c) => c.id === field.value) ?? null}
                      onValueChange={(c) => {
                        if (c) handleClientChange(c.id);
                      }}
                      disabled={!!fixedClientId}
                    >
                      <FormControl>
                        <ComboboxInput
                          className="w-full"
                          placeholder="Select a client"
                          onBlur={field.onBlur}
                          name={field.name}
                        />
                      </FormControl>
                      <ComboboxContent>
                        <ComboboxEmpty>No clients found.</ComboboxEmpty>
                        <ComboboxList>
                          {(c: Client) => (
                            <ComboboxItem key={c.id} value={c}>
                              {c.name}
                              {c.companyName ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  ({c.companyName})
                                </span>
                              ) : null}
                            </ComboboxItem>
                          )}
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lenderId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lender (optional)</FormLabel>
                    <Select
                      onValueChange={(value) =>
                        field.onChange(
                          value === "unassigned"
                            ? undefined
                            : parseInt(value, 10),
                        )
                      }
                      value={
                        field.value ? field.value.toString() : "unassigned"
                      }
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="unassigned">Select later</SelectItem>
                        {lenders
                          ?.filter((lender) => lender.status === "active")
                          .map((lender) => (
                            <SelectItem
                              key={lender.id}
                              value={lender.id.toString()}
                            >
                              {lender.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="propertyId"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-end pb-1">
                      <FormLabel>Property</FormLabel>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          if (!currentClientId) {
                            toast.add({ title: "Select a client first" });
                            return;
                          }
                          setIsPropertyOpen(true);
                        }}
                        disabled={!currentClientId}
                      >
                        <Plus /> Add New Property
                      </Button>
                    </div>
                    <Select
                      onValueChange={(v) => handlePropertyChange(parseInt(v))}
                      value={field.value ? field.value.toString() : ""}
                      disabled={!currentClientId}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue
                            placeholder={
                              currentClientId
                                ? "Select a property"
                                : "Select a client first"
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {clientProperties.length === 0 && (
                          <div className="p-2 text-sm text-muted-foreground text-center">
                            No properties found.
                          </div>
                        )}
                        {clientProperties.map((p) => (
                          <SelectItem key={p.id} value={p.id.toString()}>
                            {formatAddress(p)} ({p.matterType.replace("_", " ")})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="serviceType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Level</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SERVICE_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="propertyValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Property Value (£)</FormLabel>
                      <FormControl>
                        <CommaInput
                          value={field.value === 0 ? "" : field.value}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="loanAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Loan Amount (£)</FormLabel>
                      <FormControl>
                        <CommaInput
                          value={field.value === 0 ? "" : field.value}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="procFeePct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Proc Fee (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="brokerFeeBasis"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Our fee</FormLabel>
                      <div className="flex gap-2">
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="w-[120px] shrink-0" aria-label="Fee basis">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FEE_BASIS_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {field.value === "flat" ? (
                          <Input type="number" step="1" min="0" placeholder="995" aria-label="Flat fee (£)" {...form.register("brokerFeeFlat")} />
                        ) : (
                          <Input type="number" step="0.1" min="0" max="100" aria-label="Fee (% of loan)" {...form.register("brokerFeePct")} />
                        )}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createCase.isPending}>
                  {createCase.isPending ? "Creating..." : "Create Case"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isPropertyOpen} onOpenChange={setIsPropertyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Property</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddProperty} className="pt-4">
            <FieldGroup>
              <Field>
                <FieldLabel>Address</FieldLabel>
                <Input
                  value={newPropAddress}
                  onChange={(e) => setNewPropAddress(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel>Matter Type</FieldLabel>
                <Select
                  value={newPropMatterType}
                  onValueChange={setNewPropMatterType}
                  required
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="residential">Residential</SelectItem>
                    <SelectItem value="buy_to_let">Buy to Let</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="development">Development</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>Value (£)</FieldLabel>
                  <CommaInput
                    value={newPropValue}
                    onChange={setNewPropValue}
                    required
                    min="0"
                  />
                </Field>
                <Field>
                  <FieldLabel>Loan Amount (£)</FieldLabel>
                  <CommaInput
                    value={newPropLoanAmount}
                    onChange={setNewPropLoanAmount}
                    required
                    min="0"
                  />
                </Field>
                <Field>
                  <FieldLabel>Expected Rent (£/mo)</FieldLabel>
                  <CommaInput
                    value={newPropRent}
                    onChange={setNewPropRent}
                    min="0"
                  />
                </Field>
                <Field>
                  <FieldLabel>GDV (£)</FieldLabel>
                  <CommaInput
                    value={newPropGdv}
                    onChange={setNewPropGdv}
                    min="0"
                  />
                </Field>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsPropertyOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createProperty.isPending}>
                  {createProperty.isPending ? "Adding..." : "Add Property"}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
      <CreateClientDialog
        open={isClientOpen}
        onOpenChange={setIsClientOpen}
        redirectOnSuccess={false}
        onCreated={(client) => {
          form.setValue("clientId", client.id, {
            shouldValidate: true,
            shouldDirty: true,
          });
          form.setValue("propertyId", 0, {
            shouldValidate: true,
            shouldDirty: true,
          });
          form.setValue("propertyValue", 0, {
            shouldValidate: true,
            shouldDirty: true,
          });
          form.setValue("loanAmount", 0, {
            shouldValidate: true,
            shouldDirty: true,
          });
        }}
      />
    </>
  );
}
