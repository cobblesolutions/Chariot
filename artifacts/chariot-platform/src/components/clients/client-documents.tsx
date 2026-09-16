import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetClientQueryKey,
  getGetClientTimelineQueryKey,
  getListClientsQueryKey,
  getListDocumentsQueryKey,
  useListDocuments,
  type ClientDetail,
  type Document,
} from "@workspace/api-client-react";
import { CircleDashed, FileText, Upload } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { DocumentFile } from "@/components/document-file";
import { OnboardingList } from "@/components/onboarding-list";
import { ACCEPTED_DOCUMENT_TYPES } from "@/components/add/utils";

const categoryLabel = (category: string) =>
  category
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

/**
 * Everything on file for the client: the onboarding document checklist
 * (upload against each requirement) and then any other documents on the
 * client or their cases. This is the only place documents live on the record.
 */
export function ClientDocuments({ client }: { client: ClientDetail }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef("general");
  const [uploading, setUploading] = useState(false);
  const { data, isLoading } = useListDocuments(
    { clientId: client.id },
    { query: { queryKey: getListDocumentsQueryKey({ clientId: client.id }) } },
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListDocumentsQueryKey({ clientId: client.id }) });
    qc.invalidateQueries({ queryKey: getGetClientQueryKey(client.id) });
    qc.invalidateQueries({ queryKey: getGetClientTimelineQueryKey(client.id) });
    qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
  };

  const pick = (category: string) => {
    categoryRef.current = category;
    inputRef.current?.click();
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    let uploaded = 0;
    try {
      for (const file of Array.from(files)) {
        if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} is over the 50 MB limit.`);
        const response = await fetch("/api/documents/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-client-id": String(client.id),
            "x-filename": file.name,
            "x-content-type": file.type || "application/octet-stream",
            "x-document-category": categoryRef.current,
          },
          body: await file.arrayBuffer(),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          throw new Error(result?.error || `Upload failed for ${file.name}`);
        }
        uploaded += 1;
      }
      toast.add({ title: `${uploaded} document${uploaded === 1 ? "" : "s"} uploaded`, type: "success" });
    } catch (error) {
      toast.add({ title: "Upload failed", description: error instanceof Error ? error.message : undefined, type: "error" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      refresh();
    }
  };

  const onboardingItems = client.onboarding.items.filter((item) => item.kind === "document");
  const onboardingKeys = new Set(onboardingItems.map((item) => item.key));
  const onboardingDone = onboardingItems.filter((item) => item.status === "complete").length;
  const documents: Document[] = data ?? [];
  const others = documents.filter((document) => document.uploadedAt && !onboardingKeys.has(document.category));
  const outstanding = documents.filter((document) => !document.uploadedAt && !onboardingKeys.has(document.category));

  return (
    <div className="space-y-6">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept={ACCEPTED_DOCUMENT_TYPES}
        onChange={(event) => void upload(event.target.files)}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Onboarding documents</h3>
            <p className="text-xs text-muted-foreground">
              {onboardingItems.length
                ? `${onboardingDone} of ${onboardingItems.length} collected`
                : "No document requirements for this client."}
            </p>
          </div>
        </div>
        {onboardingItems.length > 0 && (
          <OnboardingList
            items={onboardingItems}
            onUpdateItem={() => undefined}
            onUploadDocument={pick}
            isUpdating={uploading}
            documents={client.documents}
            onDocumentDeleted={refresh}
          />
        )}
      </section>

      <Separator />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Other documents</h3>
            <p className="text-xs text-muted-foreground">
              {others.length ? `${others.length} on file, including case documents` : "Anything else for this client or their cases."}
              {outstanding.length ? ` · ${outstanding.length} still required` : ""}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => pick("general")} disabled={uploading}>
            <Upload /> {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : others.length === 0 && outstanding.length === 0 ? (
          <Empty className="border-0 py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText />
              </EmptyMedia>
              <EmptyTitle>Nothing else on file</EmptyTitle>
              <EmptyDescription>Upload a file above and it will be kept against this client.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="-mx-2 space-y-0.5">
            {others.map((document) => (
              <div key={document.id} className="flex items-center gap-2">
                <DocumentFile
                  id={document.id}
                  name={document.name}
                  byteSize={document.byteSize}
                  onDeleted={refresh}
                  className="min-w-0 flex-1"
                />
                <span className="hidden w-44 shrink-0 truncate text-xs text-muted-foreground sm:block">
                  {categoryLabel(document.category)}
                  {document.uploadedAt ? ` · ${formatDate(document.uploadedAt)}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        {outstanding.length > 0 && (
          <ul className="space-y-0.5">
            {outstanding.map((document) => (
              <li key={document.id} className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                <CircleDashed className="size-4 shrink-0" />
                <span className="truncate">{document.name}</span>
                <span className="ml-auto shrink-0 text-xs">{categoryLabel(document.category)} · required</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
