import { useEffect, useMemo, useState } from "react";
import {
  useGetCase,
  useGetCaseStressTest,
  useGetSubmissionStressTest,
  getGetSubmissionStressTestQueryKey,
  useUpdateCaseStressTest,
  useApplyCaseStressTestPropertyValue,
  useListLenders,
  getGetCaseStressTestQueryKey,
  getGetCaseQueryKey,
  type UpdateCaseStressTestInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Calculator,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";

// --- Formatting helpers (per spec) ---
const n = (v: string | number | null | undefined): number => {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const parsed = parseFloat(v ?? "");
  return isNaN(parsed) ? 0 : parsed;
};

const fmt = (v: number | null | undefined): string => {
  if (v == null || isNaN(v) || v === 0) return "—";
  return "£" + Math.floor(v).toLocaleString("en-GB");
};

const fmtPct = (v: number | null | undefined, dp = 2): string => {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(dp) + "%";
};

const RATE_PRESETS = [4, 4.5, 5, 5.5, 6, 6.5, 7];
const SENSITIVITY_RATES = [3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5];
const LTV_PRESETS = [65, 70, 75, 80];

type ArrFeeMode = "none" | "pct" | "fixed";
type StressBasis = "total" | "net";

interface FeeArgs {
  arrFeeMode: ArrFeeMode;
  arrFeePct: number;
  arrFeeFixed: number;
}

function stripFee(
  x: number,
  { arrFeeMode, arrFeePct, arrFeeFixed }: FeeArgs,
): number {
  if (arrFeeMode === "pct") return x / (1 + arrFeePct / 100);
  if (arrFeeMode === "fixed") return Math.max(0, x - arrFeeFixed);
  return x;
}

function addFee(
  x: number,
  { arrFeeMode, arrFeePct, arrFeeFixed }: FeeArgs,
): number {
  if (arrFeeMode === "pct") return x * (1 + arrFeePct / 100);
  if (arrFeeMode === "fixed") return x + arrFeeFixed;
  return x;
}

interface CalcInputs {
  rent: number;
  rate: number;
  icrMultiplier: number;
  arrFeeMode: ArrFeeMode;
  arrFeePct: number;
  arrFeeFixed: number;
  stressBasis: StressBasis;
  propertyValue: number;
  ltv: number;
  payRate: number;
}

interface CalcResult {
  stressCapacity: number;
  maxTotalLoan: number;
  maxGrossLoan: number;
  arrFeeOnMaxLoan: number;
  hasValue: boolean;
  targetGrossLoan: number;
  targetArrFee: number;
  targetTotalLoan: number;
  achievableLtv: number;
  ltvHeadroom: number;
  maxPropertyValue: number;
  stressedTarget: number;
  requiredRent: number;
  surplus: number;
  passes: boolean;
  breakEvenRate: number | null;
  monthlyInterestOnly: number;
}

function computeCalc(inputs: CalcInputs): CalcResult | null {
  const {
    rent,
    rate,
    icrMultiplier,
    arrFeeMode,
    arrFeePct,
    arrFeeFixed,
    stressBasis,
    propertyValue,
    ltv,
    payRate,
  } = inputs;
  if (rate <= 0) return null;

  const feeArgs: FeeArgs = { arrFeeMode, arrFeePct, arrFeeFixed };
  const stressCapacity = (rent * 1200) / (rate * icrMultiplier);

  const maxTotalLoan =
    stressBasis === "total" ? stressCapacity : addFee(stressCapacity, feeArgs);
  const maxGrossLoan =
    stressBasis === "total"
      ? stripFee(stressCapacity, feeArgs)
      : stressCapacity;
  const arrFeeOnMaxLoan = maxTotalLoan - maxGrossLoan;

  const hasValue = propertyValue > 0;

  let targetGrossLoan = 0;
  let targetArrFee = 0;
  let targetTotalLoan = 0;
  let achievableLtv = 0;
  let ltvHeadroom = 0;
  let maxPropertyValue = 0;
  let stressedTarget = 0;
  let requiredRent = 0;
  let surplus = 0;
  let passes = false;
  let breakEvenRate: number | null = null;

  if (hasValue) {
    targetGrossLoan = (propertyValue * ltv) / 100;
    targetArrFee =
      arrFeeMode === "pct"
        ? (targetGrossLoan * arrFeePct) / 100
        : arrFeeMode === "fixed"
          ? arrFeeFixed
          : 0;
    targetTotalLoan = targetGrossLoan + targetArrFee;

    achievableLtv = Math.min((maxGrossLoan / propertyValue) * 100, 100);
    ltvHeadroom = achievableLtv - ltv;
    maxPropertyValue = ltv > 0 ? maxGrossLoan / (ltv / 100) : 0;

    stressedTarget = stressBasis === "net" ? targetGrossLoan : targetTotalLoan;
    const targetMonthlyInt = (stressedTarget * rate) / 100 / 12;
    requiredRent = targetMonthlyInt * icrMultiplier;
    surplus = rent - requiredRent;
    passes = surplus >= 0;

    breakEvenRate =
      rent > 0 && stressedTarget > 0
        ? (rent * 1200) / (stressedTarget * icrMultiplier)
        : null;
  } else {
    maxPropertyValue = 0;
  }

  const monthlyInterestOnly =
    payRate > 0 ? (maxTotalLoan * payRate) / 100 / 12 : 0;

  return {
    stressCapacity,
    maxTotalLoan,
    maxGrossLoan,
    arrFeeOnMaxLoan,
    hasValue,
    targetGrossLoan,
    targetArrFee,
    targetTotalLoan,
    achievableLtv,
    ltvHeadroom,
    maxPropertyValue,
    stressedTarget,
    requiredRent,
    surplus,
    passes,
    breakEvenRate,
    monthlyInterestOnly,
  };
}

interface ScenarioRow {
  rate: number;
  maxGrossLoan: number;
  maxTotalLoan: number;
  achievableLtv: number | null;
  diff: number | null;
}

function computeScenarios(
  inputs: Omit<CalcInputs, "rate" | "payRate">,
): ScenarioRow[] {
  const {
    rent,
    icrMultiplier,
    arrFeeMode,
    arrFeePct,
    arrFeeFixed,
    stressBasis,
    propertyValue,
    ltv,
  } = inputs;
  if (rent <= 0) return [];

  const feeArgs: FeeArgs = { arrFeeMode, arrFeePct, arrFeeFixed };
  const hasValue = propertyValue > 0;

  return SENSITIVITY_RATES.map((rate) => {
    const stressCapacity = (rent * 1200) / (rate * icrMultiplier);
    const maxTotalLoan =
      stressBasis === "total"
        ? stressCapacity
        : addFee(stressCapacity, feeArgs);
    const maxGrossLoan =
      stressBasis === "total"
        ? stripFee(stressCapacity, feeArgs)
        : stressCapacity;

    let achievableLtv: number | null = null;
    let diff: number | null = null;
    if (hasValue) {
      achievableLtv = Math.min((maxGrossLoan / propertyValue) * 100, 100);
      diff = achievableLtv - ltv;
    }

    return { rate, maxGrossLoan, maxTotalLoan, achievableLtv, diff };
  });
}

// Comma-formatted numeric input: displays formatted, stores raw digits
function CommaInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const display = value ? n(value).toLocaleString("en-GB") : "";
  return (
    <Input
      type="text"
      inputMode="numeric"
      value={display}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
    />
  );
}

export function StressTestPanel({
  caseId,
  submissionId = null,
  scope,
  className,
  action,
}: {
  caseId: number;
  /** The lender submission the test is for; the primary open one when null. */
  submissionId?: number | null;
  /** The lender picker, shown beside the page action when the case is with several lenders. */
  scope?: React.ReactNode;
  className?: string;
  /** Page-level control shown top-right (e.g. advance the stage). */
  action?: React.ReactNode;
}) {
  const qc = useQueryClient();
  // The case-level route follows the primary lender; a specific lender has its own route.
  const caseLevel = useGetCaseStressTest(caseId, {
    query: { enabled: !!caseId && submissionId == null, queryKey: getGetCaseStressTestQueryKey(caseId) },
  });
  const perLender = useGetSubmissionStressTest(caseId, submissionId ?? 0, {
    query: { enabled: !!caseId && submissionId != null, queryKey: getGetSubmissionStressTestQueryKey(caseId, submissionId ?? 0) },
  });
  const record = submissionId != null ? perLender.data : caseLevel.data;
  const isLoading = submissionId != null ? perLender.isLoading : caseLevel.isLoading;
  const invalidateRecord = () => {
    qc.invalidateQueries({ queryKey: getGetCaseStressTestQueryKey(caseId) });
    if (submissionId != null) qc.invalidateQueries({ queryKey: getGetSubmissionStressTestQueryKey(caseId, submissionId) });
  };
  const { data: lenders = [] } = useListLenders();
  const { data: caseItem } = useGetCase(caseId, {
    query: { enabled: !!caseId, queryKey: getGetCaseQueryKey(caseId) },
  });
  const updateStressTest = useUpdateCaseStressTest();
  const applyPropertyValue = useApplyCaseStressTestPropertyValue();

  // Local editable form state, seeded from the persisted record
  const [lenderId, setLenderId] = useState<string>("");
  const [monthlyRent, setMonthlyRent] = useState("");
  const [propertyValue, setPropertyValue] = useState("");
  const [stressRate, setStressRate] = useState("");
  const [payRate, setPayRate] = useState("");
  const [stressAtPayRate, setStressAtPayRate] = useState(true);
  const [stressMargin, setStressMargin] = useState("2");
  const [icrMultiplier, setIcrMultiplier] = useState(1.25);
  const [targetLtv, setTargetLtv] = useState("75");
  const [arrFeeMode, setArrFeeMode] = useState<ArrFeeMode>("pct");
  const [arrFeePct, setArrFeePct] = useState("");
  const [arrFeeFixed, setArrFeeFixed] = useState("");
  const [stressBasis, setStressBasis] = useState<StressBasis>("total");
  const [autoSaveState, setAutoSaveState] = useState<
    "saved" | "saving" | "error"
  >("saved");

  const [loadedForId, setLoadedForId] = useState<number | null>(null);

  useEffect(() => {
    if (record && loadedForId !== record.id) {
      setLoadedForId(record.id);
      setLenderId(record.lenderId ? String(record.lenderId) : "");
      setMonthlyRent(
        record.monthlyRent != null ? String(record.monthlyRent) : "",
      );
      setPropertyValue(
        record.propertyValue != null ? String(record.propertyValue) : "",
      );
      setStressRate(record.stressRate != null ? String(record.stressRate) : "");
      setPayRate(record.payRate != null ? String(record.payRate) : "");
      setStressAtPayRate(record.stressAtPayRate);
      setStressMargin(String(record.stressMargin));
      setIcrMultiplier(record.icrMultiplier);
      setTargetLtv(String(record.targetLtv));
      setArrFeeMode(record.arrFeeMode as ArrFeeMode);
      setArrFeePct(record.arrFeePct != null ? String(record.arrFeePct) : "");
      setArrFeeFixed(
        record.arrFeeFixed != null ? String(record.arrFeeFixed) : "",
      );
      setStressBasis(record.stressBasis as StressBasis);
    }
  }, [record, loadedForId]);

  const rent = n(monthlyRent);
  const propValue = n(propertyValue);
  const payRateNum = n(payRate);
  const marginNum = n(stressMargin);
  const stressRateNum = n(stressRate);

  const effectiveStressRate =
    payRateNum > 0
      ? stressAtPayRate
        ? payRateNum
        : payRateNum + marginNum
      : stressRateNum;

  const calc = useMemo(
    () =>
      computeCalc({
        rent,
        rate: effectiveStressRate,
        icrMultiplier,
        arrFeeMode,
        arrFeePct: n(arrFeePct),
        arrFeeFixed: n(arrFeeFixed),
        stressBasis,
        propertyValue: propValue,
        ltv: n(targetLtv),
        payRate: payRateNum,
      }),
    [
      rent,
      effectiveStressRate,
      icrMultiplier,
      arrFeeMode,
      arrFeePct,
      arrFeeFixed,
      stressBasis,
      propValue,
      targetLtv,
      payRateNum,
    ],
  );

  const scenarios = useMemo(
    () =>
      computeScenarios({
        rent,
        icrMultiplier,
        arrFeeMode,
        arrFeePct: n(arrFeePct),
        arrFeeFixed: n(arrFeeFixed),
        stressBasis,
        propertyValue: propValue,
        ltv: n(targetLtv),
      }),
    [
      rent,
      icrMultiplier,
      arrFeeMode,
      arrFeePct,
      arrFeeFixed,
      stressBasis,
      propValue,
      targetLtv,
    ],
  );

  const hasRent = rent > 0;

  const stressTestPayload = useMemo<UpdateCaseStressTestInput>(
    () => ({
      lenderId: lenderId ? parseInt(lenderId, 10) : null,
      monthlyRent: monthlyRent ? rent : null,
      propertyValue: propertyValue ? propValue : null,
      stressRate: stressRate ? stressRateNum : null,
      payRate: payRate ? payRateNum : null,
      stressAtPayRate,
      stressMargin: marginNum,
      icrMultiplier,
      targetLtv: n(targetLtv),
      arrFeeMode,
      arrFeePct: arrFeePct ? n(arrFeePct) : null,
      arrFeeFixed: arrFeeFixed ? n(arrFeeFixed) : null,
      stressBasis,
    }),
    [
      lenderId,
      monthlyRent,
      rent,
      propertyValue,
      propValue,
      stressRate,
      stressRateNum,
      payRate,
      payRateNum,
      stressAtPayRate,
      marginNum,
      icrMultiplier,
      targetLtv,
      arrFeeMode,
      arrFeePct,
      arrFeeFixed,
      stressBasis,
    ],
  );

  useEffect(() => {
    if (!record || loadedForId !== record.id) return;

    const savedPayload: UpdateCaseStressTestInput = {
      lenderId: record.lenderId,
      monthlyRent: record.monthlyRent,
      propertyValue: record.propertyValue,
      stressRate: record.stressRate,
      payRate: record.payRate,
      stressAtPayRate: record.stressAtPayRate,
      stressMargin: record.stressMargin,
      icrMultiplier: record.icrMultiplier,
      targetLtv: record.targetLtv,
      arrFeeMode: record.arrFeeMode,
      arrFeePct: record.arrFeePct,
      arrFeeFixed: record.arrFeeFixed,
      stressBasis: record.stressBasis,
    };
    if (JSON.stringify(savedPayload) === JSON.stringify(stressTestPayload)) {
      setAutoSaveState("saved");
      return;
    }

    setAutoSaveState("saving");
    const timer = window.setTimeout(() => {
      updateStressTest.mutate(
        { id: caseId, data: { ...stressTestPayload, submissionId: submissionId ?? null } },
        {
          onSuccess: () => {
            setAutoSaveState("saved");
            invalidateRecord();
          },
          onError: () => {
            setAutoSaveState("error");
            toast.add({ title: "Failed to save stress test", type: "error" });
          },
        },
      );
    }, 600);

    return () => window.clearTimeout(timer);
  }, [caseId, submissionId, loadedForId, qc, record, stressTestPayload, updateStressTest]);

  const handleApplyPropertyValue = () => {
    if (
      !calc?.passes ||
      propValue <= 0 ||
      autoSaveState !== "saved" ||
      applyPropertyValue.isPending
    )
      return;
    applyPropertyValue.mutate(
      { id: caseId, data: { submissionId: submissionId ?? null } },
      {
        onSuccess: () => {
          toast.add({
            title: "Property value updated from stress test",
            type: "success",
          });
          qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
        },
        onError: (error: any) => {
          toast.add({
            title: "Could not update property value",
            description: error?.data?.error ?? error?.message,
            type: "error",
          });
        },
      },
    );
  };

  // Seed every input from what the case already knows.
  const useCaseFigures = () => {
    if (!caseItem) return;
    setLenderId(caseItem.lenderId ? String(caseItem.lenderId) : "");
    setMonthlyRent(caseItem.rent ? String(caseItem.rent) : "");
    setPropertyValue(
      caseItem.propertyValue ? String(caseItem.propertyValue) : "",
    );
    if (caseItem.loanAmount > 0 && caseItem.propertyValue > 0) {
      setTargetLtv(
        String(
          Math.min(
            100,
            Math.round((caseItem.loanAmount / caseItem.propertyValue) * 1000) /
              10,
          ),
        ),
      );
    }
  };

  const caseLtv =
    caseItem && caseItem.loanAmount > 0 && caseItem.propertyValue > 0
      ? (caseItem.loanAmount / caseItem.propertyValue) * 100
      : null;
  const differsFromCase =
    !!caseItem &&
    (n(monthlyRent) !== n(caseItem.rent ?? 0) ||
      propValue !== n(caseItem.propertyValue));

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  const rateField = (
    <Field>
      <FieldLabel>Stress rate %</FieldLabel>
      <Input
        type="text"
        inputMode="decimal"
        value={stressRate}
        onChange={(e) => setStressRate(e.target.value.replace(/[^0-9.]/g, ""))}
        placeholder="e.g. 5.5"
      />
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={
          RATE_PRESETS.some((p) => stressRateNum === p)
            ? String(stressRateNum)
            : ""
        }
        onValueChange={(v) => v && setStressRate(v)}
        className="flex-wrap"
      >
        {RATE_PRESETS.map((p) => (
          <ToggleGroupItem key={p} value={String(p)}>
            {p}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );

  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardHeader className="border-b px-5 py-3 [.border-b]:pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Calculator className="size-4 text-primary" />
          Stress test
          {calc?.hasValue && hasRent && (
            <Badge
              variant="secondary"
              className={
                calc.passes
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-red-50 text-red-700"
              }
            >
              {calc.passes ? <CheckCircle2 /> : <AlertTriangle />}
              {calc.passes ? "Passes" : "Fails"}
            </Badge>
          )}
        </CardTitle>
        <CardAction className="flex flex-wrap items-center justify-end gap-2">
          <span
            className={`text-xs ${
              autoSaveState === "error"
                ? "text-destructive"
                : autoSaveState === "saving"
                  ? "text-muted-foreground"
                  : "text-emerald-600 dark:text-emerald-500"
            }`}
          >
            {autoSaveState === "error"
              ? "Autosave failed"
              : autoSaveState === "saving"
                ? "Saving…"
                : "Saved"}
          </span>
          {differsFromCase && (
            <Button size="sm" variant="outline" onClick={useCaseFigures}>
              <RotateCcw /> Use case figures
            </Button>
          )}
          {calc?.passes && propValue > 0 && differsFromCase && (
            <Button
              size="sm"
              onClick={handleApplyPropertyValue}
              disabled={
                autoSaveState !== "saved" || applyPropertyValue.isPending
              }
            >
              {applyPropertyValue.isPending
                ? "Updating…"
                : "Save value to case"}
            </Button>
          )}
          {scope}
          {action}
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-5 px-5 py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {/* What the case already tells us */}
        {caseItem && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md bg-muted/40 px-4 py-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">
                {caseItem.valuationAmount ? "Valuation" : "Property value"}
              </dt>
              <dd className="font-medium tabular-nums">
                {fmt(caseItem.propertyValue)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Monthly rent</dt>
              <dd className="font-medium tabular-nums">
                {caseItem.rent ? fmt(caseItem.rent) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Loan requested</dt>
              <dd className="font-medium tabular-nums">
                {fmt(caseItem.loanAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">LTV requested</dt>
              <dd className="font-medium tabular-nums">
                {caseLtv != null ? fmtPct(caseLtv, 1) : "—"}
              </dd>
            </div>
          </dl>
        )}

        {/* Inputs */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field>
            <FieldLabel>Monthly rent</FieldLabel>
            <CommaInput
              value={monthlyRent}
              onChange={setMonthlyRent}
              placeholder="e.g. 2,000"
            />
          </Field>
          <Field>
            <FieldLabel>Property value</FieldLabel>
            <CommaInput
              value={propertyValue}
              onChange={setPropertyValue}
              placeholder="e.g. 350,000"
            />
          </Field>
          <Field>
            <FieldLabel>Target LTV %</FieldLabel>
            <div className="flex gap-2">
              <Input
                type="text"
                inputMode="decimal"
                value={targetLtv}
                onChange={(e) =>
                  setTargetLtv(e.target.value.replace(/[^0-9.]/g, ""))
                }
                className="w-20"
              />
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={
                  LTV_PRESETS.some((p) => n(targetLtv) === p)
                    ? String(n(targetLtv))
                    : ""
                }
                onValueChange={(v) => v && setTargetLtv(v)}
              >
                {LTV_PRESETS.map((p) => (
                  <ToggleGroupItem key={p} value={String(p)}>
                    {p}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </Field>

          {payRateNum === 0 && rateField}
          <Field>
            <FieldLabel>
              Pay rate %{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </FieldLabel>
            <Input
              type="text"
              inputMode="decimal"
              value={payRate}
              onChange={(e) =>
                setPayRate(e.target.value.replace(/[^0-9.]/g, ""))
              }
              placeholder="e.g. 5.25"
            />
            {payRateNum > 0 && (
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5">
                  <Checkbox
                    checked={stressAtPayRate}
                    onCheckedChange={(v) => setStressAtPayRate(v === true)}
                  />
                  Stress at pay rate
                </label>
                {!stressAtPayRate && (
                  <span className="flex items-center gap-1.5">
                    + margin
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={stressMargin}
                      onChange={(e) =>
                        setStressMargin(e.target.value.replace(/[^0-9.]/g, ""))
                      }
                      className="h-7 w-14 px-2"
                    />
                    %
                  </span>
                )}
                <span className="text-muted-foreground">
                  → stressed at {fmtPct(effectiveStressRate)}
                </span>
              </div>
            )}
          </Field>
          <Field>
            <FieldLabel>ICR</FieldLabel>
            <Select
              value={String(icrMultiplier)}
              onValueChange={(v) => setIcrMultiplier(parseFloat(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1.25">125% — standard</SelectItem>
                <SelectItem value="1.45">
                  145% — higher-rate taxpayer
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Arrangement fee</FieldLabel>
            <div className="flex gap-2">
              <Select
                value={arrFeeMode}
                onValueChange={(v) => setArrFeeMode(v as ArrFeeMode)}
              >
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="pct">% of loan</SelectItem>
                  <SelectItem value="fixed">Fixed £</SelectItem>
                </SelectContent>
              </Select>
              {arrFeeMode === "pct" && (
                <Input
                  type="text"
                  inputMode="decimal"
                  value={arrFeePct}
                  onChange={(e) =>
                    setArrFeePct(e.target.value.replace(/[^0-9.]/g, ""))
                  }
                  placeholder="e.g. 1.75"
                />
              )}
              {arrFeeMode === "fixed" && (
                <CommaInput
                  value={arrFeeFixed}
                  onChange={setArrFeeFixed}
                  placeholder="e.g. 3,995"
                />
              )}
            </div>
            {arrFeeMode !== "none" && (
              <Select
                value={stressBasis}
                onValueChange={(v) => setStressBasis(v as StressBasis)}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="total">
                    Stress the total facility (incl. fee)
                  </SelectItem>
                  <SelectItem value="net">Stress the net loan only</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field>
            <FieldLabel>Lender</FieldLabel>
            <Select value={lenderId || undefined} onValueChange={setLenderId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select lender" />
              </SelectTrigger>
              <SelectContent>
                {lenders.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {/* Results */}
        {!hasRent ? (
          <Empty className="border py-8">
            <EmptyHeader>
              <EmptyDescription>
                Enter the monthly rent to calculate.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : !calc ? (
          <Empty className="border py-8">
            <EmptyHeader>
              <EmptyDescription>
                Enter a stress rate or pay rate to calculate.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Max loan
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {fmt(calc.maxGrossLoan)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {arrFeeMode !== "none" && calc.arrFeeOnMaxLoan > 0
                  ? `${fmt(calc.maxTotalLoan)} incl. ${fmt(calc.arrFeeOnMaxLoan)} fee`
                  : `at ${fmtPct(effectiveStressRate)} · ICR ${Math.round(icrMultiplier * 100)}%`}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Achievable LTV
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {calc.hasValue ? fmtPct(calc.achievableLtv, 1) : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {calc.hasValue
                  ? calc.ltvHeadroom >= 0
                    ? `target ${fmtPct(n(targetLtv), 1)} · ${calc.ltvHeadroom.toFixed(1)}pp headroom`
                    : `target ${fmtPct(n(targetLtv), 1)} · ${Math.abs(calc.ltvHeadroom).toFixed(1)}pp short`
                  : "enter a property value"}
              </p>
            </div>
            <div
              className={cn(
                "rounded-lg border p-4",
                calc.hasValue &&
                  (calc.passes
                    ? "border-emerald-200 bg-emerald-50/50"
                    : "border-red-200 bg-red-50/50"),
              )}
            >
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Rent required
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {calc.hasValue ? fmt(calc.requiredRent) : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {calc.hasValue
                  ? calc.surplus >= 0
                    ? `${fmt(rent)} actual · ${fmt(calc.surplus)} surplus`
                    : `${fmt(rent)} actual · ${fmt(Math.abs(calc.surplus))} short`
                  : "enter a property value"}
                {calc.hasValue && calc.breakEvenRate != null && (
                  <> · passes up to {fmtPct(calc.breakEvenRate, 1)}</>
                )}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Monthly cost
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {payRateNum > 0 ? fmt(calc.monthlyInterestOnly) : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {payRateNum > 0
                  ? `interest-only at ${fmtPct(payRateNum)}`
                  : "enter a pay rate"}
              </p>
            </div>
          </div>
        )}

        {calc && scenarios.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
              <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
              Rate sensitivity
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Rate</TableHead>
                    <TableHead className="text-right">Max loan</TableHead>
                    {calc.hasValue && (
                      <TableHead className="text-right">
                        Achievable LTV
                      </TableHead>
                    )}
                    {calc.hasValue && (
                      <TableHead className="text-right">vs target</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scenarios.map((s) => {
                    const isActive =
                      Math.abs(s.rate - effectiveStressRate) < 0.001;
                    return (
                      <TableRow
                        key={s.rate}
                        data-state={isActive ? "selected" : undefined}
                      >
                        <TableCell className="font-medium">
                          {fmtPct(s.rate, 1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(s.maxGrossLoan)}
                        </TableCell>
                        {calc.hasValue && (
                          <TableCell className="text-right tabular-nums">
                            {s.achievableLtv != null
                              ? fmtPct(s.achievableLtv, 1)
                              : "—"}
                          </TableCell>
                        )}
                        {calc.hasValue && (
                          <TableCell
                            className={`text-right font-medium tabular-nums ${s.diff != null && s.diff < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-500"}`}
                          >
                            {s.diff != null
                              ? `${s.diff >= 0 ? "+" : ""}${s.diff.toFixed(1)}pp`
                              : "—"}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
