import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  activitiesTable,
  appUsersTable,
  casesTable,
  clientEnquiriesTable,
  clientInteractionsTable,
  clientsTable,
  db,
  documentsTable,
  portalInvitationsTable,
  tasksTable,
  type InteractionKind,
} from "@workspace/db";
import type { ClientRow } from "./clients";

const iso = (value: Date) => value.toISOString();

export const INTERACTION_LABELS: Record<InteractionKind, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
};

type InteractionRow = typeof clientInteractionsTable.$inferSelect;

export interface ClientInteractionView {
  id: number;
  clientId: number;
  caseId: number | null;
  kind: InteractionKind;
  summary: string;
  occurredAt: string;
  createdByUserId: number | null;
  createdByName: string;
  createdAt: string;
}

async function staffNames(ids: Array<number | null | undefined>) {
  const unique = Array.from(new Set(ids.filter((id): id is number => id != null)));
  if (unique.length === 0) return new Map<number, string>();
  const users = await db
    .select({ id: appUsersTable.id, displayName: appUsersTable.displayName })
    .from(appUsersTable)
    .where(inArray(appUsersTable.id, unique));
  return new Map(users.map((user) => [user.id, user.displayName]));
}

function interactionView(row: InteractionRow, names: Map<number, string>): ClientInteractionView {
  return {
    id: row.id,
    clientId: row.clientId,
    caseId: row.caseId ?? null,
    kind: row.kind as InteractionKind,
    summary: row.summary,
    occurredAt: iso(row.occurredAt),
    createdByUserId: row.createdByUserId ?? null,
    createdByName: (row.createdByUserId != null && names.get(row.createdByUserId)) || "Staff",
    createdAt: iso(row.createdAt),
  };
}

export async function listInteractions(clientId: number): Promise<ClientInteractionView[]> {
  const rows = await db
    .select()
    .from(clientInteractionsTable)
    .where(eq(clientInteractionsTable.clientId, clientId))
    .orderBy(desc(clientInteractionsTable.occurredAt), desc(clientInteractionsTable.id));
  const names = await staffNames(rows.map((row) => row.createdByUserId));
  return rows.map((row) => interactionView(row, names));
}

/**
 * Log a touchpoint. Also moves the client's last-contacted time forward and,
 * when the caller sets one, the next follow-up date; the activity feed gets a
 * row so the interaction shows up on the global activity page too.
 */
export async function createInteraction(
  client: ClientRow,
  input: {
    kind: InteractionKind;
    summary: string;
    occurredAt?: Date;
    caseId?: number | null;
    nextFollowUpAt?: string | null;
  },
  actor: { id: number; displayName: string },
): Promise<ClientInteractionView> {
  const occurredAt = input.occurredAt ?? new Date();
  const [created] = await db
    .insert(clientInteractionsTable)
    .values({
      clientId: client.id,
      caseId: input.caseId ?? null,
      kind: input.kind,
      summary: input.summary.trim(),
      occurredAt,
      createdByUserId: actor.id,
    })
    .returning();
  if (!created) throw new Error("Interaction was not created");
  const lastContactedAt =
    client.lastContactedAt && client.lastContactedAt > occurredAt ? client.lastContactedAt : occurredAt;
  await db
    .update(clientsTable)
    .set({
      lastContactedAt,
      ...(input.nextFollowUpAt !== undefined ? { nextFollowUpAt: input.nextFollowUpAt } : {}),
    })
    .where(eq(clientsTable.id, client.id));
  await db.insert(activitiesTable).values({
    caseId: input.caseId ?? null,
    title: `${INTERACTION_LABELS[input.kind]} logged`,
    detail: `${client.name}: ${created.summary}`,
    actorName: actor.displayName,
    entityType: "client",
    entityId: client.id,
    occurredAt,
  });
  return interactionView(created, new Map([[actor.id, actor.displayName]]));
}

export async function findInteraction(clientId: number, interactionId: number) {
  const [row] = await db
    .select()
    .from(clientInteractionsTable)
    .where(and(eq(clientInteractionsTable.id, interactionId), eq(clientInteractionsTable.clientId, clientId)));
  return row ?? null;
}

export async function updateInteraction(
  row: InteractionRow,
  input: { kind?: InteractionKind; summary?: string },
): Promise<ClientInteractionView> {
  const [updated] = await db
    .update(clientInteractionsTable)
    .set({
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.summary !== undefined ? { summary: input.summary.trim() } : {}),
    })
    .where(eq(clientInteractionsTable.id, row.id))
    .returning();
  if (!updated) throw new Error("Interaction was not updated");
  const names = await staffNames([updated.createdByUserId]);
  return interactionView(updated, names);
}

export async function deleteInteraction(row: InteractionRow) {
  await db.delete(clientInteractionsTable).where(eq(clientInteractionsTable.id, row.id));
  // Keep last-contacted honest when the newest touchpoint is removed.
  const [latest] = await db
    .select({ occurredAt: clientInteractionsTable.occurredAt })
    .from(clientInteractionsTable)
    .where(eq(clientInteractionsTable.clientId, row.clientId))
    .orderBy(desc(clientInteractionsTable.occurredAt))
    .limit(1);
  await db
    .update(clientsTable)
    .set({ lastContactedAt: latest?.occurredAt ?? null })
    .where(eq(clientsTable.id, row.clientId));
}

export type TimelineKind = "activity" | "interaction" | "task" | "document" | "case" | "email" | "enquiry";

export interface ClientTimelineItem {
  id: string;
  kind: TimelineKind;
  title: string;
  detail: string;
  actorName: string;
  occurredAt: string;
  href: string | null;
  interactionKind: InteractionKind | null;
}

const TIMELINE_LIMIT = 200;

/**
 * Everything that happened on the relationship, newest first: activity rows
 * about the client or its cases, logged interactions, tasks, uploaded
 * documents, cases opened and welcome emails.
 */
export async function clientTimeline(client: ClientRow): Promise<ClientTimelineItem[]> {
  const cases = await db
    .select({
      id: casesTable.id,
      reference: casesTable.reference,
      displayReference: casesTable.displayReference,
      propertyAddress: casesTable.propertyAddress,
      assignedTo: casesTable.assignedTo,
      createdAt: casesTable.createdAt,
    })
    .from(casesTable)
    .where(eq(casesTable.clientId, client.id));
  const caseIds = cases.map((row) => row.id);
  const caseRef = new Map(cases.map((row) => [row.id, row.displayReference ?? row.reference]));

  const [activities, interactions, tasks, documents, invitations, enquiries] = await Promise.all([
    db
      .select()
      .from(activitiesTable)
      .where(or(
        and(eq(activitiesTable.entityType, "client"), eq(activitiesTable.entityId, client.id)),
        caseIds.length ? inArray(activitiesTable.caseId, caseIds) : sql`false`,
      ))
      .orderBy(desc(activitiesTable.occurredAt))
      .limit(TIMELINE_LIMIT),
    db
      .select()
      .from(clientInteractionsTable)
      .where(eq(clientInteractionsTable.clientId, client.id))
      .orderBy(desc(clientInteractionsTable.occurredAt))
      .limit(TIMELINE_LIMIT),
    db
      .select()
      .from(tasksTable)
      .where(caseIds.length
        ? or(eq(tasksTable.clientId, client.id), inArray(tasksTable.caseId, caseIds))
        : eq(tasksTable.clientId, client.id))
      .orderBy(desc(tasksTable.createdAt))
      .limit(TIMELINE_LIMIT),
    db
      .select({
        id: documentsTable.id,
        name: documentsTable.name,
        caseId: documentsTable.caseId,
        uploadedAt: documentsTable.uploadedAt,
        uploadedByUserId: documentsTable.uploadedByUserId,
      })
      .from(documentsTable)
      .where(eq(documentsTable.clientId, client.id)),
    db
      .select()
      .from(portalInvitationsTable)
      .where(and(eq(portalInvitationsTable.clientId, client.id), eq(portalInvitationsTable.purpose, "activation")))
      .orderBy(desc(portalInvitationsTable.createdAt)),
    db
      .select()
      .from(clientEnquiriesTable)
      .where(eq(clientEnquiriesTable.clientId, client.id))
      .orderBy(desc(clientEnquiriesTable.receivedAt))
      .limit(TIMELINE_LIMIT),
  ]);

  const names = await staffNames([
    ...interactions.map((row) => row.createdByUserId),
    ...tasks.flatMap((row) => [row.createdByUserId, row.completedByUserId]),
    ...documents.map((row) => row.uploadedByUserId),
  ]);
  const nameOf = (id: number | null | undefined, fallback: string) => (id != null && names.get(id)) || fallback;

  const items: ClientTimelineItem[] = [];
  // Every enquiry the client has made, oldest = "Enquiry received", later ones = repeats.
  const firstEnquiryId = enquiries.length ? enquiries[enquiries.length - 1]!.id : null;
  for (const row of enquiries) {
    const outcome = row.status === "open" ? "under review" : row.status === "accepted" ? "accepted" : row.status;
    items.push({
      id: `enquiry-${row.id}`,
      kind: "enquiry",
      title: row.id === firstEnquiryId ? "Enquiry received" : "Repeat enquiry",
      detail: [row.summary ?? row.emailSubject ?? "", row.timescale ? `Timescale: ${row.timescale}` : "", `Status: ${outcome}`]
        .filter(Boolean).join(" · "),
      actorName: row.emailFrom ?? client.name,
      occurredAt: iso(row.receivedAt),
      href: `/add/${client.id}`,
      interactionKind: null,
    });
  }
  // Interactions already write an activity row; skip those so they show once.
  const interactionActivity = /^(Call|Email|Meeting|Note) logged$/;
  for (const row of activities) {
    if (row.entityType === "client" && interactionActivity.test(row.title)) continue;
    items.push({
      id: `activity-${row.id}`,
      kind: "activity",
      title: row.title,
      detail: row.detail,
      actorName: row.actorName,
      occurredAt: iso(row.occurredAt),
      href: row.caseId != null ? `/cases/${row.caseId}` : null,
      interactionKind: null,
    });
  }
  for (const row of interactions) {
    const kind = row.kind as InteractionKind;
    items.push({
      id: `interaction-${row.id}`,
      kind: "interaction",
      title: row.caseId != null && caseRef.has(row.caseId)
        ? `${INTERACTION_LABELS[kind]} · ${caseRef.get(row.caseId)}`
        : INTERACTION_LABELS[kind],
      detail: row.summary,
      actorName: nameOf(row.createdByUserId, "Staff"),
      occurredAt: iso(row.occurredAt),
      href: row.caseId != null ? `/cases/${row.caseId}` : null,
      interactionKind: kind,
    });
  }
  for (const row of tasks) {
    const href = `/tasks?task=${row.id}`;
    items.push({
      id: `task-${row.id}`,
      kind: "task",
      title: "Task created",
      detail: row.title,
      actorName: nameOf(row.createdByUserId, "System"),
      occurredAt: iso(row.createdAt),
      href,
      interactionKind: null,
    });
    if (row.completedAt) {
      items.push({
        id: `task-${row.id}-done`,
        kind: "task",
        title: "Task completed",
        detail: row.title,
        actorName: nameOf(row.completedByUserId, row.assignee),
        occurredAt: iso(row.completedAt),
        href,
        interactionKind: null,
      });
    }
  }
  for (const row of documents) {
    if (!row.uploadedAt) continue;
    items.push({
      id: `document-${row.id}`,
      kind: "document",
      title: "Document uploaded",
      detail: row.caseId != null && caseRef.has(row.caseId) ? `${row.name} · ${caseRef.get(row.caseId)}` : row.name,
      actorName: nameOf(row.uploadedByUserId, client.name),
      occurredAt: iso(row.uploadedAt),
      href: row.caseId != null ? `/cases/${row.caseId}` : `/documents?clientId=${client.id}`,
      interactionKind: null,
    });
  }
  for (const row of cases) {
    items.push({
      id: `case-${row.id}`,
      kind: "case",
      title: "Case opened",
      detail: `${row.displayReference ?? row.reference} · ${row.propertyAddress}`,
      actorName: row.assignedTo,
      occurredAt: iso(row.createdAt),
      href: `/cases/${row.id}`,
      interactionKind: null,
    });
  }
  for (const row of invitations) {
    items.push({
      id: `email-${row.id}`,
      kind: "email",
      title: row.deliveryStatus === "sent"
        ? "Welcome email sent"
        : row.deliveryStatus === "failed"
          ? "Welcome email failed"
          : "Welcome email queued",
      detail: row.deliveryError ?? (row.usedAt ? "Portal access set up" : "Portal activation link"),
      actorName: "Chariot",
      occurredAt: iso(row.deliveredAt ?? row.createdAt),
      href: null,
      interactionKind: null,
    });
  }
  items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
  return items.slice(0, TIMELINE_LIMIT);
}
