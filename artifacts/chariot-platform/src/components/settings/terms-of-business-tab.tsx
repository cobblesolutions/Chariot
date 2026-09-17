import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Braces, ChevronDown, Eye, FileSignature, LogIn, Plus, RotateCcw, Trash2, Unplug, Upload } from "lucide-react";
import { useSearch } from "wouter";
import {
  useGetTermsOfBusiness,
  usePublishTermsOfBusiness,
  useTestDocusignConnection,
  useDisconnectDocusign,
  getGetTermsOfBusinessQueryKey,
  type TermsPlaceholder,
  type TermsTemplateField,
  type TermsTemplateInput,
  type TermsFieldType,
  type DocusignTestResult,
  type SignatureConfig,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { previewDocument } from "@/components/document-preview";
import { apiErrorMessage } from "@/components/add/utils";
import { cn, formatDate } from "@/lib/utils";

export const TERMS_DOCUMENT_HREF = "/api/settings/terms-of-business/document";

const FIELD_TYPES: Array<{ value: TermsFieldType; label: string }> = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Paragraph" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Amount (£)" },
  { value: "date", label: "Date" },
  { value: "select", label: "Choice" },
];

const slug = (label: string) =>
  label
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0]!.toUpperCase() + word.slice(1).toLowerCase()))
    .join("")
    .replace(/^\d+/, "")
    .slice(0, 40);

/** Opens a PDF returned by a POST as a preview; the fetch carries the session cookie. */
export async function openPdfPreview(url: string, body: unknown, name: string) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "Could not render the document");
  }
  const blobUrl = URL.createObjectURL(await response.blob());
  previewDocument(blobUrl, name, blobUrl);
}

// ---------------------------------------------------------------------------
// The body as the editor sees it: an intro plus named sections. Serialised
// back to the stored format (`# Heading` lines) so the PDF renderer and any
// template already published are unchanged.

interface Section {
  heading: string;
  text: string;
}
interface Doc {
  title: string;
  intro: string;
  sections: Section[];
  fields: TermsTemplateField[];
}

const HEADING = /^#{1,3}\s+(.*)$/;

function parseBody(body: string): { intro: string; sections: Section[] } {
  const sections: Section[] = [];
  const intro: string[] = [];
  let current: Section | null = null;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(HEADING);
    if (match) {
      current = { heading: match[1]!.trim(), text: "" };
      sections.push(current);
    } else if (current) {
      current.text += (current.text ? "\n" : "") + line;
    } else {
      intro.push(line);
    }
  }
  return { intro: intro.join("\n").trim(), sections: sections.map((section) => ({ ...section, text: section.text.trim() })) };
}

function serialiseBody(doc: Pick<Doc, "intro" | "sections">) {
  return [
    doc.intro.trim(),
    ...doc.sections.map((section) => [section.heading.trim() ? `# ${section.heading.trim()}` : "", section.text.trim()].filter(Boolean).join("\n\n")),
  ]
    .filter(Boolean)
    .join("\n\n");
}

const toDoc = (input: TermsTemplateInput): Doc => ({ title: input.title, ...parseBody(input.body), fields: input.fields });
const toInput = (doc: Doc): TermsTemplateInput => ({ title: doc.title, body: serialiseBody(doc), fields: doc.fields });
const sameInput = (a: TermsTemplateInput, b: TermsTemplateInput) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------

/**
 * The firm's Terms of Business as a template: a document made of named
 * sections, with values from each case dropped in where the text says
 * {{like this}}, and the questions staff answer per case. Publishing keeps the
 * previous versions so a signed agreement can always show what it said.
 */
export function TermsOfBusinessTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useGetTermsOfBusiness();
  const publish = usePublishTermsOfBusiness();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  // The textarea that last had focus — "Insert value" drops the token there.
  const focused = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  const stored: TermsTemplateInput | null = useMemo(() => {
    if (!data) return null;
    const source = data.template ?? data.defaults;
    return { title: source.title, body: source.body, fields: source.fields };
  }, [data]);

  // Seed the editor from the published version (or the built-in text) once; keep edits after refetches.
  useEffect(() => {
    if (stored && !doc) setDoc(toDoc(stored));
  }, [stored, doc]);

  const input = doc ? toInput(doc) : null;
  const dirty = !!input && !!stored && !sameInput(input, stored);
  const nextVersion = (data?.template?.version ?? 0) + 1;
  const placeholders = data?.placeholders ?? [];

  const update = (patch: Partial<Doc>) => setDoc((current) => (current ? { ...current, ...patch } : current));
  const updateSection = (index: number, patch: Partial<Section>) =>
    setDoc((current) => current ? { ...current, sections: current.sections.map((section, at) => (at === index ? { ...section, ...patch } : section)) } : current);
  const move = <T,>(list: T[], index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  };

  /** Drops `{{token}}` into whichever text box was last focused (or the end of the intro). */
  const insertToken = (token: string) => {
    const el = focused.current;
    const text = `{{${token}}}`;
    if (!el || !doc) {
      update({ intro: `${doc?.intro ?? ""}${text}` });
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const nativeSetter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set;
    nativeSetter?.call(el, `${el.value.slice(0, start)}${text}${el.value.slice(end)}`);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const handlePreview = async () => {
    if (!input) return;
    setPreviewing(true);
    try {
      await openPdfPreview("/api/settings/terms-of-business/preview", input, `${input.title} (preview)`);
    } catch (error) {
      toast.add({ title: "Couldn't render the preview", description: error instanceof Error ? error.message : undefined, type: "error" });
    } finally {
      setPreviewing(false);
    }
  };

  const handlePublish = () => {
    if (!input) return;
    publish.mutate(
      { data: input },
      {
        onSuccess: (state) => {
          qc.invalidateQueries({ queryKey: getGetTermsOfBusinessQueryKey() });
          if (state.template) setDoc(toDoc({ title: state.template.title, body: state.template.body, fields: state.template.fields }));
          toast.add({ title: `Terms of Business published as v${state.template?.version ?? nextVersion}`, type: "success" });
        },
        onError: (error) => toast.add({ title: "Couldn't publish", description: apiErrorMessage(error, "Check the template and try again"), type: "error" }),
      },
    );
  };

  const remember = (el: HTMLTextAreaElement | HTMLInputElement | null) => {
    if (el) focused.current = el;
  };

  return (
    <TabsContent value="terms-of-business" className="space-y-4">
      <DocusignCard isAdmin={isAdmin} signature={data?.signature ?? null} />

      <DynamicValuesCard placeholders={placeholders} fields={doc?.fields ?? []} />

      {/* Header row: what is published, and the two actions. No card — the editor is a set of cards below. */}
      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <FileSignature className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Terms of Business template</h2>
            {isLoading ? (
              <Skeleton className="h-4 w-64" />
            ) : data?.template ? (
              <p className="text-xs text-muted-foreground">
                Version {data.template.version} · published {formatDate(data.template.publishedAt)}
                {data.template.publishedBy ? ` by ${data.template.publishedBy}` : ""}
                {dirty ? <span className="text-amber-700 dark:text-amber-400"> · unpublished changes</span> : ""}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Nothing published yet — the built-in text is loaded. Publish it (or your own) before a case can send its terms.</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={handlePreview} disabled={!input || previewing}>
            <Eye /> {previewing ? "Rendering…" : "Preview PDF"}
          </Button>
          {isAdmin ? (
            <Button onClick={handlePublish} disabled={!input || publish.isPending || (!dirty && !!data?.template)}>
              <Upload /> {publish.isPending ? "Publishing…" : `Publish v${nextVersion}`}
            </Button>
          ) : null}
        </div>
      </div>

      {doc ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:gap-0">
          {/* Left: the editor — one card per thing to edit */}
          <div className="min-w-0 space-y-3 xl:pr-6">
            <div className="flex justify-end">
              <InsertValueMenu placeholders={placeholders} fields={doc.fields} onInsert={insertToken} disabled={!isAdmin} />
            </div>

            <Card className="gap-3 py-4">
              <div className="space-y-3 px-4">
                <Field>
                  <FieldLabel>Document title</FieldLabel>
                  <Input value={doc.title} onChange={(event) => update({ title: event.target.value })} disabled={!isAdmin} maxLength={120} onFocus={(event) => remember(event.currentTarget)} className="h-8" />
                </Field>
                <Field>
                  <FieldLabel>Opening paragraph</FieldLabel>
                  <Textarea
                    value={doc.intro}
                    onChange={(event) => update({ intro: event.target.value })}
                    onFocus={(event) => remember(event.currentTarget)}
                    disabled={!isAdmin}
                    className="min-h-[72px] text-sm"
                    placeholder="What this document is and who it is between."
                  />
                </Field>
              </div>
            </Card>

            {doc.sections.map((section, index) => (
              <Card key={index} className="gap-0 py-2">
                <div className="px-2">
                  <div className="flex items-center gap-1">
                    <Input
                      value={section.heading}
                      onChange={(event) => updateSection(index, { heading: event.target.value })}
                      onFocus={(event) => remember(event.currentTarget)}
                      disabled={!isAdmin}
                      placeholder="Section heading, e.g. Our fee"
                      className="h-8 border-transparent bg-transparent px-2 font-medium shadow-none hover:border-input focus-visible:border-input dark:bg-transparent"
                    />
                    <Button type="button" variant="ghost" size="icon-sm" disabled={!isAdmin || index === 0} onClick={() => update({ sections: move(doc.sections, index, -1) })} aria-label="Move up"><ArrowUp /></Button>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={!isAdmin || index === doc.sections.length - 1} onClick={() => update({ sections: move(doc.sections, index, 1) })} aria-label="Move down"><ArrowDown /></Button>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={!isAdmin} onClick={() => update({ sections: doc.sections.filter((_, at) => at !== index) })} aria-label="Remove section"><Trash2 /></Button>
                  </div>
                  <Textarea
                    value={section.text}
                    onChange={(event) => updateSection(index, { text: event.target.value })}
                    onFocus={(event) => remember(event.currentTarget)}
                    disabled={!isAdmin}
                    className="mt-1 min-h-[76px] text-sm"
                    placeholder="The wording. Leave a blank line between paragraphs; start a line with “-” for a bullet."
                  />
                </div>
              </Card>
            ))}
            {isAdmin ? (
              <Button type="button" variant="outline" size="sm" className="w-full border-dashed" onClick={() => update({ sections: [...doc.sections, { heading: "", text: "" }] })}>
                <Plus /> Add section
              </Button>
            ) : null}

            <Card className="gap-0 py-3">
              <div className="px-3">
                <FieldsEditor fields={doc.fields} disabled={!isAdmin} onChange={(fields) => update({ fields })} onInsert={insertToken} />
              </div>
            </Card>

            {isAdmin ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => setResetOpen(true)}>
                  <RotateCcw /> Reset to the built-in template
                </Button>
                {dirty && stored ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDoc(toDoc(stored))}>
                    Discard changes
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Right: the preview, on its own "desk" behind a rail */}
          <div className="min-w-0 xl:border-l-2 xl:border-border xl:pl-6">
            {/* Sticks to the viewport and fills it; only the page inside scrolls. */}
            <Card className="gap-0 overflow-hidden py-0 xl:sticky xl:top-4 xl:flex xl:h-[calc(100dvh-2rem)] xl:flex-col">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Eye className="size-4 text-muted-foreground" /> Preview
                  <span className="text-xs font-normal text-muted-foreground">· updates as you type</span>
                </p>
                <Badge variant="outline" className="bg-background font-normal text-muted-foreground">Sample case · not a real client</Badge>
              </div>
              <div className="max-h-[70dvh] overflow-y-auto bg-[#E4ECE9] p-5 xl:max-h-none xl:min-h-0 xl:flex-1 dark:bg-[#0f1f1b]">
                <DocumentPreview doc={doc} placeholders={placeholders} version={nextVersion} />
              </div>
              <div className="border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                Highlighted words are replaced with each case's own values. The signature and date are filled in by DocuSign.
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {data?.versions && data.versions.length > 1 ? (
        <Card className="gap-0 py-0">
          <div className="px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Previous versions</p>
            <ul className="mt-2 divide-y text-sm">
              {data.versions.slice(1).map((version) => (
                <li key={version.version} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">
                    v{version.version} · {version.title}
                    <span className="text-muted-foreground"> · {formatDate(version.publishedAt)}{version.publishedBy ? ` by ${version.publishedBy}` : ""} · {version.fields.length} question{version.fields.length === 1 ? "" : "s"}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => previewDocument(`${TERMS_DOCUMENT_HREF}?version=${version.version}`, `${version.title} v${version.version} (sample)`, `${TERMS_DOCUMENT_HREF}?version=${version.version}`)}
                  >
                    <Eye /> View sample
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}
      {!isAdmin ? (
        <p className="px-1 text-xs text-muted-foreground">Only an administrator can publish changes.</p>
      ) : null}

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset to the built-in template?"
        description="Replaces the editor text and questions. Nothing is published until you click Publish."
        actionLabel="Reset"
        onConfirm={() => {
          if (data) setDoc(toDoc({ title: data.defaults.title, body: data.defaults.body, fields: data.defaults.fields }));
        }}
      />
    </TabsContent>
  );
}

// ---------------------------------------------------------------------------
// Dynamic values: what they are and a copy button for each

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.add({ title: `Copied ${text}`, type: "success" });
  } catch {
    toast.add({ title: "Couldn't copy — select it and copy by hand", type: "error" });
  }
}

/** Every value the text can use, grouped, each a click-to-copy chip. */
function DynamicValuesCard({ placeholders, fields }: { placeholders: TermsPlaceholder[]; fields: TermsTemplateField[] }) {
  const [open, setOpen] = useState(false);
  const groups: Array<[string, Array<{ token: string; description: string; sample: string }>]> = [
    ...(["case", "client", "firm"] as const).map((group) => [group, placeholders.filter((item) => item.group === group)] as [string, TermsPlaceholder[]]),
    ["fields", fields.filter((field) => field.key).map((field) => ({ token: field.key, description: field.label || field.key, sample: field.defaultValue ?? `[${field.label}]` }))],
  ];
  return (
    <Card className="gap-0 py-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Braces className="size-4 text-muted-foreground" /> Dynamic values
          <span className="text-xs font-normal text-muted-foreground">{placeholders.length + fields.filter((field) => field.key).length} available</span>
        </h2>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {open ? "Click a value to copy it" : "Show"}
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open ? (
      <div className="space-y-1.5 border-t px-5 py-3">
        {groups.map(([group, items]) =>
          items.length ? (
            <div key={group} className="flex flex-wrap items-center gap-1.5">
              <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{GROUP_LABEL[group]}</span>
              {items.map((item) => (
                <button
                  key={item.token}
                  type="button"
                  onClick={() => copyText(`{{${item.token}}}`)}
                  title={`${item.description.replace(/,?\s*e\.g\..*$/, "")} — e.g. ${item.sample || "—"}`}
                  className="rounded-md border bg-background px-2 py-0.5 font-mono text-xs transition-colors hover:bg-muted"
                >
                  {`{{${item.token}}}`}
                </button>
              ))}
            </div>
          ) : null,
        )}
      </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Insert value: the tokens, grouped by where they come from

const GROUP_LABEL: Record<string, string> = { client: "From the client", case: "From the case", firm: "The firm", fields: "Your questions" };

function InsertValueMenu({
  placeholders,
  fields,
  onInsert,
  disabled,
}: {
  placeholders: TermsPlaceholder[];
  fields: TermsTemplateField[];
  onInsert: (token: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const groups: Array<[string, Array<{ token: string; description: string; sample: string }>]> = [
    ...(["case", "client", "firm"] as const).map((group) => [group, placeholders.filter((item) => item.group === group)] as [string, TermsPlaceholder[]]),
    ["fields", fields.filter((field) => field.key).map((field) => ({ token: field.key, description: field.label || field.key, sample: field.defaultValue ?? `[${field.label}]` }))],
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Braces /> Insert value <ChevronDown className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[420px] w-80 overflow-y-auto p-2">
        {groups.map(([group, items]) =>
          items.length ? (
            <div key={group} className="mb-2 last:mb-0">
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{GROUP_LABEL[group]}</p>
              {items.map((item) => (
                <button
                  key={item.token}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onInsert(item.token);
                    setOpen(false);
                  }}
                  className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{item.description.replace(/,?\s*e\.g\..*$/, "")}</span>
                    <span className="block truncate text-xs text-muted-foreground">e.g. {item.sample || "—"}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null,
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Live preview: the same block rules as the PDF, with sample values dropped in

function TokenText({ text, values }: { text: string; values: Map<string, string> }) {
  const parts = text.split(/(\{\{\s*[a-zA-Z][a-zA-Z0-9_]*\s*\}\})/g);
  return (
    <>
      {parts.map((part, index) => {
        const match = part.match(/^\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}$/);
        if (!match) return <span key={index}>{part}</span>;
        const value = values.get(match[1]!);
        return value === undefined ? (
          <span key={index} className="rounded bg-destructive/10 px-1 text-destructive" title="Unknown value — check the spelling">{part}</span>
        ) : (
          <span key={index} className="rounded bg-primary/10 px-0.5 text-foreground" title={`{{${match[1]}}}`}>{value}</span>
        );
      })}
    </>
  );
}

function Blocks({ text, values }: { text: string; values: Map<string, string> }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((raw) => raw.split("\n").map((line) => line.trim()).filter(Boolean)).filter((lines) => lines.length);
  return (
    <>
      {blocks.map((lines, index) =>
        lines.every((line) => /^[-•*]\s+/.test(line)) ? (
          <ul key={index} className="my-2 list-disc space-y-1 pl-5">
            {lines.map((line, at) => (
              <li key={at}><TokenText text={line.replace(/^[-•*]\s+/, "")} values={values} /></li>
            ))}
          </ul>
        ) : (
          <p key={index} className="my-2"><TokenText text={lines.join(" ")} values={values} /></p>
        ),
      )}
    </>
  );
}

function DocumentPreview({ doc, placeholders, version }: { doc: Doc; placeholders: TermsPlaceholder[]; version: number }) {
  const values = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of placeholders) map.set(item.token, item.sample);
    map.set("companyNameClause", " (Okafor Property Ltd)");
    map.set("templateVersion", String(version));
    for (const field of doc.fields) if (field.key) map.set(field.key, field.defaultValue || (field.type === "select" ? field.options?.[0] ?? "" : "") || `[${field.label || field.key}]`);
    return map;
  }, [placeholders, doc.fields, version]);
  const firm = values.get("firmName") ?? "Chariot";
  return (
    <div className="mx-auto max-w-[680px] rounded-sm border border-neutral-300/60 bg-white px-9 py-8 text-[13px] leading-relaxed text-neutral-800 shadow-lg dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
      <img src="/chariot-logo.png" alt={firm} className="h-8 w-auto" />
      <h3 className="mt-5 text-2xl font-bold text-neutral-900 dark:text-neutral-50"><TokenText text={doc.title || "Untitled"} values={values} /></h3>
      <p className="mt-1 text-xs text-neutral-500">Prepared for {values.get("clientName")} · {values.get("date")} · Version {version}</p>
      <hr className="my-4 border-t-2 border-[#064B3E]/70" />
      {doc.intro.trim() ? <Blocks text={doc.intro} values={values} /> : null}
      {doc.sections.map((section, index) => (
        <div key={index} className="mt-4">
          {section.heading.trim() ? <h4 className="mb-1 text-sm font-bold text-[#064B3E] dark:text-emerald-300"><TokenText text={section.heading} values={values} /></h4> : null}
          <Blocks text={section.text} values={values} />
        </div>
      ))}
      <hr className="my-5 border-[#cfe0db] dark:border-neutral-800" />
      <p className="text-sm font-bold text-[#064B3E] dark:text-emerald-300">Agreement</p>
      <p className="mt-1">I confirm that I have read and understood these terms and agree to be bound by them.</p>
      <div className="mt-8 grid grid-cols-2 gap-6">
        <div className="border-t border-neutral-800 pt-1 dark:border-neutral-300">
          <p className="text-[10px] text-neutral-500">Signed by the client</p>
          <p className="text-xs">{values.get("clientName")}</p>
        </div>
        <div className="border-t border-neutral-800 pt-1 dark:border-neutral-300">
          <p className="text-[10px] text-neutral-500">Date</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The questions staff answer per case

function FieldsEditor({
  fields,
  disabled,
  onChange,
  onInsert,
}: {
  fields: TermsTemplateField[];
  disabled: boolean;
  onChange: (fields: TermsTemplateField[]) => void;
  onInsert: (token: string) => void;
}) {
  const updateField = (index: number, patch: Partial<TermsTemplateField>) => onChange(fields.map((field, at) => (at === index ? { ...field, ...patch } : field)));
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">Questions answered per case</p>
        {!disabled ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...fields, { key: "", label: "", type: "text", required: true }])}>
            <Plus /> Add question
          </Button>
        ) : null}
      </div>
      {fields.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">No questions — the document comes entirely from the case.</p>
      ) : (
        <div className="space-y-1.5">
          {fields.map((field, index) => (
            <FieldRow
              key={index}
              field={field}
              disabled={disabled}
              first={index === 0}
              last={index === fields.length - 1}
              onChange={(patch) => updateField(index, patch)}
              onMove={(delta) => {
                const target = index + delta;
                if (target < 0 || target >= fields.length) return;
                const next = [...fields];
                [next[index], next[target]] = [next[target]!, next[index]!];
                onChange(next);
              }}
              onRemove={() => onChange(fields.filter((_, at) => at !== index))}
              onInsert={() => field.key && onInsert(field.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FieldRow({
  field,
  disabled,
  first,
  last,
  onChange,
  onMove,
  onRemove,
  onInsert,
}: {
  field: TermsTemplateField;
  disabled: boolean;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<TermsTemplateField>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  onInsert: () => void;
}) {
  const [keyTouched, setKeyTouched] = useState(!!field.key);
  const [more, setMore] = useState(false);
  const options = field.options ?? [];
  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="flex items-center gap-1">
        <Input
          value={field.label}
          placeholder="Question, e.g. When is the fee payable?"
          disabled={disabled}
          aria-label="Question"
          className="h-8 min-w-[7rem] flex-1"
          onChange={(event) => onChange(keyTouched ? { label: event.target.value } : { label: event.target.value, key: slug(event.target.value) })}
        />
        <Select value={field.type} onValueChange={(value) => value && onChange({ type: value as TermsFieldType, options: value === "select" ? options : undefined })} disabled={disabled}>
          <SelectTrigger size="sm" className="w-[8.25rem] shrink-0" aria-label="Answer type"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((item) => (
              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground" title="Must be answered before the document can be sent">
          <Switch size="sm" checked={field.required} onCheckedChange={(checked) => onChange({ required: checked })} disabled={disabled} />
          Req.
        </label>
        <Button type="button" variant="ghost" size="icon-xs" disabled={disabled || !field.key} onClick={onInsert} title="Insert this answer into the text at the cursor" aria-label="Insert into text">
          <Braces />
        </Button>
        <button
          type="button"
          onClick={() => setMore((open) => !open)}
          title="Default answer, hint, name in the text"
          className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronDown className={cn("size-3 transition-transform", more && "rotate-180")} /> More
        </button>
        <span className="flex shrink-0 items-center">
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => onMove(-1)} disabled={disabled || first} aria-label="Move up"><ArrowUp /></Button>
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => onMove(1)} disabled={disabled || last} aria-label="Move down"><ArrowDown /></Button>
          <Button type="button" variant="ghost" size="icon-xs" onClick={onRemove} disabled={disabled} aria-label="Remove question"><Trash2 /></Button>
        </span>
      </div>
      {field.type === "select" ? (
        <Field className="mt-2">
          <FieldLabel className="text-xs">Choices (one per line)</FieldLabel>
          <Textarea
            value={options.join("\n")}
            disabled={disabled}
            className="min-h-[56px] text-sm"
            onChange={(event) => onChange({ options: event.target.value.split("\n") })}
            onBlur={(event) => onChange({ options: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })}
          />
        </Field>
      ) : null}
      <div>
        <Collapsible open={more} onOpenChange={setMore}>
          <CollapsibleContent>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Field>
                <FieldLabel className="text-xs">Default answer</FieldLabel>
                {field.type === "select" ? (
                  <Select value={field.defaultValue ?? ""} onValueChange={(value) => onChange({ defaultValue: value || undefined })} disabled={disabled || options.length === 0}>
                    <SelectTrigger size="sm" className="w-full"><SelectValue placeholder="First choice" /></SelectTrigger>
                    <SelectContent>
                      {options.filter(Boolean).map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === "textarea" ? (
                  <Textarea value={field.defaultValue ?? ""} disabled={disabled} className="min-h-[60px]" onChange={(event) => onChange({ defaultValue: event.target.value })} />
                ) : (
                  <Input value={field.defaultValue ?? ""} disabled={disabled} type={field.type === "date" ? "date" : "text"} className="h-8" onChange={(event) => onChange({ defaultValue: event.target.value })} />
                )}
              </Field>
              <Field>
                <FieldLabel className="text-xs">Hint shown to staff</FieldLabel>
                <Input value={field.hint ?? ""} disabled={disabled} className="h-8" onChange={(event) => onChange({ hint: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel className="text-xs">Name in the text</FieldLabel>
                <Input
                  value={field.key}
                  placeholder="feePayable"
                  disabled={disabled}
                  className="h-8 font-mono"
                  onChange={(event) => {
                    setKeyTouched(true);
                    onChange({ key: event.target.value.replace(/[^a-zA-Z0-9_]/g, "") });
                  }}
                />
              </Field>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}

/** DocuSign's brand mark, simplified: the bold "d" on its purple. */
function DocusignMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M13.2 3.5h-3v7.4a4.1 4.1 0 1 0 3 3.95V3.5Zm-1.5 9.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z" />
      <path d="M5 19.3h14v1.6H5z" />
    </svg>
  );
}

const MODE_LABEL = { off: "Not connected", mock: "Mock (development)", docusign: "Connected" } as const;

/**
 * The signature provider. The firm registers Chariot as a DocuSign app once
 * (two env vars); an administrator then signs in to the firm's DocuSign
 * account here and every case's terms go out from it.
 */
function DocusignCard({ isAdmin, signature }: { isAdmin: boolean; signature: SignatureConfig | null }) {
  const qc = useQueryClient();
  const test = useTestDocusignConnection();
  const disconnect = useDisconnectDocusign();
  const [result, setResult] = useState<DocusignTestResult | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const search = useSearch();
  const mode = signature?.mode ?? "off";

  // Coming back from DocuSign: `?docusign=connected` or `?docusign=error&reason=…`.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const outcome = params.get("docusign");
    if (!outcome) return;
    if (outcome === "connected") toast.add({ title: "DocuSign connected", type: "success" });
    else toast.add({ title: "DocuSign sign-in failed", description: params.get("reason") ?? undefined, type: "error" });
    qc.invalidateQueries({ queryKey: getGetTermsOfBusinessQueryKey() });
    window.history.replaceState(null, "", "/settings?tab=terms-of-business");
  }, [search, qc]);

  const connection = signature?.connection ?? null;
  return (
    <Card className="gap-0 border-violet-200/70 bg-violet-50/60 py-0 dark:border-violet-900/60 dark:bg-violet-950/20">
      <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#4C00FF] text-white shadow-sm">
            <DocusignMark className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              DocuSign
              <Badge variant={mode === "docusign" ? "default" : mode === "mock" ? "secondary" : "outline"}>{MODE_LABEL[mode]}</Badge>
            </h2>
            {!signature ? (
              <Skeleton className="h-4 w-64" />
            ) : !signature.appRegistered && mode !== "mock" ? (
              <p className="text-sm text-muted-foreground">
                Not set up yet — register Chariot as a DocuSign app and set <code className="rounded bg-muted px-1">DOCUSIGN_INTEGRATION_KEY</code> and <code className="rounded bg-muted px-1">DOCUSIGN_SECRET_KEY</code> on the API
                {signature.redirectUri ? <> (redirect URI <code className="break-all rounded bg-muted px-1">{signature.redirectUri}</code>)</> : null}.
              </p>
            ) : mode === "mock" ? (
              <p className="text-sm text-muted-foreground">Envelopes are simulated in this process (<code className="rounded bg-muted px-1">DOCUSIGN_MOCK=true</code>): nothing is emailed, and a "Simulate signature" button on each case stands in for the client.</p>
            ) : connection ? (
              <>
                <p className="text-sm">
                  Signed in as <span className="font-medium">{connection.userName}</span> ({connection.email}) · account "{connection.account}"
                </p>
                <p className="text-xs text-muted-foreground">
                  Connected {formatDate(connection.connectedAt)}{connection.connectedBy ? ` by ${connection.connectedBy}` : ""} · {signature.oauthHost === "account.docusign.com" ? "production" : "developer sandbox"}
                  {signature.webhookUrl ? " · instant updates via webhook" : " · status polled every 15 minutes"}{signature.hmacEnabled ? " · HMAC verified" : ""}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{isAdmin ? "Sign in to the firm's DocuSign account to start sending documents for signature." : "An administrator needs to sign in to the firm's DocuSign account."}</p>
            )}
            {result ? (
              <p className={result.ok ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-destructive"}>
                {result.ok ? `Working: ${result.account}${result.email ? ` (${result.email})` : ""}` : result.error}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {isAdmin && signature && mode !== "mock" ? (
            connection ? (
              <>
                <Button
                  variant="outline"
                  disabled={test.isPending}
                  onClick={() => test.mutate(undefined, { onSuccess: setResult, onError: (error) => setResult({ ok: false, mode, account: null, email: null, baseUri: null, error: apiErrorMessage(error, "The test failed") }) })}
                >
                  {test.isPending ? "Testing…" : "Test connection"}
                </Button>
                <Button variant="outline" onClick={() => setDisconnectOpen(true)} disabled={disconnect.isPending}>
                  <Unplug /> Disconnect
                </Button>
              </>
            ) : (
              <Button className="bg-[#4C00FF] text-white hover:bg-[#3d00cc]" disabled={!signature.appRegistered} onClick={() => window.location.assign("/api/settings/docusign/connect")} title={signature.appRegistered ? undefined : "Set DOCUSIGN_INTEGRATION_KEY and DOCUSIGN_SECRET_KEY first"}>
                <LogIn /> Connect DocuSign
              </Button>
            )
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Disconnect DocuSign?"
        description="Documents can't be sent or tracked until an account is connected again."
        actionLabel="Disconnect"
        destructive
        onConfirm={() =>
          disconnect.mutate(undefined, {
            onSuccess: () => {
              setResult(null);
              qc.invalidateQueries({ queryKey: getGetTermsOfBusinessQueryKey() });
              toast.add({ title: "DocuSign disconnected", type: "success" });
            },
            onError: (error) => toast.add({ title: "Couldn't disconnect", description: apiErrorMessage(error, "Please try again"), type: "error" }),
          })
        }
      />
    </Card>
  );
}
