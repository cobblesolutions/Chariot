import { Link } from "wouter";
import { serviceTypeLabel } from "@/lib/service-types";
import {
  CreditCard,
  FolderOpen,
  Hash,
  Landmark,
  User,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { CaseDetail } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { CaseStageStrip } from "@/components/case/case-stage-strip";
import { caseStatusStyle } from "@/lib/case-status";
import { stageClasses } from "@/lib/stages";
import { cn, formatMoney } from "@/lib/utils";

export interface HeaderChip {
  icon: LucideIcon;
  /** Accessible name for the icon, e.g. "Client". */
  title: string;
  label: string;
  href?: string;
  muted?: boolean;
}

function titleCase(value: string) {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function buildChips(caseItem: CaseDetail): HeaderChip[] {
  return [
    {
      icon: User,
      title: "Client",
      label: caseItem.clientName,
      href: `/clients/${caseItem.clientId}`,
    },
    {
      icon: FolderOpen,
      title: "Matter",
      label: `${titleCase(caseItem.matterType)} · ${serviceTypeLabel(caseItem.serviceType)}`,
    },
    {
      icon: CreditCard,
      title: "Loan",
      label: formatMoney(caseItem.loanAmount),
    },
    caseItem.lenderId
      ? {
          icon: Landmark,
          title: "Lender",
          label: caseItem.lenderName ?? "Lender",
          href: `/lenders/${caseItem.lenderId}`,
        }
      : {
          icon: Landmark,
          title: "Lender",
          label: "No lender yet",
          muted: true,
        },
    caseItem.assignedTo
      ? { icon: UserCheck, title: "Case manager", label: caseItem.assignedTo }
      : {
          icon: UserCheck,
          title: "Case manager",
          label: "Unassigned",
          muted: true,
        },
    // The lender's own reference, unless it is what we already show as the badge.
    ...(caseItem.caseNumber && caseItem.caseNumber !== caseItem.reference
      ? [{ icon: Hash, title: "Lender reference", label: caseItem.caseNumber }]
      : []),
  ];
}

type CaseHeaderProps = {
  caseItem: CaseDetail;
  viewingStageIndex: number;
  onSelectStage: (index: number) => void;
  /** Page-level buttons, top right. Outline buttons get the glass treatment. */
  actions?: React.ReactNode;
};

/**
 * Hero band in the current stage's colour (back link, title, status, chips,
 * actions) with the stage strip card overlapping its lower edge.
 */
export function CaseHeader({
  caseItem,
  viewingStageIndex,
  onSelectStage,
  actions,
}: CaseHeaderProps) {
  const chips = buildChips(caseItem);
  // The band follows the stage being viewed, fading between stage colours.
  const band = stageClasses(viewingStageIndex).hero;

  return (
    <div className="shrink-0">
      <div
        className={cn(
          "relative pt-4 pb-20 text-white transition-colors duration-700 ease-in-out md:pt-6 md:pb-24",
          band,
          // Stock buttons re-tinted for the coloured ground.
          "[&_[data-variant=outline]]:border-white/30 [&_[data-variant=outline]]:bg-white/10 [&_[data-variant=outline]]:text-white [&_[data-variant=outline]]:shadow-none [&_[data-variant=outline]]:hover:bg-white/20 [&_[data-variant=outline]]:hover:text-white [&_[data-variant=outline]]:aria-expanded:bg-white/20 [&_[data-variant=outline]]:aria-expanded:text-white",
          "[&_[data-variant=default]]:bg-card [&_[data-variant=default]]:text-foreground [&_[data-variant=default]]:hover:bg-card/90 [&_[data-variant=default]]:hover:text-foreground",
        )}
      >
        <div className="mx-auto max-w-page px-6 md:px-8">
          <BackButton
            fallback={{ href: "/cases", label: "Cases" }}
            className="-ml-2 text-white/80 hover:bg-white/10 hover:text-white"
          />
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {caseItem.propertyId ? (
                    <Link
                      href={`/properties/${caseItem.propertyId}`}
                      className="decoration-white/40 underline-offset-4 hover:underline"
                    >
                      {caseItem.propertyAddress}
                    </Link>
                  ) : (
                    caseItem.propertyAddress
                  )}
                </h1>
                <Badge
                  variant="outline"
                  className="border-white/30 font-mono text-white"
                >
                  {caseItem.reference}
                </Badge>
                <StatusBadge
                  style={caseStatusStyle(caseItem.status, caseItem.archivedAt)}
                />
              </div>
              <dl className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                {chips.map((chip) => (
                  <div
                    key={chip.title}
                    className={cn(
                      "flex items-center gap-1.5",
                      chip.muted ? "text-white/55" : "text-white/90",
                    )}
                  >
                    <dt className="contents">
                      <chip.icon
                        className="size-3.5 shrink-0 text-white/60"
                        aria-label={chip.title}
                      />
                    </dt>
                    <dd className="truncate">
                      {chip.href ? (
                        <Link
                          href={chip.href}
                          className="decoration-white/40 underline-offset-4 hover:underline"
                        >
                          {chip.label}
                        </Link>
                      ) : (
                        chip.label
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            {actions && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {actions}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-page px-6 md:px-8">
        <Card className="relative -mt-14 md:-mt-16">
          <CardContent>
            <CaseStageStrip
              stages={caseItem.stages}
              stageIndex={caseItem.stageIndex}
              skippedStageIndexes={caseItem.skippedStageIndexes}
              viewingStageIndex={viewingStageIndex}
              onSelect={onSelectStage}
              stageDays={caseItem.stageDays}
              stageFlagged={caseItem.stageFlagged}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
