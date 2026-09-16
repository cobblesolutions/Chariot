import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquareText } from "lucide-react";
import {
  useRespondPortalApproval,
  getListPortalCasesQueryKey,
  type ClientApproval,
  type SubmissionPack,
} from "@workspace/api-client-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { SubmissionPackView } from "@/components/case/submission-details-panel";

const money = (value: unknown) =>
  typeof value === "number" ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value) : null;

/**
 * "Action needed" on a portal case card: the advice or the submission
 * details the adviser sent, with Approve / Confirm and a way to say no.
 */
export function PortalApprovalBlock({ approval }: { approval: ClientApproval }) {
  const qc = useQueryClient();
  const respond = useRespondPortalApproval();
  const [discussing, setDiscussing] = useState(false);
  const [note, setNote] = useState("");
  const isAdvice = approval.kind === "advice";
  const snapshot = approval.snapshot as Record<string, unknown>;

  const submit = (response: "approved" | "discuss") =>
    respond.mutate(
      { id: approval.id, data: { response, note: note.trim() || undefined } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListPortalCasesQueryKey() });
          toast.add({
            title: response === "approved" ? "Thank you — recorded" : "We'll be in touch",
            description: response === "approved"
              ? `Your ${isAdvice ? "approval" : "confirmation"} has been passed to your adviser.`
              : "Your adviser will contact you to talk it through.",
            type: "success",
          });
        },
        onError: (error) =>
          toast.add({
            title: "Couldn't record your answer",
            description: (error as { data?: { error?: string } })?.data?.error ?? "Please try again.",
            type: "error",
          }),
      },
    );

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Action needed</p>
        <p className="text-sm font-medium">
          {isAdvice ? "Please review our recommendation" : "Please confirm your details before we submit"}
        </p>
      </div>

      {isAdvice ? (
        <div className="space-y-2 text-sm">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
            {[
              ["Lender", snapshot.lender as string | null],
              ["Product", snapshot.product as string | null],
              ["Rate", snapshot.ratePct != null ? `${snapshot.ratePct}%` : null],
              ["Term", snapshot.termYears != null ? `${snapshot.termYears} years` : null],
              ["Monthly payment", money(snapshot.monthlyPayment)],
              ["Arrangement fee", money(snapshot.arrangementFee)],
            ]
              .filter((row): row is [string, string] => !!row[1])
              .map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
          </dl>
          {typeof snapshot.summary === "string" && snapshot.summary ? (
            <blockquote className="border-l-2 pl-3 leading-relaxed">{snapshot.summary}</blockquote>
          ) : null}
        </div>
      ) : (
        <SubmissionPackView pack={approval.snapshot as unknown as SubmissionPack} compact />
      )}

      {discussing ? (
        <Field>
          <FieldLabel htmlFor={`approval-note-${approval.id}`}>{isAdvice ? "What would you like to discuss?" : "What is wrong?"}</FieldLabel>
          <Textarea
            id={`approval-note-${approval.id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-20 bg-background"
            autoFocus
          />
        </Field>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {discussing ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setDiscussing(false)}>Back</Button>
            <Button size="sm" variant="secondary" disabled={respond.isPending} onClick={() => submit("discuss")}>
              <MessageSquareText /> {respond.isPending ? "Sending…" : "Send to my adviser"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => setDiscussing(true)}>
              <MessageSquareText /> {isAdvice ? "Ask for a discussion" : "Something is wrong"}
            </Button>
            <Button size="sm" disabled={respond.isPending} onClick={() => submit("approved")}>
              <Check /> {respond.isPending ? "Recording…" : isAdvice ? "Approve" : "Confirm"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
