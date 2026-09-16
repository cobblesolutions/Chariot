import type { GlobalSearchHit } from "@workspace/api-client-react";
import {
  differenceInCalendarDays,
  format,
  isThisYear,
  isToday,
} from "date-fns";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { searchTypeMeta } from "@/lib/search";
import { Highlight } from "./highlight";

/** Compact, never-wrapping: "14:32" today, "Tue" this week, "6 Sep" this year, else "6 Sep 2025". */
function hitDate(value: Date | string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (isToday(date)) return format(date, "HH:mm");
  if (Math.abs(differenceInCalendarDays(date, new Date())) < 7) {
    return format(date, "EEE");
  }
  return format(date, isThisYear(date) ? "d MMM" : "d MMM yyyy");
}

/**
 * One search result, laid out the same in the palette and on the results
 * page: type icon · title + context · "matched in" excerpt · status chip · date.
 * The wrapper (CommandItem / Link) decides interaction; this only draws.
 */
export function SearchHitBody({
  hit,
  terms,
  dense = false,
}: {
  hit: GlobalSearchHit;
  terms: readonly string[];
  /** Palette rows: smaller icon, one-line subtitle. */
  dense?: boolean;
}) {
  const meta = searchTypeMeta(hit.type);
  const Icon = meta.icon;
  const when = hitDate(hit.date);

  return (
    <>
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border",
          dense ? "size-7" : "size-9",
          meta.tile,
        )}
      >
        <Icon className={dense ? "size-3.5" : "size-4"} />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <Highlight
            text={hit.title}
            terms={terms}
            className="truncate text-sm font-medium text-foreground"
          />
        </span>
        {hit.subtitle && (
          <Highlight
            text={hit.subtitle}
            terms={terms}
            className="truncate text-xs text-muted-foreground"
          />
        )}
        {hit.matchedField && hit.snippet && (
          <span className="truncate text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">
              {hit.matchedField}
            </span>
            <span aria-hidden> · </span>
            <Highlight text={hit.snippet} terms={terms} />
          </span>
        )}
      </span>

      <span className="ml-auto flex shrink-0 items-center gap-2 self-start pt-0.5">
        {hit.badge && (
          <Badge variant="outline" className="max-sm:hidden">
            {hit.badge}
          </Badge>
        )}
        {when && (
          <time
            dateTime={new Date(hit.date as Date | string).toISOString()}
            title={format(
              new Date(hit.date as Date | string),
              "EEEE d MMMM yyyy, HH:mm",
            )}
            className="whitespace-nowrap text-xs tabular-nums text-muted-foreground max-sm:hidden"
          >
            {when}
          </time>
        )}
      </span>
    </>
  );
}
