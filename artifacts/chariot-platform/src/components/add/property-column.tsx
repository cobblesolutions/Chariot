import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import {
  useCreateProperty,
  useUpdateProperty,
  getListPropertiesQueryKey,
  getGetClientQueryKey,
  getListTasksQueryKey,
  type Property,
} from "@workspace/api-client-react";
import { Link2, Upload } from "lucide-react";
import { LinkPropertyDialog } from "./link-property-dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImportPropertiesDialog } from "./import-properties-dialog";
import { useAutosave } from "./use-autosave";
import { SaveStatus } from "./save-status";
import { CommaInput } from "@/components/ui/comma-input";
import { DatePicker } from "@/components/date-picker";
import { ColumnHeader } from "./column-header";
import { FormSection, FormSections, countFilled } from "./form-section";
import { AddNewCard, RecordCard, RecordCardList } from "./record-card";
import { AssigneeSelect } from "./assignee-select";
import { OptionSelect } from "./option-select";
import { AddressFields } from "@/components/address-fields";
import { formatAddress } from "@/lib/address";
import {
  EPC_RATINGS,
  MATTER_TYPES,
  OCCUPANCIES,
  PROPERTY_TYPES,
  TENANCY_TYPES,
  TENURES,
  apiErrorMessage,
  emptyToNull,
  numberToInput,
  parseAmount,
  parseWholeNumber,
} from "./utils";

interface PropertyDraft {
  address: string;
  city: string;
  postcode: string;
  matterType: string;
  value: string;
  loanAmount: string;
  rent: string;
  gdv: string;
  propertyType: string;
  tenure: string;
  leaseYearsRemaining: string;
  bedrooms: string;
  yearBuilt: string;
  epcRating: string;
  occupancy: string;
  tenancyType: string;
  purchasePrice: string;
  purchaseDate: string;
  currentLender: string;
  currentRatePct: string;
  currentBalance: string;
  currentRateEndDate: string;
  notes: string;
}

const emptyDraft: PropertyDraft = {
  address: "",
  city: "",
  postcode: "",
  matterType: "remortgage",
  value: "",
  loanAmount: "",
  rent: "",
  gdv: "",
  propertyType: "",
  tenure: "",
  leaseYearsRemaining: "",
  bedrooms: "",
  yearBuilt: "",
  epcRating: "",
  occupancy: "",
  tenancyType: "",
  purchasePrice: "",
  purchaseDate: "",
  currentLender: "",
  currentRatePct: "",
  currentBalance: "",
  currentRateEndDate: "",
  notes: "",
};

function draftFromProperty(property: Property): PropertyDraft {
  return {
    address: property.address,
    city: property.city ?? "",
    postcode: property.postcode ?? "",
    matterType: property.matterType,
    value: String(property.value),
    loanAmount: String(property.loanAmount),
    rent: numberToInput(property.rent),
    gdv: numberToInput(property.gdv),
    propertyType: property.propertyType ?? "",
    tenure: property.tenure ?? "",
    leaseYearsRemaining: numberToInput(property.leaseYearsRemaining),
    bedrooms: numberToInput(property.bedrooms),
    yearBuilt: numberToInput(property.yearBuilt),
    epcRating: property.epcRating ?? "",
    occupancy: property.occupancy ?? "",
    tenancyType: property.tenancyType ?? "",
    purchasePrice: numberToInput(property.purchasePrice),
    purchaseDate: property.purchaseDate ?? "",
    currentLender: property.currentLender ?? "",
    currentRatePct: numberToInput(property.currentRatePct),
    currentBalance: numberToInput(property.currentBalance),
    currentRateEndDate: property.currentRateEndDate ?? "",
    notes: property.notes ?? "",
  };
}

/** Draft → API payload. `value`/`loanAmount` stay nullable until validated. */
function payloadFromDraft(draft: PropertyDraft, clientId: number) {
  return {
    clientId,
    address: draft.address.trim(),
    city: draft.city.trim() || null,
    postcode: draft.postcode.trim() || null,
    matterType: draft.matterType,
    value: parseAmount(draft.value),
    loanAmount: parseAmount(draft.loanAmount),
    rent: parseAmount(draft.rent),
    gdv: parseAmount(draft.gdv),
    propertyType: emptyToNull(draft.propertyType),
    tenure: emptyToNull(draft.tenure),
    leaseYearsRemaining: parseWholeNumber(draft.leaseYearsRemaining),
    bedrooms: parseWholeNumber(draft.bedrooms),
    yearBuilt: parseWholeNumber(draft.yearBuilt),
    epcRating: emptyToNull(draft.epcRating),
    occupancy: emptyToNull(draft.occupancy),
    tenancyType: emptyToNull(draft.tenancyType),
    purchasePrice: parseAmount(draft.purchasePrice),
    purchaseDate: emptyToNull(draft.purchaseDate),
    currentLender: emptyToNull(draft.currentLender),
    currentRatePct: parseAmount(draft.currentRatePct),
    currentBalance: parseAmount(draft.currentBalance),
    currentRateEndDate: emptyToNull(draft.currentRateEndDate),
    notes: emptyToNull(draft.notes),
  };
}
type PropertyPayload = ReturnType<typeof payloadFromDraft>;

function validatePayload(payload: PropertyPayload) {
  return !payload.address || payload.value == null || payload.loanAmount == null
    ? "Address, value and loan amount are required"
    : null;
}

function toInput(payload: PropertyPayload) {
  return { ...payload, value: payload.value!, loanAmount: payload.loanAmount! };
}

const money = (value: number) => `£${value.toLocaleString("en-GB")}`;

function matterTypeLabel(value: string) {
  return (
    MATTER_TYPES.find((type) => type.value === value)?.label ??
    value.replace(/_/g, " ")
  );
}

function propertyCompleteness(property: Property) {
  return {
    filled: countFilled([
      property.propertyType ?? "",
      property.tenure ?? "",
      property.occupancy ?? "",
      numberToInput(property.bedrooms),
      property.epcRating ?? "",
    ]),
    total: 5,
  };
}

/**
 * Column 2. The client's properties are listed; click one to edit it or
 * "Add new property" to start a fresh one. Both use the same full form.
 */
export function PropertyColumn({
  clientId,
  clientName,
  properties,
  propertyId,
  onPropertyChange,
  needs,
}: {
  clientId: number;
  clientName: string;
  properties: Property[];
  propertyId: number | null;
  onPropertyChange: (propertyId: number | null) => void;
  needs?: string[];
}) {
  const qc = useQueryClient();
  const createProperty = useCreateProperty();
  const updateProperty = useUpdateProperty();

  const [draft, setDraft] = useState<PropertyDraft>(emptyDraft);
  const [assignee, setAssignee] = useState<number | null>(null);
  /** The saved property this column is editing; null while adding a new one. */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(
    properties.length === 0 || propertyId != null,
  );
  const [importOpen, setImportOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const seededFor = useRef<number | null>(null);

  const selected = properties.find((property) => property.id === propertyId);

  // Load the selected property into the form once per selection.
  useEffect(() => {
    if (propertyId && selected && seededFor.current !== propertyId) {
      seededFor.current = propertyId;
      setEditingId(propertyId);
      setDraft(draftFromProperty(selected));
      setShowForm(true);
    }
    if (!propertyId && seededFor.current !== null) {
      seededFor.current = null;
      setEditingId(null);
      setDraft(emptyDraft);
    }
  }, [propertyId, selected]);

  const isPending = createProperty.isPending;
  const setField =
    <K extends keyof PropertyDraft>(key: K) =>
    (value: PropertyDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value }));
  const onInput =
    (key: keyof PropertyDraft) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setField(key)(event.target.value);

  const startNew = () => {
    onPropertyChange(null);
    seededFor.current = null;
    setEditingId(null);
    setDraft(emptyDraft);
    setShowForm(true);
  };

  const invalidateProperties = () => {
    qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
  };

  // Saved properties save themselves; a new one still needs Create.
  const payload = payloadFromDraft(draft, clientId);
  const autosave = useAutosave({
    enabled: !!editingId,
    payload,
    seedKey: editingId,
    validate: validatePayload,
    save: async (next) => {
      if (!editingId) return;
      try {
        await updateProperty.mutateAsync({ id: editingId, data: toInput(next) });
        invalidateProperties();
      } catch (error) {
        throw new Error(apiErrorMessage(error, "Couldn't save property"));
      }
    },
  });

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (editingId) {
      autosave.flush();
      return;
    }
    const problem = validatePayload(payload);
    if (problem) {
      toast.add({
        title: "Check the property details",
        description: problem,
        type: "error",
      });
      return;
    }
    createProperty.mutate(
      { data: { ...toInput(payload), assignedUserId: assignee ?? undefined } },
      {
        onSuccess: (property: Property) => {
          toast.add({ title: "Property saved", type: "success" });
          seededFor.current = property.id;
          setEditingId(property.id);
          setDraft(draftFromProperty(property));
          onPropertyChange(property.id);
          invalidateProperties();
          qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: (error: unknown) => {
          toast.add({
            title: "Couldn't save property",
            description: apiErrorMessage(error, "Please try again."),
            type: "error",
          });
        },
      },
    );
  };

  const isLeasehold =
    draft.tenure === "leasehold" || draft.tenure === "share_of_freehold";
  const isLet = draft.occupancy === "let" || draft.occupancy === "holiday_let";
  // Rental income matters for buy-to-let or anything let out; GDV for bridging/development.
  const wantsRent = draft.matterType === "btl" || isLet;
  const wantsGdv = draft.matterType === "bridging";
  const addingNew = showForm && !editingId;
  const status = editingId ? "saved" : addingNew ? "draft" : "empty";

  return (
    <section className="space-y-6">
      <ColumnHeader
        title="Property"
        status={status}
        needs={needs}
        action={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setImportOpen(true)}
          >
            <Upload /> Import CSV
          </Button>
        }
      />
      <ImportPropertiesDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        clientId={clientId}
        clientName={clientName}
        onImported={(created) => {
          const first = created[0];
          if (first) {
            onPropertyChange(first.id);
            setShowForm(true);
          }
        }}
      />
      <LinkPropertyDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        clientId={clientId}
        clientName={clientName}
        onLinked={(property) => {
          onPropertyChange(property.id);
          setShowForm(true);
        }}
      />
      <div>
        <form
          onSubmit={handleSave}
          onBlur={() => autosave.flush()}
          className="space-y-4"
        >
          <RecordCardList>
            {properties.map((property) => (
              <RecordCard
                key={property.id}
                selected={property.id === propertyId}
                onSelect={() => {
                  onPropertyChange(property.id);
                  setShowForm(true);
                }}
                title={formatAddress(property)}
                subtitle={matterTypeLabel(property.matterType)}
                meta={[
                  money(property.value),
                  `loan ${money(property.loanAmount)}`,
                  property.rent != null ? `rent ${money(property.rent)}/mo` : null,
                  property.gdv != null ? `GDV ${money(property.gdv)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                completeness={propertyCompleteness(property)}
              />
            ))}
            <AddNewCard
              label="Add new property"
              onClick={startNew}
              selected={addingNew}
            />
            <AddNewCard
              label="Use an existing property"
              icon={Link2}
              onClick={() => setLinkOpen(true)}
            />
          </RecordCardList>

          {showForm ? (
            <>
              <FormSections>
                <FormSection
                  id="deal"
                  title="The deal"
                  filled={countFilled([
                    draft.address,
                    draft.matterType,
                    draft.value,
                    draft.loanAmount,
                    ...(wantsRent ? [draft.rent] : []),
                    ...(wantsGdv ? [draft.gdv] : []),
                  ])}
                  total={4 + (wantsRent ? 1 : 0) + (wantsGdv ? 1 : 0)}
                >
                  <AddressFields
                    idPrefix="add-property"
                    required
                    value={{
                      address: draft.address,
                      city: draft.city,
                      postcode: draft.postcode,
                    }}
                    onChange={(next) =>
                      setDraft((current) => ({ ...current, ...next }))
                    }
                  />
                  <Field>
                    <FieldLabel>Matter Type</FieldLabel>
                    <OptionSelect
                      value={draft.matterType}
                      onChange={setField("matterType")}
                      options={MATTER_TYPES}
                      placeholder="Select matter type"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel htmlFor="add-property-value">
                        Value (£) <span className="text-destructive">*</span>
                      </FieldLabel>
                      <CommaInput
                        id="add-property-value"
                        value={draft.value}
                        onChange={setField("value")}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="add-property-loan">
                        Loan Amount (£){" "}
                        <span className="text-destructive">*</span>
                      </FieldLabel>
                      <CommaInput
                        id="add-property-loan"
                        value={draft.loanAmount}
                        onChange={setField("loanAmount")}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="add-property-rent">
                        Rental Income (£/mo)
                        {wantsRent ? (
                          <span className="text-destructive"> *</span>
                        ) : null}
                      </FieldLabel>
                      <CommaInput
                        id="add-property-rent"
                        value={draft.rent}
                        onChange={setField("rent")}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="add-property-gdv">GDV (£)</FieldLabel>
                      <CommaInput
                        id="add-property-gdv"
                        value={draft.gdv}
                        onChange={setField("gdv")}
                      />
                    </Field>
                  </div>
                </FormSection>

                <FormSection
                  id="details"
                  title="Property details"
                  filled={countFilled([
                    draft.propertyType,
                    draft.tenure,
                    draft.bedrooms,
                    draft.yearBuilt,
                    draft.epcRating,
                  ])}
                  total={5}
                >
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel>Property Type</FieldLabel>
                      <OptionSelect
                        value={draft.propertyType}
                        onChange={setField("propertyType")}
                        options={PROPERTY_TYPES}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Tenure</FieldLabel>
                      <OptionSelect
                        value={draft.tenure}
                        onChange={setField("tenure")}
                        options={TENURES}
                      />
                    </Field>
                    {isLeasehold ? (
                      <Field>
                        <FieldLabel htmlFor="add-property-lease">
                          Lease Years Remaining
                        </FieldLabel>
                        <Input
                          id="add-property-lease"
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={draft.leaseYearsRemaining}
                          onChange={onInput("leaseYearsRemaining")}
                        />
                      </Field>
                    ) : null}
                    <Field>
                      <FieldLabel htmlFor="add-property-bedrooms">
                        Bedrooms
                      </FieldLabel>
                      <Input
                        id="add-property-bedrooms"
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={draft.bedrooms}
                        onChange={onInput("bedrooms")}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="add-property-year">
                        Year Built
                      </FieldLabel>
                      <Input
                        id="add-property-year"
                        type="number"
                        min="1000"
                        max="2100"
                        step="1"
                        inputMode="numeric"
                        value={draft.yearBuilt}
                        onChange={onInput("yearBuilt")}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>EPC Rating</FieldLabel>
                      <OptionSelect
                        value={draft.epcRating}
                        onChange={setField("epcRating")}
                        options={EPC_RATINGS}
                      />
                    </Field>
                  </div>
                </FormSection>

                <FormSection
                  id="occupancy"
                  title="Occupancy & letting"
                  filled={countFilled([
                    draft.occupancy,
                    ...(isLet ? [draft.tenancyType] : []),
                  ])}
                  total={isLet ? 2 : 1}
                >
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel>Occupancy</FieldLabel>
                      <OptionSelect
                        value={draft.occupancy}
                        onChange={setField("occupancy")}
                        options={OCCUPANCIES}
                      />
                    </Field>
                    {isLet ? (
                      <Field>
                        <FieldLabel>Tenancy Type</FieldLabel>
                        <OptionSelect
                          value={draft.tenancyType}
                          onChange={setField("tenancyType")}
                          options={TENANCY_TYPES}
                        />
                      </Field>
                    ) : null}
                  </div>
                </FormSection>

                <FormSection
                  id="mortgage"
                  title="Purchase & current mortgage"
                  filled={countFilled([
                    draft.purchasePrice,
                    draft.purchaseDate,
                    draft.currentLender,
                    draft.currentRatePct,
                    draft.currentBalance,
                    draft.currentRateEndDate,
                  ])}
                  total={6}
                >
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel htmlFor="add-property-purchase-price">
                        Purchase Price (£)
                      </FieldLabel>
                      <CommaInput
                        id="add-property-purchase-price"
                        value={draft.purchasePrice}
                        onChange={setField("purchasePrice")}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Purchase Date</FieldLabel>
                      <DatePicker
                        value={draft.purchaseDate}
                        onChange={setField("purchaseDate")}
                        className="w-full justify-start"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="add-property-current-lender">
                        Current Lender
                      </FieldLabel>
                      <Input
                        id="add-property-current-lender"
                        value={draft.currentLender}
                        onChange={onInput("currentLender")}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="add-property-current-rate">
                        Current Rate (%)
                      </FieldLabel>
                      <Input
                        id="add-property-current-rate"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        inputMode="decimal"
                        value={draft.currentRatePct}
                        onChange={onInput("currentRatePct")}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="add-property-current-balance">
                        Outstanding Balance (£)
                      </FieldLabel>
                      <CommaInput
                        id="add-property-current-balance"
                        value={draft.currentBalance}
                        onChange={setField("currentBalance")}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Current Rate Ends</FieldLabel>
                      <DatePicker
                        value={draft.currentRateEndDate}
                        onChange={setField("currentRateEndDate")}
                        className="w-full justify-start"
                      />
                    </Field>
                  </div>
                </FormSection>

                <FormSection id="notes" title="Notes">
                  <Field>
                    <FieldLabel htmlFor="add-property-notes">Notes</FieldLabel>
                    <Textarea
                      id="add-property-notes"
                      value={draft.notes}
                      onChange={onInput("notes")}
                      placeholder="Access, works needed, valuation concerns…"
                      className="min-h-[80px]"
                    />
                  </Field>
                </FormSection>
              </FormSections>

              {!editingId ? (
                <AssigneeSelect
                  section="property"
                  value={assignee}
                  onChange={setAssignee}
                />
              ) : null}

              <div className="flex items-center justify-between gap-3">
                {editingId ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      Changes save automatically
                    </span>
                    <SaveStatus status={autosave.status} error={autosave.error} />
                  </>
                ) : (
                  <>
                    <span />
                    <Button type="submit" size="sm" disabled={isPending}>
                      {isPending ? "Saving..." : "Create property"}
                    </Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Pick a property above, or add a new one.
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
