import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, ilike, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import {
  activitiesTable,
  appUsersTable,
  casesTable,
  clientPortalUsersTable,
  clientsTable,
  db,
  portalInvitationsTable,
  propertiesTable,
  tasksTable,
  type ClientLifecycle,
} from "@workspace/db";
import { recordEnquiry, reopenLatestEnquiry, resolveOpenEnquiries } from "./client-enquiries";
import { sendChariotEmail } from "../integrations/resend";
import { renderChariotEmail } from "../integrations/email-template";
import { logger } from "../lib/logger";
import { clientProfile } from "./profile-fields";
import { createAssignmentTask, resolveAssignee, addDays } from "./assignment";
import type { ExtractedEnquiry } from "./enquiry-extraction";
import { getEmailTemplate, renderEmailTemplate, templateVarsFor } from "./email-templates";

export type ClientRow = typeof clientsTable.$inferSelect;

/** An enquiry that has waited this long for a decision is flagged on the Add page. */
export const ENQUIRY_STALE_DAYS = 3;

export const ENQUIRY_REVIEW_KIND = "enquiry_review";
/**
 * Placeholders handed out on accept for records that do not exist yet. They
 * close themselves the moment the property / case is created, at which point
 * the record's own checklist task (property_review / case_submission) takes over.
 */
export const ADVANCED_PROPERTY_KIND = "advanced_property";
export const ADVANCED_CASE_KIND = "advanced_case";
export const ADVANCED_KINDS = [ADVANCED_PROPERTY_KIND, ADVANCED_CASE_KIND] as const;

const iso = (value: Date) => value.toISOString();
const isoOrNull = (value: Date | null | undefined) => (value ? value.toISOString() : null);

export interface ClientAssigneeView {
  id: number;
  displayName: string;
}

export interface WelcomeDeliveryView {
  status: "pending" | "sent" | "disabled" | "failed";
  error: string | null;
  deliveredAt: string | null;
}

export interface ClientExtras {
  assignee: ClientAssigneeView | null;
  welcomeDelivery: WelcomeDeliveryView | null;
  /** CRM rollups shown on the clients list. */
  openCases: number;
  loanTotal: number;
  openTasks: number;
  lastActivityAt: string | null;
}

export const EMPTY_CLIENT_EXTRAS: ClientExtras = {
  assignee: null,
  welcomeDelivery: null,
  openCases: 0,
  loanTotal: 0,
  openTasks: 0,
  lastActivityAt: null,
};

export function isStaleEnquiry(row: Pick<ClientRow, "lifecycle" | "enquiryReceivedAt">, now = Date.now()) {
  if (row.lifecycle !== "enquiry") return false;
  return now - row.enquiryReceivedAt.getTime() >= ENQUIRY_STALE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * The response shape shared by every client endpoint. `onboardingStatus` is
 * passed in because the detail routes recompute it from the checklist.
 */
export function clientView(row: ClientRow, extras: ClientExtras, onboardingStatus = row.onboardingStatus) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    companyName: row.companyName,
    onboardingStatus,
    createdAt: iso(row.createdAt),
    ...clientProfile(row),
    lifecycle: row.lifecycle as ClientLifecycle,
    source: row.source ?? null,
    introducerName: row.introducerName ?? null,
    introducerContact: row.introducerContact ?? null,
    assignee: extras.assignee,
    enquiryType: row.enquiryType ?? null,
    enquirySummary: row.enquirySummary ?? null,
    enquiryTimescale: row.enquiryTimescale ?? null,
    enquiryEmailText: row.enquiryEmailText ?? null,
    enquiryEmailSubject: row.enquiryEmailSubject ?? null,
    enquiryEmailFrom: row.enquiryEmailFrom ?? null,
    enquiryReceivedAt: iso(row.enquiryReceivedAt),
    acceptedAt: isoOrNull(row.acceptedAt),
    closedAt: isoOrNull(row.closedAt),
    outcomeReason: row.outcomeReason ?? null,
    stale: isStaleEnquiry(row),
    welcomeDelivery: extras.welcomeDelivery,
    onboardingCompletedAt: isoOrNull(row.onboardingCompletedAt),
    documentFilledFields: Array.isArray(row.documentFilledFields) ? (row.documentFilledFields as string[]) : [],
    openCases: extras.openCases,
    loanTotal: extras.loanTotal,
    openTasks: extras.openTasks,
    lastActivityAt: extras.lastActivityAt,
    lastContactedAt: isoOrNull(row.lastContactedAt),
    nextFollowUpAt: row.nextFollowUpAt ?? null,
  };
}

/** Assignee names, latest welcome-email delivery and CRM rollups for a batch of clients, in a handful of queries. */
export async function clientExtrasFor(rows: ClientRow[]): Promise<Map<number, ClientExtras>> {
  const result = new Map<number, ClientExtras>();
  if (rows.length === 0) return result;
  const userIds = Array.from(new Set(rows.map((row) => row.assignedUserId).filter((id): id is number => id != null)));
  const users = userIds.length
    ? await db
        .select({ id: appUsersTable.id, displayName: appUsersTable.displayName })
        .from(appUsersTable)
        .where(inArray(appUsersTable.id, userIds))
    : [];
  const userById = new Map(users.map((user) => [user.id, user]));
  const invitations = await db
    .select({
      clientId: portalInvitationsTable.clientId,
      deliveryStatus: portalInvitationsTable.deliveryStatus,
      deliveryError: portalInvitationsTable.deliveryError,
      deliveredAt: portalInvitationsTable.deliveredAt,
    })
    .from(portalInvitationsTable)
    .where(and(
      inArray(portalInvitationsTable.clientId, rows.map((row) => row.id)),
      eq(portalInvitationsTable.purpose, "activation"),
    ))
    .orderBy(desc(portalInvitationsTable.createdAt));
  const latestByClient = new Map<number, WelcomeDeliveryView>();
  for (const invitation of invitations) {
    if (latestByClient.has(invitation.clientId)) continue;
    latestByClient.set(invitation.clientId, {
      status: invitation.deliveryStatus as WelcomeDeliveryView["status"],
      error: invitation.deliveryError ?? null,
      deliveredAt: isoOrNull(invitation.deliveredAt),
    });
  }
  const clientIds = rows.map((row) => row.id);
  const caseRows = await db
    .select({ id: casesTable.id, clientId: casesTable.clientId, status: casesTable.status, loanAmount: casesTable.loanAmount, archivedAt: casesTable.archivedAt })
    .from(casesTable)
    .where(inArray(casesTable.clientId, clientIds));
  const caseIds = caseRows.map((row) => row.id);
  const clientByCase = new Map(caseRows.map((row) => [row.id, row.clientId]));
  const openCases = new Map<number, { count: number; loan: number }>();
  for (const row of caseRows) {
    if (row.status === "completed" || row.archivedAt) continue;
    const entry = openCases.get(row.clientId) ?? { count: 0, loan: 0 };
    entry.count += 1;
    entry.loan += Number(row.loanAmount) || 0;
    openCases.set(row.clientId, entry);
  }
  const taskRows = await db
    .select({ clientId: tasksTable.clientId, caseId: tasksTable.caseId })
    .from(tasksTable)
    .where(and(
      ne(tasksTable.status, "done"),
      caseIds.length
        ? or(inArray(tasksTable.clientId, clientIds), inArray(tasksTable.caseId, caseIds))
        : inArray(tasksTable.clientId, clientIds),
    ));
  const openTasks = new Map<number, number>();
  for (const row of taskRows) {
    const clientId = row.clientId ?? (row.caseId != null ? clientByCase.get(row.caseId) : undefined);
    if (clientId == null) continue;
    openTasks.set(clientId, (openTasks.get(clientId) ?? 0) + 1);
  }
  const activityRows = await db
    .select({ entityId: activitiesTable.entityId, caseId: activitiesTable.caseId, occurredAt: activitiesTable.occurredAt })
    .from(activitiesTable)
    .where(or(
      and(eq(activitiesTable.entityType, "client"), inArray(activitiesTable.entityId, clientIds)),
      caseIds.length ? inArray(activitiesTable.caseId, caseIds) : sql`false`,
    ));
  const lastActivity = new Map<number, Date>();
  for (const row of activityRows) {
    const clientId = row.caseId != null ? clientByCase.get(row.caseId) : row.entityId;
    if (clientId == null) continue;
    const current = lastActivity.get(clientId);
    if (!current || row.occurredAt > current) lastActivity.set(clientId, row.occurredAt);
  }
  for (const row of rows) {
    const user = row.assignedUserId != null ? userById.get(row.assignedUserId) : undefined;
    const cases = openCases.get(row.id);
    result.set(row.id, {
      assignee: user ? { id: user.id, displayName: user.displayName } : null,
      welcomeDelivery: latestByClient.get(row.id) ?? null,
      openCases: cases?.count ?? 0,
      loanTotal: cases?.loan ?? 0,
      openTasks: openTasks.get(row.id) ?? 0,
      lastActivityAt: isoOrNull(lastActivity.get(row.id)),
    });
  }
  return result;
}

export async function clientExtras(row: ClientRow): Promise<ClientExtras> {
  const map = await clientExtrasFor([row]);
  return map.get(row.id) ?? EMPTY_CLIENT_EXTRAS;
}

export type ClientMatchReason = "email" | "company_number" | "phone" | "name";

const normalisePhone = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "").replace(/^44/, "0");

/**
 * Possible existing clients for a new enquiry, strongest signal first. Used to
 * steer a repeat enquiry onto the existing record instead of a duplicate.
 */
export async function findClientMatches(query: {
  email?: string | null;
  phone?: string | null;
  companyNumber?: string | null;
  name?: string | null;
  excludeClientId?: number | null;
}): Promise<Array<{ client: ClientRow; reason: ClientMatchReason }>> {
  const matches: Array<{ client: ClientRow; reason: ClientMatchReason }> = [];
  const seen = new Set<number>();
  const push = (rows: ClientRow[], reason: ClientMatchReason) => {
    for (const row of rows) {
      if (seen.has(row.id) || row.id === query.excludeClientId) continue;
      seen.add(row.id);
      matches.push({ client: row, reason });
    }
  };
  const email = query.email?.trim().toLowerCase();
  if (email) {
    push(await db.select().from(clientsTable).where(sql`lower(${clientsTable.email}) = ${email}`), "email");
  }
  const companyNumber = query.companyNumber?.trim();
  if (companyNumber) {
    push(await db.select().from(clientsTable).where(eq(clientsTable.companyNumber, companyNumber)), "company_number");
  }
  const phone = normalisePhone(query.phone);
  if (phone.length >= 10) {
    const rows = await db.select().from(clientsTable).where(
      or(ne(clientsTable.phone, ""), isNotNull(clientsTable.alternativePhone)),
    );
    push(rows.filter((row) => normalisePhone(row.phone) === phone || normalisePhone(row.alternativePhone) === phone), "phone");
  }
  const name = query.name?.trim();
  if (name && name.length >= 3) {
    push(await db.select().from(clientsTable).where(ilike(clientsTable.name, `%${name}%`)).limit(5), "name");
  }
  return matches.slice(0, 5);
}

/**
 * Create (or re-use) the portal account and send the activation email — the
 * "welcome email" of the enquiry flow. Account and invitation rows are written
 * before delivery so a Resend outage never loses the client; the delivery
 * status stays visible and Accept can re-issue it.
 */
export async function issuePortalInvitation(
  client: ClientRow,
  options: { senderName?: string; log?: { warn: (obj: unknown, msg: string) => void } } = {},
) {
  const log = options.log ?? logger;
  const setupToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(setupToken).digest("hex");
  let invitationId: number | undefined;
  try {
    const [existingUser] = await db.select().from(appUsersTable)
      .where(eq(appUsersTable.email, client.email.toLowerCase()));
    const user = existingUser ?? (await db.insert(appUsersTable).values({
      displayName: client.name,
      email: client.email.toLowerCase(),
      role: "client",
      passwordHash: null,
      mustChangePassword: true,
    }).returning())[0];
    if (!user || user.role !== "client") {
      throw new Error("Email is already assigned to a non-client account");
    }
    await db.insert(clientPortalUsersTable).values({ clientId: client.id, userId: user.id })
      .onConflictDoNothing();
    const [invitation] = await db.insert(portalInvitationsTable).values({
      clientId: client.id,
      userId: user.id,
      tokenHash,
      purpose: "activation",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      deliveryStatus: "pending",
    }).returning();
    invitationId = invitation?.id;
    const portalUrl = process.env.PORTAL_URL;
    if (!portalUrl) throw new Error("PORTAL_URL is required to deliver portal invitations");
    // The words come from the editable template; the layout and button do not.
    const template = await getEmailTemplate("client_welcome");
    const rendered = renderEmailTemplate(template, templateVarsFor(client, options.senderName ?? "Chariot"));
    const activateUrl = `${portalUrl.replace(/\/$/, "")}/activate?token=${encodeURIComponent(setupToken)}`;
    const result = await sendChariotEmail({
      purpose: "portal_activation",
      to: [client.email],
      subject: rendered.subject,
      html: renderChariotEmail({
        preheader: "Set up your client portal access within 24 hours.",
        heading: rendered.heading,
        paragraphs: rendered.paragraphs,
        cta: { label: "Set up portal access", url: activateUrl },
      }),
    });
    await db.update(portalInvitationsTable).set({
      deliveryStatus: result.status === "sent" ? "sent" : "disabled",
      deliveredAt: result.status === "sent" ? new Date() : undefined,
    }).where(eq(portalInvitationsTable.id, invitationId!));
    return { status: result.status === "sent" ? "sent" : "disabled" } as const;
  } catch (error) {
    if (invitationId) {
      await db.update(portalInvitationsTable).set({
        deliveryStatus: "failed",
        deliveryError: error instanceof Error ? error.message : "Invitation delivery failed",
      }).where(eq(portalInvitationsTable.id, invitationId));
    }
    log.warn({ err: error, clientId: client.id }, "Portal invitation was not delivered");
    return { status: "failed" } as const;
  }
}

/** Close every open auto-created task of the given kinds about this client. */
export async function completeClientTasks(clientId: number, kinds: readonly string[], completedByUserId: number | null) {
  await db.update(tasksTable)
    .set({ status: "done", completedAt: new Date(), completedByUserId })
    .where(and(
      eq(tasksTable.clientId, clientId),
      inArray(tasksTable.kind, [...kinds]),
      ne(tasksTable.status, "done"),
    ));
}

/** Step 1 → task for the enquiry owner to accept or decline. */
export async function createEnquiryReviewTask(client: ClientRow, staffUser: Awaited<ReturnType<typeof resolveAssignee>>) {
  if (!staffUser.ok) return null;
  return createAssignmentTask({
    staffUser: staffUser.staffUser,
    title: `Review new enquiry: ${client.name}`,
    notes: [
      client.enquirySummary ? client.enquirySummary : "Check the basic details, then accept (sends the welcome email) or decline.",
      client.enquiryTimescale ? `Timescale: ${client.enquiryTimescale}` : null,
    ].filter(Boolean).join("\n"),
    caseId: null,
    clientId: client.id,
    kind: ENQUIRY_REVIEW_KIND,
    dueDate: addDays(1),
  });
}

/**
 * Step 2 → accept. Welcome/portal email for a new client, then the advanced
 * information tasks go to the property and case default workers.
 */
export async function acceptClient(client: ClientRow, actor: { id: number; displayName: string }) {
  const now = new Date();
  const [updated] = await db.update(clientsTable).set({
    lifecycle: "onboarding",
    acceptedAt: client.acceptedAt ?? now,
    acceptedByUserId: client.acceptedByUserId ?? actor.id,
    closedAt: null,
    outcomeReason: null,
  }).where(eq(clientsTable.id, client.id)).returning();
  const delivery = await issuePortalInvitation(updated!, { senderName: actor.displayName });
  await resolveOpenEnquiries(client.id, "accepted");
  await completeClientTasks(client.id, [ENQUIRY_REVIEW_KIND], actor.id);
  await db.insert(activitiesTable).values({
    title: "Enquiry accepted",
    detail: `${client.name} was accepted as a client${delivery.status === "sent" ? " and sent the welcome email" : ""}`,
    actorName: actor.displayName,
    entityType: "client",
    entityId: client.id,
  });
  await createAdvancedInfoTasks(updated!);
  return { client: updated!, delivery };
}

/**
 * Step 3's work, one task per column, each for that column's default worker:
 *  - client: the onboarding checklist task (fields + documents tick as saved);
 *  - property: a review task with a field checklist for every property already
 *    read from the email, or a placeholder to add one;
 *  - case: a placeholder until the case exists, when its own checklist task
 *    (case_submission) is created and the placeholder closes.
 */
export async function createAdvancedInfoTasks(client: ClientRow) {
  const [clientAssignee, propertyAssignee, caseAssignee, properties] = await Promise.all([
    resolveAssignee({ section: "client", explicitUserId: client.assignedUserId }),
    resolveAssignee({ section: "property" }),
    resolveAssignee({ section: "case" }),
    db.select({ id: propertiesTable.id, address: propertiesTable.address })
      .from(propertiesTable).where(eq(propertiesTable.clientId, client.id)),
  ]);
  const enquiryNotes = [client.enquirySummary, client.enquiryTimescale ? `Timescale: ${client.enquiryTimescale}` : null]
    .filter(Boolean).join("\n");
  const tasks: Array<Promise<unknown>> = [];
  if (clientAssignee.ok) {
    tasks.push(createAssignmentTask({
      staffUser: clientAssignee.staffUser,
      title: `Begin onboarding for new client: ${client.name}`,
      notes: `Complete the client's advanced information and onboarding documents.`,
      caseId: null,
      clientId: client.id,
      kind: "client_onboarding",
    }));
  }
  if (propertyAssignee.ok) {
    if (properties.length > 0) {
      for (const property of properties) {
        tasks.push(createAssignmentTask({
          staffUser: propertyAssignee.staffUser,
          title: `Review new property: ${property.address}`,
          notes: `${client.name} — ${property.address}${enquiryNotes ? `\n${enquiryNotes}` : ""}`,
          caseId: null,
          clientId: client.id,
          propertyId: property.id,
          kind: "property_review",
        }));
      }
    } else {
      tasks.push(createAssignmentTask({
        staffUser: propertyAssignee.staffUser,
        title: `Add the property for ${client.name}`,
        notes: enquiryNotes || "Add the property this enquiry is about; its own checklist task follows.",
        caseId: null,
        clientId: client.id,
        kind: ADVANCED_PROPERTY_KIND,
      }));
    }
  }
  if (caseAssignee.ok) {
    tasks.push(createAssignmentTask({
      staffUser: caseAssignee.staffUser,
      title: `Set up the case for ${client.name}`,
      notes: enquiryNotes || "Create the case once the property is in place; its own checklist task follows.",
      caseId: null,
      clientId: client.id,
      kind: ADVANCED_CASE_KIND,
    }));
  }
  await Promise.all(tasks.map((task) =>
    task.catch((error) => logger.warn({ err: error, clientId: client.id }, "Advanced info task was not created"))));
}

/** Re-send the welcome email for an accepted client whose last delivery did not go out. */
export async function resendWelcome(client: ClientRow, actor: { displayName: string }) {
  const delivery = await issuePortalInvitation(client, { senderName: actor.displayName });
  await db.insert(activitiesTable).values({
    title: "Welcome email re-sent",
    detail: `${client.name}'s portal invitation was ${delivery.status === "sent" ? "re-sent" : "not delivered (" + delivery.status + ")"}`,
    actorName: actor.displayName,
    entityType: "client",
    entityId: client.id,
  });
  return delivery;
}

export async function declineClient(
  client: ClientRow,
  outcome: { status: "declined" | "lost"; reason: string },
  actor: { id: number; displayName: string },
) {
  const [updated] = await db.update(clientsTable).set({
    lifecycle: outcome.status,
    closedAt: new Date(),
    outcomeReason: outcome.reason,
  }).where(eq(clientsTable.id, client.id)).returning();
  await resolveOpenEnquiries(client.id, outcome.status, outcome.reason);
  await completeClientTasks(client.id, [ENQUIRY_REVIEW_KIND, "client_onboarding", "property_review", ...ADVANCED_KINDS], actor.id);
  await db.insert(activitiesTable).values({
    title: outcome.status === "declined" ? "Enquiry declined" : "Client lost",
    detail: `${client.name}: ${outcome.reason}`,
    actorName: actor.displayName,
    entityType: "client",
    entityId: client.id,
  });
  return updated!;
}

export async function reopenClient(client: ClientRow, actor: { id: number; displayName: string }) {
  // Back to where they were: accepted clients return to onboarding, others to enquiry.
  const lifecycle: ClientLifecycle = client.acceptedAt ? "onboarding" : "enquiry";
  const [updated] = await db.update(clientsTable).set({
    lifecycle,
    closedAt: null,
    outcomeReason: null,
    enquiryReceivedAt: lifecycle === "enquiry" ? new Date() : client.enquiryReceivedAt,
  }).where(eq(clientsTable.id, client.id)).returning();
  await reopenLatestEnquiry(client.id);
  await db.insert(activitiesTable).values({
    title: "Enquiry reopened",
    detail: `${client.name} was reopened`,
    actorName: actor.displayName,
    entityType: "client",
    entityId: client.id,
  });
  if (lifecycle === "enquiry") {
    const assignee = await resolveAssignee({ section: "client", explicitUserId: client.assignedUserId });
    await createEnquiryReviewTask(updated!, assignee).catch((error) =>
      logger.warn({ err: error, clientId: client.id }, "Enquiry review task was not created"));
  }
  return updated!;
}

/**
 * A fresh enquiry from someone already on the books. No welcome email and no
 * lifecycle change — the email is kept, a property is created when one was
 * read out of it, and the case default worker gets a task.
 */
export async function recordRepeatEnquiry(
  client: ClientRow,
  input: {
    emailText?: string | null;
    subject?: string | null;
    from?: string | null;
    extracted?: ExtractedEnquiry | null;
  },
  actor: { displayName: string },
) {
  const extracted = input.extracted ?? null;
  const summary = extracted?.enquiry.summary ?? null;
  const stamp = new Date().toLocaleDateString("en-GB");
  const noteLine = [`Repeat enquiry ${stamp}`, summary, extracted?.enquiry.timescale ? `Timescale: ${extracted.enquiry.timescale}` : null]
    .filter(Boolean).join(" — ");
  await db.update(clientsTable).set({
    notes: client.notes ? `${client.notes}\n\n${noteLine}` : noteLine,
    enquiryEmailText: input.emailText ?? client.enquiryEmailText,
    enquiryEmailSubject: input.subject ?? client.enquiryEmailSubject,
    enquiryEmailFrom: input.from ?? client.enquiryEmailFrom,
    enquiryType: extracted?.enquiry.type ?? client.enquiryType,
    enquirySummary: summary ?? client.enquirySummary,
    enquiryTimescale: extracted?.enquiry.timescale ?? client.enquiryTimescale,
    // A closed client who comes back is open again.
    ...(client.lifecycle === "declined" || client.lifecycle === "lost"
      ? { lifecycle: client.acceptedAt ? "onboarding" : "enquiry", closedAt: null, outcomeReason: null }
      : {}),
  }).where(eq(clientsTable.id, client.id));
  // The history row: an accepted client's repeat enquiry needs no review, a returning enquirer's does.
  await recordEnquiry(client.id, {
    source: input.from ? "email" : client.source,
    enquiryType: extracted?.enquiry.type ?? null,
    summary,
    timescale: extracted?.enquiry.timescale ?? null,
    emailFrom: input.from ?? null,
    emailSubject: input.subject ?? null,
    emailText: input.emailText ?? null,
    extracted,
    status: client.acceptedAt ? "accepted" : "open",
  });

  let propertyId: number | null = null;
  const property = extracted?.property;
  if (property && (property.address || property.value || property.loanAmount)) {
    const [created] = await db.insert(propertiesTable).values({
      clientId: client.id,
      address: property.address ?? "Address to confirm",
      matterType: property.matterType ?? "Unspecified",
      value: property.value ?? 0,
      loanAmount: property.loanAmount ?? 0,
      rent: property.rent ?? null,
    }).returning();
    propertyId = created?.id ?? null;
  }
  await db.insert(activitiesTable).values({
    title: "Repeat enquiry received",
    detail: summary ? `${client.name}: ${summary}` : `${client.name} sent a new enquiry`,
    actorName: actor.displayName,
    entityType: "client",
    entityId: client.id,
  });
  const repeatNotes = [summary, extracted?.enquiry.timescale ? `Timescale: ${extracted.enquiry.timescale}` : null]
    .filter(Boolean).join("\n");
  const [propertyAssignee, caseAssignee] = await Promise.all([
    resolveAssignee({ section: "property" }),
    resolveAssignee({ section: "case" }),
  ]);
  const tasks: Array<Promise<unknown>> = [];
  if (propertyId && propertyAssignee.ok) {
    tasks.push(createAssignmentTask({
      staffUser: propertyAssignee.staffUser,
      title: `Review new property: ${property?.address ?? "Address to confirm"}`,
      notes: `${client.name} — repeat enquiry${repeatNotes ? `\n${repeatNotes}` : ""}`,
      caseId: null,
      clientId: client.id,
      propertyId,
      kind: "property_review",
    }));
  }
  if (caseAssignee.ok) {
    tasks.push(createAssignmentTask({
      staffUser: caseAssignee.staffUser,
      title: `Set up the case for ${client.name} — repeat enquiry`,
      notes: repeatNotes || "An existing client has sent a new enquiry.",
      caseId: null,
      clientId: client.id,
      propertyId,
      kind: ADVANCED_CASE_KIND,
    }));
  }
  await Promise.all(tasks.map((task) =>
    task.catch((error) => logger.warn({ err: error, clientId: client.id }, "Repeat enquiry task was not created"))));
  return { propertyId };
}
