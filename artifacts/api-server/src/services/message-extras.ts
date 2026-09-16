import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  appUsersTable,
  conversationParticipantsTable,
  db,
  messageAttachmentsTable,
  messageReactionsTable,
  messagesTable,
} from "@workspace/db";

export type ReactionView = { emoji: string; count: number; users: string[]; reacted: boolean };
export type AttachmentView = { id: number; name: string; contentType: string; byteSize: number };

export function attachmentView(row: typeof messageAttachmentsTable.$inferSelect): AttachmentView {
  return { id: row.id, name: row.name, contentType: row.contentType, byteSize: row.byteSize };
}

/** Reactions (grouped by emoji, in first-reacted order) and attachments for a set of messages. */
export async function messageExtras(messageIds: number[], currentUserId: number) {
  const reactions = new Map<number, ReactionView[]>();
  const attachments = new Map<number, AttachmentView[]>();
  const ids = [...new Set(messageIds)];
  if (ids.length === 0) return { reactions, attachments };

  const reactionRows = await db
    .select({
      messageId: messageReactionsTable.messageId,
      userId: messageReactionsTable.userId,
      emoji: messageReactionsTable.emoji,
      displayName: appUsersTable.displayName,
    })
    .from(messageReactionsTable)
    .innerJoin(appUsersTable, eq(messageReactionsTable.userId, appUsersTable.id))
    .where(inArray(messageReactionsTable.messageId, ids))
    .orderBy(asc(messageReactionsTable.createdAt), asc(messageReactionsTable.id));
  for (const row of reactionRows) {
    const list = reactions.get(row.messageId) ?? [];
    let entry = list.find((r) => r.emoji === row.emoji);
    if (!entry) {
      entry = { emoji: row.emoji, count: 0, users: [], reacted: false };
      list.push(entry);
    }
    entry.count += 1;
    entry.users.push(row.displayName);
    if (row.userId === currentUserId) entry.reacted = true;
    reactions.set(row.messageId, list);
  }

  const attachmentRows = await db
    .select()
    .from(messageAttachmentsTable)
    .where(inArray(messageAttachmentsTable.messageId, ids))
    .orderBy(asc(messageAttachmentsTable.id));
  for (const row of attachmentRows) {
    const list = attachments.get(row.messageId!) ?? [];
    list.push(attachmentView(row));
    attachments.set(row.messageId!, list);
  }
  return { reactions, attachments };
}

export async function reactionsForMessage(messageId: number, currentUserId: number) {
  const { reactions } = await messageExtras([messageId], currentUserId);
  return reactions.get(messageId) ?? [];
}

/** Attachments the current user uploaded that are not yet linked to a message. */
export async function pendingAttachments(attachmentIds: number[], userId: number) {
  const ids = [...new Set(attachmentIds)];
  if (ids.length === 0) return [];
  return db
    .select()
    .from(messageAttachmentsTable)
    .where(and(
      inArray(messageAttachmentsTable.id, ids),
      eq(messageAttachmentsTable.uploadedByUserId, userId),
      isNull(messageAttachmentsTable.messageId),
    ));
}

export async function linkAttachments(messageId: number, attachmentIds: number[], userId: number) {
  const ids = [...new Set(attachmentIds)];
  if (ids.length === 0) return [];
  const rows = await db
    .update(messageAttachmentsTable)
    .set({ messageId })
    .where(and(
      inArray(messageAttachmentsTable.id, ids),
      eq(messageAttachmentsTable.uploadedByUserId, userId),
      isNull(messageAttachmentsTable.messageId),
    ))
    .returning();
  return rows.sort((a, b) => a.id - b.id).map(attachmentView);
}

/** Staff can read every case chat; conversation messages require membership. */
export async function canAccessMessage(message: typeof messagesTable.$inferSelect, userId: number) {
  if (message.conversationId == null) return true;
  const [membership] = await db
    .select({ userId: conversationParticipantsTable.userId })
    .from(conversationParticipantsTable)
    .where(and(
      eq(conversationParticipantsTable.conversationId, message.conversationId),
      eq(conversationParticipantsTable.userId, userId),
    ));
  return !!membership;
}

export type ReplyPreview = { id: number; sender: string; body: string };

/** Quoted-reply previews; attachment-only originals get "Photo" or the file name instead of an empty body. */
export async function replyPreviews(rows: { replyToMessageId: number | null }[]) {
  const previews = new Map<number, ReplyPreview>();
  const ids = [...new Set(rows.map((r) => r.replyToMessageId).filter((v): v is number => v != null))];
  if (ids.length === 0) return previews;
  const found = await db
    .select({ id: messagesTable.id, sender: messagesTable.sender, body: messagesTable.body })
    .from(messagesTable)
    .where(inArray(messagesTable.id, ids));
  const empty = found.filter((row) => !row.body.trim()).map((row) => row.id);
  const files = empty.length
    ? await db
        .select({ messageId: messageAttachmentsTable.messageId, name: messageAttachmentsTable.name, contentType: messageAttachmentsTable.contentType })
        .from(messageAttachmentsTable)
        .where(inArray(messageAttachmentsTable.messageId, empty))
    : [];
  for (const row of found) {
    const file = files.find((f) => f.messageId === row.id);
    const body = row.body.trim() ? row.body : file ? (file.contentType.startsWith("image/") ? "Photo" : file.name) : "Attachment";
    previews.set(row.id, { id: row.id, sender: row.sender, body });
  }
  return previews;
}
