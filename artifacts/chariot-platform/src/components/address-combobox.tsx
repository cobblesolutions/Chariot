import { useEffect, useRef, useState, type KeyboardEvent, type FocusEvent } from "react";
import { MapPin } from "lucide-react";
import {
  useAutocompletePlaces,
  getAutocompletePlacesQueryKey,
  getPlaceAddress,
  type PlaceAddress,
  type PlaceSuggestion,
} from "@workspace/api-client-react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

/**
 * One autocomplete session per "type → pick" cycle so Google bills the
 * predictions and the final details call as a single lookup.
 */
function newSessionToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export interface AddressComboboxProps {
  value: string;
  /** Fires on every keystroke and again with the full address once a suggestion is picked. */
  onChange: (value: string) => void;
  /** The structured address behind the picked suggestion (postcode, town, coordinates…). */
  onSelect?: (address: PlaceAddress) => void;
  /**
   * What lands in this field when a suggestion is picked: the whole address on
   * one line, or just the street line (city and postcode go to their own
   * fields via `onSelect`).
   */
  fill?: "full" | "street";
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  className?: string;
  "aria-label"?: string;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/** Free-text address with live Google Places suggestions; picking one fills in the full address. */
export function AddressCombobox({
  value,
  onChange,
  onSelect,
  fill = "full",
  id,
  placeholder = "Start typing an address or postcode",
  disabled,
  required,
  autoFocus,
  className,
  "aria-label": ariaLabel,
  onBlur,
  onKeyDown,
}: AddressComboboxProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [resolving, setResolving] = useState(false);
  const sessionToken = useRef(newSessionToken());

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const search = useAutocompletePlaces(
    { q: debouncedQuery, sessionToken: sessionToken.current },
    {
      query: {
        enabled: debouncedQuery.length >= 3,
        retry: false,
        queryKey: getAutocompletePlacesQueryKey({
          q: debouncedQuery,
          sessionToken: sessionToken.current,
        }),
      },
    },
  );

  const pick = async (suggestion: PlaceSuggestion) => {
    // Show the prediction text straight away; swap in the canonical
    // formatted address (and hand back the parts) once details arrive.
    // Clearing the search query stops the filled-in address being sent
    // back to Google as a new search.
    onChange(fill === "street" ? suggestion.mainText : suggestion.description);
    setQuery("");
    setDebouncedQuery("");
    setShowResults(false);
    setResolving(true);
    const token = sessionToken.current;
    sessionToken.current = newSessionToken();
    try {
      const address = await getPlaceAddress({
        placeId: suggestion.placeId,
        sessionToken: token,
      });
      onChange(
        fill === "street"
          ? address.line1 || suggestion.mainText
          : address.formattedAddress || suggestion.description,
      );
      onSelect?.(address);
    } catch {
      // The prediction text is already a complete address; keep it.
    } finally {
      setResolving(false);
    }
  };

  const status = (search.error as { status?: number } | null)?.status;
  const open = showResults && debouncedQuery.length >= 3 && status !== 503;

  return (
    <Combobox
      items={search.data?.results ?? []}
      filter={null}
      itemToStringLabel={(item: PlaceSuggestion) => item.description}
      itemToStringValue={(item: PlaceSuggestion) => item.placeId}
      inputValue={value}
      onInputValueChange={(next, details) => {
        // Only typing drives the search; picking an item is handled by
        // `pick`, which fills the field with the resolved address itself.
        // Anything else is Base UI resetting the input on its own — notably
        // it blanks the field when the list closes with nothing chosen — and
        // must not touch the address the user has typed.
        if (details.reason !== "input-change") return;
        onChange(next);
        setQuery(next);
        setShowResults(true);
      }}
      open={open}
      onOpenChange={setShowResults}
      onValueChange={(item: PlaceSuggestion | null) => {
        if (item) void pick(item);
      }}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        className={className ?? "w-full"}
        showTrigger={false}
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-busy={resolving || undefined}
        onBlur={onBlur}
        onKeyDown={(event) => {
          // While suggestions are showing, Enter picks and Escape closes;
          // only pass the keys on once the list is out of the way.
          if (open && (event.key === "Enter" || event.key === "Escape")) return;
          onKeyDown?.(event);
        }}
      />
      <ComboboxContent className="pointer-events-auto">
        {search.isFetching ? (
          <ComboboxEmpty>Searching addresses...</ComboboxEmpty>
        ) : search.error ? (
          <ComboboxEmpty>Couldn't look up addresses right now.</ComboboxEmpty>
        ) : (
          <ComboboxEmpty>No matching addresses found.</ComboboxEmpty>
        )}
        <ComboboxList>
          {(item: PlaceSuggestion) => (
            <ComboboxItem
              key={item.placeId}
              value={item}
              className="flex-col items-start gap-0.5"
            >
              <span className="flex items-center gap-1.5 font-medium">
                <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                {item.mainText}
              </span>
              {item.secondaryText ? (
                <span className="pl-5 text-xs text-muted-foreground">
                  {item.secondaryText}
                </span>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
