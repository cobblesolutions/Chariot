import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import {
  useGetEmailTemplate,
  useUpdateEmailTemplate,
  useResetEmailTemplate,
  usePreviewEmailTemplate,
  getGetEmailTemplateQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/components/auth-provider";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { isFullAccess } from "@/lib/roles";
import { apiErrorMessage } from "./utils";

type TemplateKey = "client_welcome" | "advice_email" | "details_confirmation";
const TITLES: Record<TemplateKey, { title: string; blurb: string }> = {
  client_welcome: { title: "Welcome email", blurb: 'Sent when an enquiry is accepted. Change the words here — the logo, colours and the "Set up portal access" button are fixed.' },
  advice_email: { title: "Advice email", blurb: "Sent with the recommendation. The advice table and the Approve / Further discussion buttons are fixed; the words around them are yours." },
  details_confirmation: { title: "Details confirmation email", blurb: 'Sent with the submission details. The details table and the "Confirm my details" button are fixed; the words around them are yours.' },
};
/** The email shell is laid out at this width; the preview scales it down to fit. */
const EMAIL_WIDTH = 600;
const EMAIL_HEIGHT = 900;

function ScaledEmailPreview({ html }: { html: string | null }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const update = () => setScale(Math.min(1, box.clientWidth / EMAIL_WIDTH));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={boxRef}
      className="overflow-hidden rounded-lg border bg-[#EEF1EF]"
      style={{ height: Math.round(EMAIL_HEIGHT * scale) }}
    >
      {html ? (
        <iframe
          title="Welcome email preview"
          srcDoc={html}
          sandbox=""
          className="origin-top-left border-0 bg-transparent"
          style={{ width: EMAIL_WIDTH, height: EMAIL_HEIGHT, transform: `scale(${scale})` }}
        />
      ) : (
        <Skeleton className="h-full w-full" />
      )}
    </div>
  );
}

/**
 * Edit the words of the welcome email — subject, heading and body — with a
 * live preview inside the fixed branded layout. Placeholders fill in from
 * the client at send time. Saving is for administrators; everyone can look.
 */
export function WelcomeTemplateDialog({
  open,
  onOpenChange,
  /** Preview with this client's real details instead of sample ones. */
  clientId,
  templateKey = "client_welcome",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId?: number | null;
  templateKey?: TemplateKey;
}) {
  const KEY = templateKey;
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = isFullAccess(user?.role);
  const template = useGetEmailTemplate(KEY, {
    query: { queryKey: getGetEmailTemplateQueryKey(KEY), enabled: open },
  });
  const save = useUpdateEmailTemplate();
  const reset = useResetEmailTemplate();
  const preview = usePreviewEmailTemplate();

  const [subject, setSubject] = useState("");
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [html, setHtml] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const seeded = useRef<string | null>(null);

  // Seed the form from the server once per open (and after a reset).
  useEffect(() => {
    if (!open) {
      seeded.current = null;
      return;
    }
    const data = template.data;
    if (!data) return;
    const stamp = `${data.updatedAt ?? "default"}:${data.isDefault}`;
    if (seeded.current === stamp) return;
    seeded.current = stamp;
    setSubject(data.subject);
    setHeading(data.heading);
    setBody(data.body);
  }, [open, template.data]);

  // Live preview, a moment after typing stops.
  useEffect(() => {
    if (!open || !subject.trim() || !heading.trim() || !body.trim()) return;
    const timer = setTimeout(() => {
      preview.mutate(
        { key: KEY, data: { subject, heading, body, clientId: clientId ?? null } },
        { onSuccess: (result) => setHtml(result.html) },
      );
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subject, heading, body, clientId]);

  const dirty =
    !!template.data &&
    (subject !== template.data.subject || heading !== template.data.heading || body !== template.data.body);

  const insertPlaceholder = (token: string) => {
    const el = bodyRef.current;
    if (!el) {
      setBody((current) => `${current}${token}`);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${token}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const handleSave = () => {
    save.mutate(
      { key: KEY, data: { subject: subject.trim(), heading: heading.trim(), body: body.trim() } },
      {
        onSuccess: (saved) => {
          qc.setQueryData(getGetEmailTemplateQueryKey(KEY), saved);
          toast.add({ title: "Welcome email saved", type: "success" });
          onOpenChange(false);
        },
        onError: (error) =>
          toast.add({ title: "Couldn't save the template", description: apiErrorMessage(error, "Please try again."), type: "error" }),
      },
    );
  };

  const handleReset = () => {
    reset.mutate(
      { key: KEY },
      {
        onSuccess: (restored) => {
          qc.setQueryData(getGetEmailTemplateQueryKey(KEY), restored);
          seeded.current = `${restored.updatedAt ?? "default"}:${restored.isDefault}`;
          setSubject(restored.subject);
          setHeading(restored.heading);
          setBody(restored.body);
          setResetOpen(false);
          toast.add({ title: "Default text restored", type: "success" });
        },
        onError: (error) =>
          toast.add({ title: "Couldn't reset the template", description: apiErrorMessage(error, "Please try again."), type: "error" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{TITLES[KEY].title}</DialogTitle>
          <DialogDescription>{TITLES[KEY].blurb}</DialogDescription>
        </DialogHeader>

        {template.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <fieldset disabled={!canEdit} className="min-w-0 space-y-4">
              <Field>
                <FieldLabel htmlFor="tpl-subject">Subject</FieldLabel>
                <Input id="tpl-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="tpl-heading">Heading</FieldLabel>
                <Input id="tpl-heading" value={heading} onChange={(event) => setHeading(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="tpl-body">Body</FieldLabel>
                <Textarea
                  id="tpl-body"
                  ref={bodyRef}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  className="min-h-64 font-sans text-sm leading-relaxed"
                />
                <p className="text-xs text-muted-foreground">
                  Leave a blank line between paragraphs. Click a placeholder to insert it where the cursor is.
                </p>
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {(template.data?.placeholders ?? []).map((item) => (
                  <button
                    key={item.token}
                    type="button"
                    onClick={() => insertPlaceholder(item.token)}
                    title={item.description}
                    className="rounded-md border bg-muted/40 px-2 py-0.5 font-mono text-xs text-foreground/80 hover:bg-muted"
                  >
                    {item.token}
                  </button>
                ))}
              </div>
              {!canEdit ? (
                <p className="text-xs text-muted-foreground">Only an administrator can change the text.</p>
              ) : template.data && !template.data.isDefault ? (
                <p className="text-xs text-muted-foreground">
                  Last changed {template.data.updatedBy ? `by ${template.data.updatedBy}` : ""}
                  {template.data.updatedAt ? ` on ${new Date(template.data.updatedAt).toLocaleDateString("en-GB")}` : ""}.
                </p>
              ) : null}
            </fieldset>

            <div className="min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preview</span>
                {template.data?.isDefault ? <Badge variant="outline">Default text</Badge> : <Badge variant="secondary">Custom text</Badge>}
              </div>
              <ScaledEmailPreview html={html} />
              <p className="truncate text-xs text-muted-foreground" title={subject}>
                Subject: {subject || "—"}
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          {canEdit && template.data && !template.data.isDefault ? (
            <Button type="button" variant="ghost" onClick={() => setResetOpen(true)} disabled={reset.isPending}>
              <RotateCcw /> Reset to default
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {canEdit ? "Cancel" : "Close"}
            </Button>
            {canEdit ? (
              <Button
                type="button"
                disabled={!dirty || save.isPending || !subject.trim() || !heading.trim() || !body.trim()}
                onClick={handleSave}
              >
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
        <ConfirmDialog
          open={resetOpen}
          onOpenChange={setResetOpen}
          title="Reset to the default text?"
          description="Your wording is discarded and the built-in welcome email is used again."
          actionLabel="Reset"
          destructive
          onConfirm={handleReset}
        />
      </DialogContent>
    </Dialog>
  );
}
