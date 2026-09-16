import {
  useListLenders,
  useCreateLender,
  useCreateLenderContact,
  getListLendersQueryKey,
  type LenderInput,
  type Lender,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyDescription,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/components/auth-provider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFeatures,
} from "@/components/data-table";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { isFullAccess } from "@/lib/roles";

const columnHelper = createColumnHelper<DataTableFeatures, Lender>();

const columns = columnHelper.columns([
  columnHelper.accessor("name", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Lender Name" />
    ),
    sortFn: "text",
    meta: { cellClassName: "font-semibold" },
  }),
  columnHelper.accessor("status", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    sortFn: "text",
    cell: ({ getValue }) => (
      <Badge
        variant={getValue() === "active" ? "default" : "secondary"}
        className="capitalize"
      >
        {getValue()}
      </Badge>
    ),
  }),
  columnHelper.accessor("activeCases", {
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Active Cases"
        className="justify-center"
      />
    ),
    sortFn: "basic",
    meta: { cellClassName: "text-center font-medium" },
  }),
  columnHelper.accessor("avgDecisionDays", {
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Avg Decision (Days)"
        className="justify-center"
      />
    ),
    sortFn: "basic",
    meta: { cellClassName: "text-center" },
  }),
]);

export default function LendersList() {
  const [, setLocation] = useLocation();
  const { data: lenders, isLoading } = useListLenders();
  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);
  const qc = useQueryClient();
  const createLender = useCreateLender();
  const createContact = useCreateLenderContact();

  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [portfolioStage, setPortfolioStage] =
    useState<LenderInput["portfolioStage"]>("submission");
  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [requirementDraft, setRequirementDraft] = useState("");
  const [requirements, setRequirements] = useState<string[]>([]);

  const resetForm = () => {
    setName("");
    setPortfolioStage("submission");
    setContactName("");
    setContactRole("");
    setContactEmail("");
    setContactPhone("");
    setRequirementDraft("");
    setRequirements([]);
  };

  const addRequirement = () => {
    const value = requirementDraft.trim();
    if (!value) return;
    setRequirements((prev) => [...prev, value]);
    setRequirementDraft("");
  };

  const removeRequirement = (index: number) => {
    setRequirements((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createLender.mutate(
      {
        data: {
          name,
          portfolioStage,
          status: "active",
          profile:
            requirements.length > 0
              ? { configuredRequirements: requirements }
              : undefined,
        },
      },
      {
        onSuccess: (createdLender) => {
          const finish = () => {
            toast.add({ title: "Lender created", type: "success" });
            setIsOpen(false);
            resetForm();
            qc.invalidateQueries({ queryKey: getListLendersQueryKey() });
          };
          if (contactName.trim()) {
            createContact.mutate(
              {
                id: createdLender.id,
                data: {
                  name: contactName,
                  role: contactRole || "BDM",
                  email: contactEmail || null,
                  phone: contactPhone || null,
                },
              },
              { onSuccess: finish, onError: finish },
            );
          } else {
            finish();
          }
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <div className="flex justify-between items-start md:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Lenders</h1>
        </div>
        {isAdmin && (
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus /> Add Lender
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Lender</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={handleCreate}
                className="space-y-5 pt-4 px-1 pb-2"
              >
                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[70vh]">
                  <Field>
                    <FieldLabel>Lender Name</FieldLabel>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </Field>
                  <Separator />
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">
                      Primary Contact
                    </Label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field>
                        <FieldLabel className="text-xs text-muted-foreground">
                          Name
                        </FieldLabel>
                        <Input
                          value={contactName}
                          onChange={(e) => setContactName(e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel className="text-xs text-muted-foreground">
                          Role
                        </FieldLabel>
                        <Input
                          value={contactRole}
                          onChange={(e) => setContactRole(e.target.value)}
                          placeholder="e.g. BDM, Underwriter"
                        />
                      </Field>
                      <Field>
                        <FieldLabel className="text-xs text-muted-foreground">
                          Email
                        </FieldLabel>
                        <Input
                          type="email"
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel className="text-xs text-muted-foreground">
                          Phone
                        </FieldLabel>
                        <Input
                          type="tel"
                          value={contactPhone}
                          onChange={(e) => setContactPhone(e.target.value)}
                        />
                      </Field>
                    </div>
                  </div>

                  <Separator />
                  <div className="space-y-2">
                    <Label>When is the portfolio required?</Label>
                    <RadioGroup
                      value={portfolioStage}
                      onValueChange={(v) =>
                        setPortfolioStage(v as LenderInput["portfolioStage"])
                      }
                    >
                      <div className="flex items-center gap-3">
                        <RadioGroupItem
                          value="submission"
                          id="portfolio-submission"
                        />
                        <Label htmlFor="portfolio-submission">
                          At submission
                        </Label>
                      </div>
                      <div className="flex items-center gap-3">
                        <RadioGroupItem
                          value="underwriting"
                          id="portfolio-underwriting"
                        />
                        <Label htmlFor="portfolio-underwriting">
                          During underwriting
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <Separator />
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">
                      Configured Requirements
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        value={requirementDraft}
                        onChange={(e) => setRequirementDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addRequirement();
                          }
                        }}
                        placeholder="e.g. Bank statements (3 months)"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={addRequirement}
                      >
                        Add
                      </Button>
                    </div>
                    {requirements.length > 0 && (
                      <ul className="space-y-1">
                        {requirements.map((req, i) => (
                          <li
                            key={i}
                            className="flex items-center justify-between text-sm bg-muted/40 rounded-md px-3 py-1.5"
                          >
                            <span>{req}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label="Remove requirement"
                              onClick={() => removeRequirement(i)}
                            >
                              <X />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <DialogFooter>
                    <Button type="submit" disabled={createLender.isPending}>
                      {createLender.isPending ? "Saving..." : "Save Lender"}
                    </Button>
                  </DialogFooter>
                </ScrollArea>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <DataTable
        columns={columns}
        data={lenders ?? []}
        initialSorting={[{ id: "name", desc: false }]}
        onRowClick={(l) => setLocation(`/lenders/${l.id}`)}
        emptyMessage={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Building2 />
              </EmptyMedia>
              <EmptyDescription>No lenders configured.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />
    </div>
  );
}
