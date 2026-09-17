import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { Briefcase, Check, ExternalLink, Home, User, UserRoundPen, Users } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddStartDialog, type StartTab } from "@/components/add/start-dialog";
import { AddDrafts } from "@/components/add/drafts";
import { AddStepper } from "@/components/add/add-stepper";
import { AcceptPanel, WelcomeDeliveryNotice } from "@/components/add/accept-panel";
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
import { useNavTitle } from "@/lib/nav-history";
import { apiErrorStatus } from "@/components/add/utils";

function parseId(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type AddTab = "client" | "property" | "case";

/** The three forms of the advanced step, in the order they are filled in. */
const ADD_TABS: ReadonlyArray<{ key: AddTab; title: string; icon: typeof User }> = [
  { key: "client", title: "Client", icon: User },
  { key: "property", title: "Property", icon: Home },
  { key: "case", title: "Case", icon: Briefcase },
];

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
  // Which of the three forms is showing; null until the user picks one, so
  // the page can open on the first form that still needs something.
  const [chosenTab, setChosenTab] = useState<AddTab | null>(initial.caseId ? "case" : null);
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

  const needs: Record<AddTab, string[]> = {
    client: missingLabels(clientChecks(client)),
    property: missingLabels(propertyChecks(property)),
    case: missingLabels(caseChecks(activeCase)),
  };
  const tab: AddTab = chosenTab ?? (ADD_TABS.find((item) => needs[item.key].length > 0)?.key ?? "case");

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
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="text-xl font-semibold leading-tight">{client.name}</h2>
                  {client.companyName ? (
                    <span className="text-base text-muted-foreground">{client.companyName}</span>
                  ) : null}
                  <Badge variant={isClosedLifecycle(client.lifecycle) ? "destructive" : "outline"}>
                    {LIFECYCLE_LABELS[client.lifecycle]}
                  </Badge>
                </div>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
                  {[
                    client.email,
                    client.phone || null,
                    client.source ? `${sourceLabel(client.source)}${client.introducerName ? ` via ${client.introducerName}` : ""}` : null,
                    client.assignee && !awaitingDecision ? `Reviewed by ${client.assignee.displayName}` : null,
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
              <div className="flex shrink-0 flex-wrap items-center gap-1 sm:-mr-2">
                <WelcomeDeliveryNotice client={client} />
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
            <div className="flex flex-col gap-3 border-t px-5 py-2.5 sm:flex-row sm:items-center sm:justify-between md:px-6">
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
            <AcceptPanel client={client} />
          ) : (
            <>
              {/* One form at a time: Client, Property, Case. The switcher sits
                  above the form; every form stays mounted so unsaved edits
                  survive switching. */}
              <Tabs value={tab} onValueChange={(value) => setChosenTab(value as AddTab)} className="gap-4">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <TabsList className="h-10 w-fit">
                    {ADD_TABS.map((item) => {
                      const left = needs[item.key].length;
                      return (
                        <TabsTrigger key={item.key} value={item.key} className="px-4">
                          <item.icon />
                          {item.title}
                          {left === 0 ? (
                            <Check className="text-emerald-600" aria-label="Complete" />
                          ) : (
                            <span className="text-xs font-normal text-muted-foreground">{left} left</span>
                          )}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                  {/* What the open form still needs before the case can proceed. */}
                  {needs[tab].length === 0 ? (
                    <p className="text-sm font-medium text-emerald-600">Everything needed is in.</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Still needed:</span> {needs[tab].join(" · ")}
                    </p>
                  )}
                </div>
                <TabsContent value="client" forceMount className="data-[state=inactive]:hidden">
                  <ClientColumn
                    key={`client-${resetKey}`}
                    client={client}
                    isClientLoading={clientQuery.isLoading}
                  />
                </TabsContent>
                <TabsContent value="property" forceMount className="data-[state=inactive]:hidden">
                  <PropertyColumn
                    key={`property-${resetKey}`}
                    clientId={client.id}
                    clientName={client.name}
                    properties={properties}
                    propertyId={propertyId}
                    onPropertyChange={handlePropertyChange}
                    documents={client.documents}
                  />
                </TabsContent>
                <TabsContent value="case" forceMount className="data-[state=inactive]:hidden">
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
                  />
                </TabsContent>
              </Tabs>
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
