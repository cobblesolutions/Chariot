import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import {
  useGetTermsOfBusiness,
  useUpdateClient,
  useUpdateClientOnboardingItem,
  getListClientsQueryKey,
  getGetClientQueryKey,
  type ClientDetail,
  type ClientSource,
  type EnquiryType,
  type OnboardingItemUpdateStatus,
} from "@workspace/api-client-react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutosave } from "./use-autosave";
import { SaveStatus } from "./save-status";
import { Textarea } from "@/components/ui/textarea";
import { CommaInput } from "@/components/ui/comma-input";
import { DatePicker } from "@/components/date-picker";
import { OnboardingList } from "@/components/onboarding-list";
import { TermsAcceptDialog } from "@/components/client/terms-accept-dialog";
import { ColumnHeader } from "./column-header";
import { FormSection, FormSections, countFilled } from "./form-section";
import { CompanyNameCombobox } from "./company-name-combobox";
import { AddressFields } from "@/components/address-fields";
import { OptionSelect } from "./option-select";
import { ENQUIRY_TYPE_OPTIONS, SOURCE_OPTIONS } from "@/lib/enquiry";
import {
  ACCEPTED_DOCUMENT_TYPES,
  CLIENT_TITLES,
  EMPLOYMENT_STATUSES,
  MARITAL_STATUSES,
  apiErrorMessage,
  apiErrorStatus,
  emptyToNull,
  numberToInput,
  parseAmount,
  parseWholeNumber,
} from "./utils";

interface ClientDraft {
  name: string;
  email: string;
  phone: string;
  alternativePhone: string;
  currentAddress: string;
  currentAddressCity: string;
  currentAddressPostcode: string;
  previousAddress: string;
  previousAddressCity: string;
  previousAddressPostcode: string;
  title: string;
  dateOfBirth: string;
  nationality: string;
  maritalStatus: string;
  dependants: string;
  employmentStatus: string;
  employerName: string;
  jobTitle: string;
  annualIncome: string;
  otherIncome: string;
  monthlyCommitments: string;
  creditHistoryNotes: string;
  companyName: string;
  companyNumber: string;
  companyRegisteredAddress: string;
  companyRegisteredCity: string;
  companyRegisteredPostcode: string;
  notes: string;
  source: string;
  introducerName: string;
  introducerContact: string;
  enquiryType: string;
  enquirySummary: string;
  enquiryTimescale: string;
}

function draftFromClient(client: ClientDetail): ClientDraft {
  return {
    name: client.name,
    email: client.email,
    phone: client.phone,
    alternativePhone: client.alternativePhone ?? "",
    currentAddress: client.currentAddress ?? "",
    currentAddressCity: client.currentAddressCity ?? "",
    currentAddressPostcode: client.currentAddressPostcode ?? "",
    previousAddress: client.previousAddress ?? "",
    previousAddressCity: client.previousAddressCity ?? "",
    previousAddressPostcode: client.previousAddressPostcode ?? "",
    title: client.title ?? "",
    dateOfBirth: client.dateOfBirth ?? "",
    nationality: client.nationality ?? "",
    maritalStatus: client.maritalStatus ?? "",
    dependants: numberToInput(client.dependants),
    employmentStatus: client.employmentStatus ?? "",
    employerName: client.employerName ?? "",
    jobTitle: client.jobTitle ?? "",
    annualIncome: numberToInput(client.annualIncome),
    otherIncome: numberToInput(client.otherIncome),
    monthlyCommitments: numberToInput(client.monthlyCommitments),
    creditHistoryNotes: client.creditHistoryNotes ?? "",
    companyName: client.companyName ?? "",
    companyNumber: client.companyNumber ?? "",
    companyRegisteredAddress: client.companyRegisteredAddress ?? "",
    companyRegisteredCity: client.companyRegisteredCity ?? "",
    companyRegisteredPostcode: client.companyRegisteredPostcode ?? "",
    notes: client.notes ?? "",
    source: client.source ?? "",
    introducerName: client.introducerName ?? "",
    introducerContact: client.introducerContact ?? "",
    enquiryType: client.enquiryType ?? "",
    enquirySummary: client.enquirySummary ?? "",
    enquiryTimescale: client.enquiryTimescale ?? "",
  };
}

function payloadFromDraft(draft: ClientDraft) {
  return {
    name: draft.name.trim(),
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    companyName: draft.companyName.trim(),
    title: emptyToNull(draft.title),
    dateOfBirth: emptyToNull(draft.dateOfBirth),
    nationality: emptyToNull(draft.nationality),
    maritalStatus: emptyToNull(draft.maritalStatus),
    dependants: parseWholeNumber(draft.dependants),
    currentAddress: emptyToNull(draft.currentAddress),
    currentAddressCity: emptyToNull(draft.currentAddressCity),
    currentAddressPostcode: emptyToNull(draft.currentAddressPostcode),
    previousAddress: emptyToNull(draft.previousAddress),
    previousAddressCity: emptyToNull(draft.previousAddressCity),
    previousAddressPostcode: emptyToNull(draft.previousAddressPostcode),
    alternativePhone: emptyToNull(draft.alternativePhone),
    employmentStatus: emptyToNull(draft.employmentStatus),
    employerName: emptyToNull(draft.employerName),
    jobTitle: emptyToNull(draft.jobTitle),
    annualIncome: parseAmount(draft.annualIncome),
    otherIncome: parseAmount(draft.otherIncome),
    monthlyCommitments: parseAmount(draft.monthlyCommitments),
    creditHistoryNotes: emptyToNull(draft.creditHistoryNotes),
    companyNumber: emptyToNull(draft.companyNumber),
    companyRegisteredAddress: emptyToNull(draft.companyRegisteredAddress),
    companyRegisteredCity: emptyToNull(draft.companyRegisteredCity),
    companyRegisteredPostcode: emptyToNull(draft.companyRegisteredPostcode),
    notes: emptyToNull(draft.notes),
    source: (emptyToNull(draft.source) as ClientSource | null),
    introducerName: emptyToNull(draft.introducerName),
    introducerContact: emptyToNull(draft.introducerContact),
    enquiryType: (emptyToNull(draft.enquiryType) as EnquiryType | null),
    enquirySummary: emptyToNull(draft.enquirySummary),
    enquiryTimescale: emptyToNull(draft.enquiryTimescale),
  };
}


/** The section to open first: the first one with something still missing. */
function firstIncompleteSection(client: ClientDetail, draft: ClientDraft): string {
  if (!draft.phone || !draft.currentAddress) return "contact";
  if (!draft.dateOfBirth) return "personal";
  if (!draft.employmentStatus || !draft.annualIncome) return "employment";
  if (client.onboarding.completed < client.onboarding.total) return "onboarding";
  return "notes";
}

/** Column 1: the fixed client's full record, editable in place. */
export function ClientColumn({
  client,
  isClientLoading,
  needs,
}: {
  client: ClientDetail | undefined;
  isClientLoading: boolean;
  needs?: string[];
}) {
  return (
    <section className="space-y-6">
      <ColumnHeader
        title="Client"
        status="saved"
        needs={needs}
      />
      <div className="space-y-4">
        {client ? (
          <ClientForm client={client} />
        ) : isClientLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ClientForm({ client }: { client: ClientDetail }) {
  const qc = useQueryClient();
  const updateClient = useUpdateClient();
  const updateOnboarding = useUpdateClientOnboardingItem();

  const [draft, setDraft] = useState<ClientDraft>(() =>
    draftFromClient(client),
  );
  const seededFor = useRef<number>(client.id);

  useEffect(() => {
    // Re-seed only when a different client is loaded, so in-progress edits
    // survive background refetches of the same client.
    if (seededFor.current !== client.id) {
      seededFor.current = client.id;
      setDraft(draftFromClient(client));
    }
  }, [client]);

  const documentInputRef = useRef<HTMLInputElement>(null);
  const documentCategoryRef = useRef("onboarding");
  const { data: termsDoc } = useGetTermsOfBusiness();
  const [termsOpen, setTermsOpen] = useState(false);

  const setField =
    <K extends keyof ClientDraft>(key: K) =>
    (value: ClientDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value }));
  const onInput =
    (key: keyof ClientDraft) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setField(key)(event.target.value);

  const invalidateClient = () => {
    qc.invalidateQueries({ queryKey: getGetClientQueryKey(client.id) });
    qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
  };

  // Every change saves itself a moment after typing stops, and on blur.
  const autosave = useAutosave({
    enabled: true,
    payload: payloadFromDraft(draft),
    seedKey: client.id,
    validate: (payload) =>
      !payload.name || !payload.email ? "Name and email are required" : null,
    save: async (payload) => {
      try {
        await updateClient.mutateAsync({ id: client.id, data: payload });
        invalidateClient();
      } catch (error) {
        throw new Error(
          apiErrorStatus(error) === 409
            ? "Another client already uses this email"
            : apiErrorMessage(error, "Couldn't save client details"),
        );
      }
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    autosave.flush();
  };

  const handleUpdateOnboarding = (
    key: string,
    data: { value?: string | null; status?: OnboardingItemUpdateStatus },
  ) => {
    updateOnboarding.mutate(
      { id: client.id, key, data },
      {
        onSuccess: () => {
          toast.add({ title: "Requirement updated", type: "success" });
          invalidateClient();
        },
        onError: () =>
          toast.add({ title: "Failed to update requirement", type: "error" }),
      },
    );
  };

  const handleDocumentUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    let uploaded = 0;
    try {
      for (const file of files) {
        if (file.size > 50 * 1024 * 1024) {
          throw new Error(
            `${file.name} is too large. Maximum file size is 50 MB.`,
          );
        }
        const response = await fetch("/api/documents/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-client-id": String(client.id),
            "x-filename": file.name,
            "x-content-type": file.type || "application/octet-stream",
            "x-document-category": documentCategoryRef.current,
          },
          body: await file.arrayBuffer(),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || `Upload failed for ${file.name}`);
        }
        uploaded += 1;
      }
      toast.add({
        title: `${uploaded} document${uploaded === 1 ? "" : "s"} uploaded`,
        type: "success",
      });
      invalidateClient();
    } catch (error) {
      toast.add({
        title: "Document upload failed",
        description: error instanceof Error ? error.message : "Upload failed",
        type: "error",
      });
    } finally {
      if (documentInputRef.current) documentInputRef.current.value = "";
    }
  };

  const onboarding = client.onboarding;

  return (
    <form
      onSubmit={handleSubmit}
      onBlur={() => autosave.flush()}
      className="space-y-4"
    >
      <input
        ref={documentInputRef}
        type="file"
        className="hidden"
        multiple
        accept={ACCEPTED_DOCUMENT_TYPES}
        onChange={handleDocumentUpload}
      />

      <FormSections defaultOpen={firstIncompleteSection(client, draft)}>
        <FormSection
          id="onboarding"
          title="Onboarding & documents"
          filled={onboarding.completed}
          total={onboarding.total}
          hint="What the case needs before it can proceed. Fields save when you leave them; documents upload immediately."
        >
          <OnboardingList
            items={onboarding.items}
            onUpdateItem={handleUpdateOnboarding}
            onUploadDocument={(key) => {
              documentCategoryRef.current = key;
              documentInputRef.current?.click();
            }}
            isUpdating={updateOnboarding.isPending}
            documents={client.documents}
            onDocumentDeleted={invalidateClient}
            terms={{
              document: termsDoc?.document ?? null,
              acceptance: client.termsOfBusiness,
              viewHref: "/api/settings/terms-of-business/document",
              onMarkAccepted: () => setTermsOpen(true),
            }}
          />
          <TermsAcceptDialog open={termsOpen} onOpenChange={setTermsOpen} clientId={client.id} onAccepted={invalidateClient} />
        </FormSection>

        <FormSection
          id="contact"
          title="Contact"
          filled={countFilled([
            draft.name,
            draft.email,
            draft.phone,
            draft.currentAddress,
          ])}
          total={4}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,3fr)] gap-4">
            <Field>
              <FieldLabel>Title</FieldLabel>
              <OptionSelect
                value={draft.title}
                onChange={setField("title")}
                options={CLIENT_TITLES}
                placeholder="—"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-client-name">
                Full Name <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="add-client-name"
                value={draft.name}
                onChange={onInput("name")}
                required
                autoComplete="off"
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="add-client-email">
              Email Address <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              id="add-client-email"
              type="email"
              value={draft.email}
              onChange={onInput("email")}
              required
              autoComplete="off"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="add-client-phone">Phone Number</FieldLabel>
              <Input
                id="add-client-phone"
                value={draft.phone}
                onChange={onInput("phone")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-client-alt-phone">
                Alternative Phone
              </FieldLabel>
              <Input
                id="add-client-alt-phone"
                value={draft.alternativePhone}
                onChange={onInput("alternativePhone")}
              />
            </Field>
          </div>
          <AddressFields
            idPrefix="add-client"
            label="Current Address"
            value={{
              address: draft.currentAddress,
              city: draft.currentAddressCity,
              postcode: draft.currentAddressPostcode,
            }}
            onChange={(next) =>
              setDraft((current) => ({
                ...current,
                currentAddress: next.address,
                currentAddressCity: next.city,
                currentAddressPostcode: next.postcode,
              }))
            }
          />
          <AddressFields
            idPrefix="add-client-prev"
            label="Previous Address"
            placeholder="If at the current address for under 3 years"
            value={{
              address: draft.previousAddress,
              city: draft.previousAddressCity,
              postcode: draft.previousAddressPostcode,
            }}
            onChange={(next) =>
              setDraft((current) => ({
                ...current,
                previousAddress: next.address,
                previousAddressCity: next.city,
                previousAddressPostcode: next.postcode,
              }))
            }
          />
        </FormSection>

        <FormSection
          id="personal"
          title="Personal"
          filled={countFilled([
            draft.dateOfBirth,
            draft.nationality,
            draft.maritalStatus,
            draft.dependants,
          ])}
          total={4}
        >
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel>Date of Birth</FieldLabel>
              <DatePicker
                value={draft.dateOfBirth}
                onChange={setField("dateOfBirth")}
                className="w-full justify-start"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-client-nationality">
                Nationality
              </FieldLabel>
              <Input
                id="add-client-nationality"
                value={draft.nationality}
                onChange={onInput("nationality")}
              />
            </Field>
            <Field>
              <FieldLabel>Marital Status</FieldLabel>
              <OptionSelect
                value={draft.maritalStatus}
                onChange={setField("maritalStatus")}
                options={MARITAL_STATUSES}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-client-dependants">
                Dependants
              </FieldLabel>
              <Input
                id="add-client-dependants"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={draft.dependants}
                onChange={onInput("dependants")}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection
          id="employment"
          title="Employment & income"
          filled={countFilled([
            draft.employmentStatus,
            draft.employerName,
            draft.jobTitle,
            draft.annualIncome,
            draft.monthlyCommitments,
          ])}
          total={5}
        >
          <Field>
            <FieldLabel>Employment Status</FieldLabel>
            <OptionSelect
              value={draft.employmentStatus}
              onChange={setField("employmentStatus")}
              options={EMPLOYMENT_STATUSES}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="add-client-employer">Employer</FieldLabel>
              <Input
                id="add-client-employer"
                value={draft.employerName}
                onChange={onInput("employerName")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-client-job">Job Title</FieldLabel>
              <Input
                id="add-client-job"
                value={draft.jobTitle}
                onChange={onInput("jobTitle")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-client-income">
                Annual Income (£)
              </FieldLabel>
              <CommaInput
                id="add-client-income"
                value={draft.annualIncome}
                onChange={setField("annualIncome")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-client-other-income">
                Other Income (£/yr)
              </FieldLabel>
              <CommaInput
                id="add-client-other-income"
                value={draft.otherIncome}
                onChange={setField("otherIncome")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-client-commitments">
                Monthly Commitments (£)
              </FieldLabel>
              <CommaInput
                id="add-client-commitments"
                value={draft.monthlyCommitments}
                onChange={setField("monthlyCommitments")}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="add-client-credit">Credit History</FieldLabel>
            <Textarea
              id="add-client-credit"
              value={draft.creditHistoryNotes}
              onChange={onInput("creditHistoryNotes")}
              placeholder="Defaults, CCJs, missed payments, IVAs…"
              className="min-h-[60px]"
            />
          </Field>
        </FormSection>

        <FormSection
          id="company"
          title="Company"
          filled={countFilled([
            draft.companyName,
            draft.companyNumber,
            draft.companyRegisteredAddress,
          ])}
          total={3}
        >
          <Field>
            <FieldLabel htmlFor="add-client-company">Company Name</FieldLabel>
            <CompanyNameCombobox
              id="add-client-company"
              value={draft.companyName}
              onChange={setField("companyName")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="add-client-company-number">
              Company Number
            </FieldLabel>
            <Input
              id="add-client-company-number"
              value={draft.companyNumber}
              onChange={onInput("companyNumber")}
            />
          </Field>
          <AddressFields
            idPrefix="add-client-company"
            label="Registered Address"
            value={{
              address: draft.companyRegisteredAddress,
              city: draft.companyRegisteredCity,
              postcode: draft.companyRegisteredPostcode,
            }}
            onChange={(next) =>
              setDraft((current) => ({
                ...current,
                companyRegisteredAddress: next.address,
                companyRegisteredCity: next.city,
                companyRegisteredPostcode: next.postcode,
              }))
            }
          />
        </FormSection>

        <FormSection
          id="enquiry"
          title="Enquiry"
          filled={countFilled([draft.source, draft.enquiryType, draft.enquirySummary])}
          total={3}
          hint="How they came to us and what they asked for — read from the email, or filled in at step 1."
        >
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel>Source</FieldLabel>
              <OptionSelect
                value={draft.source}
                onChange={setField("source")}
                options={SOURCE_OPTIONS}
                placeholder="Not set"
              />
            </Field>
            <Field>
              <FieldLabel>What they want</FieldLabel>
              <OptionSelect
                value={draft.enquiryType}
                onChange={setField("enquiryType")}
                options={ENQUIRY_TYPE_OPTIONS}
                placeholder="Not set"
              />
            </Field>
          </div>
          {draft.source === "referral" || draft.source === "introducer" || draft.introducerName ? (
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="add-client-introducer">Referred by</FieldLabel>
                <Input
                  id="add-client-introducer"
                  value={draft.introducerName}
                  onChange={onInput("introducerName")}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="add-client-introducer-contact">Their contact</FieldLabel>
                <Input
                  id="add-client-introducer-contact"
                  value={draft.introducerContact}
                  onChange={onInput("introducerContact")}
                />
              </Field>
            </div>
          ) : null}
          <Field>
            <FieldLabel htmlFor="add-client-enquiry-summary">In short</FieldLabel>
            <Textarea
              id="add-client-enquiry-summary"
              value={draft.enquirySummary}
              onChange={onInput("enquirySummary")}
              placeholder="What they asked for, in a sentence or two"
              className="min-h-[60px]"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="add-client-enquiry-timescale">Timescale</FieldLabel>
            <Input
              id="add-client-enquiry-timescale"
              value={draft.enquiryTimescale}
              onChange={onInput("enquiryTimescale")}
              placeholder="e.g. exchange by end of October"
            />
          </Field>
          {client.enquiryEmailText ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Original email</summary>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs">
                {client.enquiryEmailText}
              </pre>
            </details>
          ) : null}
        </FormSection>

        <FormSection id="notes" title="Notes">
          <Field>
            <FieldLabel htmlFor="add-client-notes">Notes</FieldLabel>
            <Textarea
              id="add-client-notes"
              value={draft.notes}
              onChange={onInput("notes")}
              placeholder="Anything else the team should know"
              className="min-h-[80px]"
            />
          </Field>
        </FormSection>
      </FormSections>

      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-xs text-muted-foreground">
          {client.email}
        </span>
        <SaveStatus status={autosave.status} error={autosave.error} />
      </div>
    </form>
  );
}
