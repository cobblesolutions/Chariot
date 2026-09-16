import type { GlobalSearchType } from "@workspace/api-client-react";
import {
  getGlobalSearchQueryKey,
  useGlobalSearch,
} from "@workspace/api-client-react";
import { useDebounced } from "@/hooks/use-debounced";
import { ALL_SEARCH_TYPES, MIN_QUERY_LENGTH } from "@/lib/search";

/**
 * Debounced, cached call to `GET /search`. Keeps the previous results on
 * screen while the next keystroke's request is in flight so the list never
 * flashes empty between queries.
 */
export function useSearchResults(
  rawQuery: string,
  types: GlobalSearchType[],
  limit: number,
) {
  const query = useDebounced(rawQuery.trim(), 200);
  const enabled = query.length >= MIN_QUERY_LENGTH;
  const params = {
    q: query,
    limit,
    ...(types.length && types.length < ALL_SEARCH_TYPES.length
      ? { types: types.join(",") }
      : {}),
  };
  const result = useGlobalSearch(params, {
    query: {
      enabled,
      queryKey: getGlobalSearchQueryKey(params),
      placeholderData: (previous) => previous,
      staleTime: 30_000,
    },
  });
  return {
    query,
    enabled,
    results: enabled ? result.data : undefined,
    isPending: enabled && result.isFetching,
    isError: enabled && result.isError,
  };
}
