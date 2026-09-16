import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import { toast } from "@/components/ui/toast";
import {
  useListProperties,
  useUpdateProperty,
  getGetClientQueryKey,
  getListPropertiesQueryKey,
  type Property,
  type PropertyListItem,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MATTER_TYPES, apiErrorMessage } from "./utils";
import { formatAddress } from "@/lib/address";

const money = (value: number) => `£${value.toLocaleString("en-GB")}`;

function matterTypeLabel(value: string) {
  return (
    MATTER_TYPES.find((type) => type.value === value)?.label ??
    value.replace(/_/g, " ")
  );
}

/**
 * Attach a property that already exists in the register to this client.
 * Unassigned properties link freely; one owned by another client can be
 * moved unless it is in use on one of their open cases.
 */
export function LinkPropertyDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
  clientName: string;
  onLinked: (property: Property) => void;
}) {
  const qc = useQueryClient();
  const { data: properties, isLoading } = useListProperties();
  const updateProperty = useUpdateProperty();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number | null>(null);

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (properties ?? [])
      .filter((property) => property.clientId !== clientId)
      .filter((property) =>
        !needle
          ? true
          : [formatAddress(property), property.clientName ?? ""]
              .some((value) => value.toLowerCase().includes(needle)),
      )
      .slice(0, 50);
  }, [properties, query, clientId]);

  const selected = candidates.find((property) => property.id === picked);
  const inUseElsewhere = (property: PropertyListItem) =>
    property.clientId != null && property.activeCases.length > 0;

  const reset = () => {
    setQuery("");
    setPicked(null);
  };

  const handleLink = () => {
    if (!selected) return;
    updateProperty.mutate(
      {
        id: selected.id,
        data: {
          clientId,
          address: selected.address,
          city: selected.city ?? null,
          postcode: selected.postcode ?? null,
          matterType: selected.matterType,
          value: selected.value,
          loanAmount: selected.loanAmount,
          rent: selected.rent ?? null,
          gdv: selected.gdv ?? null,
        },
      },
      {
        onSuccess: (property) => {
          toast.add({
            title: `${formatAddress(property)} linked to ${clientName}`,
            type: "success",
          });
          qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
          if (selected.clientId) {
            qc.invalidateQueries({ queryKey: getGetClientQueryKey(selected.clientId) });
          }
          reset();
          onOpenChange(false);
          onLinked(property);
        },
        onError: (error) => {
          toast.add({
            title: "Couldn't link property",
            description: apiErrorMessage(error, "Please try again."),
            type: "error",
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Use an existing property</DialogTitle>
          <DialogDescription>
            Pick a property already in the register to add it to {clientName}.
            Properties in use on another client's open case can't be moved.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by address or current client"
            autoComplete="off"
            autoFocus
            className="pl-8"
          />
        </div>

        <div
          role="listbox"
          aria-label="Properties"
          className="max-h-72 overflow-y-auto rounded-md border"
        >
          {isLoading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : candidates.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {query.trim()
                ? `No other properties match “${query.trim()}”.`
                : "Every property in the register already belongs to this client."}
            </p>
          ) : (
            candidates.map((property) => {
              const isSelected = property.id === picked;
              const blocked = inUseElsewhere(property);
              const owner = property.clientId
                ? property.clientName || "Another client"
                : "Unassigned";
              return (
                <button
                  key={property.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={blocked}
                  onClick={() => setPicked(property.id)}
                  className={cn(
                    "flex w-full items-start gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60 focus-visible:outline-none focus-visible:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
                    isSelected && "bg-primary/10 hover:bg-primary/15",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {formatAddress(property)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {matterTypeLabel(property.matterType)} · {money(property.value)} ·{" "}
                      {owner}
                      {blocked
                        ? ` · in use on ${property.activeCases
                            .map((item) => item.reference)
                            .join(", ")}`
                        : ""}
                    </span>
                  </span>
                  {isSelected ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        {selected?.clientId ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            This moves the property from {selected.clientName || "its current client"} to{" "}
            {clientName}.
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selected || updateProperty.isPending}
            onClick={handleLink}
          >
            {updateProperty.isPending ? "Linking..." : "Link to client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
