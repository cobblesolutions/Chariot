import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDocuments,
  getListDocumentsQueryKey,
} from "@workspace/api-client-react";
import type { CaseDetail, Document } from "@workspace/api-client-react";
import { Download, FileText, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatBytes } from "@/components/chat/chat-thread";
import { SidePanelHeader } from "@/components/case/case-side-menu";
import { DocumentActions, previewDocument } from "@/components/document-file";
import { formatDate } from "@/lib/utils";

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "identity", label: "Identity" },
  { value: "financial", label: "Financial" },
  { value: "property", label: "Property" },
  { value: "contract", label: "Contract" },
];

async function downloadDocument(doc: Document) {
  try {
    const res = await fetch(`/api/documents/${doc.id}/download`);
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.name;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  } catch {
    toast.add({ title: "Failed to download document", type: "error" });
  }
}

/** Files attached to the case, with upload. Mirrors the Documents page. */
export function CaseDocumentsPanel({
  caseItem,
  onClose,
}: {
  caseItem: CaseDetail;
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const params = { caseId: caseItem.id };
  const { data: documents = [], isLoading } = useListDocuments(params, {
    query: { queryKey: getListDocumentsQueryKey(params) },
  });
  const [category, setCategory] = useState("general");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        headers: {
          "x-filename": file.name,
          "x-content-type": file.type || "application/octet-stream",
          "x-document-category": category,
          "x-client-id": String(caseItem.clientId),
          "x-case-id": String(caseItem.id),
          "Content-Type": "application/octet-stream",
        },
        body: await file.arrayBuffer(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Upload failed");
      }
      toast.add({ title: "Document uploaded", type: "success" });
      qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
    } catch (err) {
      toast.add({
        title: "Failed to upload document",
        description: err instanceof Error ? err.message : "Upload failed",
        type: "error",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const sorted = [...documents].sort(
    (a, b) =>
      new Date(b.uploadedAt ?? 0).getTime() -
      new Date(a.uploadedAt ?? 0).getTime(),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidePanelHeader
        icon={FileText}
        title="Documents"
        count={documents.length}
        onClose={onClose}
      />

      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleUpload}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload /> {isUploading ? "Uploading…" : "Upload"}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : sorted.length === 0 ? (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText />
              </EmptyMedia>
              <EmptyTitle>No documents</EmptyTitle>
              <EmptyDescription>
                Upload files for this case and they will show here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y">
            {sorted.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <FileText className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => previewDocument(`/api/documents/${doc.id}/view`, doc.name)}
                    className="block max-w-full truncate text-left text-sm font-medium hover:underline"
                  >
                    {doc.name}
                  </button>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <Badge variant="outline" className="capitalize">
                      {doc.category.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                    {doc.byteSize ? (
                      <span>{formatBytes(doc.byteSize)}</span>
                    ) : null}
                    {doc.uploadedAt ? (
                      <span>{formatDate(doc.uploadedAt)}</span>
                    ) : null}
                  </span>
                </span>
                <DocumentActions
                  id={doc.id}
                  name={doc.name}
                  size="icon-sm"
                  onDeleted={() => qc.invalidateQueries({ queryKey: getListDocumentsQueryKey(params) })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
