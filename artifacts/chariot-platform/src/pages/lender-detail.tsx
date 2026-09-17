import { useState } from "react";
import {
  useGetLender,
  useUpdateLender,
  useArchiveLender,
  useUpdateLenderContact,
  getGetLenderQueryKey,
  getListLendersQueryKey,
  type LenderInput,
  type LenderContact,
} from "@workspace/api-client-react";
import { useRoute, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Empty,
  EmptyHeader,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Mail, Phone, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import { useNavTitle } from "@/lib/nav-history";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isFullAccess } from "@/lib/roles";

export default function LenderDetail() {
  const [, params] = useRoute("/lenders/:id");
  const id = parseInt(params?.id || "0");
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);

  const { data: lender, isLoading } = useGetLender(id, {
    query: { enabled: !!id, queryKey: getGetLenderQueryKey(id) },
  });
  useNavTitle(`/lenders/${id}`, lender?.name);
  const updateLender = useUpdateLender();
  const archiveLender = useArchiveLender();
  const updateContact = useUpdateLenderContact();

  const [editingContact, setEditingContact] = useState<LenderContact | null>(
    null,
  );
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  if (isLoading)
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!lender)
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2 />
            </EmptyMedia>
            <EmptyTitle>Lender not found</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <BackButton
              variant="outline"
              size="default"
              fallback={{ href: "/lenders", label: "Lenders" }}
            />
          </EmptyContent>
        </Empty>
      </div>
    );

  const handleArchive = () => setArchiveOpen(true);

  const confirmHandleArchive = () => {
    archiveLender.mutate(
      { id },
      {
        onSuccess: () => {
          toast.add({ title: "Lender archived", type: "success" });
          qc.invalidateQueries({ queryKey: getGetLenderQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListLendersQueryKey() });
        },
      },
    );
  };

  const handlePortfolioStage = (
    portfolioStage: LenderInput["portfolioStage"],
  ) => {
    updateLender.mutate(
      {
        id,
        data: {
          name: lender.name,
          portfolioStage,
          avgDecisionDays: lender.avgDecisionDays,
          status: lender.status,
        },
      },
      {
        onSuccess: () => {
          toast.add({
            title: "Portfolio requirement updated",
            type: "success",
          });
          qc.invalidateQueries({ queryKey: getGetLenderQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListLendersQueryKey() });
        },
        onError: () => toast.add({ title: "Update failed", type: "error" }),
      },
    );
  };

  const openEditContact = (contact: LenderContact) => {
    setEditingContact(contact);
    setContactName(contact.name);
    setContactRole(contact.role);
    setContactEmail(contact.email || "");
    setContactPhone(contact.phone || "");
  };

  const handleUpdateContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContact) return;
    updateContact.mutate(
      {
        id,
        contactId: editingContact.id,
        data: {
          name: contactName,
          role: contactRole || "BDM",
          email: contactEmail || null,
          phone: contactPhone || null,
        },
      },
      {
        onSuccess: () => {
          toast.add({ title: "Contact updated", type: "success" });
          setEditingContact(null);
          qc.invalidateQueries({ queryKey: getGetLenderQueryKey(id) });
        },
      },
    );
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <div>
        <BackButton
          className="mb-4 -ml-3"
          fallback={{ href: "/lenders", label: "Lenders" }}
        />
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                {lender.name}
                <Badge variant="secondary" className="capitalize">
                  {lender.status}
                </Badge>
              </h1>
            </div>
          </div>
          {isAdmin && lender.status === "active" && (
            <Button
              variant="destructive"
              onClick={handleArchive}
              disabled={archiveLender.isPending}
            >
              Archive Lender
            </Button>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 md:grid-rows-2 gap-4">
        <Card className="md:col-span-2 md:row-start-1">
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent>
            {lender.contacts.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyDescription>No contacts defined.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="divide-y">
                {lender.contacts.map((c) => (
                  <div
                    key={c.id}
                    className="py-4 first:pt-0 last:pb-0 space-y-2"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-semibold">{c.name}</div>
                        <div className="text-xs text-primary font-medium">
                          {c.role}
                        </div>
                      </div>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground"
                          onClick={() => openEditContact(c)}
                        >
                          <Pencil />
                        </Button>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1 mt-2">
                      {c.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="h-3 w-3" />{" "}
                          <a href={`mailto:${c.email}`}>{c.email}</a>
                        </div>
                      )}
                      {c.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-3 w-3" />{" "}
                          <a href={`tel:${c.phone}`}>{c.phone}</a>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2 md:row-start-2">
          <CardHeader>
            <CardTitle>Configured Requirements</CardTitle>
          </CardHeader>
          <CardContent>
            {lender.configuredRequirements.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyDescription>
                    No custom requirements configured.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                {lender.configuredRequirements.map((req, i) => (
                  <li key={i}>{req}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="md:row-start-1">
          <CardHeader>
            <CardTitle>Performance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-muted-foreground">Active Cases</span>
              <span className="font-medium text-lg">{lender.activeCases}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-muted-foreground">Avg Decision</span>
              <span className="font-medium text-lg">
                {lender.avgDecisionDays} days
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="md:row-start-2">
          <CardHeader>
            <CardTitle>When is the portfolio required?</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={lender.portfolioStage}
              onValueChange={(v) =>
                handlePortfolioStage(v as LenderInput["portfolioStage"])
              }
              disabled={!isAdmin || updateLender.isPending}
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem value="submission" id="portfolio-submission" />
                <Label htmlFor="portfolio-submission">At submission</Label>
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
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={!!editingContact}
        onOpenChange={(open) => {
          if (!open) setEditingContact(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateContact} className="pt-4">
            <FieldGroup>
              <Field>
                <FieldLabel>Name</FieldLabel>
                <Input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel>Role</FieldLabel>
                <Input
                  value={contactRole}
                  onChange={(e) => setContactRole(e.target.value)}
                  placeholder="e.g. BDM, Underwriter"
                />
              </Field>
              <Field>
                <FieldLabel>Email</FieldLabel>
                <Input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Phone</FieldLabel>
                <Input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </Field>
              <DialogFooter>
                <Button type="submit" disabled={updateContact.isPending}>
                  Save Changes
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this lender?"
        description="Hidden from new cases; existing cases keep it."
        actionLabel="Archive"
        destructive
        onConfirm={confirmHandleArchive}
      />
    </div>
  );
}
