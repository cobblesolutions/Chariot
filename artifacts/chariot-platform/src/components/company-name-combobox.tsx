import { useEffect, useState, type FocusEvent, type KeyboardEvent } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import {
  useSearchCompaniesHouse,
  getSearchCompaniesHouseQueryKey,
  type CompaniesHouseCompany,
} from "@workspace/api-client-react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

export interface CompanyNameComboboxProps {
  value: string;
  /** Fires on every keystroke and again with the registered name once a company is picked. */
  onChange: (value: string) => void;
  /** The full Companies House record behind the picked suggestion (number, status, registered office). */
  onSelect?: (company: CompaniesHouseCompany) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  "aria-label"?: string;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Free-text company name with live Companies House suggestions. Picking a
 * suggestion also reports the full record via `onSelect` so the parent form
 * can fill the company number and registered address.
 */
export function CompanyNameCombobox({
  value,
  onChange,
  onSelect,
  id,
  placeholder = "Search Companies House or type manually",
  disabled,
  autoFocus,
  className,
  "aria-label": ariaLabel,
  onBlur,
  onKeyDown,
}: CompanyNameComboboxProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const search = useSearchCompaniesHouse(
    { q: debouncedQuery },
    {
      query: {
        enabled: debouncedQuery.length >= 2,
        retry: false,
        // Keep the last suggestions on screen while the next keystroke's
        // request is in flight so the list doesn't collapse on every letter.
        placeholderData: keepPreviousData,
        queryKey: getSearchCompaniesHouseQueryKey({ q: debouncedQuery }),
      },
    },
  );

  const status = (search.error as { status?: number } | null)?.status;
  const open = showResults && debouncedQuery.length >= 2;

  return (
    <Combobox
      items={search.data?.results ?? []}
      filter={null}
      itemToStringLabel={(company: CompaniesHouseCompany) => company.name}
      itemToStringValue={(company: CompaniesHouseCompany) => company.companyNumber}
      inputValue={value}
      onInputValueChange={(next, details) => {
        // Only typing drives the search; picking an item is handled in
        // `onValueChange`. Anything else is Base UI resetting the input on
        // its own (it blanks the field when the list closes with nothing
        // chosen) and must not touch the name the user has typed.
        if (details.reason !== "input-change") return;
        onChange(next);
        setQuery(next);
        setShowResults(true);
      }}
      open={open}
      onOpenChange={setShowResults}
      onValueChange={(company: CompaniesHouseCompany | null) => {
        if (!company) return;
        onChange(company.name);
        onSelect?.(company);
        // Clearing the search stops the filled-in name being sent back to
        // Companies House as a new search.
        setQuery("");
        setDebouncedQuery("");
        setShowResults(false);
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
        autoFocus={autoFocus}
        aria-label={ariaLabel}
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
          <ComboboxEmpty>Searching Companies House...</ComboboxEmpty>
        ) : search.error ? (
          <ComboboxEmpty>
            {status === 503
              ? "Companies House search isn't connected yet — you can type the company name directly."
              : "Couldn't search Companies House right now."}
          </ComboboxEmpty>
        ) : (
          <ComboboxEmpty>No matching companies found.</ComboboxEmpty>
        )}
        <ComboboxList>
          {(company: CompaniesHouseCompany) => (
            <ComboboxItem
              key={company.companyNumber}
              value={company}
              className="flex-col items-start gap-0.5"
            >
              <span className="flex items-center gap-1.5 font-medium">
                <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                {company.name}
              </span>
              <span className="pl-5 text-xs text-muted-foreground capitalize">
                {company.companyNumber} · {company.status}
                {company.address ? ` · ${company.address}` : ""}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
