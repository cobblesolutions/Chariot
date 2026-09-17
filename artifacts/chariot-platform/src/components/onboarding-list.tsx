import { useState, useRef, useEffect } from "react";
import type {
  DocumentReading,
  OnboardingItem,
  OnboardingItemUpdateStatus,
} from "@workspace/api-client-react";
import { DocumentReadingLine } from "@/components/document-reading-line";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RequiredDot } from "@/components/required-dot";
import { Check, FileUp, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { DocumentFile } from "@/components/document-file";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const residentialStatusOptions = [
  "Owner with mortgage",
  "Owner without mortgage",
  "Renting",
] as const;

interface OnboardingListProps {
  items: OnboardingItem[];
  onUpdateItem: (
    key: string,
    data: { value?: string | null; status?: OnboardingItemUpdateStatus },
  ) => void;
  onUploadDocument: (key: string) => void;
  isUpdating: boolean;
  /** Kept for call-site compatibility; onboarding items are required once a client exists. */
  showNotApplicable?: boolean;
  documents?: Array<OnboardingDocument>;
  /** Staff: refetch after a re-read. When given, each file shows what the document reading system found. */
  onReadingChanged?: () => void;
  /** Portal passes its own view route; staff use the default. */
  viewHref?: (id: number) => string;
  downloadHref?: (id: number) => string;
  /** Called after a file is deleted (staff only - omit to hide Delete). */
  onDocumentDeleted?: () => void;
  /** @deprecated Files open their own preview; kept for call sites still passing it. */
  onViewDocument?: (id: number) => void;
}

export interface OnboardingDocument {
  id: number;
  name: string;
  category: string;
  reading?: DocumentReading | null;
}

export function OnboardingList({
  items,
  onUpdateItem,
  onUploadDocument,
  isUpdating,
  showNotApplicable = true,
  documents = [],
  onReadingChanged,
  viewHref,
  downloadHref,
  onDocumentDeleted,
}: OnboardingListProps) {
  if (!items || items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4">
        No onboarding requirements found.
      </div>
    );
  }
  const documentItems = items.filter((item) => item.kind === "document");
  const fieldItems = items.filter((item) => item.kind !== "document");

  return (
    <div className="@container space-y-3">
      {documentItems.length > 0 ? (
        <div className="grid gap-1.5 @xl:grid-cols-2 @5xl:grid-cols-4">
          {documentItems.map((item) => (
            <UploadTile
              key={item.key}
              item={item}
              onUpload={() => onUploadDocument(item.key)}
              disabled={isUpdating}
              documents={documents.filter((document) => document.category === item.key)}
              onReadingChanged={onReadingChanged}
              viewHref={viewHref}
              downloadHref={downloadHref}
              onDocumentDeleted={onDocumentDeleted}
            />
          ))}
        </div>
      ) : null}
      {fieldItems.length > 0 ? (
        <div className="grid gap-x-6 gap-y-2 @3xl:grid-cols-2">
          {fieldItems.map((item) => (
            <OnboardingItemRow
              key={item.key}
              item={item}
              onUpdate={(data) => onUpdateItem(item.key, data)}
              disabled={isUpdating}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One document requirement as a compact tile: the title, whether it is done,
 * an upload control, and the files already there - each with preview,
 * download and (for staff) delete.
 */
function UploadTile({
  item,
  onUpload,
  disabled,
  documents,
  onReadingChanged,
  viewHref,
  downloadHref,
  onDocumentDeleted,
}: {
  item: OnboardingItem;
  onUpload: () => void;
  disabled: boolean;
  documents: OnboardingDocument[];
  onReadingChanged?: () => void;
  viewHref?: (id: number) => string;
  downloadHref?: (id: number) => string;
  onDocumentDeleted?: () => void;
}) {
  const done = item.status === "complete";
  const empty = documents.length === 0;
  return (
    <div
      role={empty ? "button" : undefined}
      tabIndex={empty ? 0 : undefined}
      onClick={empty && !disabled ? onUpload : undefined}
      onKeyDown={(event) => {
        if (empty && !disabled && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onUpload();
        }
      }}
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors",
        done
          ? "border-emerald-200/70 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20"
          : "bg-card",
        empty && !disabled && "cursor-pointer hover:border-foreground/30 hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          done ? "bg-emerald-600 text-white" : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
        )}
        aria-label={done ? "Uploaded" : "Required"}
        title={done ? "Uploaded" : "Required"}
      >
        {done ? <Check className="size-3.5" /> : <FileUp className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-snug">{item.label}</p>
        {documents.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {documents.map((document) => (
              <DocumentFile
                key={document.id}
                id={document.id}
                name={document.name}
                variant="chip"
                viewHref={viewHref?.(document.id)}
                downloadHref={downloadHref?.(document.id)}
                onDeleted={onDocumentDeleted}
              />
            ))}
          </div>
        ) : null}
        {onReadingChanged
          ? documents.map((document) => (
              <DocumentReadingLine
                key={`reading-${document.id}`}
                documentId={document.id}
                reading={document.reading}
                onRefresh={onReadingChanged}
              />
            ))
          : null}
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onUpload();
        }}
        disabled={disabled}
        aria-label={documents.length > 0 ? `Add another file for ${item.label}` : `Upload ${item.label}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <Upload className="size-4" />
      </button>
    </div>
  );
}

function OnboardingItemRow({
  item,
  onUpdate,
  disabled,
}: {
  item: OnboardingItem;
  onUpdate: (data: {
    value?: string | null;
    status?: OnboardingItemUpdateStatus;
  }) => void;
  disabled: boolean;
}) {
  const [localValue, setLocalValue] = useState(item.value || "");
  const lastSaved = useRef(item.value || "");

  useEffect(() => {
    // Only update local state if the server's value has changed to something
    // different from what we last saved (e.g. updated by someone else)
    const serverValue = item.value || "";
    if (serverValue !== lastSaved.current) {
      setLocalValue(serverValue);
      lastSaved.current = serverValue;
    }
  }, [item.value]);

  const handleBlur = () => {
    if (localValue !== lastSaved.current) {
      lastSaved.current = localValue;
      onUpdate({ value: localValue });
    }
  };

  return (
    <div className="grid gap-1 @lg:grid-cols-[minmax(150px,2fr)_minmax(200px,3fr)] @lg:items-center @lg:gap-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {item.label}
            {item.status !== "complete" ? <RequiredDot /> : null}
          </p>
          {item.key === "residential_status" ? (
            <Select
              value={localValue}
              onValueChange={(value) => {
                setLocalValue(value);
                lastSaved.current = value;
                onUpdate({ value });
              }}
              disabled={disabled}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select residential status" />
              </SelectTrigger>
              <SelectContent>
                {residentialStatusOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : item.kind === "textarea" ? (
            <Textarea
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              onBlur={handleBlur}
              disabled={disabled}
              placeholder="Enter details..."
              className="min-h-14"
            />
          ) : (
            <Input
              type={item.kind === "date" ? "date" : "text"}
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              onBlur={handleBlur}
              disabled={disabled}
              placeholder="Enter required information"
            />
          )}
    </div>
  );
}
