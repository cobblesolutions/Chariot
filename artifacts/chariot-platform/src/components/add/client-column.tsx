import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import {
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
import { UploadProgress } from "@/components/upload-progress";
import { documentUploadHeaders, useUpload } from "@/lib/upload";
import { FormSection, FormSections, countFilled, span } from "./form-section";
import { CompanyNameCombobox } from "@/components/company-name-combobox";
import { AddressFields } from "@/components/address-fields";
import { OptionSelect } from "./option-select";
import { NationalitySelect } from "./nationality-select";
import { RequiredDot } from "@/components/required-dot";
import { IncomeEvidence } from "./income-evidence";
import { DocumentChecks } from "./document-checks";
import { documentFilledClass } from "@/lib/document-filled";
import { cn } from "@/lib/utils";

/** Document categories the reading system handles (mirrors READERS on the server). */
const READABLE_CATEGORIES = new Set(["identity", "bank_statements", "proof_income", "credit_report", "portfolio"]);
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

/** Column 1: the fixed client's full record, editable in place. */
export function ClientColumn({
  client,
  isClientLoading,
}: {
  client: ClientDetail | undefined;
  isClientLoading: boolean;
}) {
  return (
    <section className="space-y-4">
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
  // What the draft was seeded/mirrored with: saves send only the fields that
  // differ from it (staff's own edits), so values a reader wrote on the server
  // are never overwritten by a draft that has not caught up with them yet.
  const baseline = useRef<ClientDraft>(draftFromClient(client));
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    // Re-seed only when a different client is loaded, so in-progress edits
    // survive background refetches of the same client.
    if (seededFor.current !== client.id) {
      seededFor.current = client.id;
      baseline.current = draftFromClient(client);
      setDraft(baseline.current);
    }
  }, [client]);

  const qcInvalidate = () => qc.invalidateQueries({ queryKey: getGetClientQueryKey(client.id) });

  // Readers run in the background after an upload; poll until every readable
  // document has a result so the reading lines and checks fill in by themselves.
  const readingPending = client.documents.some(
    (document) => READABLE_CATEGORIES.has(document.category) && document.reading?.status === "pending",
  );
  useEffect(() => {
    if (!readingPending) return;
    const timer = window.setInterval(qcInvalidate, 2500);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingPending, client.id]);

  // When a reader fills client fields on the server, mirror them into the
  // draft so the next autosave does not send the still-empty draft values back
  // over them. A newly completed reading triggers one more fetch first: the
  // client row in the response that showed the reading may predate its apply.
  const readingSync = useRef<{ seen: Set<string>; mounted: boolean; pending: Set<string> | null }>({ seen: new Set(), mounted: false, pending: null });
  useEffect(() => {
    const sync = readingSync.current;
    if (sync.pending) {
      const fields = sync.pending;
      sync.pending = null;
      const fresh = draftFromClient(client);
      setDraft((current) => {
        const next = { ...current };
        for (const field of fields) {
          const key = field as keyof ClientDraft;
          if (key in fresh && !current[key] && fresh[key]) {
            next[key] = fresh[key];
            baseline.current = { ...baseline.current, [key]: fresh[key] };
          }
        }
        return next;
      });
    }
    const applied: string[] = [];
    for (const document of client.documents) {
      const reading = document.reading;
      if (!reading || reading.status !== "completed") continue;
      const key = `${document.id}:${reading.readAt}`;
      if (sync.seen.has(key)) continue;
      sync.seen.add(key);
      // The seed already reflects readings that finished before the form opened.
      if (sync.mounted) applied.push(...reading.appliedFields);
    }
    sync.mounted = true;
    if (applied.length > 0) {
      sync.pending = new Set(applied);
      qcInvalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // Yellow = the value on the record was written by a reader and staff have
  // not changed it (typing removes the colour at once; saving removes it for good).
  const filledFields = new Set(client.documentFilledFields ?? []);
  const seed = draftFromClient(client);
  const fromDocument = (key: keyof ClientDraft) => filledFields.has(key) && draft[key] === seed[key];
  const fieldClass = (key: keyof ClientDraft) => documentFilledClass(fromDocument(key));
  const anyFromDocument = (Object.keys(draft) as Array<keyof ClientDraft>).some(fromDocument);

  const documentInputRef = useRef<HTMLInputElement>(null);
  const documentCategoryRef = useRef("onboarding");
  const documentUpload = useUpload();

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
      // Partial PATCH: only what staff changed since the seed / last save.
      const base = payloadFromDraft(baseline.current) as Record<string, unknown>;
      const changed = Object.fromEntries(
        Object.entries(payload).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(base[key])),
      ) as Partial<typeof payload>;
      const snapshot = draftRef.current;
      if (Object.keys(changed).length === 0) return;
      try {
        await updateClient.mutateAsync({ id: client.id, data: changed });
        baseline.current = snapshot;
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
      for (const [index, file] of files.entries()) {
        if (file.size > 50 * 1024 * 1024) {
          throw new Error(
            `${file.name} is too large. Maximum file size is 50 MB.`,
          );
        }
        await documentUpload.send(file, {
          url: "/api/documents/upload",
          headers: documentUploadHeaders(file, {
            "x-client-id": client.id,
            "x-document-category": documentCategoryRef.current,
          }),
          index,
          count: files.length,
        });
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
      documentUpload.reset();
      if (documentInputRef.current) documentInputRef.current.value = "";
    }
  };

  const onboarding = client.onboarding;
  const showReferrer = draft.source === "referral" || draft.source === "introducer" || !!draft.introducerName;
  // The one hidden input serves both the onboarding list and proof of income;
  // the progress line sits under whichever section started the upload.
  const uploadingIncome = documentCategoryRef.current === "proof_income";

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

      {anyFromDocument ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden className="inline-block size-3 rounded-sm border border-yellow-400 bg-yellow-50 dark:border-yellow-600 dark:bg-yellow-950/40" />
          Yellow fields were read from documents — check them.
        </p>
      ) : null}
      <FormSections>
        <FormSection
          id="onboarding"
          wide
          title="Onboarding & documents"
          filled={onboarding.completed}
          total={onboarding.total}
        >
          {!uploadingIncome ? <UploadProgress progress={documentUpload.progress} /> : null}
          <OnboardingList
            items={onboarding.items}
            onUpdateItem={handleUpdateOnboarding}
            onUploadDocument={(key) => {
              documentCategoryRef.current = key;
              documentInputRef.current?.click();
            }}
            isUpdating={updateOnboarding.isPending}
            documents={client.documents}
            onReadingChanged={invalidateClient}
            onDocumentDeleted={invalidateClient}
            onDocumentUpdated={invalidateClient}
          />
          <DocumentChecks checks={client.documentChecks} />
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
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
            <Field>
              <FieldLabel>Title</FieldLabel>
              <OptionSelect
                value={draft.title}
                onChange={setField("title")}
                options={CLIENT_TITLES}
                placeholder="—"
                className={fieldClass("title")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-client-name">
                Full Name <RequiredDot />
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
              Email Address <RequiredDot />
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
          <Field>
            <FieldLabel htmlFor="add-client-phone">
              Phone Number <RequiredDot />
            </FieldLabel>
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
          <AddressFields
            idPrefix="add-client"
            label="Current Address"
            layout="row"
            required
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
            classNames={{
              address: fieldClass("currentAddress"),
              city: fieldClass("currentAddressCity"),
              postcode: fieldClass("currentAddressPostcode"),
            }}
          />
          <AddressFields
            idPrefix="add-client-prev"
            label="Previous Address"
            layout="row"
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
            classNames={{
              address: fieldClass("previousAddress"),
              city: fieldClass("previousAddressCity"),
              postcode: fieldClass("previousAddressPostcode"),
            }}
          />
        </FormSection>

        <FormSection
          id="personal"
          title="Personal"
          cols={2}
          filled={countFilled([
            draft.dateOfBirth,
            draft.nationality,
            draft.maritalStatus,
            draft.dependants,
          ])}
          total={4}
        >
            <Field>
              <FieldLabel>
                Date of Birth <RequiredDot />
              </FieldLabel>
              <DatePicker
                value={draft.dateOfBirth}
                onChange={setField("dateOfBirth")}
                className={cn("w-full justify-start", fieldClass("dateOfBirth"))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-client-nationality">
                Nationality
              </FieldLabel>
              <NationalitySelect
                id="add-client-nationality"
                value={draft.nationality}
                onChange={setField("nationality")}
                className={fieldClass("nationality")}
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
        </FormSection>

        <FormSection
          id="company"
          title="Company"
          cols={2}
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
              onSelect={(company) =>
                setDraft((current) => ({
                  ...current,
                  companyName: company.name,
                  companyNumber: company.companyNumber,
                  companyRegisteredAddress:
                    company.registeredAddress?.line1 ?? current.companyRegisteredAddress,
                  companyRegisteredCity:
                    company.registeredAddress?.city ?? current.companyRegisteredCity,
                  companyRegisteredPostcode:
                    company.registeredAddress?.postcode ?? current.companyRegisteredPostcode,
                }))
              }
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
              className={fieldClass("companyNumber")}
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
          <div className={span.full}>
          <IncomeEvidence
            client={client}
            draft={{
              annualIncome: draft.annualIncome,
              employerName: draft.employerName,
              jobTitle: draft.jobTitle,
              employmentStatus: draft.employmentStatus,
            }}
            onApply={(values) => setDraft((current) => ({ ...current, ...values }))}
            onUpload={() => {
              documentCategoryRef.current = "proof_income";
              documentInputRef.current?.click();
            }}
            onRefresh={invalidateClient}
          />
          {uploadingIncome ? <UploadProgress progress={documentUpload.progress} /> : null}
          </div>
          <Field>
            <FieldLabel>
              Employment Status <RequiredDot />
            </FieldLabel>
            <OptionSelect
              value={draft.employmentStatus}
              onChange={setField("employmentStatus")}
              options={EMPLOYMENT_STATUSES}
              className={fieldClass("employmentStatus")}
            />
          </Field>
            <Field>
              <FieldLabel htmlFor="add-client-employer">Employer</FieldLabel>
              <Input
                id="add-client-employer"
                value={draft.employerName}
                onChange={onInput("employerName")}
                className={fieldClass("employerName")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-client-job">Job Title</FieldLabel>
              <Input
                id="add-client-job"
                value={draft.jobTitle}
                onChange={onInput("jobTitle")}
                className={fieldClass("jobTitle")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-client-income">
                Annual Income (£) <RequiredDot />
              </FieldLabel>
              <CommaInput
                id="add-client-income"
                value={draft.annualIncome}
                onChange={setField("annualIncome")}
                className={fieldClass("annualIncome")}
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
                className={fieldClass("monthlyCommitments")}
              />
            </Field>
          <Field className={span.half}>
            <FieldLabel htmlFor="add-client-credit">Credit History</FieldLabel>
            <Textarea
              id="add-client-credit"
              value={draft.creditHistoryNotes}
              onChange={onInput("creditHistoryNotes")}
              placeholder="Defaults, CCJs, missed payments, IVAs…"
              className={cn("min-h-9", fieldClass("creditHistoryNotes"))}
            />
          </Field>
        </FormSection>

        <FormSection
          id="enquiry"
          title="Enquiry"
          cols={3}
          filled={countFilled([draft.source, draft.enquiryType, draft.enquirySummary])}
          total={3}
        >
            <Field>
              <FieldLabel>Source</FieldLabel>
              <OptionSelect
                value={draft.source}
                onChange={setField("source")}
                options={SOURCE_OPTIONS}
                placeholder="Not set"
                className={fieldClass("source")}
              />
            </Field>
            <Field>
              <FieldLabel>What they want</FieldLabel>
              <OptionSelect
                value={draft.enquiryType}
                onChange={setField("enquiryType")}
                options={ENQUIRY_TYPE_OPTIONS}
                placeholder="Not set"
                className={fieldClass("enquiryType")}
              />
            </Field>
          <Field>
            <FieldLabel htmlFor="add-client-enquiry-timescale">Timescale</FieldLabel>
            <Input
              id="add-client-enquiry-timescale"
              value={draft.enquiryTimescale}
              onChange={onInput("enquiryTimescale")}
              placeholder="e.g. exchange by end of October"
              className={fieldClass("enquiryTimescale")}
            />
          </Field>
          {showReferrer ? (
            <>
              <Field>
                <FieldLabel htmlFor="add-client-introducer">Referred by</FieldLabel>
                <Input
                  id="add-client-introducer"
                  value={draft.introducerName}
                  onChange={onInput("introducerName")}
                  className={fieldClass("introducerName")}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="add-client-introducer-contact">Their contact</FieldLabel>
                <Input
                  id="add-client-introducer-contact"
                  value={draft.introducerContact}
                  onChange={onInput("introducerContact")}
                  className={fieldClass("introducerContact")}
                />
              </Field>
            </>
          ) : null}
          <Field className={span.full}>
            <FieldLabel htmlFor="add-client-enquiry-summary">In short</FieldLabel>
            <Textarea
              id="add-client-enquiry-summary"
              value={draft.enquirySummary}
              onChange={onInput("enquirySummary")}
              placeholder="What they asked for, in a sentence or two"
              className={cn("min-h-9", fieldClass("enquirySummary"))}
            />
          </Field>
          {client.enquiryEmailText ? (
            <details className={cn("text-sm", span.full)}>
              <summary className="cursor-pointer text-muted-foreground">Original email</summary>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs">
                {client.enquiryEmailText}
              </pre>
            </details>
          ) : null}
        </FormSection>

        <FormSection id="notes" title="Notes" cols={1} stretch>
          <Field className={span.full}>
            <FieldLabel htmlFor="add-client-notes">Notes</FieldLabel>
            <Textarea
              id="add-client-notes"
              value={draft.notes}
              onChange={onInput("notes")}
              placeholder="Anything else the team should know"
              className="min-h-9"
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
