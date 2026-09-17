import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Mail, PencilLine, Sparkles } from "lucide-react";
import {
  useCreateClient,
  useExtractClientEnquiry,
  useFindClientMatches,
  useRecordRepeatEnquiry,
  getListClientsQueryKey,
  getListTasksQueryKey,
  getGetClientQueryKey,
  type ClientMatch,
  type ClientSource,
  type EnquiryType,
  type ExtractedEnquiry,
} from "@workspace/api-client-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { RequiredDot } from "@/components/required-dot";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn, formatMoney } from "@/lib/utils";
import { ENQUIRY_TYPE_OPTIONS, SOURCE_OPTIONS } from "@/lib/enquiry";
import { AssigneeSelect } from "./assignee-select";
import { CompanyNameCombobox } from "./company-name-combobox";
import { OptionSelect } from "./option-select";
import { apiErrorMessage, apiErrorStatus } from "./utils";

type Mode = "paste" | "manual";

interface BasicDraft {
  name: string;
  email: string;
  phone: string;
  companyName: string;
  companyNumber: string;
  companyRegisteredAddress: string;
  companyRegisteredCity: string;
  companyRegisteredPostcode: string;
  source: ClientSource | "";
  introducerName: string;
  introducerContact: string;
  enquiryType: EnquiryType | "";
  summary: string;
}

const EMPTY_DRAFT: BasicDraft = {
  name: "",
  email: "",
  phone: "",
  companyName: "",
  companyNumber: "",
  companyRegisteredAddress: "",
  companyRegisteredCity: "",
  companyRegisteredPostcode: "",
  source: "",
  introducerName: "",
  introducerContact: "",
  enquiryType: "",
  summary: "",
};

const MATCH_REASON: Record<ClientMatch["reason"], string> = {
  email: "same email",
  company_number: "same company number",
  phone: "same phone number",
  name: "similar name",
};

/**
 * Step 1 of the Add page: the basic client details, read out of a pasted
 * email or typed in. Anything else the email gave (property, timescale) is
 * saved with the client and waits for step 3.
 */
export function EnquiryIntake({
  open,
  onCreated,
  onCancel,
}: {
  open: boolean;
  /** The client to continue with — freshly created or an existing match. */
  onCreated: (clientId: number, options?: { propertyId?: number | null }) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const createClient = useCreateClient();
  const extract = useExtractClientEnquiry();
  const findMatches = useFindClientMatches();
  const repeatEnquiry = useRecordRepeatEnquiry();

  const [mode, setMode] = useState<Mode>("paste");
  const [emailText, setEmailText] = useState("");
  const [extracted, setExtracted] = useState<ExtractedEnquiry | null>(null);
  const [extractionModel, setExtractionModel] = useState<string | null>(null);
  const [draft, setDraft] = useState<BasicDraft>(EMPTY_DRAFT);
  const [assignee, setAssignee] = useState<number | null>(null);
  const [matches, setMatches] = useState<ClientMatch[]>([]);
  const [showFound, setShowFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The review form is shown after extraction, or straight away in manual mode.
  const reviewing = mode === "manual" || extracted !== null;

  useEffect(() => {
    if (!open) {
      setMode("paste");
      setEmailText("");
      setExtracted(null);
      setExtractionModel(null);
      setDraft(EMPTY_DRAFT);
      setAssignee(null);
      setMatches([]);
      setShowFound(false);
      setError(null);
    }
  }, [open]);

  const setField =
    <K extends keyof BasicDraft>(key: K) =>
    (value: BasicDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value }));

  // Duplicate check while typing, debounced; extraction seeds it directly.
  useEffect(() => {
    if (!reviewing) return;
    const email = draft.email.trim();
    const name = draft.name.trim();
    const phone = draft.phone.trim();
    if (!email && name.length < 3 && phone.length < 10) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      findMatches.mutate(
        { data: { email: email || null, name: name || null, phone: phone || null } },
        { onSuccess: (result) => setMatches(result.matches) },
      );
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.email, draft.name, draft.phone, reviewing]);

  const emailMatch = useMemo(
    () => matches.find((match) => match.reason === "email"),
    [matches],
  );

  const handleExtract = () => {
    const text = emailText.trim();
    if (!text) return;
    setError(null);
    extract.mutate(
      { data: { emailText: text } },
      {
        onSuccess: (result) => {
          setExtracted(result.extracted);
          setExtractionModel(result.model);
          setMatches(result.matches);
          setDraft({
            name: result.extracted.client.name ?? "",
            email: result.extracted.client.email ?? "",
            phone: result.extracted.client.phone ?? "",
            companyName: result.extracted.client.companyName ?? "",
            companyNumber: result.extracted.client.companyNumber ?? "",
            companyRegisteredAddress: "",
            companyRegisteredCity: "",
            companyRegisteredPostcode: "",
            source: result.extracted.enquiry.source ?? "email",
            introducerName: result.extracted.enquiry.introducerName ?? "",
            introducerContact: result.extracted.enquiry.introducerContact ?? "",
            enquiryType: result.extracted.enquiry.type ?? "",
            summary: result.extracted.enquiry.summary ?? "",
          });
          setShowFound(true);
        },
        onError: (err) =>
          setError(apiErrorMessage(err, "Couldn't read that email. Try entering the details manually.")),
      },
    );
  };

  const foundExtras = useMemo(() => {
    if (!extracted) return [];
    const items: Array<{ label: string; value: string }> = [];
    const { property, enquiry, client } = extracted;
    if (client.companyNumber) items.push({ label: "Company no.", value: client.companyNumber });
    if (client.currentAddress || client.currentAddressPostcode) items.push({ label: "Lives at", value: [client.currentAddress, client.currentAddressCity, client.currentAddressPostcode].filter(Boolean).join(", ") });
    if (client.employerName || client.jobTitle) items.push({ label: "Work", value: [client.jobTitle, client.employerName].filter(Boolean).join(" at ") });
    if (client.annualIncome != null) items.push({ label: "Income", value: `${formatMoney(client.annualIncome)}/yr` });
    if (property.address) items.push({ label: "Property", value: [property.address, property.city, property.postcode].filter(Boolean).join(", ") });
    if (property.value != null) items.push({ label: "Value", value: formatMoney(property.value) });
    if (property.purchasePrice != null) items.push({ label: "Price", value: formatMoney(property.purchasePrice) });
    if (property.loanAmount != null) items.push({ label: "Loan", value: formatMoney(property.loanAmount) });
    if (property.rent != null) items.push({ label: "Rent", value: `${formatMoney(property.rent)}/mo` });
    if (property.matterType) items.push({ label: "Matter", value: property.matterType.toUpperCase() });
    if (property.currentLender || property.currentBalance != null) {
      items.push({ label: "Current mortgage", value: [property.currentLender, property.currentBalance != null ? formatMoney(property.currentBalance) : null, property.currentRatePct != null ? `${property.currentRatePct}%` : null, property.currentRateEndDate ? `ends ${property.currentRateEndDate}` : null].filter(Boolean).join(" · ") });
    }
    if (enquiry.timescale) items.push({ label: "Timescale", value: enquiry.timescale });
    if (enquiry.introducerName) items.push({ label: "Introduced by", value: [enquiry.introducerName, enquiry.introducerContact].filter(Boolean).join(" · ") });
    return items;
  }, [extracted]);

  const invalidate = (clientId: number) => {
    qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
    qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
    qc.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
  };

  const handleUseExisting = (match: ClientMatch) => {
    // A repeat enquiry rides on the existing record: keep the email, add the
    // property it mentions, and task the case worker. No welcome email.
    repeatEnquiry.mutate(
      {
        id: match.client.id,
        data: {
          emailText: emailText.trim() || null,
          extracted: extracted
            ? { ...extracted, enquiry: { ...extracted.enquiry, summary: draft.summary.trim() || extracted.enquiry.summary } }
            : draft.summary.trim()
              ? { client: {}, property: {}, enquiry: { summary: draft.summary.trim(), type: draft.enquiryType || null } }
              : null,
        },
      },
      {
        onSuccess: (result) => {
          invalidate(match.client.id);
          toast.add({
            title: `Repeat enquiry added to ${match.client.name}`,
            description: result.propertyId ? "The property from the email was added too." : undefined,
            type: "success",
          });
          onCreated(match.client.id, { propertyId: result.propertyId });
        },
        onError: (err) =>
          toast.add({
            title: "Couldn't record the enquiry",
            description: apiErrorMessage(err, "Please try again."),
            type: "error",
          }),
      },
    );
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const name = draft.name.trim();
    const email = draft.email.trim();
    if (!name || !email) {
      setError("Name and email are required");
      return;
    }
    setError(null);
    const property = extracted?.property;
    createClient.mutate(
      {
        data: {
          name,
          email,
          phone: draft.phone.trim() || undefined,
          companyName: draft.companyName.trim() || undefined,
          companyNumber:
            draft.companyNumber.trim() || extracted?.client.companyNumber || undefined,
          companyRegisteredAddress: draft.companyRegisteredAddress.trim() || undefined,
          companyRegisteredCity: draft.companyRegisteredCity.trim() || undefined,
          companyRegisteredPostcode: draft.companyRegisteredPostcode.trim() || undefined,
          // Everything else the email said about them goes straight onto the record.
          title: extracted?.client.title ?? undefined,
          currentAddress: extracted?.client.currentAddress ?? undefined,
          currentAddressCity: extracted?.client.currentAddressCity ?? undefined,
          currentAddressPostcode: extracted?.client.currentAddressPostcode ?? undefined,
          employmentStatus: extracted?.client.employmentStatus ?? undefined,
          employerName: extracted?.client.employerName ?? undefined,
          jobTitle: extracted?.client.jobTitle ?? undefined,
          annualIncome: extracted?.client.annualIncome ?? undefined,
          assignedUserId: assignee ?? undefined,
          source: draft.source || null,
          introducerName: draft.introducerName.trim() || null,
          introducerContact: draft.introducerContact.trim() || null,
          enquiryType: draft.enquiryType || null,
          enquirySummary: draft.summary.trim() || null,
          enquiryTimescale: extracted?.enquiry.timescale ?? null,
          enquiryEmailText: emailText.trim() || null,
          enquiryExtracted: extracted ? (extracted as unknown as Record<string, unknown>) : null,
          enquiryExtractionModel: extractionModel,
          property:
            property && (property.address || property.value || property.loanAmount)
              ? {
                  address: property.address ?? "Address to confirm",
                  city: property.city ?? undefined,
                  postcode: property.postcode ?? undefined,
                  matterType: property.matterType ?? undefined,
                  value: property.value ?? undefined,
                  loanAmount: property.loanAmount ?? undefined,
                  rent: property.rent ?? undefined,
                  propertyType: property.propertyType ?? undefined,
                  purchasePrice: property.purchasePrice ?? undefined,
                  currentLender: property.currentLender ?? undefined,
                  currentBalance: property.currentBalance ?? undefined,
                  currentRatePct: property.currentRatePct ?? undefined,
                  currentRateEndDate: property.currentRateEndDate ?? undefined,
                }
              : null,
        },
      },
      {
        onSuccess: (created) => {
          invalidate(created.id);
          toast.add({ title: `Enquiry from ${created.name} added`, type: "success" });
          onCreated(created.id);
        },
        onError: (err) => {
          if (apiErrorStatus(err) === 409) {
            setError("Another client already uses this email — use them from the list below.");
            return;
          }
          toast.add({
            title: "Couldn't add the enquiry",
            description: apiErrorMessage(err, "Please try again."),
            type: "error",
          });
        },
      },
    );
  };

  const busy = createClient.isPending || repeatEnquiry.isPending;

  return (
    <div className="space-y-4">
      <ToggleGroup
        type="single"
        variant="outline"
        value={mode}
        onValueChange={(value) => {
          if (!value) return;
          setMode(value as Mode);
          setError(null);
        }}
        className="w-full"
      >
        <ToggleGroupItem value="paste" className="flex-1">
          <Mail /> Paste email
        </ToggleGroupItem>
        <ToggleGroupItem value="manual" className="flex-1">
          <PencilLine /> Type it in
        </ToggleGroupItem>
      </ToggleGroup>

      {mode === "paste" ? (
        <Field>
          <FieldLabel htmlFor="enquiry-email-text">The enquiry email</FieldLabel>
          <Textarea
            id="enquiry-email-text"
            value={emailText}
            onChange={(event) => setEmailText(event.target.value)}
            placeholder="Paste the whole email, headers and signature included."
            className="min-h-32 font-mono text-xs"
            autoFocus={!reviewing}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {extracted
                ? extractionModel
                  ? `Read by ${extractionModel}. Check the details below.`
                  : "Read without AI (not connected) — check the details below."
                : "We'll read the name, contact details, company and what they're after."}
            </p>
            <Button
              type="button"
              size="sm"
              variant={extracted ? "outline" : "default"}
              disabled={!emailText.trim() || extract.isPending}
              onClick={handleExtract}
            >
              <Sparkles /> {extract.isPending ? "Reading…" : extracted ? "Read again" : "Extract"}
            </Button>
          </div>
        </Field>
      ) : null}

      {reviewing ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="enquiry-name">
                Full name <RequiredDot />
              </FieldLabel>
              <Input
                id="enquiry-name"
                value={draft.name}
                onChange={(event) => setField("name")(event.target.value)}
                autoComplete="off"
                autoFocus={mode === "manual"}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="enquiry-email">
                Email <RequiredDot />
              </FieldLabel>
              <Input
                id="enquiry-email"
                type="email"
                value={draft.email}
                onChange={(event) => setField("email")(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="enquiry-phone">Phone</FieldLabel>
              <Input
                id="enquiry-phone"
                type="tel"
                value={draft.phone}
                onChange={(event) => setField("phone")(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="enquiry-company">Company</FieldLabel>
              <CompanyNameCombobox
                id="enquiry-company"
                value={draft.companyName}
                onChange={setField("companyName")}
                onSelect={(company) =>
                  setDraft((current) => ({
                    ...current,
                    companyName: company.name,
                    companyNumber: company.companyNumber,
                    companyRegisteredAddress: company.registeredAddress?.line1 ?? "",
                    companyRegisteredCity: company.registeredAddress?.city ?? "",
                    companyRegisteredPostcode: company.registeredAddress?.postcode ?? "",
                  }))
                }
              />
            </Field>
            <Field>
              <FieldLabel>Source</FieldLabel>
              <OptionSelect
                value={draft.source}
                onChange={(value) => setField("source")(value as ClientSource | "")}
                options={SOURCE_OPTIONS}
                placeholder="How did they find us?"
              />
            </Field>
            <Field>
              <FieldLabel>What they want</FieldLabel>
              <OptionSelect
                value={draft.enquiryType}
                onChange={(value) => setField("enquiryType")(value as EnquiryType | "")}
                options={ENQUIRY_TYPE_OPTIONS}
                placeholder="Not sure yet"
              />
            </Field>
          </div>

          {draft.source === "referral" || draft.source === "introducer" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="enquiry-introducer">Referred by</FieldLabel>
                <Input
                  id="enquiry-introducer"
                  value={draft.introducerName}
                  onChange={(event) => setField("introducerName")(event.target.value)}
                  placeholder="Person or firm"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="enquiry-introducer-contact">Their contact</FieldLabel>
                <Input
                  id="enquiry-introducer-contact"
                  value={draft.introducerContact}
                  onChange={(event) => setField("introducerContact")(event.target.value)}
                  placeholder="Email or phone"
                />
              </Field>
            </div>
          ) : null}

          <Field>
            <FieldLabel htmlFor="enquiry-summary">In short</FieldLabel>
            <Textarea
              id="enquiry-summary"
              value={draft.summary}
              onChange={(event) => setField("summary")(event.target.value)}
              placeholder="What they're asking for, in a sentence or two."
              className="min-h-16"
            />
          </Field>

          {foundExtras.length > 0 ? (
            <Collapsible open={showFound} onOpenChange={setShowFound}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50"
                >
                  <span>
                    Also found in the email
                    <span className="ml-2 text-xs text-muted-foreground">
                      saved for the property &amp; case step
                    </span>
                  </span>
                  <ChevronDown
                    className={cn("size-4 text-muted-foreground transition-transform", showFound && "rotate-180")}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {foundExtras.map((item) => (
                    <Badge key={item.label} variant="secondary" className="font-normal">
                      <span className="text-muted-foreground">{item.label}:</span>&nbsp;{item.value}
                    </Badge>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : null}

          {matches.length > 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
              <p className="font-medium">
                {emailMatch
                  ? "This is an existing client"
                  : "This might be an existing client"}
              </p>
              <p className="text-xs text-muted-foreground">
                Using them adds this enquiry to their record — no welcome email, straight to the property and case.
              </p>
              <ul className="mt-2 divide-y divide-amber-200 dark:divide-amber-800">
                {matches.map((match) => (
                  <li key={match.client.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{match.client.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {match.client.email}
                        {match.client.companyName ? ` · ${match.client.companyName}` : ""}
                        {" · "}
                        {MATCH_REASON[match.reason]}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => handleUseExisting(match)}
                    >
                      Use this client
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <AssigneeSelect
            section="client"
            value={assignee}
            onChange={setAssignee}
            label="Reviewed by"
          />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !!emailMatch}
              title={emailMatch ? "A client with this email already exists" : undefined}
            >
              {createClient.isPending ? "Adding…" : "Add enquiry"}
            </Button>
          </DialogFooter>
        </form>
      ) : (
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      )}
    </div>
  );
}
