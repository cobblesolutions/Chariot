import { Router, type IRouter } from "express";
import { requireStaff } from "../auth/session";
import { linkAttachments, messageExtras, pendingAttachments, replyPreviews } from "../services/message-extras";
import {
  ArchiveLenderParams, CompleteCalendarEventBody, CompleteCalendarEventParams,
  CreateCalendarEventBody, CreateLenderBody, CreateLenderContactBody,
  CreateLenderContactParams, CreatePropertyBody, CreatePropertyValuationBody,
  CreatePropertyValuationParams, DeleteCalendarEventParams, ImportPropertiesBody,
  DeleteLenderContactParams, DeletePropertyParams,
  GetCalendarEventParams, GetCaseChatParams, GetLenderParams, GetPropertyParams,
  ListPropertyValuationsParams,
  SendCaseChatMessageBody, SendCaseChatMessageParams,
  UpdateCalendarEventBody, UpdateCalendarEventParams, UpdateLenderBody,
  UpdateLenderContactBody, UpdateLenderContactParams, UpdateLenderParams,
  UpdatePropertyBody, UpdatePropertyParams, ListChatThreadsResponse,
} from "@workspace/api-zod";
import {
  activitiesTable, appUsersTable, calendarEventsTable, caseMessageReadsTable, casesTable,
  clientsTable, db, lenderContactsTable, lendersTable, messagesTable,
  propertiesTable, propertyValuationsTable, tasksTable,
} from "@workspace/db";
import { stageName } from "../services/stages";
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { reconcileLenderPortfolioRequirements } from "../services/case-portfolio-requirement";
import { createAssignmentTask, resolveAssignee } from "../services/assignment";
import { ADVANCED_PROPERTY_KIND, completeClientTasks } from "../services/clients";
import { caseDateKindOf, moveCaseDateFromEvent, setValuationCompleted } from "../services/case-dates";
import { PROPERTY_DETAIL_KEYS, pickProvided } from "../services/profile-fields";
import { syncCaseChecklists, syncPropertyChecklists } from "../services/task-checklists";
import { logger } from "../lib/logger";
import { isFullAccess } from "../auth/roles";
import { caseView } from "./operations";
import { formatAddress } from "../lib/address";

const router: IRouter = Router();
router.use(requireStaff);
const id = (value: unknown) => Number(value);
const isAdmin = (res: any) => isFullAccess(res.locals.authUser.role);
const invalid = (res: any) => res.status(400).json({ error: "Invalid request" });
const staffOnlyAdmin = (res: any) => isAdmin(res) || (res.status(403).json({ error: "Administrator access required" }), false);
const contactView = (row: typeof lenderContactsTable.$inferSelect) => ({ id: row.id, lenderId: row.lenderId, name: row.name, email: row.email, phone: row.phone, role: row.role });

async function eventView(row: typeof calendarEventsTable.$inferSelect) {
  const caseRow = row.caseId
    ? (await db.select({ reference: sql<string>`coalesce(${casesTable.displayReference}, ${casesTable.reference})`, clientName: clientsTable.name })
        .from(casesTable).innerJoin(clientsTable, eq(casesTable.clientId, clientsTable.id)).where(eq(casesTable.id, row.caseId)))[0]
    : undefined;
  const [task] = await db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.calendarEventId, row.id)).limit(1);
  return { id: row.id, caseId: row.caseId ?? null, renewalId: row.renewalId ?? null, title: row.title, eventType: row.eventType, eventDate: row.eventDate.toISOString(), completed: row.completed, source: row.source, taskId: task?.id ?? null, caseReference: caseRow?.reference ?? null, clientName: caseRow?.clientName ?? null };
}
const actorOf = (res: any) => ({ userId: res.locals.authUser.id as number, displayName: res.locals.authUser.displayName as string });
async function lenderView(row: typeof lendersTable.$inferSelect) {
  const [count] = await db.select({ count: sql<number>`count(*)::int` }).from(casesTable).where(and(eq(casesTable.lenderId, row.id), eq(casesTable.status, "active")));
  return { id: row.id, name: row.name, portfolioStage: row.portfolioStage, avgDecisionDays: row.avgDecisionDays, status: row.status, activeCases: count?.count ?? 0 };
}


router.get("/properties", async (_req, res) => {
  const rows = await db.select({ property: propertiesTable, clientName: clientsTable.name })
    .from(propertiesTable)
    .leftJoin(clientsTable, eq(propertiesTable.clientId, clientsTable.id))
    .orderBy(desc(propertiesTable.createdAt));
  const caseRows = await db.select({ id: casesTable.id, reference: sql<string>`coalesce(${casesTable.displayReference}, ${casesTable.reference})`, status: casesTable.status, stageIndex: casesTable.stageIndex, propertyId: casesTable.propertyId })
    .from(casesTable)
    .where(eq(casesTable.status, "active"));
  const casesByProperty = new Map<number, typeof caseRows>();
  for (const c of caseRows) {
    if (c.propertyId == null) continue;
    const list = casesByProperty.get(c.propertyId) ?? [];
    list.push(c);
    casesByProperty.set(c.propertyId, list);
  }
  res.json(rows.map(({ property, clientName }) => ({
    ...property,
    clientName,
    activeCases: (casesByProperty.get(property.id) ?? []).map((c) => ({ id: c.id, reference: c.reference, status: c.status, stage: stageName(c.stageIndex) })),
  })));
});
router.post("/properties", async (req, res) => {
  const b = CreatePropertyBody.safeParse(req.body); if (!b.success) return void invalid(res);
  const client = b.data.clientId
    ? (await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, b.data.clientId)))[0]
    : null;
  if (b.data.clientId && !client) return void res.status(404).json({ error: "Client not found" });
  // Resolve before inserting so a bad explicit assignee never leaves an orphan property.
  const assignee = await resolveAssignee({ section: "property", explicitUserId: b.data.assignedUserId });
  if (!assignee.ok) return void res.status(400).json({ error: assignee.error });
  const [created] = await db.insert(propertiesTable).values({
    clientId: b.data.clientId ?? null,
    address: b.data.address,
    matterType: b.data.matterType,
    value: b.data.value,
    loanAmount: b.data.loanAmount,
    rent: b.data.rent ?? null,
    gdv: b.data.gdv ?? null,
    ...pickProvided(b.data, PROPERTY_DETAIL_KEYS),
  }).returning();
  const createdAddress = formatAddress(created!);
  await db.insert(activitiesTable).values({ title: "Property added", detail: client ? `${createdAddress} was linked to ${client.name}` : `${createdAddress} was added without a client`, actorName: res.locals.authUser.displayName, entityType: "property", entityId: created!.id });
  if (client) await completeClientTasks(client.id, [ADVANCED_PROPERTY_KIND], res.locals.authUser.id);
  await createAssignmentTask({
    staffUser: assignee.staffUser,
    title: `Review new property: ${createdAddress}`,
    notes: client ? `${client.name} — ${createdAddress}` : createdAddress,
    caseId: null,
    clientId: client?.id ?? null,
    propertyId: created!.id,
    kind: "property_review",
  }).catch((error) => logger.warn({ err: error, propertyId: created!.id }, "Property review task was not created"));
  res.status(201).json(created);
});
router.post("/properties/import", async (req, res) => {
  const b = ImportPropertiesBody.safeParse(req.body); if (!b.success) return void invalid(res);
  const [client] = await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, b.data.clientId));
  if (!client) return void res.status(404).json({ error: "Client not found" });
  const assignee = await resolveAssignee({ section: "property", explicitUserId: b.data.assignedUserId });
  if (!assignee.ok) return void res.status(400).json({ error: assignee.error });
  const created = await db.insert(propertiesTable).values(b.data.properties.map((p) => ({
    clientId: client.id,
    address: p.address,
    matterType: p.matterType,
    value: p.value,
    loanAmount: p.loanAmount,
    rent: p.rent ?? null,
    gdv: p.gdv ?? null,
    ...pickProvided(p, PROPERTY_DETAIL_KEYS),
  }))).returning();
  await db.insert(activitiesTable).values({
    title: "Properties imported",
    detail: `${created.length} propert${created.length === 1 ? "y was" : "ies were"} imported for ${client.name}`,
    actorName: res.locals.authUser.displayName,
    entityType: "client",
    entityId: client.id,
  });
  const preview = created.slice(0, 5).map((p) => formatAddress(p)).join("; ");
  await createAssignmentTask({
    staffUser: assignee.staffUser,
    title: `Review ${created.length} imported propert${created.length === 1 ? "y" : "ies"}: ${client.name}`,
    notes: created.length > 5 ? `${preview}; and ${created.length - 5} more` : preview,
    caseId: null,
    clientId: client.id,
    kind: "property_import",
  }).catch((error) => logger.warn({ err: error, clientId: client.id }, "Property import review task was not created"));
  res.status(201).json(created);
});
router.get("/properties/:id", async (req, res) => {
  const p = GetPropertyParams.safeParse(req.params); if (!p.success) return void invalid(res);
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, p.data.id));
  if (!property) return void res.status(404).json({ error: "Property not found" });
  const [client] = property.clientId
    ? await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, property.clientId))
    : [];
  const caseRows = await db.select().from(casesTable).where(eq(casesTable.propertyId, property.id)).orderBy(desc(casesTable.updatedAt));
  const cases = await Promise.all(caseRows.map((c) => caseView(c)));
  res.json({ ...property, clientName: client?.name ?? null, cases });
});
router.patch("/properties/:id", async (req, res) => {
  const p = UpdatePropertyParams.safeParse(req.params), b = UpdatePropertyBody.safeParse(req.body); if (!p.success || !b.success) return void invalid(res);
  if (b.data.clientId) {
    const [client] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.id, b.data.clientId));
    if (!client) return void res.status(404).json({ error: "Client not found" });
  }
  const [updated] = await db.update(propertiesTable).set({
    clientId: b.data.clientId ?? null,
    address: b.data.address,
    matterType: b.data.matterType,
    value: b.data.value,
    loanAmount: b.data.loanAmount,
    rent: b.data.rent ?? null,
    gdv: b.data.gdv ?? null,
    ...pickProvided(b.data, PROPERTY_DETAIL_KEYS),
  }).where(eq(propertiesTable.id, p.data.id)).returning();
  if (!updated) return void res.status(404).json({ error: "Property not found" });
  await syncPropertyChecklists(updated.id);
  await mirrorPropertyAmountsToCases(updated);
  res.json(updated);
});

/**
 * A case's value, loan, rent and GDV are inherited from its property. Keep the
 * copies in step while the case is still being set up (advice and submission details);
 * once it has gone to a lender the figures on the case are frozen.
 */
async function mirrorPropertyAmountsToCases(property: typeof propertiesTable.$inferSelect) {
  const affected = await db
    .update(casesTable)
    .set({
      propertyValue: property.value,
      loanAmount: property.loanAmount,
      rent: property.rent,
      gdv: property.gdv,
      propertyAddress: formatAddress(property),
      matterType: property.matterType,
    })
    .where(and(
      eq(casesTable.propertyId, property.id),
      eq(casesTable.status, "active"),
      lte(casesTable.stageIndex, 1),
    ))
    .returning({ id: casesTable.id });
  await Promise.all(affected.map((row) => syncCaseChecklists(row.id)));
}
router.delete("/properties/:id", async (req, res) => {
  const p = DeletePropertyParams.safeParse(req.params); if (!p.success) return void invalid(res);
  const [linked] = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.propertyId, p.data.id)).limit(1);
  if (linked) return void res.status(409).json({ error: "Property is referenced by a case" });
  await db.delete(propertiesTable).where(eq(propertiesTable.id, p.data.id)); res.status(204).end();
});

function valuationView(row: typeof propertyValuationsTable.$inferSelect, caseReference: string | null, recordedByName: string | null) {
  return {
    id: row.id,
    propertyId: row.propertyId,
    amount: row.amount,
    valuedAt: row.valuedAt,
    source: row.source,
    caseId: row.caseId,
    caseReference,
    notes: row.notes,
    recordedByUserId: row.recordedByUserId,
    recordedByName,
    createdAt: row.createdAt.toISOString(),
  };
}
router.get("/properties/:id/valuations", async (req, res) => {
  const p = ListPropertyValuationsParams.safeParse(req.params); if (!p.success) return void invalid(res);
  const rows = await db
    .select({
      valuation: propertyValuationsTable,
      caseReference: sql<string | null>`coalesce(${casesTable.displayReference}, ${casesTable.reference})`,
      recordedByName: appUsersTable.displayName,
    })
    .from(propertyValuationsTable)
    .leftJoin(casesTable, eq(casesTable.id, propertyValuationsTable.caseId))
    .leftJoin(appUsersTable, eq(appUsersTable.id, propertyValuationsTable.recordedByUserId))
    .where(eq(propertyValuationsTable.propertyId, p.data.id))
    .orderBy(desc(propertyValuationsTable.valuedAt), desc(propertyValuationsTable.createdAt));
  res.json(rows.map((r) => valuationView(r.valuation, r.caseReference ?? null, r.recordedByName ?? null)));
});
router.post("/properties/:id/valuations", async (req, res) => {
  const p = CreatePropertyValuationParams.safeParse(req.params), b = CreatePropertyValuationBody.safeParse(req.body);
  if (!p.success || !b.success) return void invalid(res);
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, p.data.id));
  if (!property) return void res.status(404).json({ error: "Property not found" });
  const [created] = await db.insert(propertyValuationsTable).values({
    propertyId: property.id,
    amount: b.data.amount,
    valuedAt: b.data.valuedAt,
    source: b.data.source ?? "manual",
    notes: b.data.notes ?? "",
    recordedByUserId: res.locals.authUser.id,
  }).returning();
  await db.update(propertiesTable).set({ value: b.data.amount }).where(eq(propertiesTable.id, property.id));
  await db.insert(activitiesTable).values({
    title: "Valuation recorded",
    detail: `${formatAddress(property)}: valued at £${b.data.amount.toLocaleString("en-GB")}`,
    actorName: res.locals.authUser.displayName,
    entityType: "property",
    entityId: property.id,
  });
  res.status(201).json(valuationView(created!, null, res.locals.authUser.displayName));
});

router.get("/lenders/:id", async (req, res) => {
  const p = GetLenderParams.safeParse(req.params); if (!p.success) return void invalid(res);
  const [row] = await db.select().from(lendersTable).where(eq(lendersTable.id, p.data.id)); if (!row) return void res.status(404).json({ error: "Lender not found" });
  const contacts = await db.select().from(lenderContactsTable).where(eq(lenderContactsTable.lenderId, row.id));
  res.json({ ...(await lenderView(row)), profile: row.profile, contacts: contacts.map(contactView), configuredRequirements: Array.isArray((row.profile as any).configuredRequirements) ? (row.profile as any).configuredRequirements : [] });
});
router.post("/lenders", async (req, res) => {
  const b = CreateLenderBody.safeParse(req.body); if (!b.success) return void invalid(res); if (!staffOnlyAdmin(res)) return;
  const [created] = await db.insert(lendersTable).values({ ...b.data, avgDecisionDays: b.data.avgDecisionDays ?? 0, status: b.data.status ?? "active", profile: b.data.profile ?? {} }).returning();
  res.status(201).json(await lenderView(created!));
});
router.patch("/lenders/:id", async (req, res) => {
  const p = UpdateLenderParams.safeParse(req.params), b = UpdateLenderBody.safeParse(req.body); if (!p.success || !b.success) return void invalid(res); if (!staffOnlyAdmin(res)) return;
  const [updated] = await db.update(lendersTable).set(b.data).where(eq(lendersTable.id, p.data.id)).returning(); if (!updated) return void res.status(404).json({ error: "Lender not found" }); await reconcileLenderPortfolioRequirements(updated.id); res.json(await lenderView(updated));
});
router.delete("/lenders/:id", async (req, res) => {
  const p = ArchiveLenderParams.safeParse(req.params); if (!p.success) return void invalid(res); if (!staffOnlyAdmin(res)) return;
  await db.update(lendersTable).set({ status: "archived" }).where(eq(lendersTable.id, p.data.id)); res.status(204).end();
});
router.get("/lenders/:id/contacts", async (req, res) => { const p = GetLenderParams.safeParse(req.params); if (!p.success) return void invalid(res); res.json((await db.select().from(lenderContactsTable).where(eq(lenderContactsTable.lenderId, p.data.id))).map(contactView)); });
router.post("/lenders/:id/contacts", async (req, res) => { const p = CreateLenderContactParams.safeParse(req.params), b = CreateLenderContactBody.safeParse(req.body); if (!p.success || !b.success) return void invalid(res); if (!staffOnlyAdmin(res)) return; const [r] = await db.insert(lenderContactsTable).values({ ...b.data, lenderId: p.data.id }).returning(); res.status(201).json(contactView(r!)); });
router.patch("/lenders/:id/contacts/:contactId", async (req, res) => { const p = UpdateLenderContactParams.safeParse(req.params), b = UpdateLenderContactBody.safeParse(req.body); if (!p.success || !b.success) return void invalid(res); if (!staffOnlyAdmin(res)) return; const [r] = await db.update(lenderContactsTable).set(b.data).where(and(eq(lenderContactsTable.id, p.data.contactId), eq(lenderContactsTable.lenderId, p.data.id))).returning(); if (!r) return void res.status(404).json({ error: "Contact not found" }); res.json(contactView(r)); });
router.delete("/lenders/:id/contacts/:contactId", async (req, res) => { const p = DeleteLenderContactParams.safeParse(req.params); if (!p.success) return void invalid(res); if (!staffOnlyAdmin(res)) return; await db.delete(lenderContactsTable).where(and(eq(lenderContactsTable.id, p.data.contactId), eq(lenderContactsTable.lenderId, p.data.id))); res.status(204).end(); });

router.post("/calendar", async (req, res) => {
  const b = CreateCalendarEventBody.safeParse(req.body); if (!b.success) return void invalid(res);
  if (b.data.caseId) { const [c] = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.id, b.data.caseId)); if (!c) return void res.status(404).json({ error: "Case not found" }); }
  const [r] = await db.insert(calendarEventsTable).values({ ...b.data, caseId: b.data.caseId ?? null, eventDate: b.data.eventDate, createdByUserId: res.locals.authUser.id }).returning(); res.status(201).json(await eventView(r!));
});
router.get("/calendar/:id", async (req, res) => { const p = GetCalendarEventParams.safeParse(req.params); if (!p.success) return void invalid(res); const [r] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, p.data.id)); if (!r) return void res.status(404).json({ error: "Event not found" }); res.json(await eventView(r)); });
router.patch("/calendar/:id", async (req, res) => {
  const p = UpdateCalendarEventParams.safeParse(req.params), b = UpdateCalendarEventBody.safeParse(req.body); if (!p.success || !b.success) return void invalid(res);
  const [existing] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, p.data.id)); if (!existing) return void res.status(404).json({ error: "Event not found" });
  if (caseDateKindOf(existing.source)) {
    // Mirrors a case date: only the date can move here, and it moves on the case too.
    await moveCaseDateFromEvent(existing, new Date(b.data.eventDate), res.locals.authUser.id);
    const [fresh] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, existing.id)); return void res.json(await eventView(fresh ?? existing));
  }
  if (b.data.caseId) { const [c] = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.id, b.data.caseId)); if (!c) return void res.status(404).json({ error: "Case not found" }); }
  const [r] = await db.update(calendarEventsTable).set({ ...b.data, caseId: b.data.caseId ?? null }).where(eq(calendarEventsTable.id, p.data.id)).returning(); if (!r) return void res.status(404).json({ error: "Event not found" }); res.json(await eventView(r));
});
router.delete("/calendar/:id", async (req, res) => {
  const p = DeleteCalendarEventParams.safeParse(req.params); if (!p.success) return void invalid(res);
  const [existing] = await db.select({ source: calendarEventsTable.source }).from(calendarEventsTable).where(eq(calendarEventsTable.id, p.data.id));
  if (existing && caseDateKindOf(existing.source)) return void res.status(409).json({ error: "This event mirrors a case date — clear the date on the case instead" });
  await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, p.data.id)); res.status(204).end();
});
router.post("/calendar/:id/complete", async (req, res) => {
  const p = CompleteCalendarEventParams.safeParse(req.params), b = CompleteCalendarEventBody.safeParse(req.body); if (!p.success || !b.success) return void invalid(res);
  const [existing] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, p.data.id)); if (!existing) return void res.status(404).json({ error: "Event not found" });
  if (existing.source === "case_valuation" && existing.caseId) {
    // Completing the valuation event confirms the valuation on the case (and closes its task).
    await setValuationCompleted(existing.caseId, b.data.completed, actorOf(res));
    const [fresh] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, existing.id)); return void res.json(await eventView(fresh ?? existing));
  }
  const [r] = await db.update(calendarEventsTable).set({ completed: b.data.completed, completedAt: b.data.completed ? new Date() : null }).where(eq(calendarEventsTable.id, p.data.id)).returning(); if (!r) return void res.status(404).json({ error: "Event not found" }); res.json(await eventView(r));
});


 router.get("/chat/cases/:id", async (req, res) => { const p = GetCaseChatParams.safeParse(req.params); if (!p.success) return void invalid(res); const [c] = await db.select().from(casesTable).where(eq(casesTable.id, p.data.id)); if (!c) return void res.status(404).json({ error: "Case not found" }); const rows = await db.select().from(messagesTable).where(and(eq(messagesTable.caseId, c.id), isNull(messagesTable.conversationId))).orderBy(asc(messagesTable.createdAt)); const replies = await replyPreviews(rows); const extras = await messageExtras(rows.map((r) => r.id), res.locals.authUser.id); const [read] = await db.select().from(caseMessageReadsTable).where(and(eq(caseMessageReadsTable.caseId, c.id), eq(caseMessageReadsTable.userId, res.locals.authUser.id))); const unread = await db.select({ id: messagesTable.id }).from(messagesTable).where(and(eq(messagesTable.caseId, c.id), isNull(messagesTable.conversationId), gt(messagesTable.createdAt, read?.lastReadAt ?? new Date(0)), or(isNull(messagesTable.senderUserId), ne(messagesTable.senderUserId, res.locals.authUser.id)))); const readAt = new Date(); await db.insert(caseMessageReadsTable).values({ caseId: c.id, userId: res.locals.authUser.id, lastReadAt: readAt }).onConflictDoUpdate({ target: [caseMessageReadsTable.caseId, caseMessageReadsTable.userId], set: { lastReadAt: readAt } }); const caseRef = c.displayReference || c.reference; res.json({ caseId: c.id, unreadCount: unread.length, messages: rows.map((r) => ({ id: r.id, caseId: r.caseId, caseReference: caseRef, senderUserId: r.senderUserId ?? null, sender: r.sender, senderRole: r.senderRole, body: r.body, replyTo: r.replyToMessageId ? replies.get(r.replyToMessageId) ?? null : null, reactions: extras.reactions.get(r.id) ?? [], attachments: extras.attachments.get(r.id) ?? [], createdAt: r.createdAt.toISOString() })) }); });
router.get("/chat/threads", async (_req, res) => {
  const userId = res.locals.authUser.id;
  const caseRows = await db.selectDistinct({ id: casesTable.id, reference: sql<string>`coalesce(${casesTable.displayReference}, ${casesTable.reference})` })
    .from(casesTable).innerJoin(messagesTable, and(eq(messagesTable.caseId, casesTable.id), isNull(messagesTable.conversationId)));
  const threads = await Promise.all(caseRows.map(async (caseRow) => {
    const [read] = await db.select().from(caseMessageReadsTable)
      .where(and(eq(caseMessageReadsTable.caseId, caseRow.id), eq(caseMessageReadsTable.userId, userId)));
    const unread = await db.select({ id: messagesTable.id }).from(messagesTable).where(and(
      eq(messagesTable.caseId, caseRow.id),
      isNull(messagesTable.conversationId),
      gt(messagesTable.createdAt, read?.lastReadAt ?? new Date(0)),
      or(isNull(messagesTable.senderUserId), ne(messagesTable.senderUserId, userId)),
    ));
    return { caseId: caseRow.id, caseReference: caseRow.reference, unreadCount: unread.length };
  }));
  res.json(ListChatThreadsResponse.parse(threads));
});
router.post("/chat/cases/:id/messages", async (req, res) => {
  const p = SendCaseChatMessageParams.safeParse(req.params), b = SendCaseChatMessageBody.safeParse(req.body);
  if (!p.success || !b.success) return void invalid(res);
  const [c] = await db.select().from(casesTable).where(eq(casesTable.id, p.data.id));
  if (!c) return void res.status(404).json({ error: "Case not found" });
  let replyToMessageId: number | null = null;
  if (b.data.replyToMessageId != null) {
    const [replyRow] = await db.select({ id: messagesTable.id }).from(messagesTable)
      .where(and(eq(messagesTable.id, b.data.replyToMessageId), eq(messagesTable.caseId, c.id), isNull(messagesTable.conversationId)));
    if (!replyRow) return void invalid(res);
    replyToMessageId = replyRow.id;
  }
  const u = res.locals.authUser;
  const attachmentIds = b.data.attachmentIds ?? [];
  const body = b.data.body.trim();
  if (!body && attachmentIds.length === 0) return void invalid(res);
  if (attachmentIds.length > 0 && (await pendingAttachments(attachmentIds, u.id)).length !== new Set(attachmentIds).size) return void invalid(res);
  const [r] = await db.insert(messagesTable).values({ caseId: c.id, body, sender: u.displayName, senderRole: "staff", senderUserId: u.id, replyToMessageId }).returning();
  const attachments = await linkAttachments(r!.id, attachmentIds, u.id);
  const replies = replyToMessageId ? await replyPreviews([r!]) : new Map();
  res.status(201).json({ id: r!.id, caseId: c.id, caseReference: c.displayReference || c.reference, senderUserId: u.id, sender: r!.sender, senderRole: r!.senderRole, body: r!.body, replyTo: replyToMessageId ? replies.get(replyToMessageId) ?? null : null, reactions: [], attachments, createdAt: r!.createdAt.toISOString() });
});
export default router;