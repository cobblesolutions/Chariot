import { useState, useRef, useEffect } from "react";
import type {
  OnboardingItem,
  OnboardingItemUpdateStatus,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Check, Eye, FileSignature, FileUp, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DocumentFile } from "@/components/document-file";
import { previewDocument } from "@/components/document-preview";
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
  documents?: Array<{ id: number; name: string; category: string }>;
  /** Portal passes its own view route; staff use the default. */
  viewHref?: (id: number) => string;
  downloadHref?: (id: number) => string;
  /** Called after a file is deleted (staff only - omit to hide Delete). */
  onDocumentDeleted?: () => void;
  /** @deprecated Files open their own preview; kept for call sites still passing it. */
  onViewDocument?: (id: number) => void;
  /** Turns the `terms_business` item into the Terms of Business tile (read, accept / mark accepted, signed copy). */
  terms?: TermsTileProps;
}

export interface TermsTileProps {
  document: { filename: string; version: number } | null;
  acceptance: { acceptedAt: string; via: string } | null;
  /** Where the firm's PDF is served for this viewer (staff or portal route). */
  viewHref: string;
  /** Portal: the client accepts the terms. */
  onAccept?: () => void;
  /** Staff: open the "mark accepted" dialog. */
  onMarkAccepted?: () => void;
  accepting?: boolean;
}

export function OnboardingList({
  items,
  onUpdateItem,
  onUploadDocument,
  isUpdating,
  showNotApplicable = true,
  documents = [],
  viewHref,
  downloadHref,
  onDocumentDeleted,
  terms,
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
    <div className="@container space-y-4">
      {documentItems.length > 0 ? (
        <div className="grid gap-1.5 @2xl:grid-cols-2">
          {documentItems.map((item) =>
            item.key === "terms_business" && terms ? (
              <TermsTile
                key={item.key}
                item={item}
                terms={terms}
                onUpload={() => onUploadDocument(item.key)}
                disabled={isUpdating}
                documents={documents.filter((document) => document.category === item.key)}
                viewHref={viewHref}
                downloadHref={downloadHref}
                onDocumentDeleted={onDocumentDeleted}
              />
            ) : (
              <UploadTile
                key={item.key}
                item={item}
                onUpload={() => onUploadDocument(item.key)}
                disabled={isUpdating}
                documents={documents.filter((document) => document.category === item.key)}
                viewHref={viewHref}
                downloadHref={downloadHref}
                onDocumentDeleted={onDocumentDeleted}
              />
            ),
          )}
        </div>
      ) : null}
      {fieldItems.length > 0 ? (
        <Card className="gap-0 divide-y overflow-hidden py-0">
          {fieldItems.map((item) => (
            <OnboardingItemRow
              key={item.key}
              item={item}
              onUpdate={(data) => onUpdateItem(item.key, data)}
              disabled={isUpdating}
            />
          ))}
        </Card>
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
  viewHref,
  downloadHref,
  onDocumentDeleted,
}: {
  item: OnboardingItem;
  onUpload: () => void;
  disabled: boolean;
  documents: Array<{ id: number; name: string; category: string }>;
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
        "flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
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

/**
 * The Terms of Business are accepted, not just uploaded: read the firm's PDF,
 * then the client accepts in the portal (or staff mark a signed copy / phone
 * agreement). A signed copy can still be uploaded to the tile.
 */
function TermsTile({
  item,
  terms,
  onUpload,
  disabled,
  documents,
  viewHref,
  downloadHref,
  onDocumentDeleted,
}: {
  item: OnboardingItem;
  terms: TermsTileProps;
  onUpload: () => void;
  disabled: boolean;
  documents: Array<{ id: number; name: string; category: string }>;
  viewHref?: (id: number) => string;
  downloadHref?: (id: number) => string;
  onDocumentDeleted?: () => void;
}) {
  const done = item.status === "complete";
  const detail = item.detail
    ?? (terms.document
      ? terms.onAccept ? "Please read the terms, then accept them below" : "Not yet accepted — the client accepts in the portal, or upload a signed copy"
      : "The firm has not published its Terms of Business yet");
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2 transition-colors @2xl:col-span-2",
        done
          ? "border-emerald-200/70 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20"
          : "bg-card",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full",
            done ? "bg-emerald-600 text-white" : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
          )}
          aria-label={done ? "Accepted" : "Required"}
          title={done ? "Accepted" : "Required"}
        >
          {done ? <Check className="size-3.5" /> : <FileSignature className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-snug">{item.label}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
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
        </div>
        <button
          type="button"
          onClick={onUpload}
          disabled={disabled}
          aria-label="Upload a signed copy of the Terms of Business"
          title="Upload a signed copy"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <Upload className="size-4" />
        </button>
      </div>
      {/* Actions sit under the text so the tile works in a narrow column as well as a wide one. */}
      {terms.document || (!done && terms.onMarkAccepted) ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-10">
          {terms.document ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => previewDocument(terms.viewHref, terms.document?.filename ?? "Terms of Business", terms.viewHref)}
            >
              <Eye /> Read the terms
            </Button>
          ) : null}
          {!done && terms.document && terms.onAccept ? (
            <Button type="button" size="sm" onClick={terms.onAccept} disabled={disabled || terms.accepting}>
              <Check /> {terms.accepting ? "Accepting…" : "I accept"}
            </Button>
          ) : null}
          {!done && terms.onMarkAccepted ? (
            <Button type="button" variant="outline" size="sm" onClick={terms.onMarkAccepted} disabled={disabled}>
              Mark accepted
            </Button>
          ) : null}
        </div>
      ) : null}
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
    <div className="p-4">
        <div className="grid gap-2 @lg:grid-cols-[minmax(180px,1fr)_minmax(220px,2fr)] @lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-sm">{item.label}</p>
              {item.status !== "complete" && (
                <Badge variant="secondary">Required</Badge>
              )}
            </div>
          </div>
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
              className="min-h-[80px]"
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
    </div>
  );
}
