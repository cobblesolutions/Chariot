import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, Upload } from "lucide-react";
import { getGetClientQueryKey, useReadDocument, type DocumentReading } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { DocumentFile } from "@/components/document-file";
import { DocumentReadingLine } from "@/components/document-reading-line";
import { UploadProgress } from "@/components/upload-progress";
import { documentUploadHeaders, useUpload } from "@/lib/upload";
import { ACCEPTED_DOCUMENT_TYPES } from "./utils";

export interface PortfolioDocument {
  id: number;
  name: string;
  category: string;
  reading?: DocumentReading | null;
}

/** Ids of the properties the portfolio reader created, across every portfolio file. */
export function portfolioPropertyIds(documents: PortfolioDocument[]) {
  const ids = new Set<number>();
  for (const document of documents) {
    if (document.category !== "portfolio" || document.reading?.status !== "completed") continue;
    const created = (document.reading.data as { createdPropertyIds?: number[] } | null)?.createdPropertyIds ?? [];
    created.forEach((id) => ids.add(id));
  }
  return ids;
}

/**
 * The client's property portfolio (their schedule of properties) lives with
 * the properties, not the client onboarding list. Files upload under the
 * "portfolio" category; "Import CSV" turns a spreadsheet into property records.
 */
export function PortfolioDocuments({
  clientId,
  documents,
}: {
  clientId: number;
  documents: PortfolioDocument[];
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const { progress, uploading, send, reset } = useUpload();
  const files = documents.filter((document) => document.category === "portfolio");
  const refresh = () => qc.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
  // Manual (re)read of every portfolio file; uploads already read themselves.
  const readDocument = useReadDocument();
  const [readingIds, setReadingIds] = useState<Set<number>>(new Set());
  const readAll = async () => {
    setReadingIds(new Set(files.map((file) => file.id)));
    for (const file of files) {
      try {
        await readDocument.mutateAsync({ id: file.id });
      } catch {
        toast.add({ title: `Couldn't read ${file.name}`, type: "error" });
      }
      setReadingIds((current) => {
        const next = new Set(current);
        next.delete(file.id);
        return next;
      });
      refresh();
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length === 0) return;
    try {
      for (const [index, file] of picked.entries()) {
        if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} is too large. Maximum file size is 50 MB.`);
        await send(file, {
          url: "/api/documents/upload",
          headers: documentUploadHeaders(file, { "x-client-id": clientId, "x-document-category": "portfolio" }),
          index,
          count: picked.length,
        });
      }
      toast.add({ title: `${picked.length} portfolio file${picked.length === 1 ? "" : "s"} uploaded`, type: "success" });
      refresh();
    } catch (error) {
      toast.add({ title: "Upload failed", description: error instanceof Error ? error.message : "Upload failed", type: "error" });
    } finally {
      reset();
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2 border-t px-4 py-2.5">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        accept={ACCEPTED_DOCUMENT_TYPES}
        onChange={handleUpload}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Property portfolio.</span> Upload a schedule of
          properties (spreadsheet, CSV or PDF).
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="sm" disabled={files.length === 0 || readingIds.size > 0} onClick={() => void readAll()}>
            {readingIds.size > 0 ? <Spinner /> : <Sparkles />}
            Read
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? <Spinner /> : <Upload />}
            Upload
          </Button>
        </div>
      </div>
      <UploadProgress progress={progress} />
      {files.length > 0 ? (
        <div className="divide-y rounded-md border">
          {files.map((file) => (
            <div key={file.id} className="px-2 py-1">
              <DocumentFile id={file.id} name={file.name} onDeleted={refresh} />
              <DocumentReadingLine documentId={file.id} reading={file.reading} category="portfolio" busy={readingIds.has(file.id)} onRefresh={refresh} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
