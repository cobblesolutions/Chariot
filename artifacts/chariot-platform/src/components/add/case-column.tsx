import { useEffect, useRef, useState } from "react";
import { type Resolver, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { toast } from "@/components/ui/toast";
import { ExternalLink, Plus } from "lucide-react";
import {
  useCreateCase,
  useCreateCaseSubmission,
  useUpdateCase,
  useListLenders,
  useListStaff,
  getListCasesQueryKey,
  getGetCaseQueryKey,
  getGetClientQueryKey,
  getListTasksQueryKey,
  type Case,
  type CaseDetail,
  type Property,
} from "@workspace/api-client-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Field, FieldLabel } from "@/components/ui/field";
import { RequiredDot } from "@/components/required-dot";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StageBadge } from "@/components/stage-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AssigneePicker } from "@/components/assignee-picker";
import { SubmissionsPanel, submissionProgress } from "./submissions-panel";
import { useAutosave } from "./use-autosave";
import { SaveStatus } from "./save-status";
import { FormSection, FormSections, countFilled } from "./form-section";
import { RecordCard, RecordCardList } from "./record-card";
import { AssigneeSelect } from "./assignee-select";
import { OptionSelect } from "./option-select";
import { AdviceStagePanel } from "@/components/case/advice-stage-panel";
import { SubmissionDetailsPanel } from "@/components/case/submission-details-panel";
import { TermsOfBusinessPanel } from "@/components/case/terms-of-business-panel";
import {
  apiErrorMessage,
} from "./utils";
import { formatAddress } from "@/lib/address";
import { FEE_BASIS_OPTIONS, type FeeBasis } from "@/lib/fees";

import { SERVICE_TYPES, serviceTypeLabel } from "@/lib/service-types";
import type { ServiceType } from "@workspace/api-client-react";


const createSchema = z.object({
  serviceType: z.enum(["full_advice", "light_advice", "execution_only"]),
  procFeePct: z.coerce.number().min(0).max(100),
  brokerFeePct: z.coerce.number().min(0).max(100),
  brokerFeeBasis: z.enum(["percent", "flat"]),
  brokerFeeFlat: z.coerce.number().min(0).optional(),
});
type CreateValues = z.infer<typeof createSchema>;

const money = (value: number) => `£${value.toLocaleString("en-GB")}`;



/**
 * Column 3. The client's open cases are shown as cards; click one to edit it
 * or "New case" to open one against the selected property.
 */
export function CaseColumn({
  clientId,
  clientName,
  propertyId,
  property,
  cases,
  caseId,
  onCaseChange,
  onCaseSelected,
  caseDetail,
  isCaseLoading,
  enquiry,
}: {
  clientId: number;
  clientName: string;
  propertyId: number | null;
  property: Property | undefined;
  cases: Case[];
  caseId: number | null;
  onCaseChange: (caseId: number | null) => void;
  onCaseSelected: (item: Case) => void;
  caseDetail: CaseDetail | undefined;
  isCaseLoading: boolean;
  /** What the client asked for at step 1, shown while the case is being set up. */
  enquiry?: { summary: string | null; timescale: string | null } | null;
}) {
  const openCases = cases.filter((item) => item.status === "active");
  const [creating, setCreating] = useState(false);
  const showNewForm = !caseId && (creating || openCases.length === 0);

  return (
    <section className="space-y-4">
      <div className="space-y-4">
        {/* Which case the form below edits, and the way to start one. */}
        <div className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
            <h3 className="text-sm font-semibold">Cases</h3>
            <div className="flex items-center gap-2">
              {!propertyId ? (
                <span className="text-xs text-muted-foreground">Select a property first</span>
              ) : showNewForm ? (
                <span className="text-xs text-muted-foreground">Unsaved</span>
              ) : null}
              <Button
                type="button"
                variant={showNewForm && propertyId ? "secondary" : "ghost"}
                size="sm"
                disabled={!propertyId}
                onClick={() => {
                  onCaseChange(null);
                  setCreating(true);
                }}
              >
                <Plus /> New case
              </Button>
            </div>
          </div>
          {openCases.length > 0 ? (
        <RecordCardList>
          {openCases.map((item) => (
            <RecordCard
              key={item.id}
              selected={item.id === caseId}
              onSelect={() => {
                setCreating(false);
                onCaseSelected(item);
              }}
              title={item.reference}
              subtitle={item.propertyId ? item.propertyAddress : "Property removed"}
              badges={
                <>
                  <StageBadge stage={item.stage} stageIndex={item.stageIndex} />
                  <Badge variant="outline">{serviceTypeLabel(item.serviceType)}</Badge>
                </>
              }
              meta={`Loan ${money(item.loanAmount)} · ${item.assignedTo}`}
            />
          ))}
        </RecordCardList>
          ) : null}
        </div>

        {caseId ? (
          caseDetail && caseDetail.id === caseId ? (
            <CaseDetails caseDetail={caseDetail} property={property} />
          ) : isCaseLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : null
        ) : showNewForm && !propertyId ? (
          <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Pick or add a property first — the case takes its figures from it.
          </div>
        ) : showNewForm ? (
          <>
            {enquiry?.summary || enquiry?.timescale ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">From the enquiry</span>
                {enquiry.summary ? <p className="mt-1">{enquiry.summary}</p> : null}
                {enquiry.timescale ? (
                  <p className="mt-1 text-xs text-muted-foreground">Timescale: {enquiry.timescale}</p>
                ) : null}
              </div>
            ) : null}
            <NewCaseForm
            clientId={clientId}
            propertyId={propertyId}
            property={property}
            onCreated={(created) => {
              setCreating(false);
              onCaseSelected(created);
            }}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Pick a case above, or start a new one.
          </p>
        )}
      </div>
    </section>
  );
}

function NewCaseForm({
  clientId,
  propertyId,
  property,
  onCreated,
}: {
  clientId: number;
  propertyId: number | null;
  property: Property | undefined;
  onCreated: (created: Case) => void;
}) {
  const qc = useQueryClient();
  const createCase = useCreateCase();
  const { data: lenders } = useListLenders();
  const [assignee, setAssignee] = useState<number | null>(null);
  /** Lenders to submit to straight away; each gets its own submission tab. */
  const [lenderIds, setLenderIds] = useState<number[]>([]);
  const createSubmission = useCreateCaseSubmission();

  const form = useForm<CreateValues>({
    // z.coerce fields make the schema input `unknown`; the form works with parsed output values.
    resolver: zodResolver(createSchema) as Resolver<CreateValues>,
    defaultValues: {
      serviceType: "full_advice",
      procFeePct: 1,
      brokerFeePct: 0.5,
      brokerFeeBasis: "percent",
    },
  });

  // Amounts are never typed here: the case takes them from the property.
  const canCreate = !!propertyId && !!property;

  const onSubmit = (data: CreateValues) => {
    if (!propertyId || !property) return;
    createCase.mutate(
      {
        data: {
          clientId,
          propertyId,
          serviceType: data.serviceType,
          loanAmount: property.loanAmount,
          propertyValue: property.value,
          rent: property.rent ?? undefined,
          gdv: property.gdv ?? undefined,
          lenderId: lenderIds[0],
          procFeePct: data.procFeePct,
          brokerFeePct: data.brokerFeePct,
          brokerFeeBasis: data.brokerFeeBasis,
          brokerFeeFlat: data.brokerFeeBasis === "flat" ? data.brokerFeeFlat ?? 0 : undefined,
          assignedUserId: assignee ?? undefined,
        },
      },
      {
        onSuccess: async (created) => {
          // The first lender rides along on the case itself; the rest become
          // further submissions so every lender has its own tab.
          for (const lenderId of lenderIds.slice(1)) {
            try {
              await createSubmission.mutateAsync({ id: created.id, data: { lenderId } });
            } catch (error) {
              toast.add({
                title: "Couldn't add a lender",
                description: apiErrorMessage(error, "Add it from the case's submission tabs."),
                type: "error",
              });
            }
          }
          qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
          toast.add({
            title: `Case ${created.reference} created`,
            type: "success",
          });
          onCreated(created);
        },
        onError: (error) => {
          toast.add({
            title: "Failed to create case",
            description: apiErrorMessage(error, "Please try again."),
            type: "error",
          });
        },
      },
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {property ? (
          <p className="text-sm text-muted-foreground">
            New case for <span className="text-foreground">{formatAddress(property)}</span>.
          </p>
        ) : null}
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

        <PropertyAmounts property={property} />

        <Field>
          <FieldLabel>Submit to lenders</FieldLabel>
          <div className="divide-y rounded-md border">
            {(lenders ?? [])
              .filter((lender) => lender.status === "active")
              .map((lender) => {
                const checked = lenderIds.includes(lender.id);
                return (
                  <label
                    key={lender.id}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) =>
                        setLenderIds((current) =>
                          next === true
                            ? [...current, lender.id]
                            : current.filter((id) => id !== lender.id),
                        )
                      }
                    />
                    <span className="flex-1">{lender.name}</span>
                    {checked && lenderIds[0] === lender.id ? (
                      <span className="text-xs text-muted-foreground">primary</span>
                    ) : null}
                  </label>
                );
              })}
          </div>
          <p className="text-xs text-muted-foreground">
            Optional. Pick as many as you like; each lender gets its own submission
            tab. The first ticked is the one the case follows. You can add or remove
            lenders later.
          </p>
        </Field>

        {/* Container query: the Add page column is narrow, so the fee fields stack there and pair up when wider. */}
        <div className="@container">
        <div className="grid gap-4 @md:grid-cols-2">
          <FormField
            control={form.control}
            name="procFeePct"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Proc Fee (%)</FormLabel>
                <FormControl>
                  <Input type="number" step="0.1" min="0" max="100" {...field} />
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
        </div>

        <AssigneeSelect section="case" value={assignee} onChange={setAssignee} />

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {canCreate
              ? "Lender case number, valuation and DIP come next."
              : "Select or save a property before creating the case."}
          </span>
          <Button
            type="submit"
            size="sm"
            disabled={!canCreate || createCase.isPending}
          >
            {createCase.isPending ? "Creating..." : "Create case"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

interface AmountSource {
  value: number;
  loanAmount: number;
  rent: number | null;
  gdv: number | null;
}

/**
 * Read-only amounts the case inherits from its property. Edited on the
 * Property card, never here; the server mirrors them onto the case while it
 * is still at Submission details.
 */
function PropertyAmounts({
  property,
  fallback,
}: {
  property: Property | undefined;
  fallback?: AmountSource;
}) {
  const source: AmountSource | undefined = property
    ? {
        value: property.value,
        loanAmount: property.loanAmount,
        rent: property.rent ?? null,
        gdv: property.gdv ?? null,
      }
    : fallback;
  if (!source) {
    return (
      <p className="text-sm text-muted-foreground">
        Value and loan amount come from the selected property.
      </p>
    );
  }
  const cells: Array<[string, string]> = [
    ["Property value", money(source.value)],
    ["Loan amount", money(source.loanAmount)],
  ];
  if (source.rent != null) cells.push(["Rental income", money(source.rent) + "/mo"]);
  if (source.gdv != null) cells.push(["GDV", money(source.gdv)]);
  return (
    <div className="space-y-1.5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {cells.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-2 border-b border-dashed py-1"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        {property
          ? "Taken from the property. Change them on the Property card."
          : "Copied when the case was created; its property is no longer linked."}
      </p>
    </div>
  );
}

interface CaseDraft {
  serviceType: string;
  procFeePct: string;
  brokerFeePct: string;
  brokerFeeBasis: string;
  brokerFeeFlat: string;
  draftNotes: string;
  assignedUserId: string;
}

const CURRENT_ASSIGNEE = "__current__";

function draftFromCase(
  item: CaseDetail,
  staff: Array<{ id: number; displayName: string }> | undefined,
): CaseDraft {
  // The user id is the durable link; the display-name match only covers cases from before it existed.
  const matchingStaff = item.assignedUserId != null
    ? staff?.find((member) => member.id === item.assignedUserId)
    : staff?.find((member) => member.displayName === item.assignedTo);
  return {
    serviceType: item.serviceType,
    procFeePct: String(item.procFeePct),
    brokerFeePct: String(item.brokerFeePct),
    brokerFeeBasis: item.brokerFeeBasis ?? "percent",
    brokerFeeFlat: item.brokerFeeFlat != null ? String(item.brokerFeeFlat) : "",
    draftNotes: item.draftNotes ?? "",
    assignedUserId: matchingStaff ? String(matchingStaff.id) : CURRENT_ASSIGNEE,
  };
}

/** Every editable detail of an existing case; changes save themselves. */
function CaseDetails({
  caseDetail,
  property,
}: {
  caseDetail: CaseDetail;
  property: Property | undefined;
}) {
  const qc = useQueryClient();
  const updateCase = useUpdateCase();
  const { data: lenders } = useListLenders();
  const { data: staff } = useListStaff();

  const [draft, setDraft] = useState<CaseDraft>(() =>
    draftFromCase(caseDetail, staff),
  );
  const seededForId = useRef(caseDetail.id);
  const seededWithStaff = useRef(!!staff);

  useEffect(() => {
    // Re-seed when a different case is selected, or once the staff list arrives
    // so the assignee select can match the display name to a user.
    if (
      seededForId.current !== caseDetail.id ||
      (!seededWithStaff.current && staff)
    ) {
      seededForId.current = caseDetail.id;
      seededWithStaff.current = !!staff;
      setDraft(draftFromCase(caseDetail, staff));
    }
  }, [caseDetail, staff]);

  const setField =
    <K extends keyof CaseDraft>(key: K) =>
    (value: CaseDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value }));

  const invalidateCase = () => {
    qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseDetail.id) });
    qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
    qc.invalidateQueries({
      queryKey: getGetClientQueryKey(caseDetail.clientId),
    });
  };

  const payload = {
    serviceType: draft.serviceType as ServiceType,
    procFeePct: parseFloat(draft.procFeePct),
    brokerFeePct: parseFloat(draft.brokerFeePct),
    brokerFeeBasis: draft.brokerFeeBasis as FeeBasis,
    brokerFeeFlat: draft.brokerFeeBasis === "flat" ? parseFloat(draft.brokerFeeFlat) : null,
    draftNotes: draft.draftNotes,
    assignedUserId:
      draft.assignedUserId === CURRENT_ASSIGNEE
        ? undefined
        : parseInt(draft.assignedUserId, 10),
  };

  // Changes save themselves a moment after typing stops, and on blur. The
  // baseline resets when a different case loads or the staff list arrives
  // (which re-seeds the assignee), so neither triggers a save.
  const autosave = useAutosave({
    enabled: true,
    payload,
    seedKey: `${caseDetail.id}:${staff ? 1 : 0}`,
    validate: (next) => {
      if (!Number.isFinite(next.procFeePct) || !Number.isFinite(next.brokerFeePct)) {
        return "Enter valid fee percentages";
      }
      if (next.brokerFeeBasis === "flat" && !Number.isFinite(next.brokerFeeFlat ?? NaN)) {
        return "Enter the flat fee amount";
      }
      return null;
    },
    save: async (next) => {
      try {
        await updateCase.mutateAsync({ id: caseDetail.id, data: next });
        invalidateCase();
      } catch (error) {
        throw new Error(apiErrorMessage(error, "Couldn't save case details"));
      }
    },
  });

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    autosave.flush();
  };


  const assigneeIsStaff = staff?.some(
    (member) => member.displayName === caseDetail.assignedTo,
  );

  return (
    <form
      onSubmit={handleSave}
      onBlur={() => autosave.flush()}
      className="space-y-4"
    >
      <div className="flex items-start justify-between gap-2 border-b pb-3">
        <div className="min-w-0">
          <p className="font-semibold truncate">{caseDetail.reference}</p>
          <p className="text-sm text-muted-foreground truncate">
            {caseDetail.propertyAddress}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StageBadge
            stage={caseDetail.stage}
            stageIndex={caseDetail.stageIndex}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            asChild
            aria-label="Open case page"
          >
            <Link href={`/cases/${caseDetail.id}`}>
              <ExternalLink />
            </Link>
          </Button>
        </div>
      </div>

      <FormSections>
        {caseDetail.stageIndex === 0 ? (
          <FormSection id="advice" wide title="Advice & approval" hint="Confirm the service level, write the recommendation and send it to the client.">
            <AdviceStagePanel caseId={caseDetail.id} serviceType={caseDetail.serviceType} compact />
          </FormSection>
        ) : null}
        {caseDetail.stageIndex === 1 ? (
          <FormSection id="details" wide title="Submission details" hint="What goes to the lender, gathered from the forms on this page. Copy empty fields from the last case.">
            <SubmissionDetailsPanel caseId={caseDetail.id} clientId={caseDetail.clientId} compact />
          </FormSection>
        ) : null}
        <FormSection
          id="deal"
          title="The deal"
          filled={countFilled([
            draft.serviceType,
            draft.procFeePct,
            draft.brokerFeeBasis === "flat" ? draft.brokerFeeFlat : draft.brokerFeePct,
          ])}
          total={3}
        >
          <Field>
            <FieldLabel>
              Service Level <RequiredDot />
            </FieldLabel>
            <OptionSelect
              value={draft.serviceType}
              onChange={setField("serviceType")}
              options={SERVICE_TYPES}
              placeholder="Select service level"
            />
          </Field>
          <PropertyAmounts
            property={property}
            fallback={{
              value: caseDetail.propertyValue,
              loanAmount: caseDetail.loanAmount,
              rent: caseDetail.rent ?? null,
              gdv: caseDetail.gdv ?? null,
            }}
          />
          <div className="@container">
          <div className="grid gap-4 @md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="add-case-proc">Proc Fee (%)</FieldLabel>
              <Input
                id="add-case-proc"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={draft.procFeePct}
                onChange={(e) => setField("procFeePct")(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-case-broker">
                Our fee <RequiredDot />
              </FieldLabel>
              <div className="flex gap-2">
                <div className="w-[120px] shrink-0">
                  <OptionSelect
                    value={draft.brokerFeeBasis}
                    onChange={setField("brokerFeeBasis")}
                    options={FEE_BASIS_OPTIONS}
                  />
                </div>
                {draft.brokerFeeBasis === "flat" ? (
                  <Input
                    id="add-case-broker"
                    type="number"
                    step="1"
                    min="0"
                    placeholder="995"
                    aria-label="Flat fee (£)"
                    value={draft.brokerFeeFlat}
                    onChange={(e) => setField("brokerFeeFlat")(e.target.value)}
                  />
                ) : (
                  <Input
                    id="add-case-broker"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    aria-label="Fee (% of loan)"
                    value={draft.brokerFeePct}
                    onChange={(e) => setField("brokerFeePct")(e.target.value)}
                  />
                )}
              </div>
            </Field>
          </div>
          </div>
        </FormSection>

        <FormSection
          id="submission"
          wide
          title="Lender submissions"
          filled={caseDetail.submissions.reduce(
            (sum, item) => sum + submissionProgress(item).done,
            0,
          )}
          total={Math.max(
            1,
            caseDetail.submissions.reduce(
              (sum, item) => sum + submissionProgress(item).total,
              0,
            ),
          )}
          hint={
            caseDetail.submissions.filter((item) => item.status === "active" || item.status === "offered").length > 1
              ? "One tab per lender. The starred lender is the one the case follows."
              : undefined
          }
        >
          <SubmissionsPanel caseDetail={caseDetail} />
        </FormSection>

        <FormSection id="owner" title="Notes & owner">
          <Field>
            <FieldLabel htmlFor="add-case-notes">Notes</FieldLabel>
            <Textarea
              id="add-case-notes"
              value={draft.draftNotes}
              onChange={(e) => setField("draftNotes")(e.target.value)}
              placeholder="Anything the next person needs to know"
              className="min-h-[80px]"
            />
          </Field>
          <Field>
            <FieldLabel>
              Assigned to <RequiredDot />
            </FieldLabel>
            <AssigneePicker
              value={draft.assignedUserId}
              onValueChange={setField("assignedUserId")}
              staff={staff ?? []}
              leading={
                assigneeIsStaff
                  ? []
                  : [
                      {
                        value: CURRENT_ASSIGNEE,
                        label: caseDetail.assignedTo || "Unassigned",
                      },
                    ]
              }
            />
            <p className="text-xs text-muted-foreground">
              Reassigning changes the case owner; it does not create a new task.
            </p>
          </Field>
        </FormSection>

        {/* Last on purpose: the terms are generated from everything above and must be signed before the case proceeds. */}
        <FormSection
          id="terms"
          title="Terms of Business"
          filled={caseDetail.termsOfBusiness ? 1 : 0}
          total={1}
          hint="Fill in the details, preview the document and send it to the client to sign. The signed copy is filed here automatically."
        >
          <TermsOfBusinessPanel caseId={caseDetail.id} clientId={caseDetail.clientId} compact />
        </FormSection>
      </FormSections>

      <div className="flex items-center justify-between gap-3">
        <StageBadge
          stage={caseDetail.stage}
          stageIndex={caseDetail.stageIndex}
        />
        <SaveStatus status={autosave.status} error={autosave.error} />
      </div>
    </form>
  );
}
