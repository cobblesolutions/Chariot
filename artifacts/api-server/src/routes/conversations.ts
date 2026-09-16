import { Router, type IRouter } from "express";
import {
  CreateCaseConversationBody,
  CreateCaseConversationParams,
  CreateCaseConversationResponse,
  CreateConversationBody,
  CreateConversationResponse,
  GetConversationParams,
  GetConversationResponse,
  ListCaseConversationsParams,
  ListCaseConversationsResponse,
  ListMyConversationsResponse,
  SendConversationMessageBody,
  SendConversationMessageParams,
  SendConversationMessageResponse,
  UpdateConversationBody,
  UpdateConversationParams,
  UpdateConversationResponse,
} from "@workspace/api-zod";
import {
  appUsersTable,
  caseConversationsTable,
  casesTable,
  conversationParticipantsTable,
  conversationReadsTable,
  db,
  messagesTable,
} from "@workspace/db";
import { and, asc, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { requireStaff } from "../auth/session";
import { linkAttachments, messageExtras, pendingAttachments, replyPreviews } from "../services/message-extras";
import { STAFF_ROLES, type StaffRole } from "../auth/roles";

const router: IRouter = Router();
router.use(requireStaff);

const iso = (value: Date) => value.toISOString();


async function conversationView(conversationId: number, currentUserId: number) {
  const [conversation] = await db.select().from(caseConversationsTable)
    .where(eq(caseConversationsTable.id, conversationId));
  if (!conversation) return null;

  const participants = await db.select({
    id: appUsersTable.id,
    displayName: appUsersTable.displayName,
    role: appUsersTable.role,
  }).from(conversationParticipantsTable)
    .innerJoin(appUsersTable, eq(conversationParticipantsTable.userId, appUsersTable.id))
    .where(eq(conversationParticipantsTable.conversationId, conversationId))
    .orderBy(asc(appUsersTable.displayName));

  if (!participants.some((participant) => participant.id === currentUserId)) return null;

  const caseReference = conversation.caseId
    ? (await db.select({ reference: sql<string>`coalesce(${casesTable.displayReference}, ${casesTable.reference})` }).from(casesTable)
        .where(eq(casesTable.id, conversation.caseId)))[0]?.reference ?? null
    : null;

  const messages = await db.select().from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(asc(messagesTable.createdAt));
  const replies = await replyPreviews(messages);
  const extras = await messageExtras(messages.map((message) => message.id), currentUserId);
  const title = conversation.title
    || (conversation.kind === "group"
      ? "Group chat"
      : participants.find((participant) => participant.id !== currentUserId)?.displayName ?? "Direct chat");

  return {
    id: conversation.id,
    caseId: conversation.caseId,
    caseReference,
    kind: conversation.kind as "direct" | "group",
    title,
    participants: participants.map((participant) => ({
      ...participant,
      role: participant.role as StaffRole,
    })),
    messages: messages.map((message) => ({
      id: message.id,
      conversationId: conversation.id,
      senderUserId: message.senderUserId!,
      sender: message.sender,
      senderRole: message.senderRole as StaffRole,
      body: message.body,
      replyTo: message.replyToMessageId ? replies.get(message.replyToMessageId) ?? null : null,
      reactions: extras.reactions.get(message.id) ?? [],
      attachments: extras.attachments.get(message.id) ?? [],
      createdAt: iso(message.createdAt),
    })),
    createdAt: iso(conversation.createdAt),
  };
}

router.get("/conversations", async (req, res): Promise<void> => {
  const currentUserId = res.locals.authUser.id;
  const conversationIds = await db.select({ id: caseConversationsTable.id })
    .from(caseConversationsTable)
    .innerJoin(
      conversationParticipantsTable,
      eq(conversationParticipantsTable.conversationId, caseConversationsTable.id),
    )
    .where(eq(conversationParticipantsTable.userId, currentUserId));

  const summaries = await Promise.all(
    conversationIds.map(async (item) => {
      const [conversation] = await db.select().from(caseConversationsTable)
        .where(eq(caseConversationsTable.id, item.id));
      if (!conversation) return null;
      const caseReference = conversation.caseId
        ? (await db.select({ reference: sql<string>`coalesce(${casesTable.displayReference}, ${casesTable.reference})` }).from(casesTable)
            .where(eq(casesTable.id, conversation.caseId)))[0]?.reference ?? null
        : null;
      const participants = await db.select({
        id: appUsersTable.id,
        displayName: appUsersTable.displayName,
      }).from(conversationParticipantsTable)
        .innerJoin(appUsersTable, eq(conversationParticipantsTable.userId, appUsersTable.id))
        .where(eq(conversationParticipantsTable.conversationId, conversation.id));
      const title = conversation.title
        || (conversation.kind === "group"
          ? "Group chat"
          : participants.find((participant) => participant.id !== currentUserId)?.displayName ?? "Direct chat");
      const [lastMessage] = await db.select().from(messagesTable)
        .where(eq(messagesTable.conversationId, conversation.id))
        .orderBy(desc(messagesTable.createdAt))
        .limit(1);
      const lastMessageReplies = lastMessage ? await replyPreviews([lastMessage]) : new Map();
      const [read] = await db.select().from(conversationReadsTable)
        .where(and(
          eq(conversationReadsTable.conversationId, conversation.id),
          eq(conversationReadsTable.userId, currentUserId),
        ));
      const unread = await db.select({ id: messagesTable.id }).from(messagesTable)
        .where(and(
          eq(messagesTable.conversationId, conversation.id),
          gt(messagesTable.createdAt, read?.lastReadAt ?? new Date(0)),
          ne(messagesTable.senderUserId, currentUserId),
        ));
      return {
        id: conversation.id,
        caseId: conversation.caseId,
        caseReference,
        kind: conversation.kind as "direct" | "group",
        title,
        unreadCount: unread.length,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              conversationId: conversation.id,
              senderUserId: lastMessage.senderUserId!,
              sender: lastMessage.sender,
              senderRole: lastMessage.senderRole as StaffRole,
              body: lastMessage.body,
              replyTo: lastMessage.replyToMessageId ? lastMessageReplies.get(lastMessage.replyToMessageId) ?? null : null,
              createdAt: iso(lastMessage.createdAt),
            }
          : null,
        createdAt: iso(conversation.createdAt),
      };
    }),
  );

  const filtered = summaries.filter((item): item is NonNullable<typeof item> => item !== null);
  filtered.sort((a, b) => {
    const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : new Date(a.createdAt).getTime();
    const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : new Date(b.createdAt).getTime();
    return bTime - aTime;
  });

  res.json(ListMyConversationsResponse.parse(filtered));
});

router.get("/cases/:id/conversations", async (req, res): Promise<void> => {
  const params = ListCaseConversationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid case" });
    return;
  }
  const conversationIds = await db.select({ id: caseConversationsTable.id })
    .from(caseConversationsTable)
    .innerJoin(
      conversationParticipantsTable,
      eq(conversationParticipantsTable.conversationId, caseConversationsTable.id),
    )
    .where(and(
      eq(caseConversationsTable.caseId, params.data.id),
      eq(conversationParticipantsTable.userId, res.locals.authUser.id),
    ))
    .orderBy(asc(caseConversationsTable.createdAt));
  const conversations = await Promise.all(
    conversationIds.map((item) => conversationView(item.id, res.locals.authUser.id)),
  );
  res.json(ListCaseConversationsResponse.parse(conversations.filter(Boolean)));
});

async function resolveParticipants(
  kind: "direct" | "group",
  participantUserId: number | undefined,
  currentUserId: number,
): Promise<{ participantIds: number[]; participantKey: string } | { error: string }> {
  if (kind === "direct") {
    const targetId = participantUserId;
    if (!targetId || targetId === currentUserId) {
      return { error: "Choose another staff member" };
    }
    const [target] = await db.select({ id: appUsersTable.id }).from(appUsersTable)
      .where(and(
        eq(appUsersTable.id, targetId),
        eq(appUsersTable.active, true),
        inArray(appUsersTable.role, STAFF_ROLES),
      ));
    if (!target) {
      return { error: "Choose an active staff member" };
    }
    const participantIds = [currentUserId, target.id].sort((a, b) => a - b);
    return { participantIds, participantKey: `direct:${participantIds.join(":")}` };
  }
  const staff = await db.select({ id: appUsersTable.id }).from(appUsersTable)
    .where(and(
      eq(appUsersTable.active, true),
      inArray(appUsersTable.role, STAFF_ROLES),
    ))
    .orderBy(asc(appUsersTable.id));
  return { participantIds: staff.map((member) => member.id), participantKey: "group" };
}

async function createOrGetConversation(
  caseId: number | null,
  kind: "direct" | "group",
  participantKey: string,
  participantIds: number[],
  currentUserId: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    const caseMatch = caseId === null ? sql`${caseConversationsTable.caseId} is null` : eq(caseConversationsTable.caseId, caseId);
    const [created] = await tx.insert(caseConversationsTable).values({
      caseId,
      kind,
      participantKey,
      createdByUserId: currentUserId,
    }).onConflictDoNothing().returning({ id: caseConversationsTable.id });
    const [conversation] = created
      ? [created]
      : await tx.select({ id: caseConversationsTable.id }).from(caseConversationsTable)
        .where(and(caseMatch, eq(caseConversationsTable.participantKey, participantKey)));
    if (!conversation) throw new Error("Conversation was not created");
    if (created) {
      await tx.insert(conversationParticipantsTable).values(
        participantIds.map((userId) => ({ conversationId: conversation.id, userId })),
      );
    }
    return conversation.id;
  });
}

router.post("/conversations", async (req, res): Promise<void> => {
  const body = CreateConversationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid conversation" });
    return;
  }
  const currentUserId = res.locals.authUser.id;
  const resolved = await resolveParticipants(body.data.kind, body.data.participantUserId, currentUserId);
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error });
    return;
  }

  const conversationId = await createOrGetConversation(
    null,
    body.data.kind,
    resolved.participantKey,
    resolved.participantIds,
    currentUserId,
  );

  const view = await conversationView(conversationId, currentUserId);
  res.status(201).json(CreateConversationResponse.parse(view));
});

router.get("/conversations/:id", async (req, res): Promise<void> => {
  const params = GetConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid conversation" });
    return;
  }
  const view = await conversationView(params.data.id, res.locals.authUser.id);
  if (!view) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  // Opening the conversation moves the reader's cursor, like the case chat does.
  await db.insert(conversationReadsTable)
    .values({ conversationId: view.id, userId: res.locals.authUser.id, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [conversationReadsTable.conversationId, conversationReadsTable.userId],
      set: { lastReadAt: new Date() },
    });
  res.json(GetConversationResponse.parse(view));
});

/** Renames a conversation for everyone in it; an empty or null title restores the default. */
router.patch("/conversations/:id", async (req, res): Promise<void> => {
  const params = UpdateConversationParams.safeParse(req.params);
  const body = UpdateConversationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid conversation" });
    return;
  }
  const currentUserId = res.locals.authUser.id;
  const [membership] = await db.select({ id: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(and(
      eq(conversationParticipantsTable.conversationId, params.data.id),
      eq(conversationParticipantsTable.userId, currentUserId),
    ));
  if (!membership) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const title = body.data.title?.trim() || null;
  await db.update(caseConversationsTable).set({ title }).where(eq(caseConversationsTable.id, membership.id));
  const view = await conversationView(membership.id, currentUserId);
  res.json(UpdateConversationResponse.parse(view));
});

router.post("/cases/:id/conversations", async (req, res): Promise<void> => {
  const params = CreateCaseConversationParams.safeParse(req.params);
  const body = CreateCaseConversationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid conversation" });
    return;
  }
  const [caseRow] = await db.select({ id: casesTable.id }).from(casesTable)
    .where(eq(casesTable.id, params.data.id));
  if (!caseRow) {
    res.status(404).json({ error: "Case not found" });
    return;
  }

  const currentUserId = res.locals.authUser.id;
  const resolved = await resolveParticipants(body.data.kind, body.data.participantUserId, currentUserId);
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error });
    return;
  }

  const conversationId = await createOrGetConversation(
    caseRow.id,
    body.data.kind,
    resolved.participantKey,
    resolved.participantIds,
    currentUserId,
  );

  const view = await conversationView(conversationId, currentUserId);
  res.status(201).json(CreateCaseConversationResponse.parse(view));
});

router.post("/conversations/:id/messages", async (req, res): Promise<void> => {
  const params = SendConversationMessageParams.safeParse(req.params);
  const body = SendConversationMessageBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid message" });
    return;
  }
  const [membership] = await db.select({
    conversationId: conversationParticipantsTable.conversationId,
    caseId: caseConversationsTable.caseId,
  }).from(conversationParticipantsTable)
    .innerJoin(
      caseConversationsTable,
      eq(conversationParticipantsTable.conversationId, caseConversationsTable.id),
    )
    .where(and(
      eq(conversationParticipantsTable.conversationId, params.data.id),
      eq(conversationParticipantsTable.userId, res.locals.authUser.id),
    ));
  if (!membership) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  let replyToMessageId: number | null = null;
  if (body.data.replyToMessageId != null) {
    const [replyRow] = await db.select({ id: messagesTable.id }).from(messagesTable)
      .where(and(eq(messagesTable.id, body.data.replyToMessageId), eq(messagesTable.conversationId, membership.conversationId)));
    if (!replyRow) {
      res.status(400).json({ error: "Invalid reply target" });
      return;
    }
    replyToMessageId = replyRow.id;
  }
  const attachmentIds = body.data.attachmentIds ?? [];
  const text = body.data.body.trim();
  if (!text && attachmentIds.length === 0) {
    res.status(400).json({ error: "A message needs text or an attachment" });
    return;
  }
  if (attachmentIds.length > 0 && (await pendingAttachments(attachmentIds, res.locals.authUser.id)).length !== new Set(attachmentIds).size) {
    res.status(400).json({ error: "Invalid attachment" });
    return;
  }
  const [created] = await db.insert(messagesTable).values({
    caseId: membership.caseId,
    conversationId: membership.conversationId,
    sender: res.locals.authUser.displayName,
    senderRole: res.locals.authUser.role,
    senderUserId: res.locals.authUser.id,
    body: text,
    replyToMessageId,
  }).returning();
  const attachments = await linkAttachments(created!.id, attachmentIds, res.locals.authUser.id);
  const replies = replyToMessageId ? await replyPreviews([created!]) : new Map();
  res.status(201).json(SendConversationMessageResponse.parse({
    id: created!.id,
    conversationId: membership.conversationId,
    senderUserId: res.locals.authUser.id,
    sender: created!.sender,
    senderRole: res.locals.authUser.role,
    body: created!.body,
    replyTo: replyToMessageId ? replies.get(replyToMessageId) ?? null : null,
    reactions: [],
    attachments,
    createdAt: iso(created!.createdAt),
  }));
});

export default router;