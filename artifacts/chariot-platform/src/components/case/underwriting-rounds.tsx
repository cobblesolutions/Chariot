import { useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useExtractUnderwritingRequirements,
  useAddUnderwritingRound,
  getGetCaseQueryKey,
  getListTasksQueryKey,
  type CaseDetail,
} from "@workspace/api-client-react";
import { Check, ChevronRight, ClipboardPaste, ListChecks, ListTodo, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AiProgressButton } from "@/components/ai-progress-button";
import { AI_PROGRESS_HEADER, newProgressToken } from "@/lib/ai-progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { apiErrorMessage } from "@/components/add/utils";
import { cn, formatDate } from "@/lib/utils";

type Round = CaseDetail["underwritingRounds"][number];

/**
 * The underwriting stage as one loop with the lender: paste their email →
 * provide what they asked for (a task per round, one checkbox each) → mark
 * the round sent → repeat if they come back → mark underwriting complete.
 * The strip at the top says which of those you are on right now.
 */
export function UnderwritingPanel({
  caseId,
  submissionId,
  rounds: allRounds,
  underwritingCleared,
  canEdit,
  onToggle,
  onMarkSent,
  sending,
  onToggleCleared,
}: {
  caseId: number;
  /** The lender submission in view; rounds of other lenders are hidden. */
  submissionId: number | null;
  rounds: Round[];
  underwritingCleared: boolean;
  canEdit: boolean;
  onToggle: (requirementId: number, checked: boolean) => void;
  onMarkSent: (round: number) => void;
  sending: boolean;
  onToggleCleared: (checked: boolean) => void;
}) {
  const rounds = allRounds.filter((round) => round.submissionId === submissionId);
  const latest = rounds[rounds.length - 1] ?? null;
  const openRound = latest && !latest.sentAt ? latest : null;
  const pastRounds = rounds.filter((round) => round !== openRound);
  const openDone = openRound ? openRound.requirements.filter((r) => r.complete).length : 0;
  const openTotal = openRound ? openRound.requirements.length : 0;
  const openAllDone = !!openRound && openTotal > 0 && openDone === openTotal;

  // Which step of the loop the case is on.
  const step: 1 | 2 | 3 | 4 = underwritingCleared ? 4 : !openRound ? 1 : openAllDone ? 3 : 2;
  const latestSentAndComplete = !!latest && !!latest.sentAt;

  return (
    <div className="flex flex-col">
      <FlowStrip step={step} roundNumber={openRound?.round ?? rounds.length + 1} done={openDone} total={openTotal} hasRounds={rounds.length > 0} cleared={underwritingCleared} />

      {step === 1 && canEdit && !underwritingCleared ? (
        <PasteBox caseId={caseId} submissionId={submissionId} nextRound={rounds.length + 1} />
      ) : null}

      {openRound ? (
        <OpenRoundCard round={openRound} canEdit={canEdit} onToggle={onToggle} onMarkSent={onMarkSent} sending={sending} />
      ) : null}

      {pastRounds.length > 0 ? (
        <div className="border-t">
          <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {openRound ? "Earlier rounds" : "Rounds sent to the lender"}
          </p>
          {pastRounds.slice().reverse().map((round) => (
            <PastRound key={round.round} round={round} />
          ))}
        </div>
      ) : null}

      {rounds.length > 0 ? (
        <label
          className={cn(
            "flex items-start gap-3 border-t px-4 py-4",
            canEdit && (latestSentAndComplete || underwritingCleared) ? "cursor-pointer" : "opacity-70",
          )}
        >
          <Checkbox
            className="mt-0.5"
            checked={underwritingCleared}
            onCheckedChange={(checked) => onToggleCleared(checked === true)}
            disabled={!canEdit || (!underwritingCleared && !latestSentAndComplete)}
          />
          <span className="text-sm font-semibold">
            Underwriting complete — the lender is satisfied
            {!latestSentAndComplete && !underwritingCleared ? (
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                Available once the current round has been sent to the lender.
              </span>
            ) : !underwritingCleared ? (
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                Tick this when the lender confirms they need nothing more; if they come back, paste their email above instead.
              </span>
            ) : null}
          </span>
        </label>
      ) : null}
    </div>
  );
}

const STEPS = [
  { n: 1, icon: ClipboardPaste, label: "Paste the lender's email" },
  { n: 2, icon: ListChecks, label: "Provide what they asked for" },
  { n: 3, icon: Send, label: "Send it back to the lender" },
] as const;

function FlowStrip({ step, roundNumber, done, total, hasRounds, cleared }: { step: 1 | 2 | 3 | 4; roundNumber: number; done: number; total: number; hasRounds: boolean; cleared: boolean }) {
  const hint =
    cleared ? "Underwriting complete."
    : step === 1 ? (hasRounds ? `Round ${roundNumber - 1} is with the lender. If they come back with more, paste their email to start round ${roundNumber}.` : "Start with the lender's underwriting email.")
    : step === 2 ? `Round ${roundNumber}: ${done} of ${total} provided — tick each item as it goes in.`
    : `Round ${roundNumber}: everything is provided — send it and mark the round sent.`;
  return (
    <div className="border-b bg-muted/20 px-4 py-3">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {STEPS.map((item, index) => {
          const state = cleared ? "done" : item.n < step ? "done" : item.n === step ? "current" : "todo";
          const Icon = item.icon;
          return (
            <li key={item.n} className="flex items-center gap-1">
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                  state === "current" && "border-primary bg-primary text-primary-foreground",
                  state === "done" && "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400",
                  state === "todo" && "border-border bg-card text-muted-foreground",
                )}
              >
                {state === "done" ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                {item.label}
              </span>
              {index < STEPS.length - 1 ? <ChevronRight className="size-3.5 text-muted-foreground/60" /> : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Step 1: paste → read → review the list → create the round's task. */
function PasteBox({ caseId, submissionId, nextRound }: { caseId: number; submissionId: number | null; nextRound: number }) {
  const qc = useQueryClient();
  const progressHeaders = useRef<Record<string, string>>({});
  const [progressToken, setProgressToken] = useState<string | null>(null);
  const extract = useExtractUnderwritingRequirements({ request: { headers: progressHeaders.current } });
  const create = useAddUnderwritingRound();
  const [email, setEmail] = useState("");
  const [items, setItems] = useState<string[] | null>(null);
  const [model, setModel] = useState<string | null>(null);

  const read = () => {
    const token = newProgressToken();
    progressHeaders.current[AI_PROGRESS_HEADER] = token;
    setProgressToken(token);
    extract.mutate({ id: caseId, data: { emailText: email } }, {
      onSuccess: (data) => { setItems(data.suggestions); setModel(data.model ?? null); },
      onError: (error) => toast.add({ title: "Couldn't read the email", description: apiErrorMessage(error, "Please try again."), type: "error" }),
    });
  };
  const confirm = () =>
    create.mutate({ id: caseId, data: { submissionId, emailText: email, requirementLabels: items ?? [] } }, {
      onSuccess: () => {
        toast.add({ title: `Round ${nextRound} created — task sent to the case handler`, type: "success" });
        setEmail(""); setItems(null);
        qc.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
      },
      onError: (error) => toast.add({ title: "Couldn't create the round", description: apiErrorMessage(error, "Please try again."), type: "error" }),
    });

  return (
    <div className="space-y-3 border-b p-4">
      {items === null ? (
        <>
          <Textarea
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={`Paste the lender's email for round ${nextRound} here…`}
            className="min-h-28 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Each thing they ask for becomes a checkbox on a task for the case handler.</p>
            <AiProgressButton size="sm" onClick={read} disabled={!email.trim()} busy={extract.isPending} kind="underwriting" token={progressToken}>
              Read the email
            </AiProgressButton>
          </div>
        </>
      ) : (
        <div className="space-y-2 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {items.length ? `${items.length} thing${items.length === 1 ? "" : "s"} the lender asked for` : "Nothing recognised"}
            </p>
            <span className="text-xs text-muted-foreground">{model ? "Read by AI — check the wording" : "Read line by line — check the wording"}</span>
          </div>
          {items.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">Edit the email text, or add the items by hand below.</p>
          ) : null}
          <ul className="space-y-1.5">
            {items.map((item, index) => (
              <li key={index} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{index + 1}.</span>
                <Input value={item} onChange={(e) => setItems((cur) => cur ? cur.map((x, i) => (i === index ? e.target.value : x)) : cur)} />
                <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label="Remove" onClick={() => setItems((cur) => cur ? cur.filter((_, i) => i !== index) : cur)}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setItems((cur) => [...(cur ?? []), ""])}>+ Add an item</Button>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setItems(null)}>Back</Button>
            <Button size="sm" onClick={confirm} disabled={!items.some((x) => x.trim()) || create.isPending}>
              <ListTodo /> {create.isPending ? "Creating…" : `Create round ${nextRound} task`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function OpenRoundCard({ round, canEdit, onToggle, onMarkSent, sending }: { round: Round; canEdit: boolean; onToggle: (id: number, checked: boolean) => void; onMarkSent: (round: number) => void; sending: boolean }) {
  const done = round.requirements.filter((r) => r.complete).length;
  const total = round.requirements.length;
  const allDone = total > 0 && done === total;
  return (
    <section className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Round {round.round} · what the lender asked for</p>
          <p className="text-xs text-muted-foreground">From their email of {formatDate(round.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={allDone ? "outline" : "secondary"} className={cn(allDone && "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400")}>
            {done}/{total} provided
          </Badge>
          {round.taskId != null ? (
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href={`/tasks?task=${round.taskId}`}><ListTodo /> Open task</Link>
            </Button>
          ) : null}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", allDone ? "bg-emerald-500" : "bg-primary")} style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {round.requirements.map((req) => (
          <li key={req.id}>
            <label className={cn("flex items-start gap-3 px-3 py-2.5", canEdit ? "cursor-pointer hover:bg-muted/40" : "opacity-80")}>
              <Checkbox className="mt-0.5" checked={req.complete} disabled={!canEdit} onCheckedChange={(checked) => onToggle(req.id, checked === true)} />
              <span className={cn("text-sm leading-snug", req.complete ? "text-muted-foreground line-through decoration-muted-foreground/40" : "text-foreground")}>{req.label}</span>
            </label>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5", allDone ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-dashed")}>
          <p className="text-sm text-muted-foreground">
            {allDone ? "All provided. Send it to the lender, then mark the round sent." : `${total - done} still to provide before this round can go back.`}
          </p>
          <Button size="sm" disabled={!allDone || sending} onClick={() => onMarkSent(round.id)}>
            <Send /> {sending ? "Saving…" : "Mark sent to lender"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function PastRound({ round }: { round: Round }) {
  const total = round.requirements.length;
  return (
    <details className="group border-b last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/30">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="font-medium">Round {round.round}</span>
        <span className="text-muted-foreground">{total} item{total === 1 ? "" : "s"}</span>
        <Badge variant="outline" className="ml-auto gap-1 border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400">
          <Send className="size-3" /> Sent {formatDate(round.sentAt)}{round.sentBy ? ` · ${round.sentBy}` : ""}
        </Badge>
      </summary>
      <ul className="mx-4 mb-3 divide-y rounded-lg border bg-muted/20">
        {round.requirements.map((req) => (
          <li key={req.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
            <Check className="size-3.5 text-emerald-600" /> {req.label}
          </li>
        ))}
      </ul>
    </details>
  );
}
