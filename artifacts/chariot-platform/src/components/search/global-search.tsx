import * as React from "react";
import { useLocation } from "wouter";
import type { GlobalSearchType } from "@workspace/api-client-react";
import { ArrowRight, Clock, CornerDownLeft, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  MIN_QUERY_LENGTH,
  clearRecentSearches,
  readRecentSearches,
  rememberSearch,
  searchPageHref,
  searchTypeMeta,
} from "@/lib/search";
import { SearchHitBody } from "./search-hit";
import { SearchTypeFilter } from "./search-type-filter";
import { useSearchResults } from "./use-search-results";

const PALETTE_LIMIT = 5;

/* ---------------------------------------------------------------------------
 * Context — anything in the shell (sidebar button, header icon, pages) can
 * open the palette without threading state through props.
 * ------------------------------------------------------------------------ */

interface GlobalSearchContextValue {
  open: (initialQuery?: string) => void;
  close: () => void;
  isOpen: boolean;
}

const GlobalSearchContext =
  React.createContext<GlobalSearchContextValue | null>(null);

export function useGlobalSearch() {
  const context = React.useContext(GlobalSearchContext);
  if (!context) {
    throw new Error("useGlobalSearch must be used inside GlobalSearchProvider");
  }
  return context;
}

const isTypingTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable ||
    element.closest('[role="dialog"]') !== null
  );
};

export const isMacLike =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export function GlobalSearchProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  /** Client-portal users have no site search; keep the provider but never open. */
  enabled?: boolean;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [initialQuery, setInitialQuery] = React.useState("");

  const open = React.useCallback(
    (query = "") => {
      if (!enabled) return;
      setInitialQuery(query);
      setIsOpen(true);
    },
    [enabled],
  );
  const close = React.useCallback(() => setIsOpen(false), []);

  // ⌘K / Ctrl+K anywhere; "/" when not already typing somewhere.
  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen((current) => !current);
        return;
      }
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        setInitialQuery("");
        setIsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  const value = React.useMemo(
    () => ({ open, close, isOpen }),
    [open, close, isOpen],
  );

  return (
    <GlobalSearchContext.Provider value={value}>
      {children}
      {enabled && (
        <GlobalSearchDialog
          open={isOpen}
          onOpenChange={setIsOpen}
          initialQuery={initialQuery}
        />
      )}
    </GlobalSearchContext.Provider>
  );
}

/* ---------------------------------------------------------------------------
 * Trigger — a search-box lookalike for the sidebar / header.
 * ------------------------------------------------------------------------ */

export function GlobalSearchTrigger({
  variant = "field",
  className,
}: {
  variant?: "field" | "icon";
  className?: string;
}) {
  const { open } = useGlobalSearch();
  if (variant === "icon") {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Search"
        onClick={() => open()}
        className={className}
      >
        <Search />
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => open()}
      className={cn(
        "w-full justify-start gap-2 px-2 text-muted-foreground font-normal",
        className,
      )}
      aria-label="Search everything"
      aria-keyshortcuts={isMacLike ? "Meta+K" : "Control+K"}
    >
      <Search />
      <span className="truncate">Search…</span>
      <KbdGroup className="ml-auto">
        <Kbd>{isMacLike ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </Button>
  );
}

/* ---------------------------------------------------------------------------
 * The palette itself
 * ------------------------------------------------------------------------ */

function GlobalSearchDialog({
  open,
  onOpenChange,
  initialQuery,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery: string;
}) {
  const [, navigate] = useLocation();
  const [input, setInput] = React.useState(initialQuery);
  const [types, setTypes] = React.useState<GlobalSearchType[]>([]);
  const [recent, setRecent] = React.useState<string[]>([]);

  // Reset per opening: fresh query, filters and recent list.
  React.useEffect(() => {
    if (!open) return;
    setInput(initialQuery);
    setTypes([]);
    setRecent(readRecentSearches());
  }, [open, initialQuery]);

  const { query, enabled, results, isPending, isError } = useSearchResults(
    input,
    types,
    PALETTE_LIMIT,
  );
  const terms = results?.terms ?? [];

  const go = (href: string) => {
    setRecent(rememberSearch(query));
    onOpenChange(false);
    navigate(href);
  };
  const openFullResults = () => go(searchPageHref(query, types));

  const showHints = !enabled;
  const showSkeleton = enabled && !results && isPending;
  const showEmpty =
    enabled && results != null && results.groups.length === 0 && !isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[6vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Search</DialogTitle>
          <DialogDescription>
            Search cases, clients, properties, tasks, messages and everything
            else.
          </DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          loop
          className="**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12"
        >
          <div className="relative">
            <CommandInput
              value={input}
              onValueChange={setInput}
              placeholder="Search cases, clients, properties, tasks, messages…"
              autoFocus
            />
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-2">
              {isPending && (
                <Spinner className="size-4 text-muted-foreground" />
              )}
              {input && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Clear search"
                  className="pointer-events-auto"
                  onClick={() => setInput("")}
                >
                  <X />
                </Button>
              )}
            </div>
          </div>

          <SearchTypeFilter
            value={types}
            onChange={setTypes}
            results={results}
            className="border-b px-3 py-2"
          />

          <CommandList
            className={cn(
              "h-[min(72vh,44rem)] max-h-[min(72vh,44rem)] transition-opacity",
              // Previous results stay visible while the next query loads, dimmed so they read as stale.
              isPending && results && "opacity-60",
            )}
            aria-busy={isPending || undefined}
          >
            {showHints && (
              <>
                {recent.length > 0 && (
                  <CommandGroup
                    heading={
                      <span className="flex items-center justify-between">
                        Recent searches
                        <button
                          type="button"
                          className="text-xs font-normal text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            clearRecentSearches();
                            setRecent([]);
                          }}
                        >
                          Clear
                        </button>
                      </span>
                    }
                  >
                    {recent.map((item) => (
                      <CommandItem
                        key={item}
                        value={`recent:${item}`}
                        onSelect={() => setInput(item)}
                      >
                        <Clock />
                        <span className="truncate">{item}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {input.trim().length > 0 &&
                  input.trim().length < MIN_QUERY_LENGTH
                    ? `Type at least ${MIN_QUERY_LENGTH} characters`
                    : "Search any detail — a name, phone number, address, reference, amount, date or a word from a note or message."}
                </div>
              </>
            )}

            {showSkeleton && (
              <div className="space-y-2 p-3" aria-busy>
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <Skeleton className="size-7 rounded-md" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-1/2" />
                      <Skeleton className="h-3 w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isError && (
              <div className="px-4 py-6 text-center text-sm text-destructive">
                Search failed — try again in a moment.
              </div>
            )}

            {showEmpty && (
              <CommandEmpty>
                No matches for{" "}
                <span className="font-medium text-foreground">“{query}”</span>
                {types.length > 0 && (
                  <>
                    {" "}
                    in the selected types.{" "}
                    <button
                      type="button"
                      className="text-primary underline-offset-2 hover:underline"
                      onClick={() => setTypes([])}
                    >
                      Search everything
                    </button>
                  </>
                )}
              </CommandEmpty>
            )}

            {enabled &&
              results?.groups.map((group, index) => {
                const meta = searchTypeMeta(group.type);
                const more = group.total - group.items.length;
                return (
                  <React.Fragment key={group.type}>
                    {index > 0 && <CommandSeparator />}
                    <CommandGroup
                      heading={
                        <span className="flex items-center gap-1.5">
                          {meta.plural}
                          <span className="tabular-nums opacity-70">
                            {group.total}
                          </span>
                        </span>
                      }
                    >
                      {group.items.map((hit) => (
                        <CommandItem
                          key={`${hit.type}-${hit.id}`}
                          value={`${hit.type}:${hit.id}`}
                          onSelect={() => go(hit.href)}
                          className="items-start gap-3 py-2"
                        >
                          <SearchHitBody hit={hit} terms={terms} dense />
                        </CommandItem>
                      ))}
                      {more > 0 && (
                        <CommandItem
                          value={`more:${group.type}`}
                          onSelect={() =>
                            go(searchPageHref(query, [group.type]))
                          }
                          className="justify-center text-xs text-muted-foreground"
                        >
                          See all {group.total} {meta.plural.toLowerCase()}
                          <ArrowRight className="size-3.5" />
                        </CommandItem>
                      )}
                    </CommandGroup>
                  </React.Fragment>
                );
              })}
          </CommandList>

          <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-3 max-sm:hidden">
              <span className="flex items-center gap-1">
                <KbdGroup>
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd>
                </KbdGroup>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>
                  <CornerDownLeft className="size-3" />
                </Kbd>
                open
              </span>
              <span className="flex items-center gap-1">
                <Kbd>esc</Kbd>
                close
              </span>
            </div>
            {enabled && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 gap-1.5 text-xs"
                onClick={openFullResults}
              >
                {results ? `All ${results.total} results` : "All results"}
                <ArrowRight className="size-3.5" />
              </Button>
            )}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
