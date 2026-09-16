import type { ReactNode } from "react";
import { Keyboard, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StageBadge } from "@/components/stage-badge";
import { INBOX_VIEWS, type InboxFocus, type InboxView } from "./inbox-model";

function RailButton({
  active,
  icon: Icon,
  label,
  count,
  onClick,
  title,
}: {
  active: boolean;
  icon?: typeof UserRound;
  label: ReactNode;
  count?: number;
  onClick: () => void;
  title?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "w-full justify-start font-normal",
        active && "bg-muted font-medium",
      )}
      onClick={onClick}
      aria-pressed={active}
      title={title}
    >
      {Icon && <Icon />}
      <span className="truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </Button>
  );
}

const SHORTCUTS: [string, string][] = [
  ["J / K", "Next / previous thread"],
  ["Enter", "Open the highlighted thread"],
  ["/", "Search"],
  ["N", "New message"],
  ["I", "Show or hide details"],
  ["F", "Find in conversation"],
  ["P", "Pin / unpin"],
  ["M", "Mute / unmute"],
  ["U", "Mark unread / read"],
  ["E", "Archive / restore"],
  ["Esc", "Close find, or back to the list"],
];

/** Left rail of the inbox: saved views, channels, focus filters and the shortcut legend. */
export function InboxRail({
  view,
  onView,
  counts,
  focus,
  onFocus,
  stages,
  myCasesCount,
  className,
}: {
  view: InboxView;
  onView: (view: InboxView) => void;
  counts: Record<InboxView, number>;
  focus: InboxFocus;
  onFocus: (focus: InboxFocus) => void;
  stages: { stage: string; count: number }[];
  myCasesCount: number;
  className?: string;
}) {
  const section = (key: "inbox" | "channels" | "manage") =>
    INBOX_VIEWS.filter((item) => item.section === key).map((item) => (
      <RailButton
        key={item.key}
        active={view === item.key}
        icon={item.icon}
        label={item.label}
        count={item.key === "all" ? undefined : counts[item.key]}
        onClick={() => onView(item.key)}
        title={item.hint}
      />
    ));

  const toggleStage = (stage: string) =>
    onFocus({
      ...focus,
      stages: focus.stages.includes(stage)
        ? focus.stages.filter((item) => item !== stage)
        : [...focus.stages, stage],
    });

  return (
    <aside
      className={cn(
        "flex min-h-0 w-48 shrink-0 flex-col border-r bg-muted/30",
        className,
      )}
      data-testid="inbox-rail"
    >
      <ScrollArea className="min-h-0 flex-1">
        <nav className="space-y-4 px-2 py-3" aria-label="Inbox views">
          <div className="space-y-0.5">{section("inbox")}</div>
          <div className="space-y-0.5">
            <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
              Channels
            </p>
            {section("channels")}
          </div>
          {(stages.length > 0 || myCasesCount > 0) && (
            <div className="space-y-0.5">
              <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                Focus
              </p>
              <RailButton
                active={focus.myCases}
                icon={UserRound}
                label="My cases"
                count={myCasesCount}
                onClick={() => onFocus({ ...focus, myCases: !focus.myCases })}
                title="Only threads on cases assigned to you"
              />
              {stages.map((item) => (
                <RailButton
                  key={item.stage}
                  active={focus.stages.includes(item.stage)}
                  label={
                    <StageBadge
                      stage={item.stage}
                      className="h-4 px-1.5 text-[10px] leading-none"
                    />
                  }
                  count={item.count}
                  onClick={() => toggleStage(item.stage)}
                />
              ))}
            </div>
          )}
          <div className="space-y-0.5">{section("manage")}</div>
        </nav>
      </ScrollArea>
      <div className="border-t p-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start font-normal text-muted-foreground"
            >
              <Keyboard />
              Shortcuts
            </Button>
          </PopoverTrigger>
          <PopoverContent side="right" align="end" className="w-72">
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys} className="contents">
                  <dt>
                    <Kbd>{keys}</Kbd>
                  </dt>
                  <dd className="text-muted-foreground">{what}</dd>
                </div>
              ))}
            </dl>
          </PopoverContent>
        </Popover>
      </div>
    </aside>
  );
}
