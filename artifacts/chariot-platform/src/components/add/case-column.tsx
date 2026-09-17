import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { toast } from "@/components/ui/toast";
import { ArrowRight, Plus } from "lucide-react";
import {
  useCreateCase,
  useUpdateCase,
  getListCasesQueryKey,
  getGetCaseQueryKey,
  getGetClientQueryKey,
  getListTasksQueryKey,
  type Case,
  type CaseDetail,
  type Property,
  type ServiceType,
} from "@workspace/api-client-react";
import { Field, FieldLabel } from "@/components/ui/field";
import { RequiredDot } from "@/components/required-dot";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StageBadge } from "@/components/stage-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutosave } from "./use-autosave";
import { SaveStatus } from "./save-status";
import { RecordCard, RecordCardList } from "./record-card";
import { OptionSelect } from "./option-select";
import { apiErrorMessage } from "./utils";
import { formatAddress } from "@/lib/address";
import { SERVICE_TYPES, serviceTypeLabel } from "@/lib/service-types";

const money = (value: number) => `£${value.toLocaleString("en-GB")}`;

/**
 * The Case tab. The client's open cases are listed; pick one or start a new
 * one against the selected property. Only the service level is set here —
 * fees, lenders, advice, terms and everything else live on the case page.
 */
export function CaseColumn({
  clientId,
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
          <CaseDetails caseDetail={caseDetail} />
        ) : isCaseLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : null
      ) : showNewForm && !propertyId ? (
        <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Pick or add a property first — the case takes its figures from it.
        </div>
      ) : showNewForm ? (
        <NewCaseForm
          clientId={clientId}
          propertyId={propertyId}
          property={property}
          enquiry={enquiry}
          onCreated={(created) => {
            setCreating(false);
            onCaseSelected(created);
          }}
        />
      ) : (
        <p className="px-1 text-sm text-muted-foreground">Pick a case above, or start a new one.</p>
      )}
    </section>
  );
}

/** Service level, then Create. Amounts come from the property; the rest is set on the case page. */
function NewCaseForm({
  clientId,
  propertyId,
  property,
  enquiry,
  onCreated,
}: {
  clientId: number;
  propertyId: number | null;
  property: Property | undefined;
  enquiry?: { summary: string | null; timescale: string | null } | null;
  onCreated: (created: Case) => void;
}) {
  const qc = useQueryClient();
  const createCase = useCreateCase();
  const [serviceType, setServiceType] = useState<string>("full_advice");
  const canCreate = !!propertyId && !!property;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!propertyId || !property) return;
    createCase.mutate(
      {
        data: {
          clientId,
          propertyId,
          serviceType: serviceType as ServiceType,
          loanAmount: property.loanAmount,
          propertyValue: property.value,
          rent: property.rent ?? undefined,
          gdv: property.gdv ?? undefined,
        },
      },
      {
        onSuccess: (created) => {
          qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
          toast.add({ title: `Case ${created.reference} created`, type: "success" });
          onCreated(created);
        },
        onError: (error) =>
          toast.add({
            title: "Failed to create case",
            description: apiErrorMessage(error, "Please try again."),
            type: "error",
          }),
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <h3 className="text-sm font-semibold">New case</h3>
        {property ? (
          <span className="text-xs text-muted-foreground">
            {formatAddress(property)} · {money(property.value)} · loan {money(property.loanAmount)}
          </span>
        ) : null}
      </div>
      <div className="grid gap-x-4 gap-y-3 p-4 sm:grid-cols-2 xl:grid-cols-4 *:min-w-0">
        <Field>
          <FieldLabel>
            Service Level <RequiredDot />
          </FieldLabel>
          <OptionSelect value={serviceType} onChange={setServiceType} options={SERVICE_TYPES} />
        </Field>
        {enquiry?.summary || enquiry?.timescale ? (
          <div className="text-sm sm:col-span-2 xl:col-span-3">
            <p className="text-xs font-medium text-muted-foreground">From the enquiry</p>
            {enquiry.summary ? <p className="mt-0.5">{enquiry.summary}</p> : null}
            {enquiry.timescale ? (
              <p className="mt-0.5 text-xs text-muted-foreground">Timescale: {enquiry.timescale}</p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5">
        <span className="text-xs text-muted-foreground">
          {canCreate
            ? "Fees, lenders, advice and terms are set on the case page once it exists."
            : "Select or save a property before creating the case."}
        </span>
        <Button type="submit" size="sm" disabled={!canCreate || createCase.isPending}>
          {createCase.isPending ? "Creating..." : "Create case"}
        </Button>
      </div>
    </form>
  );
}

/** An existing case: its service level, and the way to the case page for everything else. */
function CaseDetails({ caseDetail }: { caseDetail: CaseDetail }) {
  const qc = useQueryClient();
  const updateCase = useUpdateCase();
  const [serviceType, setServiceType] = useState<string>(caseDetail.serviceType);
  const seededFor = useRef(caseDetail.id);

  useEffect(() => {
    // Re-seed only when a different case is selected, so an in-flight edit survives refetches.
    if (seededFor.current !== caseDetail.id) {
      seededFor.current = caseDetail.id;
      setServiceType(caseDetail.serviceType);
    }
  }, [caseDetail]);

  const autosave = useAutosave({
    enabled: true,
    payload: { serviceType: serviceType as ServiceType },
    seedKey: caseDetail.id,
    save: async (next) => {
      try {
        await updateCase.mutateAsync({ id: caseDetail.id, data: next });
        qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseDetail.id) });
        qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetClientQueryKey(caseDetail.clientId) });
      } catch (error) {
        throw new Error(apiErrorMessage(error, "Couldn't save the service level"));
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        autosave.flush();
      }}
      onBlur={() => autosave.flush()}
      className="rounded-lg border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-sm font-semibold">{caseDetail.reference}</h3>
          <span className="truncate text-xs text-muted-foreground">{caseDetail.propertyAddress}</span>
        </div>
        <div className="flex items-center gap-2">
          <StageBadge stage={caseDetail.stage} stageIndex={caseDetail.stageIndex} />
          <SaveStatus status={autosave.status} error={autosave.error} />
        </div>
      </div>
      <div className="grid gap-x-4 gap-y-3 p-4 sm:grid-cols-2 xl:grid-cols-4 *:min-w-0">
        <Field>
          <FieldLabel>
            Service Level <RequiredDot />
          </FieldLabel>
          <OptionSelect value={serviceType} onChange={setServiceType} options={SERVICE_TYPES} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5">
        <span className="text-xs text-muted-foreground">
          Fees, lender submissions, advice, terms of business and the rest of the case are handled on the case page.
        </span>
        <Button asChild size="sm">
          <Link href={`/cases/${caseDetail.id}`}>
            Open case page <ArrowRight />
          </Link>
        </Button>
      </div>
    </form>
  );
}
