import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  getListClientInteractionsQueryKey,
  useListClientInteractions,
  type ClientInteraction,
} from "@workspace/api-client-react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAuth } from "@/components/auth-provider";
import { isFullAccess } from "@/lib/roles";
import { relativeTime } from "./client-model";
import { useClientMutations } from "./use-client-mutations";

/** Textarea that saves on ⌘↵ and cancels on Escape. */
function NoteEditor({
  initial = "",
  placeholder,
  pending,
  onSave,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  pending?: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(text.length, text.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = () => {
    const value = text.trim();
    if (value) onSave(value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <div className="space-y-2">
      <Textarea
        ref={ref}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={3}
        className="min-h-20 resize-none"
        aria-label="Note"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={!text.trim() || pending}>
          Save
        </Button>
      </div>
    </div>
  );
}

function NoteItem({
  note,
  canEdit,
  onEdit,
  onDelete,
}: {
  note: ClientInteraction;
  canEdit: boolean;
  onEdit: (text: string, done: () => void) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const mutations = useClientMutations();
  if (editing) {
    return (
      <NoteEditor
        initial={note.summary}
        placeholder="Edit note"
        pending={mutations.isEditingInteraction}
        onSave={(text) => onEdit(text, () => setEditing(false))}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <div className="group/note -mx-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
      <p className="text-sm whitespace-pre-wrap">{note.summary}</p>
      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground/80">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              {note.createdByName} · {relativeTime(note.occurredAt)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{formatDate(note.occurredAt)}</TooltipContent>
        </Tooltip>
        {canEdit && (
          <span className="ml-auto flex items-center opacity-0 transition-opacity group-hover/note:opacity-100 focus-within:opacity-100">
            <Button variant="ghost" size="icon-xs" onClick={() => setEditing(true)} aria-label="Edit note">
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={() => setConfirm(true)} aria-label="Delete note">
              <Trash2 />
            </Button>
          </span>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this note?"
        description="It is removed from the client's timeline as well."
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          setConfirm(false);
          onDelete();
        }}
      />
    </div>
  );
}

/**
 * Free-form notes on the client: add, edit and delete. Notes are `note`-kind
 * interactions, so they also appear in the timeline and the Interactions tab.
 */
export function ClientNotes({ clientId, className }: { clientId: number; className?: string }) {
  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);
  const mutations = useClientMutations();
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useListClientInteractions(clientId, {
    query: { queryKey: getListClientInteractionsQueryKey(clientId) },
  });
  const notes = (data ?? []).filter((item) => item.kind === "note");

  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex h-6 items-center gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Notes</h3>
        {notes.length > 0 && <span className="text-xs tabular-nums text-muted-foreground/70">{notes.length}</span>}
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setAdding(true)} disabled={adding}>
          <Plus /> Add
        </Button>
      </div>
      {adding && (
        <NoteEditor
          placeholder="Write a note about this client"
          pending={mutations.isLogging}
          onSave={(text) =>
            mutations.addInteraction({ id: clientId }, { kind: "note", summary: text }, { onSuccess: () => setAdding(false) })
          }
          onCancel={() => setAdding(false)}
        />
      )}
      {isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : notes.length === 0 && !adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-full rounded-md border border-dashed px-3 py-2 text-left text-sm text-muted-foreground hover:border-primary/40 hover:bg-muted/40"
        >
          Add a note about this client
        </button>
      ) : (
        <div className="space-y-1">
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              canEdit={isAdmin || note.createdByUserId === user?.id}
              onEdit={(text, done) => mutations.updateInteraction(clientId, note.id, { summary: text }, { onSuccess: done })}
              onDelete={() => mutations.deleteInteraction(clientId, note.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
