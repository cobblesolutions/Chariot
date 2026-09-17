import { Check, FileSignature, Mail } from "lucide-react";
import type { PortalTermsOfBusiness } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { previewDocument } from "@/components/document-preview";
import { cn, formatDate } from "@/lib/utils";

/**
 * The Terms of Business line on a portal case card: waiting for the client's
 * signature (DocuSign emails them the request), or signed with a link to
 * their copy. Nothing shows until the firm has sent it.
 */
export function PortalTermsBlock({ caseId, terms }: { caseId: number; terms: PortalTermsOfBusiness }) {
  if (!terms.status || terms.status === "draft") return null;
  const href = `/api/portal/cases/${caseId}/terms-of-business/document`;
  const signed = terms.status === "signed";
  const waiting = terms.status === "sent";
  const title = terms.title ?? "Terms of Business";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm",
        signed
          ? "border-emerald-200/70 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20"
          : waiting
            ? "border-amber-200/70 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20"
            : "bg-muted/40",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {signed ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : waiting ? <Mail className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <FileSignature className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0">
          <p className="font-medium">
            {signed ? `${title} signed` : waiting ? `${title} — please sign` : `${title} — ${terms.status}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {signed
              ? `Signed ${formatDate(terms.signedAt ?? "")}. Your copy is below.`
              : waiting
                ? `We emailed you a DocuSign request on ${formatDate(terms.sentAt ?? "")}. Please open it and sign; we cannot proceed until it is back.`
                : terms.status === "declined"
                  ? "You declined to sign. Your adviser will be in touch with a revised version."
                  : "This request was withdrawn; a new version will follow if needed."}
          </p>
        </div>
      </div>
      {terms.hasDocument ? (
        <Button type="button" variant="outline" size="sm" onClick={() => previewDocument(href, title, href)}>
          {signed ? "Your signed copy" : "Read the document"}
        </Button>
      ) : null}
    </div>
  );
}
