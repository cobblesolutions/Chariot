import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { DocumentCheck } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const ICONS = {
  ok: { Icon: CheckCircle2, className: "text-emerald-600" },
  mismatch: { Icon: XCircle, className: "text-destructive" },
  attention: { Icon: AlertTriangle, className: "text-amber-600" },
  info: { Icon: Info, className: "text-muted-foreground" },
} as const;

/**
 * Cross-document findings from the document reading system: where the ID,
 * statements, payslip and credit report agree with each other and the
 * record, and where they do not.
 */
export function DocumentChecks({ checks }: { checks: DocumentCheck[] | undefined }) {
  if (!checks || checks.length === 0) return null;
  const problems = checks.filter((check) => check.status !== "ok").length;
  return (
    <div className="rounded-lg border">
      <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
        Document checks
        {problems > 0 ? ` · ${problems} to look at` : " · all consistent"}
      </p>
      <ul className="divide-y">
        {checks.map((check) => {
          const { Icon, className } = ICONS[check.status] ?? ICONS.info;
          return (
            <li key={check.key} className="flex items-start gap-2 px-3 py-1.5 text-sm">
              <Icon className={cn("mt-0.5 size-4 shrink-0", className)} />
              <span className="min-w-0">
                <span className="font-medium">{check.label}</span>
                <span className="text-muted-foreground"> — {check.detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
