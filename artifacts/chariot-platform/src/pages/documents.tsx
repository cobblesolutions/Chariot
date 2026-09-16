import { useEffect, useMemo, useState, useRef } from "react";
import { useSearch } from "wouter";
import {
  useListDocuments,
  useDeleteDocument,
  getListDocumentsQueryKey,
  useListClients,
  useListCases,
  type Document,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyDescription,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  Download,
  Eye,
  Trash2,
  Search,
  FileUp,
  Filter,
  MoreHorizontal,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { createColumnHelper } from "@tanstack/react-table";
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFeatures,
} from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { previewDocument } from "@/components/document-file";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";

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

const columnHelper = createColumnHelper<DataTableFeatures, Document>();

export default function DocumentsPage() {
  const contextualClientId = new URLSearchParams(window.location.search).get(
    "clientId",
  );
  const qc = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const { data: documents, isLoading } = useListDocuments();

  // `/documents?doc=<id>` (from site search): there is no document detail page,
  // so narrow the list to that document's name and mark its row selected.
  const searchString = useSearch();
  const focusDocId = useMemo(() => {
    const value = Number(new URLSearchParams(searchString).get("doc"));
    return value > 0 ? value : null;
  }, [searchString]);
  useEffect(() => {
    if (focusDocId == null || !documents) return;
    const doc = documents.find((d) => d.id === focusDocId);
    if (!doc) return;
    setCategoryFilter("all");
    setSearchTerm(doc.name);
  }, [focusDocId, documents]);
  const { data: clients } = useListClients();
  const { data: cases } = useListCases();
  const deleteDoc = useDeleteDocument();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadClientId, setUploadClientId] = useState<string>(
    contextualClientId ?? "none",
  );
  const [uploadCaseId, setUploadCaseId] = useState<string>("none");
  const [uploadCategory, setUploadCategory] = useState<string>("general");
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      toast.add({
        title: "File too large",
        description: "Maximum file size is 50MB.",
        type: "error",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (!ACCEPTED_DOCUMENT_TYPES.has(file.type)) {
      toast.add({
        title: "Unsupported file type",
        description: "Choose a permitted business document type.",
        type: "error",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (uploadClientId === "none") {
      toast.add({
        title: "Client required",
        description: "Please select a client before uploading.",
        type: "error",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const headers: Record<string, string> = {
        "x-filename": file.name,
        "x-content-type": file.type || "application/octet-stream",
        "x-document-category": uploadCategory,
        "x-client-id": uploadClientId,
        "Content-Type": "application/octet-stream",
      };
      if (uploadCaseId !== "none") {
        headers["x-case-id"] = uploadCaseId;
      }

      const res = await fetch("/api/documents/upload", {
        method: "POST",
        headers,
        body: arrayBuffer,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Upload failed");
      }

      toast.add({ title: "Document uploaded successfully", type: "success" });
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

  const handleDownload = async (docId: number, filename: string) => {
    try {
      const res = await fetch(`/api/documents/${docId}/download`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      toast.add({ title: "Failed to download document", type: "error" });
    }
  };

  const [pendingId, setPendingId] = useState<number | null>(null);
  const handleDelete = (id: number) => setPendingId(id);

  const confirmHandleDelete = (id: number) => {
    deleteDoc.mutate(
      { id },
      {
        onSuccess: () => {
          toast.add({ title: "Document deleted", type: "success" });
          qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
        },
        onError: () => {
          toast.add({ title: "Failed to delete document", type: "error" });
        },
      },
    );
  };

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("name", {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Document Name" />
          ),
          sortFn: "text",
          cell: ({ row }) => {
            const d = row.original;
            return (
              <div>
                <div className="font-semibold flex items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  {d.name}
                </div>
                {d.caseId && (
                  <div className="text-xs text-muted-foreground mt-1 ml-7">
                    Case ID: {d.caseId}
                  </div>
                )}
              </div>
            );
          },
        }),
        columnHelper.accessor("category", {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Category" />
          ),
          sortFn: "text",
          cell: ({ getValue }) => (
            <Badge variant="outline" className="capitalize">
              {getValue()}
            </Badge>
          ),
        }),
        columnHelper.accessor("byteSize", {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Size" />
          ),
          sortFn: "basic",
          meta: { cellClassName: "text-muted-foreground" },
          cell: ({ getValue }) => {
            const size = getValue();
            return size ? `${(size / 1024).toFixed(1)} KB` : "--";
          },
        }),
        columnHelper.accessor("uploadedAt", {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Date" />
          ),
          sortFn: "datetime",
          meta: { cellClassName: "text-muted-foreground" },
          cell: ({ getValue }) => {
            const value = getValue();
            return value ? formatDate(value) : "--";
          },
        }),
        columnHelper.display({
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          meta: { cellClassName: "text-right" },
          cell: ({ row }) => {
            const d = row.original;
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => previewDocument(`/api/documents/${d.id}/view`, d.name)}>
                    <Eye /> Preview
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleDownload(d.id, d.name)}
                  >
                    <Download /> Download
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => handleDelete(d.id)}
                  >
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            );
          },
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const filteredDocs = (documents || []).filter((d) => {
    const matchesSearch = d.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesCategory =
      categoryFilter === "all" || d.category === categoryFilter;
    const matchesClient =
      !contextualClientId || d.clientId === Number(contextualClientId);
    return matchesSearch && matchesCategory && matchesClient;
  });

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[300px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Upload New</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field>
              <FieldLabel className="text-sm font-medium">
                Client (Required)
              </FieldLabel>
              <Select value={uploadClientId} onValueChange={setUploadClientId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select Client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-- Select Client --</SelectItem>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel className="text-sm font-medium">
                Case (Optional)
              </FieldLabel>
              <Select
                value={uploadCaseId}
                onValueChange={setUploadCaseId}
                disabled={uploadClientId === "none"}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select Case" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-- No Case --</SelectItem>
                  {cases
                    ?.filter((c) => c.clientId.toString() === uploadClientId)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id.toString()}>
                        {c.reference}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel className="text-sm font-medium">Category</FieldLabel>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="identity">Identity</SelectItem>
                  <SelectItem value="financial">Financial</SelectItem>
                  <SelectItem value="property">Property</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <div className="pt-2">
              <input
                type="file"
                className="hidden"
                ref={fileInputRef}
                onChange={handleUpload}
              />
              <Button
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadClientId === "none" || isUploading}
              >
                {isUploading ? (
                  "Uploading..."
                ) : (
                  <>
                    <FileUp /> Select File
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex gap-2 items-center">
            <InputGroup className="flex-1 bg-card">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Search documents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </InputGroup>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
                <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="identity">Identity</SelectItem>
                <SelectItem value="financial">Financial</SelectItem>
                <SelectItem value="property">Property</SelectItem>
                <SelectItem value="contract">Contract</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DataTable
            columns={columns}
            data={filteredDocs}
            isRowSelected={(d) => d.id === focusDocId}
            initialSorting={[{ id: "uploadedAt", desc: true }]}
            emptyMessage={
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileText />
                  </EmptyMedia>
                  <EmptyDescription>
                    No documents found matching your criteria.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            }
          />
        </div>
      </div>
      <ConfirmDialog
        open={pendingId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingId(null);
        }}
        title="Delete this document?"
        description="The file will be permanently removed."
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingId !== null) confirmHandleDelete(pendingId);
          setPendingId(null);
        }}
      />
    </div>
  );
}
