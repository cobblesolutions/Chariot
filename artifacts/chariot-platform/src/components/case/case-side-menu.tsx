import type { LucideIcon } from "lucide-react";
import { FileText, ListTodo, MessageSquare, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type CaseSection = "tasks" | "messages" | "documents";

export const CASE_SECTIONS: {
  key: CaseSection;
  label: string;
  icon: LucideIcon;
}[] = [
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "messages", label: "Messages", icon: MessageSquare },
  { key: "documents", label: "Documents", icon: FileText },
];

export function isCaseSection(value: unknown): value is CaseSection {
  return CASE_SECTIONS.some((s) => s.key === value);
}

/**
 * Icon rail inside the case page's side container. Selecting an item opens
 * its panel next to the rail; selecting the active item collapses the panel.
 */
export function CaseSideMenu({
  active,
  counts,
  onSelect,
  className,
}: {
  active: CaseSection | null;
  counts: Partial<Record<CaseSection, number>>;
  onSelect: (section: CaseSection) => void;
  className?: string;
}) {
  return (
    <nav
      aria-label="Case sections"
      className={cn(
        "flex w-14 shrink-0 flex-col items-center gap-2 border-r bg-muted/30 p-2",
        className,
      )}
    >
      {CASE_SECTIONS.map(({ key, label, icon: Icon }) => {
        const isActive = active === key;
        const count = counts[key] ?? 0;
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label={label}
                aria-pressed={isActive}
                onClick={() => onSelect(key)}
                className={cn(
                  "relative",
                  isActive &&
                    "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                )}
              >
                <Icon className="size-5" />
                {count > 0 && (
                  <Badge
                    variant="secondary"
                    className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] tabular-nums"
                  >
                    {count}
                  </Badge>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

/** Shared header for the panels the menu opens. */
export function SidePanelHeader({
  icon: Icon,
  title,
  count,
  actions,
  onClose,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  actions?: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b px-3 py-2">
      <Icon className="size-4 text-primary" />
      <span className="ml-1 truncate text-sm font-semibold">{title}</span>
      {count !== undefined && count > 0 && (
        <Badge variant="secondary" className="ml-1 px-1.5 tabular-nums">
          {count}
        </Badge>
      )}
      <span className="flex-1" />
      {actions}
      {onClose && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={`Close ${title.toLowerCase()}`}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
