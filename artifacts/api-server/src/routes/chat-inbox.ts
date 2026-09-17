import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import * as api from "@workspace/api-zod";
import {
  appUsersTable,
  caseConversationsTable,
  caseMessageReadsTable,
  casesTable,
  clientsTable,
  conversationParticipantsTable,
  conversationReadsTable,
  db,
  lendersTable,
  messageAttachmentsTable,
  messagesTable,
  threadPreferencesTable,
} from "@workspace/db";
import { stageName } from "../services/stages";
import { requireStaff } from "../auth/session";
import type { StaffRole } from "../auth/roles";

/**
 * The unified staff inbox: every case chat and direct/group conversation the
 * signed-in user can see, enriched with case context, read state and the
 * user's own inbox preferences (pin / mute / archive), plus cross-thread
 * message search. The older per-kind endpoints stay for the case pages.
 */
const router: IRouter = Router();
router.use(requireStaff);

const iso = (value: Date) => value.toISOString();
const EPOCH = new Date(0);
const SEARCH_LIMIT = 40;

type Participant = { id: number; displayName: string; role: StaffRole };
type InboxCase = Omit<api.InboxCase, never>;
type InboxMessagePreview = Omit<api.InboxMessagePreview, "createdAt"> & { createdAt: string };
type InboxThread = Omit<api.InboxThread, "case" | "lastMessage" | "lastActivityAt" | "createdAt"> & {
  case: InboxCase | null;
  lastMessage: InboxMessagePreview | null;
  lastActivityAt: string;
  createdAt: string;
};
type ChatSearchResult = Omit<api.ChatSearchResult, "createdAt"> & { createdAt: string };

/** Participants of many conversations in one query, grouped by conversation. */
async function participantsByConversation(conversationIds: number[]) {
  const map = new Map<number, Participant[]>();
  if (conversationIds.length === 0) return map;
  const rows = await db
    .select({
      conversationId: conversationParticipantsTable.conversationId,
      id: appUsersTable.id,
      displayName: appUsersTable.displayName,
      role: appUsersTable.role,
    })
    .from(conversationParticipantsTable)
    .innerJoin(appUsersTable, eq(conversationParticipantsTable.userId, appUsersTable.id))
    .where(inArray(conversationParticipantsTable.conversationId, conversationIds))
    .orderBy(appUsersTable.displayName);
  for (const row of rows) {
    const list = map.get(row.conversationId) ?? [];
    list.push({ id: row.id, displayName: row.displayName, role: row.role as StaffRole });
    map.set(row.conversationId, list);
  }
  return map;
}

/** Case summary rows (with lender name) for many cases, keyed by id. */
async function casesById(caseIds: number[]) {
  const map = new Map<number, InboxCase>();
  if (caseIds.length === 0) return map;
  const rows = await db
    .select({
      id: casesTable.id,
      reference: sql<string>`coalesce(${casesTable.displayReference}, ${casesTable.reference})`,
      clientName: clientsTable.name,
      stageIndex: casesTable.stageIndex,
      status: casesTable.status,
      assignedTo: casesTable.assignedTo,
      assignedUserId: casesTable.assignedUserId,
      lenderName: lendersTable.name,
      propertyAddress: casesTable.propertyAddress,
    })
    .from(casesTable)
    .innerJoin(clientsTable, eq(casesTable.clientId, clientsTable.id))
    .leftJoin(lendersTable, eq(casesTable.lenderId, lendersTable.id))
    .where(inArray(casesTable.id, caseIds));
  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      reference: row.reference,
      clientName: row.clientName,
      stage: stageName(row.stageIndex),
      stageIndex: row.stageIndex,
      status: row.status,
      assignedTo: row.assignedTo,
      assignedUserId: row.assignedUserId ?? null,
      lenderName: row.lenderName ?? null,
      propertyAddress: row.propertyAddress,
    });
  }
  return map;
}

function conversationTitle(
  conversation: { kind: string; title: string | null },
  participants: Participant[],
  currentUserId: number,
) {
  if (conversation.title) return conversation.title;
  if (conversation.kind === "group") return "Group chat";
  return participants.find((participant) => participant.id !== currentUserId)?.displayName ?? "Direct chat";
}

/** The ids of every conversation the user participates in. */
async function myConversationIds(currentUserId: number) {
  const rows = await db
    .select({ id: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, currentUserId));
  return rows.map((row) => row.id);
}

/** ILIKE patterns that count as mentioning this user: their full name, first name, or everyone. */
function mentionPatterns(displayName: string) {
  const escape = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
  const first = displayName.trim().split(/\s+/)[0] ?? displayName;
  return [`%@${escape(displayName)}%`, `%@${escape(first)}%`, "%@everyone%", "%@all%"];
}

function mentionSql(patterns: string[]) {
  return sql.join(
    patterns.map((pattern) => sql`${messagesTable.body} ilike ${pattern}`),
    sql` or `,
  );
}

router.get("/chat/inbox", async (_req, res): Promise<void> => {
  const currentUserId: number = res.locals.authUser.id;
  const mentions = mentionSql(mentionPatterns(res.locals.authUser.displayName));
  const notMine = or(isNull(messagesTable.senderUserId), ne(messagesTable.senderUserId, currentUserId));

  const [conversationIds, preferences] = await Promise.all([
    myConversationIds(currentUserId),
    db.select().from(threadPreferencesTable).where(eq(threadPreferencesTable.userId, currentUserId)),
  ]);
  const casePrefs = new Map(preferences.filter((p) => p.caseId != null).map((p) => [p.caseId!, p]));
  const conversationPrefs = new Map(
    preferences.filter((p) => p.conversationId != null).map((p) => [p.conversationId!, p]),
  );

  // Case chats: every case that has staff chat messages, plus any the user has pinned or archived.
  const caseChatRows = await db
    .selectDistinct({ caseId: messagesTable.caseId })
    .from(messagesTable)
    .where(and(isNull(messagesTable.conversationId), sql`${messagesTable.caseId} is not null`));
  const caseChatIds = new Set<number>(caseChatRows.map((row) => row.caseId!));
  for (const caseId of casePrefs.keys()) caseChatIds.add(caseId);

  const conversations = conversationIds.length
    ? await db.select().from(caseConversationsTable).where(inArray(caseConversationsTable.id, conversationIds))
    : [];
  const allCaseIds = [
    ...new Set([...caseChatIds, ...conversations.map((c) => c.caseId).filter((id): id is number => id != null)]),
  ];

  const [cases, participants, caseLatest, conversationLatest, caseUnread, conversationUnread] = await Promise.all([
    casesById(allCaseIds),
    participantsByConversation(conversationIds),
    caseChatIds.size
      ? db.execute<{
          case_id: number;
          id: number;
          sender: string;
          sender_user_id: number | null;
          body: string;
          created_at: Date;
          has_attachment: boolean;
        }>(sql`
          select distinct on (m.case_id) m.case_id, m.id, m.sender, m.sender_user_id, m.body, m.created_at,
            exists (select 1 from ${messageAttachmentsTable} a where a.message_id = m.id) as has_attachment
          from ${messagesTable} m
          where m.conversation_id is null and m.case_id in (${sql.join([...caseChatIds].map((id) => sql`${id}`), sql`, `)})
          order by m.case_id, m.created_at desc, m.id desc
        `)
      : { rows: [] },
    conversationIds.length
      ? db.execute<{
          conversation_id: number;
          id: number;
          sender: string;
          sender_user_id: number | null;
          body: string;
          created_at: Date;
          has_attachment: boolean;
        }>(sql`
          select distinct on (m.conversation_id) m.conversation_id, m.id, m.sender, m.sender_user_id, m.body, m.created_at,
            exists (select 1 from ${messageAttachmentsTable} a where a.message_id = m.id) as has_attachment
          from ${messagesTable} m
          where m.conversation_id in (${sql.join(conversationIds.map((id) => sql`${id}`), sql`, `)})
          order by m.conversation_id, m.created_at desc, m.id desc
        `)
      : { rows: [] },
    caseChatIds.size
      ? db
          .select({
            caseId: messagesTable.caseId,
            unread: sql<number>`count(*)::int`,
            mentions: sql<boolean>`bool_or(${mentions})`,
          })
          .from(messagesTable)
          .leftJoin(
            caseMessageReadsTable,
            and(eq(caseMessageReadsTable.caseId, messagesTable.caseId), eq(caseMessageReadsTable.userId, currentUserId)),
          )
          .where(
            and(
              isNull(messagesTable.conversationId),
              inArray(messagesTable.caseId, [...caseChatIds]),
              sql`${messagesTable.createdAt} > coalesce(${caseMessageReadsTable.lastReadAt}, ${EPOCH})`,
              notMine,
            ),
          )
          .groupBy(messagesTable.caseId)
      : [],
    conversationIds.length
      ? db
          .select({
            conversationId: messagesTable.conversationId,
            unread: sql<number>`count(*)::int`,
            mentions: sql<boolean>`bool_or(${mentions})`,
          })
          .from(messagesTable)
          .leftJoin(
            conversationReadsTable,
            and(
              eq(conversationReadsTable.conversationId, messagesTable.conversationId),
              eq(conversationReadsTable.userId, currentUserId),
            ),
          )
          .where(
            and(
              inArray(messagesTable.conversationId, conversationIds),
              sql`${messagesTable.createdAt} > coalesce(${conversationReadsTable.lastReadAt}, ${EPOCH})`,
              notMine,
            ),
          )
          .groupBy(messagesTable.conversationId)
      : [],
  ]);

  const caseLatestById = new Map(caseLatest.rows.map((row) => [Number(row.case_id), row]));
  const conversationLatestById = new Map(conversationLatest.rows.map((row) => [Number(row.conversation_id), row]));
  const caseUnreadById = new Map(caseUnread.map((row) => [row.caseId!, row]));
  const conversationUnreadById = new Map(conversationUnread.map((row) => [row.conversationId!, row]));

  const preview = (
    row:
      | { id: number; sender: string; sender_user_id: number | null; body: string; created_at: Date | string; has_attachment: boolean }
      | undefined,
  ): InboxMessagePreview | null =>
    row
      ? {
          id: Number(row.id),
          sender: row.sender,
          senderUserId: row.sender_user_id == null ? null : Number(row.sender_user_id),
          body: row.body,
          hasAttachment: Boolean(row.has_attachment),
          createdAt: iso(new Date(row.created_at)),
        }
      : null;

  const threads: InboxThread[] = [];

  for (const caseId of caseChatIds) {
    const caseRow = cases.get(caseId);
    if (!caseRow) continue;
    const last = preview(caseLatestById.get(caseId));
    const prefs = casePrefs.get(caseId);
    const unread = caseUnreadById.get(caseId);
    threads.push({
      key: `case-${caseId}`,
      kind: "case",
      caseId,
      conversationId: null,
      title: caseRow.reference,
      subtitle: caseRow.clientName ? `${caseRow.clientName} · ${caseRow.stage}` : caseRow.stage,
      case: caseRow,
      participants: [],
      lastMessage: last,
      unreadCount: unread?.unread ?? 0,
      mentionsMe: Boolean(unread?.mentions),
      pinned: prefs?.pinned ?? false,
      muted: prefs?.muted ?? false,
      archived: prefs?.archived ?? false,
      lastActivityAt: last?.createdAt ?? iso(new Date(0)),
      createdAt: last?.createdAt ?? iso(new Date(0)),
    });
  }

  for (const conversation of conversations) {
    const people = participants.get(conversation.id) ?? [];
    const caseRow = conversation.caseId != null ? (cases.get(conversation.caseId) ?? null) : null;
    const last = preview(conversationLatestById.get(conversation.id));
    const prefs = conversationPrefs.get(conversation.id);
    const unread = conversationUnreadById.get(conversation.id);
    const others = people.filter((person) => person.id !== currentUserId);
    const subtitle =
      conversation.kind === "group"
        ? `${people.length} people${caseRow ? ` · ${caseRow.reference}` : ""}`
        : `${(others[0]?.role ?? "direct message").replaceAll("_", " ")}${caseRow ? ` · ${caseRow.reference}` : ""}`;
    threads.push({
      key: `conversation-${conversation.id}`,
      kind: conversation.kind === "group" ? "group" : "direct",
      caseId: conversation.caseId,
      conversationId: conversation.id,
      title: conversationTitle(conversation, people, currentUserId),
      subtitle,
      case: caseRow,
      participants: people,
      lastMessage: last,
      unreadCount: unread?.unread ?? 0,
      mentionsMe: Boolean(unread?.mentions),
      pinned: prefs?.pinned ?? false,
      muted: prefs?.muted ?? false,
      archived: prefs?.archived ?? false,
      lastActivityAt: last?.createdAt ?? iso(conversation.createdAt),
      createdAt: iso(conversation.createdAt),
    });
  }

  threads.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  res.json(api.ListInboxResponse.parse(threads));
});

/** Resolves a {kind, id} thread the user may act on, or null. */
async function resolveThread(kind: "case" | "conversation", id: number, currentUserId: number) {
  if (kind === "case") {
    const [caseRow] = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.id, id));
    return caseRow ? { caseId: caseRow.id, conversationId: null } : null;
  }
  const [membership] = await db
    .select({ id: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, id), eq(conversationParticipantsTable.userId, currentUserId)));
  return membership ? { caseId: null, conversationId: membership.id } : null;
}

router.patch("/chat/threads/:kind/:id/preferences", async (req, res): Promise<void> => {
  const params = api.UpdateThreadPreferencesParams.safeParse(req.params);
  const body = api.UpdateThreadPreferencesBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid thread preferences" });
    return;
  }
  const currentUserId: number = res.locals.authUser.id;
  const thread = await resolveThread(params.data.kind, params.data.id, currentUserId);
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  const target =
    thread.caseId != null
      ? eq(threadPreferencesTable.caseId, thread.caseId)
      : eq(threadPreferencesTable.conversationId, thread.conversationId!);
  const [existing] = await db
    .select()
    .from(threadPreferencesTable)
    .where(and(eq(threadPreferencesTable.userId, currentUserId), target));
  const next = {
    pinned: body.data.pinned ?? existing?.pinned ?? false,
    muted: body.data.muted ?? existing?.muted ?? false,
    archived: body.data.archived ?? existing?.archived ?? false,
  };
  if (existing) {
    await db.update(threadPreferencesTable).set(next).where(eq(threadPreferencesTable.id, existing.id));
  } else {
    await db.insert(threadPreferencesTable).values({ userId: currentUserId, ...thread, ...next });
  }
  res.json(api.UpdateThreadPreferencesResponse.parse(next));
});

router.post("/chat/threads/:kind/:id/read", async (req, res): Promise<void> => {
  const params = api.SetThreadReadParams.safeParse(req.params);
  const body = api.SetThreadReadBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid read state" });
    return;
  }
  const currentUserId: number = res.locals.authUser.id;
  const thread = await resolveThread(params.data.kind, params.data.id, currentUserId);
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  const scope =
    thread.caseId != null
      ? and(eq(messagesTable.caseId, thread.caseId), isNull(messagesTable.conversationId))
      : eq(messagesTable.conversationId, thread.conversationId!);

  let lastReadAt = new Date();
  if (!body.data.read) {
    // Rewind to just before the newest message from someone else so exactly that one shows as unread.
    const [latest] = await db
      .select({ createdAt: messagesTable.createdAt })
      .from(messagesTable)
      .where(and(scope, or(isNull(messagesTable.senderUserId), ne(messagesTable.senderUserId, currentUserId))))
      .orderBy(desc(messagesTable.createdAt))
      .limit(1);
    if (!latest) {
      res.status(204).end();
      return;
    }
    lastReadAt = new Date(latest.createdAt.getTime() - 1);
  }

  if (thread.caseId != null) {
    await db
      .insert(caseMessageReadsTable)
      .values({ caseId: thread.caseId, userId: currentUserId, lastReadAt })
      .onConflictDoUpdate({ target: [caseMessageReadsTable.caseId, caseMessageReadsTable.userId], set: { lastReadAt } });
  } else {
    await db
      .insert(conversationReadsTable)
      .values({ conversationId: thread.conversationId!, userId: currentUserId, lastReadAt })
      .onConflictDoUpdate({
        target: [conversationReadsTable.conversationId, conversationReadsTable.userId],
        set: { lastReadAt },
      });
  }
  res.status(204).end();
});

router.get("/chat/search", async (req, res): Promise<void> => {
  const query = api.SearchChatMessagesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Enter at least two characters" });
    return;
  }
  const currentUserId: number = res.locals.authUser.id;
  const limit = query.data.limit ?? SEARCH_LIMIT;
  const pattern = `%${query.data.q.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const conversationIds = await myConversationIds(currentUserId);

  const visible = conversationIds.length
    ? or(isNull(messagesTable.conversationId), inArray(messagesTable.conversationId, conversationIds))
    : isNull(messagesTable.conversationId);
  const rows = await db
    .select({
      id: messagesTable.id,
      caseId: messagesTable.caseId,
      conversationId: messagesTable.conversationId,
      sender: messagesTable.sender,
      body: messagesTable.body,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .where(and(visible, sql`${messagesTable.body} ilike ${pattern}`))
    .orderBy(desc(messagesTable.createdAt))
    .limit(limit);

  const hitConversationIds = [...new Set(rows.map((row) => row.conversationId).filter((id): id is number => id != null))];
  const [conversations, participants, cases] = await Promise.all([
    hitConversationIds.length
      ? db.select().from(caseConversationsTable).where(inArray(caseConversationsTable.id, hitConversationIds))
      : [],
    participantsByConversation(hitConversationIds),
    casesById([...new Set(rows.map((row) => row.caseId).filter((id): id is number => id != null))]),
  ]);
  const conversationById = new Map(conversations.map((conversation) => [conversation.id, conversation]));

  const results: ChatSearchResult[] = [];
  for (const row of rows) {
    if (row.conversationId != null) {
      const conversation = conversationById.get(row.conversationId);
      if (!conversation) continue;
      results.push({
        messageId: row.id,
        threadKey: `conversation-${row.conversationId}`,
        kind: conversation.kind === "group" ? "group" : "direct",
        caseId: conversation.caseId,
        conversationId: row.conversationId,
        threadTitle: conversationTitle(conversation, participants.get(row.conversationId) ?? [], currentUserId),
        sender: row.sender,
        body: row.body,
        createdAt: iso(row.createdAt),
      });
    } else if (row.caseId != null) {
      const caseRow = cases.get(row.caseId);
      if (!caseRow) continue;
      results.push({
        messageId: row.id,
        threadKey: `case-${row.caseId}`,
        kind: "case",
        caseId: row.caseId,
        conversationId: null,
        threadTitle: caseRow.reference,
        sender: row.sender,
        body: row.body,
        createdAt: iso(row.createdAt),
      });
    }
  }
  res.json(api.SearchChatMessagesResponse.parse(results));
});

export default router;
