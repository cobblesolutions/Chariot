import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { ExternalLink, UserRoundPen, Users } from "lucide-react";
import {
  useGetClient,
  useGetCase,
  getGetClientQueryKey,
  getGetCaseQueryKey,
  type Case,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { AddStartDialog, type StartTab } from "@/components/add/start-dialog";
import { AddDrafts } from "@/components/add/drafts";
import { AddStepper } from "@/components/add/add-stepper";
import { AcceptPanel, WelcomeDeliveryNotice } from "@/components/add/accept-panel";
import { CapturedPreview } from "@/components/add/captured-preview";
import { Badge } from "@/components/ui/badge";
import { LIFECYCLE_LABELS, isClosedLifecycle, sourceLabel } from "@/lib/enquiry";
import { ClientColumn } from "@/components/add/client-column";
import { PropertyColumn } from "@/components/add/property-column";
import { CaseColumn } from "@/components/add/case-column";
import {
  ReadinessPanel,
  caseChecks,
  clientChecks,
  missingLabels,
  propertyChecks,
} from "@/components/add/readiness-panel";
import { BackButton } from "@/components/back-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useNavTitle } from "@/lib/nav-history";
import { apiErrorStatus } from "@/components/add/utils";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";

function parseId(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Add flow. `/add` lists everything still in progress and offers New enquiry /
 * Existing client (a dialog); the workspace then lives at `/add/:clientId`
 * and walks three steps: basic details (done once the client exists), accept
 * (welcome email), then the advanced client · property · case columns, which
 * stay read-only until the enquiry is accepted.
 * `?property=&case=` deep links are honoured.
 */
export default function AddPage() {
  const params = useParams<{ clientId?: string }>();
  const clientId = parseId(params.clientId);
  const [, navigate] = useLocation();
  const search = useSearch();

  const [initial] = useState(() => {
    const query = new URLSearchParams(search);
    return {
      propertyId: parseId(query.get("property")),
      caseId: parseId(query.get("case")),
    };
  });
  const [propertyId, setPropertyId] = useState<number | null>(
    initial.propertyId,
  );
  const [caseId, setCaseId] = useState<number | null>(initial.caseId);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<StartTab | undefined>(undefined);
  const [resetKey, setResetKey] = useState(0);
  const openDialog = (tab?: StartTab) => {
    setDialogTab(tab);
    setSwitchOpen(true);
  };

  const clientQuery = useGetClient(clientId ?? 0, {
    query: {
      enabled: !!clientId,
      queryKey: getGetClientQueryKey(clientId ?? 0),
    },
  });
  const client =
    clientQuery.data && clientQuery.data.id === clientId
      ? clientQuery.data
      : undefined;
  const clientNotFound =
    !!clientId &&
    clientQuery.isError &&
    apiErrorStatus(clientQuery.error) === 404;
  useNavTitle(`/add/${clientId ?? ""}`, client?.name);

  const { data: caseDetail, isLoading: isCaseLoading } = useGetCase(
    caseId ?? 0,
    {
      query: { enabled: !!caseId, queryKey: getGetCaseQueryKey(caseId ?? 0) },
    },
  );
  const activeCase =
    caseDetail && caseDetail.id === caseId ? caseDetail : undefined;

  // Switching client drops the property and case selection and remounts the
  // columns, unless the selected case belongs to the client we just moved to.
  const previousClientId = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (
      previousClientId.current !== undefined &&
      previousClientId.current !== clientId
    ) {
      const caseBelongs = !!caseDetail && caseDetail.clientId === clientId;
      setPropertyId(caseBelongs ? (caseDetail?.propertyId ?? null) : null);
      if (!caseBelongs) setCaseId(null);
      setResetKey((key) => key + 1);
      setSwitchOpen(false);
    }
    previousClientId.current = clientId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // A deep-linked case fills in its property, and moves to its own client if
  // the URL pointed at a different one.
  useEffect(() => {
    if (!activeCase || !clientId) return;
    if (activeCase.clientId !== clientId) {
      navigate(`/add/${activeCase.clientId}`, { replace: true });
      return;
    }
    if (activeCase.propertyId && propertyId !== activeCase.propertyId) {
      setPropertyId(activeCase.propertyId);
    }
  }, [activeCase, clientId, propertyId, navigate]);

  // The landing page (/add) stands on its own; the dialog opens on request or
  // when the URL points at a client that no longer exists.
  const dialogOpen = clientNotFound || switchOpen;

  const handleSelected = (nextClientId: number, options?: { propertyId?: number | null }) => {
    setSwitchOpen(false);
    if (options?.propertyId) setPropertyId(options.propertyId);
    if (nextClientId === clientId) return;
    navigate(options?.propertyId ? `/add/${nextClientId}?property=${options.propertyId}` : `/add/${nextClientId}`);
  };

  const handleCancel = () => {
    setSwitchOpen(false);
    if (clientNotFound) navigate("/add", { replace: true });
  };

  const handlePropertyChange = (nextPropertyId: number | null) => {
    if (nextPropertyId === propertyId) return;
    setPropertyId(nextPropertyId);
    // A case is tied to its property; a different property means a different case.
    if (activeCase && activeCase.propertyId !== nextPropertyId) setCaseId(null);
  };

  const handleCaseSelected = (item: Case) => {
    setCaseId(item.id);
    if (item.propertyId) setPropertyId(item.propertyId);
  };

  const properties = client?.properties ?? [];
  const property = properties.find((item) => item.id === propertyId);
  // Steps 1–2 gate step 3: nothing in the columns is editable until accepted.
  const awaitingDecision = !!client && (client.lifecycle === "enquiry" || isClosedLifecycle(client.lifecycle));

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      {clientId ? (
        <BackButton className="-ml-3" fallback={{ href: "/add", label: "Add" }} />
      ) : null}

      {!clientId ? (
        <AddDrafts
          onNewClient={() => openDialog("new")}
          onExistingClient={() => openDialog("existing")}
        />
      ) : clientNotFound ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>Client not found</EmptyTitle>
            <EmptyDescription>
              That client no longer exists. Create a new one or pick another.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => openDialog()}>Choose a client</Button>
          </EmptyContent>
        </Empty>
      ) : !client ? (
        <div className="space-y-6">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <div className="grid gap-6 xl:grid-cols-3">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      ) : (
        <>
          {/* Who we are working on, and where they are in the three steps. */}
          <section className="rounded-lg border bg-card">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between md:px-6">
              <div className="flex min-w-0 items-center gap-4">
                <Avatar className="size-12 shrink-0">
                  <AvatarFallback className="text-base">{initials(client.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h2 className="text-xl font-semibold leading-tight">{client.name}</h2>
                    {client.companyName ? (
                      <span className="text-base text-muted-foreground">{client.companyName}</span>
                    ) : null}
                    <Badge
                      variant={isClosedLifecycle(client.lifecycle) ? "destructive" : "outline"}
                      className="ml-1"
                    >
                      {LIFECYCLE_LABELS[client.lifecycle]}
                    </Badge>
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
                    {[
                      client.email,
                      client.phone || null,
                      client.source ? `${sourceLabel(client.source)}${client.introducerName ? ` via ${client.introducerName}` : ""}` : null,
                      client.assignee ? `Reviewed by ${client.assignee.displayName}` : null,
                    ]
                      .filter(Boolean)
                      .map((part, index) => (
                        <span key={index} className="flex items-center gap-2">
                          {index > 0 ? <span aria-hidden className="text-border">·</span> : null}
                          {part}
                        </span>
                      ))}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 sm:-mr-2">
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/clients/${client.id}`}>
                    <ExternalLink /> Client page
                  </Link>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openDialog("existing")}>
                  <UserRoundPen /> Switch client
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between md:px-6">
              <AddStepper client={client} />
              {!awaitingDecision ? (
                <ReadinessPanel
                  client={client}
                  property={property}
                  caseDetail={activeCase}
                  onAdvanced={() => undefined}
                />
              ) : null}
            </div>
          </section>

          {awaitingDecision ? (
            <>
              <AcceptPanel client={client} />
              <CapturedPreview client={client} />
            </>
          ) : (
            <>
              <WelcomeDeliveryNotice client={client} />
              {/* One card per column; they stack below xl. */}
              <div className="grid min-w-0 items-start gap-6 xl:grid-cols-3">
                <section className="min-w-0 rounded-lg border bg-card p-5 md:p-6">
                  <ClientColumn
                    key={`client-${resetKey}`}
                    client={client}
                    isClientLoading={clientQuery.isLoading}
                    needs={missingLabels(clientChecks(client))}
                  />
                </section>
                <section className="min-w-0 rounded-lg border bg-card p-5 md:p-6">
                  <PropertyColumn
                    key={`property-${resetKey}`}
                    clientId={client.id}
                    clientName={client.name}
                    properties={properties}
                    propertyId={propertyId}
                    onPropertyChange={handlePropertyChange}
                    needs={missingLabels(propertyChecks(property))}
                  />
                </section>
                <section className="min-w-0 rounded-lg border bg-card p-5 md:p-6">
                  <CaseColumn
                    key={`case-${resetKey}`}
                    clientId={client.id}
                    clientName={client.name}
                    propertyId={propertyId}
                    property={property}
                    cases={client.cases}
                    caseId={caseId}
                    onCaseChange={setCaseId}
                    onCaseSelected={handleCaseSelected}
                    caseDetail={activeCase}
                    isCaseLoading={isCaseLoading}
                    enquiry={{ summary: client.enquirySummary ?? null, timescale: client.enquiryTimescale ?? null }}
                    needs={missingLabels(caseChecks(activeCase))}
                  />
                </section>
              </div>
            </>
          )}
        </>
      )}

      <AddStartDialog
        open={dialogOpen}
        currentClientId={clientNotFound ? null : clientId}
        initialTab={dialogTab}
        onSelected={handleSelected}
        onCancel={handleCancel}
      />
    </div>
  );
}
