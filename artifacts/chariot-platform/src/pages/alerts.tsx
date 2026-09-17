import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAlerts,
  getListAlertsQueryKey,
  useAcknowledgeAlert,
  useEvaluateAlerts,
  getGetAlertSummaryQueryKey,
  type Alert,
  type ListAlertsScope,
  type ListAlertsStatus,
} from "@workspace/api-client-react";
import { formatDistanceToNowStrict } from "date-fns";
import { Bell, Briefcase, Check, RefreshCw, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/components/auth-provider";
import { isFullAccess } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/components/add/utils";
import { AlertActions } from "@/components/alerts/alert-actions";

type SeverityFilter = "all" | "red" | "amber";

const SEVERITY = {
  red: { tile: "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400", chip: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300", accent: "border-l-red-500" },
  amber: { tile: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400", chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300", accent: "border-l-amber-500" },
};

/**
 * Things that need a person: red = act today, amber = heads-up. The rules run
 * on the server every 15 minutes; an alert clears itself when the cause is
 * gone, and "Acknowledge" says "seen" until then.
 */
export default function AlertsPage() {
  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);
  const qc = useQueryClient();
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [scope, setScope] = useState<ListAlertsScope>("mine");
  const [status, setStatus] = useState<ListAlertsStatus>("open");
  const params = { scope, status };
  const { data, isLoading } = useListAlerts(params, { query: { queryKey: getListAlertsQueryKey(params), refetchInterval: 30_000 } });
  const acknowledge = useAcknowledgeAlert();
  const evaluate = useEvaluateAlerts();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListAlertsQueryKey(params) });
    qc.invalidateQueries({ queryKey: getGetAlertSummaryQueryKey() });
  };
  const items = (data ?? []).filter((alert) => severity === "all" || alert.severity === severity);
  const redCount = (data ?? []).filter((a) => a.severity === "red").length;
  const amberCount = (data ?? []).length - redCount;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            {status === "open"
              ? redCount || amberCount
                ? `${redCount} need action · ${amberCount} to keep an eye on`
                : "Nothing needs you right now."
              : status === "acknowledged" ? "Seen, still open — they clear themselves when the cause is fixed." : "Cleared alerts, most recent first."}
          </p>
        </div>
        {isAdmin ? (
          <Button
            variant="outline"
            size="sm"
            disabled={evaluate.isPending}
            onClick={() =>
              evaluate.mutate(undefined, {
                onSuccess: (result) => {
                  invalidate();
                  toast.add({ title: `Checked: ${result.raised} new, ${result.resolved} cleared, ${result.open} open`, type: "success" });
                },
                onError: (error) => toast.add({ title: "Couldn't run the checks", description: apiErrorMessage(error, "Please try again."), type: "error" }),
              })
            }
          >
            <RefreshCw className={cn(evaluate.isPending && "animate-spin")} /> Check now
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={severity} onValueChange={(value) => setSeverity(value as SeverityFilter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="red"><TriangleAlert className="text-red-600" /> Red</TabsTrigger>
            <TabsTrigger value="amber"><Bell className="text-amber-600" /> Amber</TabsTrigger>
          </TabsList>
        </Tabs>
        <ToggleGroup type="single" variant="outline" size="sm" value={status} onValueChange={(value) => value && setStatus(value as ListAlertsStatus)}>
          <ToggleGroupItem value="open">Open</ToggleGroupItem>
          <ToggleGroupItem value="acknowledged">Seen</ToggleGroupItem>
          <ToggleGroupItem value="resolved">Cleared</ToggleGroupItem>
        </ToggleGroup>
        {isAdmin ? (
          <ToggleGroup type="single" variant="outline" size="sm" value={scope} onValueChange={(value) => value && setScope(value as ListAlertsScope)} className="ml-auto">
            <ToggleGroupItem value="mine">Mine</ToggleGroupItem>
            <ToggleGroupItem value="all">Everyone</ToggleGroupItem>
          </ToggleGroup>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Check /></EmptyMedia>
            <EmptyTitle>{status === "open" ? "All clear" : "Nothing here"}</EmptyTitle>
            <EmptyDescription>
              {status === "open" ? "Overdue stages and tasks, waiting enquiries, unanswered advice, missed valuations, overdue invoices and renewals show up here." : "Alerts move here when seen or when their cause is fixed."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="overflow-hidden rounded-xl border bg-card">
          {items.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              canAcknowledge={status === "open"}
              onAcknowledge={() =>
                acknowledge.mutate({ id: alert.id }, {
                  onSuccess: invalidate,
                  onError: (error) => toast.add({ title: "Couldn't mark it as seen", description: apiErrorMessage(error, "Please try again."), type: "error" }),
                })
              }
            />
          ))}
        </ItemGroup>
      )}
    </div>
  );
}

function AlertRow({ alert, canAcknowledge, onAcknowledge }: { alert: Alert; canAcknowledge: boolean; onAcknowledge: () => void }) {
  const tone = SEVERITY[alert.severity];
  const Icon = alert.severity === "red" ? TriangleAlert : Bell;
  return (
    <Item size="sm" className={cn("rounded-none border-0 border-b border-l-2 flex-nowrap py-2 last:border-b-0 border-b-border/40", tone.accent)}>
      <ItemMedia variant="icon" className={cn("size-7", tone.tile)}>
        <Icon className="size-3.5" />
      </ItemMedia>
      <div className="min-w-0 flex-1">
        <ItemTitle>
          <Link href={alert.href} className="truncate hover:underline">{alert.title}</Link>
        </ItemTitle>
        <p className="truncate text-sm text-muted-foreground">{alert.detail}</p>
      </div>
      <ItemActions className="shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {canAcknowledge ? <AlertActions alert={alert} /> : null}
        <Badge variant="outline" className={cn("max-md:hidden", tone.chip)}>{alert.kindLabel}</Badge>
        {alert.caseReference ? (
          <Badge variant="outline" className="max-sm:hidden"><Briefcase /> {alert.caseReference}</Badge>
        ) : null}
        <span className="max-lg:hidden">{alert.assignedTo ?? "Unassigned"}</span>
        <span className="w-20 truncate text-right">{formatDistanceToNowStrict(new Date(alert.raisedAt), { addSuffix: true })}</span>
        {canAcknowledge ? (
          <Button variant="ghost" size="sm" onClick={onAcknowledge} title="Mark as seen">
            <Check /> Seen
          </Button>
        ) : alert.acknowledgedBy ? (
          <span className="max-md:hidden">Seen by {alert.acknowledgedBy}</span>
        ) : null}
      </ItemActions>
    </Item>
  );
}
