import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, FileSignature, Upload } from "lucide-react";
import {
  useGetTermsOfBusiness,
  getGetTermsOfBusinessQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { previewDocument } from "@/components/document-preview";
import { formatDate } from "@/lib/utils";

export const TERMS_DOCUMENT_HREF = "/api/settings/terms-of-business/document";

/**
 * The firm-wide Terms of Business every client accepts during onboarding.
 * One PDF; replacing it bumps the version that later acceptances record.
 */
export function TermsOfBusinessTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useGetTermsOfBusiness();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const doc = data?.document ?? null;

  const upload = async (file: File) => {
    if (file.type !== "application/pdf") {
      toast.add({ title: "Upload the Terms of Business as a PDF", type: "error" });
      return;
    }
    setUploading(true);
    try {
      const res = await fetch("/api/settings/terms-of-business", {
        method: "PUT",
        headers: {
          "x-filename": file.name,
          "x-content-type": file.type,
          "Content-Type": "application/octet-stream",
        },
        body: await file.arrayBuffer(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Upload failed");
      }
      await qc.invalidateQueries({ queryKey: getGetTermsOfBusinessQueryKey() });
      toast.add({ title: doc ? `Terms of Business replaced (v${doc.version + 1})` : "Terms of Business published", type: "success" });
    } catch (error) {
      toast.add({ title: "Couldn't publish the Terms of Business", description: error instanceof Error ? error.message : undefined, type: "error" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <TabsContent value="terms-of-business" className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
              <FileSignature className="size-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <h2 className="text-base font-semibold">Terms of Business</h2>
              {isLoading ? (
                <Skeleton className="h-4 w-64" />
              ) : doc ? (
                <>
                  <p className="truncate text-sm">{doc.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    Version {doc.version} · published {formatDate(doc.uploadedAt)}
                    {doc.uploadedBy ? ` by ${doc.uploadedBy}` : ""} · {(doc.byteSize / 1024).toFixed(0)} KB
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing published yet. Clients cannot accept the terms until a PDF is here.</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {doc ? (
              <Button variant="outline" onClick={() => previewDocument(TERMS_DOCUMENT_HREF, doc.filename, TERMS_DOCUMENT_HREF)}>
                <Eye /> View
              </Button>
            ) : null}
            {isAdmin ? (
              <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
                <Upload /> {uploading ? "Uploading…" : doc ? "Replace PDF" : "Upload PDF"}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="border-t px-6 py-4 text-sm text-muted-foreground">
          Clients read and accept this in their portal as part of onboarding. If a client returns a signed copy instead,
          upload it to their Terms of Business tile and mark it accepted. The fee each client agrees to is set per case
          (percent of the loan or a flat amount) and is what the invoice charges.
          {!isAdmin ? " Only an administrator can replace the document." : ""}
        </div>
      </Card>
    </TabsContent>
  );
}
