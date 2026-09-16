import { useEffect, useState } from "react";
import { useListClients } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { EnquiryIntake } from "./enquiry-intake";

export type StartTab = "new" | "existing";

/**
 * First step of the Add flow: a new enquiry (basic details, pasted from an
 * email or typed) or an existing client. Reports the chosen client id; the
 * page decides where to go.
 */
export function AddStartDialog({
  open,
  currentClientId,
  initialTab,
  onSelected,
  onCancel,
}: {
  open: boolean;
  currentClientId: number | null;
  /** Tab to show when opened; defaults to Existing when a client is already set. */
  initialTab?: StartTab;
  onSelected: (clientId: number, options?: { propertyId?: number | null }) => void;
  onCancel: () => void;
}) {
  const startTab: StartTab = initialTab ?? (currentClientId ? "existing" : "new");
  const [tab, setTab] = useState<StartTab>(startTab);
  const [picked, setPicked] = useState<number | null>(currentClientId);

  useEffect(() => {
    if (open) {
      setTab(startTab);
      setPicked(currentClientId);
    }
  }, [open, currentClientId, startTab]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Add</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as StartTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="new" className="flex-1">
              New enquiry
            </TabsTrigger>
            <TabsTrigger value="existing" className="flex-1">
              Existing client
            </TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="pt-2">
            <EnquiryIntake open={open} onCreated={onSelected} onCancel={onCancel} />
          </TabsContent>

          <TabsContent value="existing" className="pt-2">
            <ExistingClientPicker
              picked={picked}
              onPick={setPicked}
              onContinue={() => {
                if (picked) onSelected(picked);
              }}
              onCancel={onCancel}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Search box plus an inline result list. Rendered inside the dialog on purpose:
 * a popover-style picker would portal outside the dialog and get treated as an
 * outside click, which closes the dialog before a client can be chosen.
 */
function ExistingClientPicker({
  picked,
  onPick,
  onContinue,
  onCancel,
}: {
  picked: number | null;
  onPick: (clientId: number) => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const { data: clients, isLoading } = useListClients();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = (clients ?? [])
    .filter((client) =>
      !needle
        ? true
        : [client.name, client.email, client.companyName]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(needle)),
    )
    .slice(0, 50);
  const selected = clients?.find((client) => client.id === picked);

  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel htmlFor="add-start-client-search">Find client</FieldLabel>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="add-start-client-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email or company"
            autoComplete="off"
            autoFocus
            className="pl-8"
          />
        </div>
      </Field>
      <div
        role="listbox"
        aria-label="Clients"
        className="max-h-64 overflow-y-auto rounded-md border"
      >
        {isLoading ? (
          <p className="p-3 text-sm text-muted-foreground">Loading clients…</p>
        ) : matches.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            {needle ? `No clients match “${query.trim()}”.` : "No clients yet."}
          </p>
        ) : (
          matches.map((client) => {
            const isSelected = client.id === picked;
            return (
              <button
                key={client.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onPick(client.id)}
                onDoubleClick={() => {
                  onPick(client.id);
                  onContinue();
                }}
                className={cn(
                  "flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60 focus-visible:outline-none focus-visible:bg-muted/60",
                  isSelected && "bg-primary/10 hover:bg-primary/15",
                )}
              >
                <Avatar size="sm">
                  <AvatarFallback>
                    {client.name.trim().charAt(0).toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{client.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {client.email}
                    {client.companyName ? ` · ${client.companyName}` : ""}
                  </span>
                </span>
                {isSelected ? (
                  <Check className="size-4 shrink-0 text-primary" />
                ) : null}
              </button>
            );
          })
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {selected
          ? `Continue with ${selected.name}.`
          : "Pick a client from the list, then continue."}
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={!picked} onClick={onContinue}>
          Continue
        </Button>
      </DialogFooter>
    </div>
  );
}
