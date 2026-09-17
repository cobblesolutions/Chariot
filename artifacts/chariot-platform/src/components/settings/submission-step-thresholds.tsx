import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSubmissionStepThresholds,
  useUpdateSubmissionStepThreshold,
  getListSubmissionStepThresholdsQueryKey,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { stageClasses, SUBMISSION_STAGE_INDEX } from "@/lib/stages";

/**
 * Red flags per submission step (scope: "red flags on every step"): how many
 * days a lender submission may sit at DIP / case number / fee / valuation /
 * decision before it is flagged and an alert is raised.
 */
export function SubmissionStepThresholds({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useListSubmissionStepThresholds();
  const update = useUpdateSubmissionStepThreshold();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [state, setState] = useState<{ key: string; label: string } | null>(null);

  useEffect(() => {
    if (data) setDrafts(Object.fromEntries(data.map((t) => [t.stepKey, t.thresholdDays != null ? String(t.thresholdDays) : ""])));
  }, [data]);

  const commit = (stepKey: string, raw: string) => {
    const thresholdDays = raw.trim() === "" ? null : parseInt(raw, 10);
    if (thresholdDays != null && (Number.isNaN(thresholdDays) || thresholdDays < 1)) {
      toast.add({ title: "Enter a whole number of days, or leave blank", type: "error" });
      return;
    }
    const current = data?.find((t) => t.stepKey === stepKey)?.thresholdDays ?? null;
    if (current === thresholdDays) return;
    setState({ key: stepKey, label: "saving…" });
    update.mutate({ stepKey, data: { thresholdDays } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSubmissionStepThresholdsQueryKey() });
        setState({ key: stepKey, label: "saved" });
        setTimeout(() => setState((s) => (s?.key === stepKey ? null : s)), 1500);
      },
      onError: () => { setState(null); toast.add({ title: "Couldn't save the threshold", type: "error" }); },
    });
  };

  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold">Submission steps</h2>
        <p className="text-xs text-muted-foreground">Days a lender submission may sit at a step before it is flagged red (and an alert raised for the case handler).</p>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        {isLoading ? (
          <div className="space-y-3 p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : (
          <div className="divide-y">
            {data?.map((t) => (
              <div key={t.stepKey} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`size-2.5 shrink-0 rounded-full ${stageClasses(SUBMISSION_STAGE_INDEX).bg}`} />
                  <p className="truncate text-sm font-medium">{t.step}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    placeholder="—"
                    disabled={!isAdmin}
                    value={drafts[t.stepKey] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [t.stepKey]: e.target.value }))}
                    onBlur={(e) => commit(t.stepKey, e.target.value)}
                    className="w-16 text-right"
                  />
                  <span className="w-10 text-xs text-muted-foreground">{state && state.key === t.stepKey ? state.label : "days"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
