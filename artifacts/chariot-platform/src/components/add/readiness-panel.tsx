import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { toast } from "@/components/ui/toast";
import { ArrowRight } from "lucide-react";
import {
  useAdvanceCase,
  getGetCaseQueryKey,
  getListCasesQueryKey,
  getGetClientQueryKey,
  type CaseDetail,
  type ClientDetail,
  type Property,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { CASE_STAGES } from "@/lib/stages";
import { apiErrorMessage } from "./utils";

export interface Check {
  label: string;
  done: boolean;
}

export function clientChecks(client: ClientDetail | undefined): Check[] {
  if (!client) return [{ label: "Client selected or created", done: false }];
  const pending = client.onboarding.items.filter(
    (item) => item.status !== "complete",
  );
  return [
    { label: "Phone number", done: !!client.phone.trim() },
    { label: "Date of birth", done: !!client.dateOfBirth },
    { label: "Current address", done: !!client.currentAddress?.trim() },
    {
      label: "Employment status and income",
      done: !!client.employmentStatus && client.annualIncome != null,
    },
    {
      label:
        pending.length === 0
          ? "Onboarding information and documents"
          : `Onboarding: ${pending.length} item${pending.length === 1 ? "" : "s"} outstanding`,
      done: pending.length === 0,
    },
  ];
}

export function propertyChecks(property: Property | undefined): Check[] {
  if (!property) return [{ label: "Property selected or saved", done: false }];
  const wantsRent =
    property.matterType === "btl" ||
    property.occupancy === "let" ||
    property.occupancy === "holiday_let";
  return [
    {
      label: "Value and loan amount",
      done: property.value > 0 && property.loanAmount > 0,
    },
    {
      label: "Property type and tenure",
      done: !!property.propertyType && !!property.tenure,
    },
    { label: "Occupancy", done: !!property.occupancy },
    ...(wantsRent
      ? [
          {
            label: "Rental income",
            done: property.rent != null && property.rent > 0,
          },
        ]
      : []),
  ];
}

export function caseChecks(caseDetail: CaseDetail | undefined): Check[] {
  if (!caseDetail) return [{ label: "Case created or selected", done: false }];
  return [
    { label: "Service level", done: !!caseDetail.serviceType },
    {
      label: "Loan amount and property value",
      done: caseDetail.loanAmount > 0 && caseDetail.propertyValue > 0,
    },
    {
      label: "Assigned to a staff member",
      done: !!caseDetail.assignedTo && caseDetail.assignedTo !== "staff_1",
    },
    // Enforced server-side too: the case cannot leave the opening stages unsigned.
    { label: "Terms of Business signed", done: !!caseDetail.termsOfBusiness },
  ];
}

/** Labels of the checks still open, for a column header. */
export function missingLabels(checks: Check[]): string[] {
  return checks.filter((check) => !check.done).map((check) => check.label);
}

/**
 * The gate on step 3, kept to one line: how many details are left across the
 * three columns, and the button that moves the case out of "Submission
 * details" once none are. Each column lists its own missing items.
 */
export function ReadinessPanel({
  client,
  property,
  caseDetail,
  onAdvanced,
}: {
  client: ClientDetail | undefined;
  property: Property | undefined;
  caseDetail: CaseDetail | undefined;
  onAdvanced: () => void;
}) {
  const qc = useQueryClient();
  const advance = useAdvanceCase();

  const allChecks = [
    ...clientChecks(client),
    ...propertyChecks(property),
    ...caseChecks(caseDetail),
  ];
  const done = allChecks.filter((check) => check.done).length;
  const remaining = allChecks.length - done;
  const ready = remaining === 0 && !!caseDetail;

  // The Add page covers the first two stages; from Submission on the case page takes over.
  const atFirstStage = caseDetail ? caseDetail.stageIndex <= 1 : true;
  const nextStage = caseDetail && caseDetail.stageIndex <= 1 ? CASE_STAGES[caseDetail.stageIndex + 1] ?? null : null;

  const handleProceed = () => {
    if (!caseDetail) return;
    const currentStageRequirementIds = caseDetail.requirements
      .filter((requirement) => requirement.stageIndex === caseDetail.stageIndex)
      .map((requirement) => requirement.id);
    advance.mutate(
      {
        id: caseDetail.id,
        data: { completedRequirementIds: currentStageRequirementIds },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseDetail.id) });
          qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
          qc.invalidateQueries({
            queryKey: getGetClientQueryKey(caseDetail.clientId),
          });
          toast.add({
            title: `${caseDetail.reference} moved to ${nextStage ?? "the next stage"}`,
            type: "success",
          });
          onAdvanced();
        },
        onError: (error) => {
          toast.add({
            title: "The case can't proceed yet",
            description: apiErrorMessage(
              error,
              "Complete all required items first.",
            ),
            type: "error",
          });
        },
      },
    );
  };

  if (caseDetail && !atFirstStage) {
    return (
      <Button asChild variant="ghost" size="sm" className="shrink-0">
        <Link href={`/cases/${caseDetail.id}`}>
          At {caseDetail.stage} · open case <ArrowRight />
        </Link>
      </Button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className={cn("text-sm", ready ? "text-emerald-600" : "text-muted-foreground")}>
        {ready
          ? "Everything is in place"
          : `${done}/${allChecks.length} details`}
      </span>
      <Progress value={allChecks.length ? Math.round((done / allChecks.length) * 100) : 0} className="h-1 w-24" />
      <Button
        type="button"
        size="sm"
        variant={ready ? "default" : "outline"}
        disabled={!ready || advance.isPending}
        onClick={handleProceed}
      >
        {advance.isPending
          ? "Moving..."
          : nextStage
            ? `Proceed to ${nextStage}`
            : "Proceed"}
        <ArrowRight />
      </Button>
    </div>
  );
}
