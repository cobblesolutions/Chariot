import type {
  GlobalSearchResults,
  GlobalSearchType,
} from "@workspace/api-client-react";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { SEARCH_TYPES } from "@/lib/search";

/**
 * Record-type chips shared by the palette and the results page. An empty
 * `value` means "everything"; the API is asked only for the selected types
 * so narrowing also makes the request cheaper.
 */
export function SearchTypeFilter({
  value,
  onChange,
  results,
  wrap = false,
  className,
}: {
  value: GlobalSearchType[];
  onChange: (types: GlobalSearchType[]) => void;
  /** When present, chips show that type's hit count. */
  results?: GlobalSearchResults;
  /** Wrap onto several lines (results page) instead of scrolling horizontally (palette). */
  wrap?: boolean;
  className?: string;
}) {
  const totals = new Map(
    results?.groups.map((group) => [group.type, group.total]) ?? [],
  );
  const all = value.length === 0;

  return (
    <div
      className={cn(
        "flex items-center gap-1",
        wrap
          ? "flex-wrap"
          : // Scrolls sideways with the scrollbar hidden; the fade hints there is more to the right.
            "overflow-x-auto [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] pr-8",
        className,
      )}
    >
      <Toggle
        size="sm"
        variant="outline"
        pressed={all}
        onPressedChange={() => onChange([])}
        className="h-7 shrink-0 rounded-full px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
      >
        All
      </Toggle>
      <ToggleGroup
        type="multiple"
        size="sm"
        variant="outline"
        spacing={1}
        value={value}
        onValueChange={(next) => onChange(next as GlobalSearchType[])}
        className="shrink-0"
      >
        {SEARCH_TYPES.map((meta) => {
          const count = totals.get(meta.type);
          const Icon = meta.icon;
          return (
            <ToggleGroupItem
              key={meta.type}
              value={meta.type}
              aria-label={meta.plural}
              className="h-7 rounded-full px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              <Icon className="size-3.5" />
              {meta.plural}
              {count != null && (
                <span className="tabular-nums opacity-70">{count}</span>
              )}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}
