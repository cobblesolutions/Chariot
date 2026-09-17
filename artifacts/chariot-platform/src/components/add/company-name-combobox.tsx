import { useEffect, useState } from "react";
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

/**
 * Free-text company name with live Companies House suggestions. Picking a
 * suggestion also reports the full record via `onSelect` so the parent form
 * can fill the company number and registered address.
 */
export function CompanyNameCombobox({
  value,
  onChange,
  onSelect,
  disabled,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (company: CompaniesHouseCompany) => void;
  disabled?: boolean;
  id?: string;
}) {
  const [query, setQuery] = useState(value);
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
        queryKey: getSearchCompaniesHouseQueryKey({ q: debouncedQuery }),
      },
    },
  );

  return (
    <Combobox
      items={search.data?.results ?? []}
      filter={null}
      itemToStringLabel={(company: CompaniesHouseCompany) => company.name}
      itemToStringValue={(company: CompaniesHouseCompany) => company.name}
      inputValue={value}
      onInputValueChange={(next) => {
        onChange(next);
        setQuery(next);
        setShowResults(true);
      }}
      open={showResults && debouncedQuery.length >= 2}
      onOpenChange={setShowResults}
      onValueChange={(company: CompaniesHouseCompany | null) => {
        if (!company) return;
        onChange(company.name);
        onSelect?.(company);
        setQuery(company.name);
        setShowResults(false);
      }}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        className="w-full"
        showTrigger={false}
        autoComplete="off"
        placeholder="Search Companies House or type manually"
        disabled={disabled}
      />
      <ComboboxContent>
        {search.isFetching ? (
          <ComboboxEmpty>Searching Companies House...</ComboboxEmpty>
        ) : search.error ? (
          <ComboboxEmpty>
            {(search.error as { status?: number } | null)?.status === 503
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
              <span className="font-medium">{company.name}</span>
              <span className="text-xs text-muted-foreground capitalize">
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
