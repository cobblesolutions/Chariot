import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FileText, Trash2 } from "lucide-react";
import { useDeleteDocument } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { previewDocument } from "@/components/document-preview";

export interface DocumentFileProps {
  id: number;
  name: string;
  /** Shown after the name when known. */
  byteSize?: number | null;
  /** Staff routes by default; the portal passes its own. */
  viewHref?: string;
  downloadHref?: string;
  /** Called after a successful delete (invalidate whatever list showed the file). Omit to hide Delete. */
  onDeleted?: () => void;
  /** Row (default) or a tighter inline chip. */
  variant?: "row" | "chip";
  className?: string;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { previewDocument } from "@/components/document-preview";

/** Preview · Download · Delete for one file. Delete asks first and reports the outcome. */
export function DocumentActions({
  id,
  name,
  viewHref = `/api/documents/${id}/view`,
  downloadHref = `/api/documents/${id}/download`,
  onDeleted,
  size = "icon-xs",
}: Pick<DocumentFileProps, "id" | "name" | "viewHref" | "downloadHref" | "onDeleted"> & {
  size?: "icon-xs" | "icon-sm";
}) {
  const qc = useQueryClient();
  const deleteDocument = useDeleteDocument();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDelete = () => {
    deleteDocument.mutate(
      { id },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          toast.add({ title: `${name} deleted`, type: "success" });
          qc.invalidateQueries({ queryKey: ["/api/documents"] });
          onDeleted?.();
        },
        onError: () =>
          toast.add({ title: `Couldn't delete ${name}`, type: "error" }),
      },
    );
  };

  return (
    <span className="flex shrink-0 items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={size}
            className="text-muted-foreground"
            aria-label={`Preview ${name}`}
            onClick={() => previewDocument(viewHref, name, downloadHref)}
          >
            <Eye />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Preview</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size={size} className="text-muted-foreground" aria-label={`Download ${name}`} asChild>
            <a href={downloadHref} download={name}>
              <Download />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Download</TooltipContent>
      </Tooltip>
      {onDeleted ? (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size={size}
                aria-label={`Delete ${name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={`Delete ${name}?`}
            description="The file is removed from storage. This can't be undone."
            actionLabel={deleteDocument.isPending ? "Deleting…" : "Delete"}
            destructive
            onConfirm={handleDelete}
          />
        </>
      ) : null}
    </span>
  );
}

/**
 * One uploaded file, the same everywhere: name opens a preview, then the
 * Preview · Download · Delete actions.
 */
export function DocumentFile({
  id,
  name,
  byteSize,
  viewHref = `/api/documents/${id}/view`,
  downloadHref = `/api/documents/${id}/download`,
  onDeleted,
  variant = "row",
  className,
}: DocumentFileProps) {
  const chip = variant === "chip";
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2",
        chip ? "rounded-md border bg-background px-2 py-1" : "px-1 py-1",
        className,
      )}
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <button
        type="button"
        onClick={() => previewDocument(viewHref, name, downloadHref)}
        className="min-w-0 flex-1 truncate text-left text-sm underline-offset-4 hover:underline"
        title={`Preview ${name}`}
      >
        {name}
      </button>
      {byteSize && !chip ? (
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{formatBytes(byteSize)}</span>
      ) : null}
      <DocumentActions id={id} name={name} viewHref={viewHref} downloadHref={downloadHref} onDeleted={onDeleted} />
    </div>
  );
}
