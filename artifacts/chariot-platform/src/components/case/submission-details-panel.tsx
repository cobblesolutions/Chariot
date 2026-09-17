import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, ClipboardCopy, Copy, History } from "lucide-react";
import {
  useGetCaseSubmissionDetails,
  usePrefillCaseFromPrevious,
  getGetCaseSubmissionDetailsQueryKey,
  getGetCaseQueryKey,
  getGetClientQueryKey,
  getListCasesQueryKey,
  getListTasksQueryKey,
  type SubmissionPack,
  type SubmissionSection,
} from "@workspace/api-client-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/components/add/utils";

/** "Label: value" lines for the filled fields of a section — what a paste into the lender's portal or an email wants. */
const sectionText = (section: SubmissionSection) =>
  section.fields
    .filter((field) => field.value)
    .map((field) => `${field.label}: ${field.value}`)
    .join("\n");

const packText = (pack: SubmissionPack) =>
  pack.sections
    .map((section) => `${section.title.toUpperCase()}\n${sectionText(section)}`)
    .join("\n\n");

/**
 * Clipboard writes with a short "copied" state per key, so the icon that was
 * clicked can flip to a tick without every other one doing the same.
 */
function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const copy = useCallback(async (key: string, text: string, notice?: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.add({ title: "Couldn't copy", description: "Your browser blocked clipboard access.", type: "error" });
      return;
    }
    setCopiedKey(key);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopiedKey(null), 1500);
    if (notice) toast.add({ title: notice, type: "success" });
  }, []);
  return { copiedKey, copy };
}

function CopyButton({
  copied,
  label,
  onClick,
  className,
}: {
  copied: boolean;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(
            copied ? "text-emerald-600 opacity-100 dark:text-emerald-400" : "text-muted-foreground",
            className,
          )}
          aria-label={copied ? "Copied" : label}
          onClick={onClick}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The pack as section cards, each a grid of label-over-value cells that
 * reflows to the width available (three columns on the case page, one or
 * two inside the Add page column). Every filled value has a copy icon on
 * hover; each card copies itself as "Label: value" lines; empty required
 * fields are flagged so the gaps read at a glance.
 */
export function SubmissionPackView({ pack, compact }: { pack: SubmissionPack; compact?: boolean }) {
  const { copiedKey, copy } = useCopy();
  return (
    <div className="space-y-3">
      {pack.sections.map((section) => {
        const filled = section.fields.filter((field) => field.value).length;
        const missing = section.fields.filter((field) => field.missing).length;
        return (
          <section key={section.key} className="min-w-0 overflow-hidden rounded-lg border bg-card" aria-label={section.title}>
            <header className="flex items-center gap-2 border-b bg-muted/40 py-1.5 pr-1.5 pl-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</h4>
              <span
                className={cn(
                  "ml-auto text-[11px] tabular-nums",
                  missing ? "font-medium text-destructive" : "text-muted-foreground",
                )}
              >
                {missing ? `${missing} missing` : `${filled}/${section.fields.length}`}
              </span>
              <CopyButton
                copied={copiedKey === `section:${section.key}`}
                label={`Copy ${section.title.toLowerCase()} details`}
                onClick={() => copy(`section:${section.key}`, sectionText(section), `${section.title} copied (${filled} fields)`)}
              />
            </header>
            <dl
              className={cn(
                // Cells draw their own right/bottom lines; the negative margins tuck the trailing ones under the card edge.
                "-mr-px -mb-px grid grid-flow-dense",
                compact ? "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]",
              )}
            >
              {section.fields.map((field) => {
                const key = `${section.key}:${field.key}`;
                const long = (field.value?.length ?? 0) > 34;
                return (
                  <div
                    key={field.key}
                    className={cn(
                      "group/cell relative min-w-0 border-r border-b px-3 py-2",
                      long && "col-span-full sm:col-span-2",
                      field.missing ? "bg-destructive/5" : "hover:bg-muted/40",
                    )}
                  >
                    <dt className="flex items-center gap-1 pr-6 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <span className="truncate" title={field.label}>{field.label}</span>
                      {field.missing ? <AlertCircle className="size-3 shrink-0 text-destructive" aria-hidden="true" /> : null}
                    </dt>
                    <dd
                      className={cn(
                        "mt-0.5 text-sm leading-snug [overflow-wrap:anywhere]",
                        field.missing && "font-medium text-destructive",
                        !field.value && !field.missing && "text-muted-foreground/60",
                      )}
                    >
                      {field.value ?? (field.missing ? "Missing" : "—")}
                    </dd>
                    {field.value ? (
                      <CopyButton
                        copied={copiedKey === key}
                        label={`Copy ${field.label.toLowerCase()}`}
                        onClick={() => copy(key, field.value!)}
                        className="absolute top-1 right-1 opacity-0 transition-opacity group-hover/cell:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                      />
                    ) : null}
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Stage 1 — Submission details. A display-only view of everything the lender
 * will get, assembled from the client, property, case and advice, with what
 * is still missing; empty fields can be copied from the client's last case.
 * Nothing is put to the client — the stage is complete once the pack is.
 */
export function SubmissionDetailsPanel({
  caseId,
  clientId,
  disabled,
  compact,
}: {
  caseId: number;
  clientId: number;
  disabled?: boolean;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const { data: state, isLoading } = useGetCaseSubmissionDetails(caseId, {
    query: { queryKey: getGetCaseSubmissionDetailsQueryKey(caseId) },
  });
  const prefill = usePrefillCaseFromPrevious();
  const { copiedKey, copy } = useCopy();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetCaseSubmissionDetailsQueryKey(caseId) });
    qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
    qc.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
    qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
    qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
  };

  if (isLoading || !state) {
    return (
      <div className={cn("space-y-3", compact ? "" : "p-4 md:p-5")}>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const { pack, previousCase } = state;
  const total = pack.sections.reduce((sum, section) => sum + section.fields.length, 0);
  const filled = pack.sections.reduce((sum, section) => sum + section.fields.filter((field) => field.value).length, 0);

  const handlePrefill = () =>
    prefill.mutate(
      { id: caseId },
      {
        onSuccess: (result) => {
          invalidate();
          toast.add({
            title: result.copied.length ? `Copied from ${result.fromReference}` : `Nothing to copy from ${result.fromReference}`,
            description: result.copied.join(", ") || "Every field that case could fill was already filled.",
            type: "success",
          });
        },
        onError: (error) =>
          toast.add({ title: "Couldn't copy from the last case", description: apiErrorMessage(error, "Please try again."), type: "error" }),
      },
    );

  return (
    <div className={cn("space-y-3", compact ? "" : "p-4 md:p-5")}>
      <div className="flex flex-wrap items-center gap-2">
        {pack.missing.length === 0 ? (
          <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400">
            <Check /> Ready for the lender
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle /> {pack.missing.length} missing
          </Badge>
        )}
        <span className="text-xs tabular-nums text-muted-foreground">{filled} of {total} fields filled</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {previousCase && !disabled ? (
            <Button variant="outline" size="sm" onClick={handlePrefill} disabled={prefill.isPending} title={`Copy empty fields from ${previousCase.reference}`}>
              <History /> {prefill.isPending ? "Copying…" : `Fill from ${previousCase.reference}`}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy("pack", packText(pack), `All details copied (${filled} fields)`)}
            disabled={filled === 0}
          >
            {copiedKey === "pack" ? <Check className="text-emerald-600" /> : <ClipboardCopy />} Copy all
          </Button>
        </div>
      </div>

      {pack.missing.length ? (
        <p className="text-sm text-muted-foreground">
          Still needed: {pack.missing.join(" · ")}.
        </p>
      ) : null}

      <SubmissionPackView pack={pack} compact={compact} />
    </div>
  );
}
