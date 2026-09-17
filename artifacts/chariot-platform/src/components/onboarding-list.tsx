import { useState, useRef, useEffect } from "react";
import {
  useReadDocument,
  useUpdateDocument,
  type DocumentReading,
  type OnboardingItem,
  type OnboardingItemUpdateStatus,
} from "@workspace/api-client-react";
import { DocumentReadingLine } from "@/components/document-reading-line";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RequiredDot } from "@/components/required-dot";
import { AlertTriangle, CalendarClock, Check, FileUp, Sparkles, Upload } from "lucide-react";
import { DatePicker } from "@/components/date-picker";
import { documentExpiry, formatDate } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
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
  /** Staff: refetch after an expiry date is set. When given, each file can be given an expiry. */
  onDocumentUpdated?: () => void;
  /** @deprecated Files open their own preview; kept for call sites still passing it. */
  onViewDocument?: (id: number) => void;
}

export interface OnboardingDocument {
  id: number;
  name: string;
  category: string;
  reading?: DocumentReading | null;
  /** "yyyy-MM-dd" after which the file no longer counts. */
  expiresAt?: string | null;
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
  onDocumentUpdated,
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
              onDocumentUpdated={onDocumentUpdated}
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
 * download and (for staff) delete and an optional expiry date. The tile is
 * flagged as a whole once any of its files has expired.
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
  onDocumentUpdated,
}: {
  item: OnboardingItem;
  onUpload: () => void;
  disabled: boolean;
  documents: OnboardingDocument[];
  onReadingChanged?: () => void;
  viewHref?: (id: number) => string;
  downloadHref?: (id: number) => string;
  onDocumentDeleted?: () => void;
  onDocumentUpdated?: () => void;
}) {
  const done = item.status === "complete";
  const empty = documents.length === 0;
  // The worst expiry among the files: one expired file flags the whole tile.
  const expiry = documents
    .map((document) => documentExpiry(document.expiresAt))
    .reduce<ReturnType<typeof documentExpiry>>(
      (worst, current) => (!worst || (current && current.days < worst.days) ? current : worst),
      null,
    );
  const expired = expiry?.state === "expired";
  const expiringSoon = expiry?.state === "soon";
  // Staff can (re)read every file under the tile by hand — the upload already
  // triggers a read, this is the "run it again" / "it did not run" button.
  const readDocument = useReadDocument();
  const [readingIds, setReadingIds] = useState<Set<number>>(new Set());
  const readAll = async () => {
    if (documents.length === 0 || !onReadingChanged) return;
    setReadingIds(new Set(documents.map((document) => document.id)));
    let failed = 0;
    for (const document of documents) {
      try {
        await readDocument.mutateAsync({ id: document.id });
      } catch {
        failed += 1;
      }
      setReadingIds((current) => {
        const next = new Set(current);
        next.delete(document.id);
        return next;
      });
      onReadingChanged();
    }
    if (failed > 0) toast.add({ title: `Couldn't read ${failed} file${failed === 1 ? "" : "s"} for ${item.label}`, type: "error" });
  };
  const reading = readingIds.size > 0;
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
        expired
          ? "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30"
          : expiringSoon
            ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30"
            : done
              ? "border-emerald-200/70 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20"
              : "bg-card",
        empty && !disabled && "cursor-pointer hover:border-foreground/30 hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          expired
            ? "bg-red-600 text-white"
            : done
              ? "bg-emerald-600 text-white"
              : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
        )}
        aria-label={expired ? "Expired" : done ? "Uploaded" : "Required"}
        title={expired ? "Expired" : done ? "Uploaded" : "Required"}
      >
        {expired ? <AlertTriangle className="size-3.5" /> : done ? <Check className="size-3.5" /> : <FileUp className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium leading-snug">
          <span className="truncate">{item.label}</span>
          {expiry ? (
            <span
              className={cn(
                "shrink-0 text-xs font-medium",
                expired ? "text-red-700 dark:text-red-400" : expiringSoon ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
              )}
            >
              {expiry.label}
            </span>
          ) : null}
        </p>
        {documents.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {documents.map((document) => (
              <span key={document.id} className="flex min-w-0 items-center gap-1">
                <DocumentFile
                  id={document.id}
                  name={document.name}
                  variant="chip"
                  viewHref={viewHref?.(document.id)}
                  downloadHref={downloadHref?.(document.id)}
                  onDeleted={onDocumentDeleted}
                />
                {onDocumentUpdated ? (
                  <ExpiryPicker document={document} onSaved={onDocumentUpdated} />
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
        {onReadingChanged
          ? documents.map((document) => (
              <DocumentReadingLine
                key={`reading-${document.id}`}
                documentId={document.id}
                reading={document.reading}
                category={document.category}
                busy={readingIds.has(document.id)}
                onRefresh={onReadingChanged}
              />
            ))
          : null}
      </div>
      <span className="flex shrink-0 items-center">
        {onReadingChanged ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void readAll();
                }}
                disabled={disabled || empty || reading}
                aria-label={`Read ${item.label} with AI`}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                {reading ? <Spinner className="size-4" /> : <Sparkles className="size-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{empty ? "Upload a file to read" : `Read ${documents.length === 1 ? "the file" : `all ${documents.length} files`} with AI`}</TooltipContent>
          </Tooltip>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onUpload();
          }}
          disabled={disabled}
          aria-label={documents.length > 0 ? `Add another file for ${item.label}` : `Upload ${item.label}`}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <Upload className="size-4" />
        </button>
      </span>
    </div>
  );
}

/** Small "Expires 12 Mar 2027" / "Add expiry" control on one file; picking the same date again clears it. */
function ExpiryPicker({ document, onSaved }: { document: OnboardingDocument; onSaved: () => void }) {
  const updateDocument = useUpdateDocument();
  const expiry = documentExpiry(document.expiresAt);
  return (
    <span onClick={(event) => event.stopPropagation()}>
      <DatePicker
        variant="ghost"
        size="xs"
        value={document.expiresAt ?? null}
        placeholder="Add expiry"
        aria-label={`Expiry date for ${document.name}`}
        disabled={updateDocument.isPending}
        className={cn(
          "h-6 w-auto px-1.5 text-xs [&_svg]:size-3",
          expiry?.state === "expired" && "text-red-700 dark:text-red-400",
          expiry?.state === "soon" && "text-amber-700 dark:text-amber-400",
          !document.expiresAt && "text-muted-foreground",
        )}
        onChange={(value) =>
          updateDocument.mutate(
            { id: document.id, data: { expiresAt: value || null } },
            {
              onSuccess: onSaved,
              onError: () => toast.add({ title: `Couldn't save the expiry for ${document.name}`, type: "error" }),
            },
          )
        }
      />
    </span>
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
