import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileUp } from "lucide-react";
import { toast } from "@/components/ui/toast";
import {
  useImportProperties,
  getGetClientQueryKey,
  getListPropertiesQueryKey,
  getListTasksQueryKey,
  type Property,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AssigneeSelect } from "./assignee-select";
import { buildTemplateCsv, parsePropertyCsv, type ParsedPropertyCsv } from "./csv";
import { apiErrorMessage } from "./utils";

const money = (value: number | null) =>
  value == null ? "—" : `£${value.toLocaleString("en-GB")}`;

/**
 * Bulk-add properties for the fixed client from a CSV file. Rows are parsed
 * and validated in the browser; only the valid ones are sent, in one request.
 */
export function ImportPropertiesDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
  clientName: string;
  onImported: (created: Property[]) => void;
}) {
  const qc = useQueryClient();
  const importProperties = useImportProperties();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedPropertyCsv | null>(null);
  const [assignee, setAssignee] = useState<number | null>(null);

  const reset = () => {
    setFileName(null);
    setParsed(null);
    setAssignee(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setParsed(parsePropertyCsv(text));
  };

  const downloadTemplate = () => {
    const blob = new Blob([buildTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "properties-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const validRows = parsed?.rows.filter((row) => row.input) ?? [];
  const invalidRows = parsed?.rows.filter((row) => !row.input) ?? [];
  const hasAddressColumn = parsed?.recognisedColumns.includes("address") ?? false;

  const handleImport = () => {
    if (validRows.length === 0) return;
    importProperties.mutate(
      {
        data: {
          clientId,
          assignedUserId: assignee ?? undefined,
          properties: validRows.map((row) => row.input!),
        },
      },
      {
        onSuccess: (created) => {
          toast.add({
            title: `${created.length} propert${created.length === 1 ? "y" : "ies"} imported`,
            type: "success",
          });
          qc.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
          qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
          reset();
          onOpenChange(false);
          onImported(created);
        },
        onError: (error) => {
          toast.add({
            title: "Import failed",
            description: apiErrorMessage(error, "Nothing was imported."),
            type: "error",
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import properties from CSV</DialogTitle>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFile}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp /> {fileName ? "Choose another file" : "Choose CSV file"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}>
            <Download /> Download template
          </Button>
          {fileName ? (
            <span className="truncate text-sm text-muted-foreground">{fileName}</span>
          ) : null}
        </div>

        {parsed ? (
          <div className="space-y-3">
            {!hasAddressColumn ? (
              <p className="text-sm text-destructive">
                No address column found. Use the template headers or include a
                column called "address".
              </p>
            ) : null}
            {parsed.ignoredColumns.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Ignored columns: {parsed.ignoredColumns.join(", ")}
              </p>
            ) : null}
            <p className="text-sm">
              <span className="font-medium">{validRows.length}</span> ready to import
              {invalidRows.length > 0 ? (
                <>
                  , <span className="font-medium text-destructive">{invalidRows.length}</span>{" "}
                  skipped for errors
                </>
              ) : null}
              .
            </p>
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Line</th>
                    <th className="px-2 py-1.5 font-medium">Address</th>
                    <th className="px-2 py-1.5 font-medium">Matter</th>
                    <th className="px-2 py-1.5 font-medium text-right">Value</th>
                    <th className="px-2 py-1.5 font-medium text-right">Loan</th>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((row) => (
                    <tr
                      key={row.line}
                      className={cn("border-t", !row.input && "bg-destructive/5")}
                    >
                      <td className="px-2 py-1.5 text-muted-foreground">{row.line}</td>
                      <td className="max-w-[240px] truncate px-2 py-1.5">
                        {row.address || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-1.5">{row.matterType}</td>
                      <td className="px-2 py-1.5 text-right">{money(row.value)}</td>
                      <td className="px-2 py-1.5 text-right">{money(row.loanAmount)}</td>
                      <td className="px-2 py-1.5">
                        {row.input ? (
                          <span className="text-emerald-600">Ready</span>
                        ) : (
                          <span className="text-destructive">{row.errors.join("; ")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AssigneeSelect
              section="property"
              value={assignee}
              onChange={setAssignee}
              label="Review task goes to"
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={validRows.length === 0 || importProperties.isPending}
            onClick={handleImport}
          >
            {importProperties.isPending
              ? "Importing..."
              : `Import ${validRows.length || ""} propert${validRows.length === 1 ? "y" : "ies"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
