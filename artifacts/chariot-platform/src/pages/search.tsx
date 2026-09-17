import * as React from "react";
import { Link, useLocation, useSearch } from "wouter";
import type { GlobalSearchType } from "@workspace/api-client-react";
import { ChevronRight, Search, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Item, ItemGroup, ItemSeparator } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  MIN_QUERY_LENGTH,
  parseSearchTypes,
  rememberSearch,
  searchPageHref,
  searchTypeMeta,
} from "@/lib/search";
import { SearchHitBody } from "@/components/search/search-hit";
import { SearchTypeFilter } from "@/components/search/search-type-filter";
import { useSearchResults } from "@/components/search/use-search-results";

const PAGE_LIMIT = 50;

/**
 * Full-page search: the same endpoint as the ⌘K palette but with up to 50
 * hits per type, type chips with counts, and the query kept in the URL so a
 * search can be bookmarked, shared or returned to with Back.
 */
export default function SearchPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const urlQuery = React.useMemo(
    () => new URLSearchParams(search).get("q") ?? "",
    [search],
  );
  const urlTypes = React.useMemo(
    () => parseSearchTypes(new URLSearchParams(search).get("types")),
    [search],
  );

  const [input, setInput] = React.useState(urlQuery);
  const [types, setTypes] = React.useState<GlobalSearchType[]>(urlTypes);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Back/forward or a link into /search?q= should update the controls.
  React.useEffect(() => setInput(urlQuery), [urlQuery]);
  React.useEffect(() => setTypes(urlTypes), [urlTypes]);

  const { query, enabled, results, isPending, isError } = useSearchResults(
    input,
    types,
    PAGE_LIMIT,
  );
  const terms = results?.terms ?? [];

  // Mirror the debounced query and filters into the URL (replace, so typing
  // does not flood history) and remember what was searched for.
  React.useEffect(() => {
    if (!enabled) return;
    const href = searchPageHref(query, types);
    if (`/search?${search}` !== href) navigate(href, { replace: true });
    rememberSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, types, enabled]);

  React.useEffect(() => {
    if (!urlQuery) inputRef.current?.focus();
  }, [urlQuery]);

  const visibleGroups = results?.groups ?? [];

  return (
    <div className="p-4 md:p-frame">
      <div className="mx-auto max-w-page space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        </header>

        <div className="space-y-3">
          <InputGroup className="h-11">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Name, phone, address, reference, amount, date, a word from a note…"
              aria-label="Search everything"
              autoComplete="off"
              spellCheck={false}
              className="text-base"
            />
            <InputGroupAddon align="inline-end">
              {isPending && <Spinner className="size-4" />}
              {input && (
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Clear search"
                  onClick={() => {
                    setInput("");
                    inputRef.current?.focus();
                  }}
                >
                  <X />
                </InputGroupButton>
              )}
            </InputGroupAddon>
          </InputGroup>
          <SearchTypeFilter
            value={types}
            onChange={setTypes}
            results={results}
            wrap
          />
        </div>

        {!enabled && (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search />
              </EmptyMedia>
              <EmptyTitle>
                {input.trim().length > 0
                  ? `Type at least ${MIN_QUERY_LENGTH} characters`
                  : "What are you looking for?"}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}

        {enabled && !results && isPending && (
          <div className="space-y-3" aria-busy>
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index} className="py-4">
                <CardContent className="space-y-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {isError && (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle>Search failed</EmptyTitle>
              <EmptyDescription>Try again in a moment.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {enabled && results && results.groups.length === 0 && !isPending && (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle>No matches for “{query}”</EmptyTitle>
              {types.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setTypes([])}
                >
                  Search everything
                </Button>
              )}
            </EmptyHeader>
          </Empty>
        )}

        {enabled && results && visibleGroups.length > 0 && (
          <div
            className={cn(
              "space-y-4 transition-opacity",
              isPending && "opacity-60",
            )}
            aria-busy={isPending || undefined}
          >
            <p className="text-sm text-muted-foreground" aria-live="polite">
              <span className="font-medium text-foreground tabular-nums">
                {results.total}
              </span>{" "}
              {results.total === 1 ? "result" : "results"} for{" "}
              <span className="font-medium text-foreground">“{query}”</span>
            </p>

            {visibleGroups.map((group) => {
              const meta = searchTypeMeta(group.type);
              const Icon = meta.icon;
              const hidden = group.total - group.items.length;
              return (
                <Card key={group.type} className="gap-0 py-0 overflow-hidden">
                  <CardHeader className="flex flex-row items-center gap-2 border-b bg-muted/40 px-4 py-3 [.border-b]:pb-3">
                    <Icon className="size-4 text-muted-foreground" />
                    <CardTitle className="text-sm">
                      {meta.plural}
                      <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                        {group.total}
                      </span>
                    </CardTitle>
                    {types.length !== 1 && (
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-7 text-xs"
                      >
                        <Link href={searchPageHref(query, [group.type])}>
                          Only {meta.plural.toLowerCase()}
                        </Link>
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="px-0">
                    <ItemGroup>
                      {group.items.map((hit, index) => (
                        <React.Fragment key={`${hit.type}-${hit.id}`}>
                          {index > 0 && <ItemSeparator />}
                          <Item
                            asChild
                            size="sm"
                            className="rounded-none border-0 flex-nowrap items-start gap-3 px-4 py-2.5 hover:bg-accent/50"
                          >
                            <Link
                              href={hit.href}
                              data-testid={`search-hit-${hit.type}-${hit.id}`}
                            >
                              <SearchHitBody hit={hit} terms={terms} />
                              <ChevronRight className="size-4 shrink-0 self-center text-muted-foreground" />
                            </Link>
                          </Item>
                        </React.Fragment>
                      ))}
                    </ItemGroup>
                    {hidden > 0 && (
                      <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                        Showing the first {group.items.length} of {group.total}.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
