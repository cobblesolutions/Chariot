import { useAuth } from "@/components/auth-provider";
import { Building2, CheckCircle2, ClipboardCheck } from "lucide-react";
import {
  useListPortalCases,
  useListPortalDocuments,
  getListPortalDocumentsQueryKey,
  useGetPortalOnboarding,
  getGetPortalOnboardingQueryKey,
  useUpdatePortalOnboardingItem,
  useGetPortalTermsOfBusiness,
  getGetPortalTermsOfBusinessQueryKey,
  useAcceptPortalTermsOfBusiness,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { stageClasses } from "@/lib/stages";
import { StageBadge } from "@/components/stage-badge";
import { Button } from "@/components/ui/button";
import { useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { queryClient } from "@/lib/queryClient";
import { OnboardingList } from "@/components/onboarding-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientPortalProperties } from "@/components/client-portal-properties";
import { PortalApprovalBlock } from "@/components/portal-approval-block";

const ACCEPTED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

export default function PortalPage() {
  const { user } = useAuth();

  if (user?.role !== "client") {
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto h-full flex flex-col">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Client Portal</h1>
        </div>

        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2 />
            </EmptyMedia>
            <EmptyTitle>Portal Access Requires Client Account</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return <ClientPortalView />;
}

function ClientPortalView() {
  const { data: cases, isLoading: loadingCases } = useListPortalCases();
  const { data: documents, isLoading: loadingDocs } = useListPortalDocuments();
  const { data: onboarding, isLoading: loadingOnboarding } =
    useGetPortalOnboarding();
  const updateOnboarding = useUpdatePortalOnboardingItem();
  const { data: terms } = useGetPortalTermsOfBusiness();
  const acceptTerms = useAcceptPortalTermsOfBusiness();
  const [requirementsOpen, setRequirementsOpen] = useState(false);

  const handleAcceptTerms = () =>
    acceptTerms.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPortalOnboardingQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPortalTermsOfBusinessQueryKey() });
        toast.add({ title: "Thank you — Terms of Business accepted", type: "success" });
      },
      onError: (error) =>
        toast.add({
          title: "Couldn't record your acceptance",
          description: error instanceof Error ? error.message : "Please try again.",
          type: "error",
        }),
    });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentCategoryRef = useRef("general");

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    let uploaded = 0;
    try {
      for (const file of files) {
        if (file.size > 50 * 1024 * 1024) {
          throw new Error(
            `${file.name} is too large. Maximum file size is 50MB.`,
          );
        }
        if (!ACCEPTED_DOCUMENT_TYPES.has(file.type)) {
          throw new Error(
            `${file.name} is not a permitted business document type.`,
          );
        }
        const res = await fetch("/api/portal/documents/upload", {
          method: "POST",
          headers: {
            "x-filename": file.name,
            "x-content-type": file.type || "application/octet-stream",
            "x-document-category": documentCategoryRef.current,
            "Content-Type": "application/octet-stream",
          },
          body: await file.arrayBuffer(),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Upload failed for ${file.name}`);
        }
        uploaded += 1;
      }
      toast.add({
        title: `${uploaded} document${uploaded === 1 ? "" : "s"} uploaded successfully`,
        type: "success",
      });
      queryClient.invalidateQueries({
        queryKey: getListPortalDocumentsQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: getGetPortalOnboardingQueryKey(),
      });
    } catch (err) {
      toast.add({
        title: "Failed to upload document",
        description: err instanceof Error ? err.message : "Upload failed",
        type: "error",
      });
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUpdateOnboarding = (key: string, data: any) => {
    updateOnboarding.mutate(
      { key, data },
      {
        onSuccess: () => {
          toast.add({ title: "Saved successfully", type: "success" });
          queryClient.invalidateQueries({
            queryKey: getGetPortalOnboardingQueryKey(),
          });
        },
        onError: () => {
          toast.add({ title: "Failed to save requirement", type: "error" });
        },
      },
    );
  };

  if (loadingCases || loadingDocs || loadingOnboarding) {
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const activeCases = (cases ?? []).filter(
    (caseItem) => caseItem.status !== "completed",
  );

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Your Portal</h1>
      </div>
      <input
        type="file"
        className="hidden"
        multiple
        ref={fileInputRef}
        onChange={handleUpload}
      />

      <Tabs defaultValue="overview" className="gap-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="properties" className="gap-2">
            <Building2 />
            Properties
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-8">
          {onboarding && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardCheck className="size-5 text-primary" />
                  Required information and documents
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <Button
                  onClick={() => setRequirementsOpen(true)}
                  className="shrink-0"
                >
                  Update details
                </Button>
              </CardContent>
            </Card>
          )}

          {onboarding && (
            <Dialog open={requirementsOpen} onOpenChange={setRequirementsOpen}>
              <DialogContent className="sm:max-w-3xl max-h-[90dvh] overflow-hidden flex flex-col">
                <DialogHeader>
                  <DialogTitle>Required information and documents</DialogTitle>
                </DialogHeader>
                <ScrollArea className="pr-1">
                  <OnboardingList
                    items={onboarding.items}
                    onUpdateItem={handleUpdateOnboarding}
                    onUploadDocument={(key) => {
                      documentCategoryRef.current = key;
                      fileInputRef.current?.click();
                    }}
                    isUpdating={updateOnboarding.isPending}
                    showNotApplicable={false}
                    documents={documents ?? []}
                    viewHref={(id) => `/api/portal/documents/${id}/view`}
                    downloadHref={(id) => `/api/portal/documents/${id}/download`}
                    terms={{
                      document: terms?.document ?? null,
                      acceptance: terms?.acceptance ?? null,
                      viewHref: "/api/portal/terms-of-business/document",
                      onAccept: handleAcceptTerms,
                      accepting: acceptTerms.isPending,
                    }}
                  />
                </ScrollArea>
              </DialogContent>
            </Dialog>
          )}

          <div className="space-y-6">
            <div className="flex flex-col gap-6">
              <div className="flex h-8 items-center">
                <h2 className="text-xl font-semibold">Active Cases</h2>
              </div>
              {activeCases.length === 0 ? (
                <Empty className="border h-full">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <CheckCircle2 />
                    </EmptyMedia>
                    <EmptyDescription>No active cases.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                activeCases.map((c) => (
                  <Card key={c.id}>
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle>{c.propertyAddress}</CardTitle>
                          <CardDescription>
                            {c.reference} • {c.matterType}
                          </CardDescription>
                        </div>
                        <Badge variant="outline">{c.status}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            Current Stage
                          </span>
                          <StageBadge
                            stage={c.stage}
                            stageIndex={c.stageIndex}
                          />
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${stageClasses(c.stageIndex).bg}`}
                            style={{
                              width: `${Math.max(10, Math.min(100, (c.stageIndex / Math.max(1, c.stages.length - 1)) * 100))}%`,
                            }}
                          />
                        </div>
                        {c.pendingApprovals.map((approval) => (
                          <PortalApprovalBlock key={approval.id} approval={approval} />
                        ))}
                        <div className="flex justify-between text-xs text-muted-foreground pt-2">
                          <span>Loan: £{c.loanAmount?.toLocaleString()}</span>
                          <span>Updated: {formatDate(c.updatedAt)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="properties" className="space-y-6">
          <ClientPortalProperties />
        </TabsContent>
      </Tabs>
    </div>
  );
}
