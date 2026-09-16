import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import * as api from "@workspace/api-zod";
import {
  activitiesTable,
  appUsersTable,
  calendarEventsTable,
  caseConversationsTable,
  casesTable,
  clientsTable,
  conversationParticipantsTable,
  db,
  documentsTable,
  invoiceLineItemsTable,
  invoicesTable,
  lenderContactsTable,
  lendersTable,
  messagesTable,
  propertiesTable,
  renewalsTable,
  taskChecklistItemsTable,
  taskCommentsTable,
  tasksTable,
} from "@workspace/db";
import { requireStaff } from "../auth/session";
import { isFullAccess, STAFF_ROLES } from "../auth/roles";
import { formatAddress } from "../lib/address";

/**
 * Site-wide search. One request fans out to every record type the user can
 * see, each as a single SQL query that
 *
 *   - matches every search term (AND) against any of the type's searchable
 *     fields (OR) — text, numbers and dates are all cast to text so "250000",
 *     "2026-03" or "07700" hit money, dates and phone numbers alike;
 *   - carries `count(*) over()` so the group total costs no second query;
 *   - selects the searchable fields too, so the API can tell the browser
 *     *which* field matched and show a snippet around the hit.
 *
 * Each type is one `Source` entry below; adding a type means adding a block.
 */
const router: IRouter = Router();
router.use(requireStaff);

type SearchType = api.GlobalSearchType;
type Hit = Omit<api.GlobalSearchHit, "date"> & { date: string | null };
type AuthUser = { id: number; role: string; displayName: string };

const DEFAULT_LIMIT = 5;
const SNIPPET_RADIUS = 48;

/** A searchable column: `label` is what the browser shows as "matched in". */
type Field<K extends string = string> = { key: K; label: string; column: SQL };

/** Display order of groups, and the canonical list of types. */
const TYPE_ORDER: SearchType[] = [
  "case",
  "client",
  "property",
  "task",
  "message",
  "event",
  "lender",
  "user",
  "notification",
  "document",
  "invoice",
  "renewal",
];

/** Escape `%`, `_` and `\` so a user typing them searches for the literal characters. */
const escapeLike = (value: string) =>
  value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Normalised terms: lower-cased, de-duplicated, whitespace-split. */
function parseTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  ];
}

/** `(f1 ilike %t1% or f2 ilike %t1% …) and (f1 ilike %t2% or …)` */
function matchesAllTerms(fields: readonly Field[], terms: string[]): SQL {
  const clauses = terms.map((term) => {
    const pattern = `%${escapeLike(term)}%`;
    return or(...fields.map((field) => sql`${field.column} ilike ${pattern}`))!;
  });
  return and(...clauses)!;
}

const text = (column: SQL | { getSQL(): SQL }) => sql`${column}::text`;
const coalesceText = (column: SQL | { getSQL(): SQL }) =>
  sql`coalesce(${column}::text, '')`;
/**
 * A column of an aliased subquery, fully qualified. Drizzle renders subquery
 * fields as a bare identifier inside `sql` templates, which is ambiguous once
 * two joined subqueries both expose `blob`.
 */
const subColumn = (alias: string, column: string) =>
  sql`${sql.identifier(alias)}.${sql.identifier(column)}`;
/** Timestamps as `YYYY-MM-DD HH:MM` so "2026-09" or "14:30" match and the snippet reads cleanly. */
const dateTime = (column: { getSQL(): SQL }) =>
  sql`to_char(${column}, 'YYYY-MM-DD HH24:MI')`;
/** Top-level values of a jsonb object joined with " · ", so snippets show the text rather than raw JSON. */
const jsonValues = (column: { getSQL(): SQL }) =>
  sql`coalesce((select string_agg(v.value, ' · ') from jsonb_each_text(case when jsonb_typeof(${column}) = 'object' then ${column} else '{}'::jsonb end) v), '')`;

/** `0` when any term hits the record's headline field, `1` otherwise — headline matches sort first within a type. */
function headlineRank(column: SQL, terms: string[]): SQL {
  const hit = or(
    ...terms.map((term) => sql`${column} ilike ${`%${escapeLike(term)}%`}`),
  )!;
  return sql`case when ${hit} then 0 else 1 end`;
}
const field = <K extends string>(
  key: K,
  label: string,
  column: SQL | { getSQL(): SQL },
  opts?: { raw?: boolean },
): Field<K> => ({
  key,
  label,
  column: opts?.raw ? (column as SQL) : text(column),
});

/**
 * Find the first searchable field whose value contains a term, and cut a short
 * snippet around it. The title fields are skipped because the title is shown anyway.
 */
function locateMatch(
  values: Record<string, unknown>,
  fields: readonly Field[],
  terms: string[],
  skipKeys: readonly string[] = [],
): { matchedField: string | null; snippet: string | null } {
  const skip = new Set(skipKeys);
  for (const term of terms) {
    for (const item of fields) {
      if (skip.has(item.key)) continue;
      const raw = values[item.key];
      if (raw == null || raw === "") continue;
      const value = typeof raw === "string" ? raw : String(raw);
      const index = value.toLowerCase().indexOf(term);
      if (index < 0) continue;
      return {
        matchedField: item.label,
        snippet: snippetAround(value, index, term.length),
      };
    }
  }
  return { matchedField: null, snippet: null };
}

function snippetAround(value: string, index: number, length: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  // Re-locate in the flattened string; whitespace collapsing can shift the index.
  const at = flat
    .toLowerCase()
    .indexOf(value.slice(index, index + length).toLowerCase());
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(flat.length, at + length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

const iso = (value: Date | string | null | undefined) =>
  value == null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();

const total = sql<number>`count(*) over()`.mapWith(Number);

const caseReference = sql<string>`coalesce(${casesTable.displayReference}, ${casesTable.reference})`;

type GroupResult = { type: SearchType; total: number; items: Hit[] };

type Source = (ctx: {
  terms: string[];
  limit: number;
  user: AuthUser;
}) => Promise<GroupResult>;

/* ----------------------------------------------------------------------------
 * Sources — one per record type
 * ------------------------------------------------------------------------- */

const searchCases: Source = async ({ terms, limit }) => {
  const fields = [
    field("reference", "Reference", caseReference, { raw: true }),
    field(
      "lenderCaseNumber",
      "Lender case number",
      casesTable.lenderCaseNumber,
    ),
    field("clientName", "Client", clientsTable.name),
    field("lenderName", "Lender", lendersTable.name),
    field("propertyAddress", "Property", casesTable.propertyAddress),
    field("matterType", "Matter type", casesTable.matterType),
    field("serviceType", "Service type", casesTable.serviceType),
    field("stage", "Stage", casesTable.stage),
    field("status", "Status", casesTable.status),
    field("assignedTo", "Assigned to", casesTable.assignedTo),
    field("loanAmount", "Loan amount", casesTable.loanAmount),
    field("propertyValue", "Property value", casesTable.propertyValue),
    field("rent", "Rent", casesTable.rent),
    field("gdv", "GDV", casesTable.gdv),
    field(
      "expectedCompletionDate",
      "Expected completion",
      dateTime(casesTable.expectedCompletionDate),
      { raw: true },
    ),
    field(
      "valuationDate",
      "Valuation date",
      dateTime(casesTable.valuationDate),
      { raw: true },
    ),
    field("draftNotes", "Notes", casesTable.draftNotes),
  ];
  const rows = await db
    .select({
      id: casesTable.id,
      updatedAt: casesTable.updatedAt,
      archivedAt: casesTable.archivedAt,
      total,
      ...selectFields(fields),
    })
    .from(casesTable)
    .innerJoin(clientsTable, eq(clientsTable.id, casesTable.clientId))
    .leftJoin(lendersTable, eq(lendersTable.id, casesTable.lenderId))
    .where(matchesAllTerms(fields, terms))
    .orderBy(
      sql`${casesTable.archivedAt} is not null`,
      headlineRank(caseReference, terms),
      desc(casesTable.updatedAt),
    )
    .limit(limit);
  return group("case", rows, (row) => ({
    type: "case",
    id: row.id,
    title: row.reference ?? "",
    subtitle: [row.clientName, row.propertyAddress].filter(Boolean).join(" · "),
    ...locateMatch(row, fields, terms, [
      "reference",
      "clientName",
      "propertyAddress",
    ]),
    badge: row.archivedAt ? "Archived" : row.stage,
    href: `/cases/${row.id}`,
    date: iso(row.updatedAt),
  }));
};

const searchClients: Source = async ({ terms, limit }) => {
  const fields = [
    field("name", "Name", clientsTable.name),
    field("companyName", "Company", clientsTable.companyName),
    field("email", "Email", clientsTable.email),
    field("phone", "Phone", clientsTable.phone),
    field(
      "alternativePhone",
      "Alternative phone",
      clientsTable.alternativePhone,
    ),
    field("currentAddress", "Current address", clientsTable.currentAddress),
    field("currentAddressCity", "Current address", clientsTable.currentAddressCity),
    field("currentAddressPostcode", "Current postcode", clientsTable.currentAddressPostcode),
    field("previousAddress", "Previous address", clientsTable.previousAddress),
    field("previousAddressCity", "Previous address", clientsTable.previousAddressCity),
    field("previousAddressPostcode", "Previous postcode", clientsTable.previousAddressPostcode),
    field("companyNumber", "Company number", clientsTable.companyNumber),
    field(
      "companyRegisteredAddress",
      "Registered address",
      clientsTable.companyRegisteredAddress,
    ),
    field("employerName", "Employer", clientsTable.employerName),
    field("jobTitle", "Job title", clientsTable.jobTitle),
    field("employmentStatus", "Employment", clientsTable.employmentStatus),
    field("nationality", "Nationality", clientsTable.nationality),
    field("maritalStatus", "Marital status", clientsTable.maritalStatus),
    field("dateOfBirth", "Date of birth", clientsTable.dateOfBirth),
    field("annualIncome", "Annual income", clientsTable.annualIncome),
    field("otherIncome", "Other income", clientsTable.otherIncome),
    field(
      "monthlyCommitments",
      "Monthly commitments",
      clientsTable.monthlyCommitments,
    ),
    field(
      "creditHistoryNotes",
      "Credit history",
      clientsTable.creditHistoryNotes,
    ),
    field("onboardingStatus", "Onboarding", clientsTable.onboardingStatus),
    field("notes", "Notes", clientsTable.notes),
    field(
      "advancedInfo",
      "Additional info",
      jsonValues(clientsTable.advancedInfo),
      { raw: true },
    ),
  ];
  const rows = await db
    .select({
      id: clientsTable.id,
      updatedAt: clientsTable.updatedAt,
      total,
      ...selectFields(fields),
    })
    .from(clientsTable)
    .where(matchesAllTerms(fields, terms))
    .orderBy(
      headlineRank(text(clientsTable.name), terms),
      desc(clientsTable.updatedAt),
    )
    .limit(limit);
  return group("client", rows, (row) => ({
    type: "client",
    id: row.id,
    title: row.name ?? "",
    subtitle:
      [row.companyName, row.email].filter(Boolean).join(" · ") || row.phone,
    ...locateMatch(row, fields, terms, ["name", "companyName", "email"]),
    badge: labelize(row.onboardingStatus),
    href: `/clients/${row.id}`,
    date: iso(row.updatedAt),
  }));
};

const searchProperties: Source = async ({ terms, limit }) => {
  const fields = [
    field("address", "Address", propertiesTable.address),
    field("city", "City", propertiesTable.city),
    field("postcode", "Postcode", propertiesTable.postcode),
    field("clientName", "Client", clientsTable.name),
    field("matterType", "Matter type", propertiesTable.matterType),
    field("propertyType", "Property type", propertiesTable.propertyType),
    field("tenure", "Tenure", propertiesTable.tenure),
    field("occupancy", "Occupancy", propertiesTable.occupancy),
    field("tenancyType", "Tenancy", propertiesTable.tenancyType),
    field("epcRating", "EPC rating", propertiesTable.epcRating),
    field("currentLender", "Current lender", propertiesTable.currentLender),
    field("value", "Value", propertiesTable.value),
    field("loanAmount", "Loan amount", propertiesTable.loanAmount),
    field("rent", "Rent", propertiesTable.rent),
    field("gdv", "GDV", propertiesTable.gdv),
    field("purchasePrice", "Purchase price", propertiesTable.purchasePrice),
    field("purchaseDate", "Purchase date", propertiesTable.purchaseDate),
    field("currentBalance", "Current balance", propertiesTable.currentBalance),
    field("currentRatePct", "Current rate", propertiesTable.currentRatePct),
    field(
      "currentRateEndDate",
      "Rate end date",
      propertiesTable.currentRateEndDate,
    ),
    field("bedrooms", "Bedrooms", propertiesTable.bedrooms),
    field("yearBuilt", "Year built", propertiesTable.yearBuilt),
    field("notes", "Notes", propertiesTable.notes),
  ];
  const rows = await db
    .select({
      id: propertiesTable.id,
      updatedAt: propertiesTable.updatedAt,
      total,
      ...selectFields(fields),
    })
    .from(propertiesTable)
    .leftJoin(clientsTable, eq(clientsTable.id, propertiesTable.clientId))
    .where(matchesAllTerms(fields, terms))
    .orderBy(
      headlineRank(text(propertiesTable.address), terms),
      desc(propertiesTable.updatedAt),
    )
    .limit(limit);
  return group("property", rows, (row) => ({
    type: "property",
    id: row.id,
    title: formatAddress(row),
    subtitle:
      [row.clientName, row.propertyType].filter(Boolean).join(" · ") || null,
    ...locateMatch(row, fields, terms, ["address", "postcode", "clientName"]),
    badge: labelize(row.matterType),
    href: `/properties/${row.id}`,
    date: iso(row.updatedAt),
  }));
};

const searchLenders: Source = async ({ terms, limit }) => {
  // Contacts are folded into one text blob per lender so a contact's name,
  // email or phone finds the lender without multiplying rows.
  const contacts = db
    .select({
      lenderId: lenderContactsTable.lenderId,
      blob: sql<string>`string_agg(concat_ws(' ', ${lenderContactsTable.name}, ${lenderContactsTable.email}, ${lenderContactsTable.phone}, ${lenderContactsTable.role}), ' | ')`.as(
        "blob",
      ),
    })
    .from(lenderContactsTable)
    .groupBy(lenderContactsTable.lenderId)
    .as("contacts");
  const fields = [
    field("name", "Name", lendersTable.name),
    field("portfolioStage", "Portfolio stage", lendersTable.portfolioStage),
    field("status", "Status", lendersTable.status),
    field("avgDecisionDays", "Avg decision days", lendersTable.avgDecisionDays),
    field("profile", "Profile", jsonValues(lendersTable.profile), {
      raw: true,
    }),
    field("contacts", "Contact", coalesceText(subColumn("contacts", "blob")), {
      raw: true,
    }),
  ];
  const rows = await db
    .select({
      id: lendersTable.id,
      createdAt: lendersTable.createdAt,
      total,
      ...selectFields(fields),
    })
    .from(lendersTable)
    .leftJoin(contacts, eq(contacts.lenderId, lendersTable.id))
    .where(matchesAllTerms(fields, terms))
    .orderBy(headlineRank(text(lendersTable.name), terms), lendersTable.name)
    .limit(limit);
  return group("lender", rows, (row) => ({
    type: "lender",
    id: row.id,
    title: row.name ?? "",
    subtitle: labelize(row.portfolioStage),
    ...locateMatch(row, fields, terms, ["name"]),
    badge: labelize(row.status),
    href: `/lenders/${row.id}`,
    date: iso(row.createdAt),
  }));
};

const searchTasks: Source = async ({ terms, limit, user }) => {
  const checklist = db
    .select({
      taskId: taskChecklistItemsTable.taskId,
      blob: sql<string>`string_agg(${taskChecklistItemsTable.title}, ' | ' order by ${taskChecklistItemsTable.position})`.as(
        "blob",
      ),
    })
    .from(taskChecklistItemsTable)
    .groupBy(taskChecklistItemsTable.taskId)
    .as("checklist");
  const comments = db
    .select({
      taskId: taskCommentsTable.taskId,
      blob: sql<string>`string_agg(concat(${taskCommentsTable.authorName}, ': ', ${taskCommentsTable.body}), ' | ' order by ${taskCommentsTable.createdAt})`.as(
        "blob",
      ),
    })
    .from(taskCommentsTable)
    .groupBy(taskCommentsTable.taskId)
    .as("comments");
  const fields = [
    field("title", "Title", tasksTable.title),
    field("caseReference", "Case", coalesceText(caseReference), { raw: true }),
    field("clientName", "Client", clientsTable.name),
    field("assignee", "Assignee", tasksTable.assignee),
    field("status", "Status", tasksTable.status),
    field("priority", "Priority", tasksTable.priority),
    field("kind", "Kind", tasksTable.kind),
    field("dueDate", "Due", tasksTable.dueDate),
    field("notes", "Notes", tasksTable.notes),
    field(
      "checklist",
      "Checklist",
      coalesceText(subColumn("checklist", "blob")),
      { raw: true },
    ),
    field("comments", "Comment", coalesceText(subColumn("comments", "blob")), {
      raw: true,
    }),
  ];
  const visibility = isFullAccess(user.role)
    ? undefined
    : eq(tasksTable.assignedUserId, user.id);
  const rows = await db
    .select({
      id: tasksTable.id,
      updatedAt: tasksTable.updatedAt,
      total,
      ...selectFields(fields),
    })
    .from(tasksTable)
    .leftJoin(casesTable, eq(casesTable.id, tasksTable.caseId))
    .leftJoin(
      clientsTable,
      eq(
        clientsTable.id,
        sql`coalesce(${tasksTable.clientId}, ${casesTable.clientId})`,
      ),
    )
    .leftJoin(checklist, eq(checklist.taskId, tasksTable.id))
    .leftJoin(comments, eq(comments.taskId, tasksTable.id))
    .where(and(visibility, matchesAllTerms(fields, terms)))
    .orderBy(
      sql`${tasksTable.status} = 'done'`,
      headlineRank(text(tasksTable.title), terms),
      tasksTable.dueDate,
      desc(tasksTable.id),
    )
    .limit(limit);
  return group("task", rows, (row) => ({
    type: "task",
    id: row.id,
    title: row.title ?? "",
    subtitle: [
      row.caseReference || row.clientName,
      `Due ${row.dueDate}`,
      row.assignee,
    ]
      .filter(Boolean)
      .join(" · "),
    ...locateMatch(row, fields, terms, [
      "title",
      "caseReference",
      "clientName",
      "assignee",
      "dueDate",
    ]),
    badge: labelize(row.status),
    href: `/tasks?task=${row.id}`,
    date: iso(row.updatedAt),
  }));
};

const searchMessages: Source = async ({ terms, limit, user }) => {
  const mine = db
    .select({ id: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, user.id));
  const fields = [
    field("body", "Message", messagesTable.body),
    field("sender", "Sender", messagesTable.sender),
    field("caseReference", "Case", coalesceText(caseReference), { raw: true }),
    field(
      "conversationTitle",
      "Conversation",
      coalesceText(caseConversationsTable.title),
      { raw: true },
    ),
  ];
  const rows = await db
    .select({
      id: messagesTable.id,
      caseId: messagesTable.caseId,
      conversationId: messagesTable.conversationId,
      conversationKind: caseConversationsTable.kind,
      createdAt: messagesTable.createdAt,
      total,
      ...selectFields(fields),
    })
    .from(messagesTable)
    .leftJoin(
      caseConversationsTable,
      eq(caseConversationsTable.id, messagesTable.conversationId),
    )
    .leftJoin(casesTable, eq(casesTable.id, messagesTable.caseId))
    .where(
      and(
        // Case chats are visible to all staff; direct/group only to participants.
        or(
          isNull(messagesTable.conversationId),
          inArray(messagesTable.conversationId, mine),
        ),
        matchesAllTerms(fields, terms),
      ),
    )
    .orderBy(desc(messagesTable.createdAt))
    .limit(limit);
  return group("message", rows, (row) => {
    const thread =
      row.conversationId != null
        ? row.conversationTitle ||
          (row.conversationKind === "group" ? "Group chat" : "Direct chat")
        : row.caseReference || "Case chat";
    const href =
      row.conversationId != null
        ? `/messages/conversation/${row.conversationId}?m=${row.id}`
        : `/messages/case/${row.caseId}?m=${row.id}`;
    return {
      type: "message",
      id: row.id,
      title: (row.body ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
      subtitle: `${row.sender} · ${thread}`,
      ...locateMatch(row, fields, terms, [
        "body",
        "sender",
        "caseReference",
        "conversationTitle",
      ]),
      badge:
        row.conversationId != null
          ? row.conversationKind === "group"
            ? "Group"
            : "Direct"
          : "Case chat",
      href,
      date: iso(row.createdAt),
    };
  });
};

const searchNotifications: Source = async ({ terms, limit }) => {
  const fields = [
    field("title", "Title", activitiesTable.title),
    field("detail", "Detail", activitiesTable.detail),
    field("actorName", "By", activitiesTable.actorName),
    field("caseReference", "Case", coalesceText(caseReference), { raw: true }),
  ];
  const rows = await db
    .select({
      id: activitiesTable.id,
      caseId: activitiesTable.caseId,
      entityType: activitiesTable.entityType,
      entityId: activitiesTable.entityId,
      occurredAt: activitiesTable.occurredAt,
      total,
      ...selectFields(fields),
    })
    .from(activitiesTable)
    .leftJoin(casesTable, eq(casesTable.id, activitiesTable.caseId))
    .where(matchesAllTerms(fields, terms))
    .orderBy(
      headlineRank(text(activitiesTable.title), terms),
      desc(activitiesTable.occurredAt),
    )
    .limit(limit);
  return group("notification", rows, (row) => ({
    type: "notification",
    id: row.id,
    title: row.title ?? "",
    subtitle:
      [row.caseReference, row.actorName].filter(Boolean).join(" · ") || null,
    ...locateMatch(row, fields, terms, ["title", "caseReference", "actorName"]),
    badge: null,
    href: notificationHref(row),
    date: iso(row.occurredAt),
  }));
};

/** Mirrors `notificationHref` in the browser's notification-kinds.ts. */
function notificationHref(row: {
  caseId: number | null;
  entityType: string | null;
  entityId: number | null;
}) {
  if (row.entityType && row.entityId) {
    switch (row.entityType) {
      case "client":
        return `/clients/${row.entityId}`;
      case "property":
        return `/properties/${row.entityId}`;
      case "invoice":
        return `/invoices/${row.entityId}`;
      case "renewal":
        return "/renewals";
      case "document":
        return "/documents";
    }
  }
  if (row.caseId) return `/cases/${row.caseId}`;
  return "/activity";
}

const searchEvents: Source = async ({ terms, limit }) => {
  const fields = [
    field("title", "Title", calendarEventsTable.title),
    field("eventType", "Type", calendarEventsTable.eventType),
    field("caseReference", "Case", coalesceText(caseReference), { raw: true }),
    field("clientName", "Client", clientsTable.name),
    field("eventDate", "Date", dateTime(calendarEventsTable.eventDate), {
      raw: true,
    }),
  ];
  const rows = await db
    .select({
      id: calendarEventsTable.id,
      completed: calendarEventsTable.completed,
      total,
      ...selectFields(fields),
    })
    .from(calendarEventsTable)
    .leftJoin(casesTable, eq(casesTable.id, calendarEventsTable.caseId))
    .leftJoin(clientsTable, eq(clientsTable.id, casesTable.clientId))
    .where(matchesAllTerms(fields, terms))
    // Upcoming first, then the most recent past events.
    .orderBy(
      sql`${calendarEventsTable.eventDate} < now()`,
      sql`abs(extract(epoch from ${calendarEventsTable.eventDate} - now()))`,
    )
    .limit(limit);
  return group("event", rows, (row) => ({
    type: "event",
    id: row.id,
    title: row.title ?? "",
    subtitle:
      [row.caseReference, row.clientName].filter(Boolean).join(" · ") || null,
    ...locateMatch(row, fields, terms, [
      "title",
      "caseReference",
      "clientName",
      "eventDate",
    ]),
    badge: row.completed ? "Done" : labelize(row.eventType),
    href: `/calendar?event=${row.id}`,
    date: iso(row.eventDate),
  }));
};

const searchUsers: Source = async ({ terms, limit }) => {
  const fields = [
    field("displayName", "Name", appUsersTable.displayName),
    field("email", "Email", appUsersTable.email),
    field("role", "Role", appUsersTable.role),
  ];
  const rows = await db
    .select({
      id: appUsersTable.id,
      active: appUsersTable.active,
      createdAt: appUsersTable.createdAt,
      total,
      ...selectFields(fields),
    })
    .from(appUsersTable)
    .where(
      and(
        inArray(appUsersTable.role, STAFF_ROLES),
        matchesAllTerms(fields, terms),
      ),
    )
    .orderBy(
      desc(appUsersTable.active),
      headlineRank(text(appUsersTable.displayName), terms),
      appUsersTable.displayName,
    )
    .limit(limit);
  return group("user", rows, (row) => ({
    type: "user",
    id: row.id,
    title: row.displayName ?? "",
    subtitle: row.email,
    ...locateMatch(row, fields, terms, ["displayName", "email"]),
    badge: row.active ? labelize(row.role) : "Inactive",
    href: `/messages/new?to=${row.id}`,
    date: iso(row.createdAt),
  }));
};

const searchDocuments: Source = async ({ terms, limit }) => {
  const fields = [
    field("name", "Name", documentsTable.name),
    field("category", "Category", documentsTable.category),
    field("status", "Status", documentsTable.status),
    field("clientName", "Client", clientsTable.name),
    field("caseReference", "Case", coalesceText(caseReference), { raw: true }),
    field("contentType", "File type", documentsTable.contentType),
  ];
  const rows = await db
    .select({
      id: documentsTable.id,
      uploadedAt: documentsTable.uploadedAt,
      total,
      ...selectFields(fields),
    })
    .from(documentsTable)
    .innerJoin(clientsTable, eq(clientsTable.id, documentsTable.clientId))
    .leftJoin(casesTable, eq(casesTable.id, documentsTable.caseId))
    .where(matchesAllTerms(fields, terms))
    .orderBy(
      headlineRank(text(documentsTable.name), terms),
      sql`${documentsTable.uploadedAt} desc nulls last`,
      desc(documentsTable.id),
    )
    .limit(limit);
  return group("document", rows, (row) => ({
    type: "document",
    id: row.id,
    title: row.name ?? "",
    subtitle: [row.clientName, row.caseReference, labelize(row.category)]
      .filter(Boolean)
      .join(" · "),
    ...locateMatch(row, fields, terms, [
      "name",
      "clientName",
      "caseReference",
      "category",
    ]),
    badge: labelize(row.status),
    href: `/documents?doc=${row.id}`,
    date: iso(row.uploadedAt),
  }));
};

const searchInvoices: Source = async ({ terms, limit }) => {
  const lines = db
    .select({
      invoiceId: invoiceLineItemsTable.invoiceId,
      blob: sql<string>`string_agg(${invoiceLineItemsTable.description}, ' | ' order by ${invoiceLineItemsTable.sortOrder})`.as(
        "blob",
      ),
    })
    .from(invoiceLineItemsTable)
    .groupBy(invoiceLineItemsTable.invoiceId)
    .as("lines");
  const fields = [
    field("invoiceNumber", "Invoice number", invoicesTable.invoiceNumber),
    field("clientName", "Client", clientsTable.name),
    field("caseReference", "Case", coalesceText(caseReference), { raw: true }),
    field("status", "Status", invoicesTable.status),
    field("dueDate", "Due", invoicesTable.dueDate),
    field("notes", "Notes", invoicesTable.notes),
    field("voidReason", "Void reason", invoicesTable.voidReason),
    field("lines", "Line item", coalesceText(subColumn("lines", "blob")), {
      raw: true,
    }),
  ];
  const rows = await db
    .select({
      id: invoicesTable.id,
      updatedAt: invoicesTable.updatedAt,
      total,
      ...selectFields(fields),
    })
    .from(invoicesTable)
    .innerJoin(clientsTable, eq(clientsTable.id, invoicesTable.clientId))
    .leftJoin(casesTable, eq(casesTable.id, invoicesTable.caseId))
    .leftJoin(lines, eq(lines.invoiceId, invoicesTable.id))
    .where(matchesAllTerms(fields, terms))
    .orderBy(
      headlineRank(text(invoicesTable.invoiceNumber), terms),
      desc(invoicesTable.createdAt),
    )
    .limit(limit);
  return group("invoice", rows, (row) => ({
    type: "invoice",
    id: row.id,
    title: row.invoiceNumber ?? "",
    subtitle: [row.clientName, row.caseReference, `Due ${row.dueDate}`]
      .filter(Boolean)
      .join(" · "),
    ...locateMatch(row, fields, terms, [
      "invoiceNumber",
      "clientName",
      "caseReference",
      "dueDate",
    ]),
    badge: labelize(row.status),
    href: `/invoices/${row.id}`,
    date: iso(row.updatedAt),
  }));
};

const searchRenewals: Source = async ({ terms, limit }) => {
  const fields = [
    field("clientName", "Client", clientsTable.name),
    field("caseReference", "Case", coalesceText(caseReference), { raw: true }),
    field("type", "Type", renewalsTable.type),
    field("status", "Status", renewalsTable.status),
    field("dueDate", "Due", renewalsTable.dueDate),
    field("rateEndDate", "Rate end", renewalsTable.rateEndDate),
    field("completionDate", "Completion", renewalsTable.completionDate),
    field("notes", "Notes", renewalsTable.notes),
  ];
  const rows = await db
    .select({
      id: renewalsTable.id,
      updatedAt: renewalsTable.updatedAt,
      total,
      ...selectFields(fields),
    })
    .from(renewalsTable)
    .innerJoin(clientsTable, eq(clientsTable.id, renewalsTable.clientId))
    .leftJoin(casesTable, eq(casesTable.id, renewalsTable.caseId))
    .where(matchesAllTerms(fields, terms))
    .orderBy(renewalsTable.dueDate)
    .limit(limit);
  return group("renewal", rows, (row) => ({
    type: "renewal",
    id: row.id,
    title: `${labelize(row.type) ?? "Rate"} renewal · ${row.clientName ?? ""}`,
    subtitle: [row.caseReference, `Due ${row.dueDate}`]
      .filter(Boolean)
      .join(" · "),
    ...locateMatch(row, fields, terms, [
      "clientName",
      "caseReference",
      "type",
      "dueDate",
    ]),
    badge: labelize(row.status),
    href: `/renewals?renewal=${row.id}`,
    date: iso(row.updatedAt),
  }));
};

const SOURCES: Record<SearchType, Source> = {
  case: searchCases,
  client: searchClients,
  property: searchProperties,
  lender: searchLenders,
  task: searchTasks,
  message: searchMessages,
  notification: searchNotifications,
  event: searchEvents,
  user: searchUsers,
  document: searchDocuments,
  invoice: searchInvoices,
  renewal: searchRenewals,
};

/* ----------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

/** Select every searchable field under its key so `locateMatch` can read it back. */
function selectFields<T extends readonly Field[]>(
  fields: T,
): { [K in T[number]["key"]]: SQL.Aliased<string | null> } {
  return Object.fromEntries(
    fields.map((item) => [
      item.key,
      (item.column as SQL<string | null>).as(item.key),
    ]),
  ) as { [K in T[number]["key"]]: SQL.Aliased<string | null> };
}

function group<Row extends { total: number }>(
  type: SearchType,
  rows: Row[],
  toHit: (row: Row) => Hit,
): GroupResult {
  return { type, total: rows[0]?.total ?? 0, items: rows.map(toHit) };
}

/** `in_progress` → `In progress`. Null-safe for optional enum-ish columns. */
function labelize(value: string | null | undefined): string | null {
  if (!value) return null;
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function parseTypes(raw: string | undefined): SearchType[] {
  if (!raw) return TYPE_ORDER;
  const wanted = new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const types = TYPE_ORDER.filter((type) => wanted.has(type));
  return types.length ? types : TYPE_ORDER;
}

/* ----------------------------------------------------------------------------
 * Route
 * ------------------------------------------------------------------------- */

router.get("/search", async (req, res): Promise<void> => {
  const query = api.GlobalSearchQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Enter at least two characters" });
    return;
  }
  const terms = parseTerms(query.data.q);
  if (terms.length === 0) {
    res.status(400).json({ error: "Enter at least two characters" });
    return;
  }
  const limit = query.data.limit ?? DEFAULT_LIMIT;
  const types = parseTypes(query.data.types);
  const user = res.locals.authUser as AuthUser;

  const groups = await Promise.all(
    types.map((type) => SOURCES[type]({ terms, limit, user })),
  );
  const nonEmpty = groups.filter((item) => item.items.length > 0);

  res.json(
    api.GlobalSearchResponse.parse({
      query: query.data.q,
      terms,
      total: nonEmpty.reduce((sum, item) => sum + item.total, 0),
      groups: nonEmpty,
    }),
  );
});

export default router;
