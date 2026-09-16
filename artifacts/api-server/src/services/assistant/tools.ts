import { eq } from "drizzle-orm";
import * as api from "@workspace/api-zod";
import { db, messageAttachmentsTable } from "@workspace/db";
import { documentStorage } from "../document-storage";
import { fetchApiBytes } from "./api-client";
import {
  askUserTool,
  endpointTool,
  extractFileContent,
  type Entity,
  type ModelClient,
  type Rec,
  type Tool,
  type WritePreview,
} from "./core";
import {
  documentById,
  documentMedia,
  records,
  RECORD_TYPES,
  type ChariotContext,
} from "./records";

type ChariotTool = Tool<ChariotContext>;

/* ----------------------------------------------------------------------------
 * Read tools
 * ------------------------------------------------------------------------- */

const searchRecords: ChariotTool = {
  name: "search_records",
  kind: "read",
  description:
    "Search every record type (cases, clients, properties, tasks, messages, calendar events, lenders, staff, activity, documents, invoices, renewals) by name, address, reference, phone, email, amount or date. Use this first whenever the user mentions something by name rather than by id.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Free-text search; several words are AND-ed",
      },
      types: {
        type: "array",
        items: {
          type: "string",
          enum: [
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
          ],
        },
        description: "Limit to these record types (optional)",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 25,
        description: "Hits per type, default 5",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async run(ctx, args) {
    const params = new URLSearchParams({ q: String(args.query ?? "") });
    if (Array.isArray(args.types) && args.types.length)
      params.set("types", args.types.join(","));
    if (args.limit) params.set("limit", String(args.limit));
    const result = await ctx.api<{
      total: number;
      groups: Array<{ type: string; total: number; items: Rec[] }>;
    }>("GET", `/search?${params.toString()}`);
    if (!result.ok) return { content: { error: result.error } };
    const entities: Entity[] = [];
    const groups = result.data.groups.map((group) => ({
      type: group.type,
      total: group.total,
      items: group.items.map((hit) => {
        entities.push({
          type: group.type,
          id: Number(hit.id),
          title: String(hit.title),
          href: String(hit.href),
        });
        return {
          id: hit.id,
          title: hit.title,
          subtitle: hit.subtitle,
          badge: hit.badge,
          matchedField: hit.matchedField,
          snippet: hit.snippet,
          href: hit.href,
        };
      }),
    }));
    return { content: { total: result.data.total, groups }, entities };
  },
};

/** Search types that get_record can open in full. */
const FETCHABLE = new Set([
  "client",
  "case",
  "property",
  "task",
  "lender",
  "invoice",
  "renewal",
  "event",
  "document",
]);

/**
 * Search + open in one hop. Most questions name one thing ("Sophie's case",
 * "the Farnham property"); resolving it here saves a whole model round-trip.
 * When the match is ambiguous the candidates come back instead, ready for
 * ask_user.
 */
const lookupRecord: ChariotTool = {
  name: "lookup_record",
  kind: "read",
  description:
    "Find ONE record by name/reference/address and return it in full (like search_records followed by get_record, in a single call). Use this when the user names a specific client, case, property, task, lender, invoice, renewal, event or document. If several records match equally well you get the candidates back instead of a record — then use ask_user. Use search_records when you want a list rather than one record.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Name, reference, address, phone, email…",
      },
      type: {
        type: "string",
        enum: [...FETCHABLE],
        description:
          "Restrict to one record type when the user's wording makes it clear (e.g. 'case', 'property')",
      },
    },
    required: ["query"],
  },
  async run(ctx, args) {
    const query = String(args.query ?? "").trim();
    const params = new URLSearchParams({ q: query, limit: "5" });
    const type =
      typeof args.type === "string" && FETCHABLE.has(args.type)
        ? args.type
        : null;
    if (type) params.set("types", type);
    const result = await ctx.api<{
      groups: Array<{ type: string; total: number; items: Rec[] }>;
    }>("GET", `/search?${params.toString()}`);
    if (!result.ok) return { content: { error: result.error } };
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits: Array<Rec & { type: string }> = result.data.groups
      .filter((group) => FETCHABLE.has(group.type))
      .flatMap((group) =>
        group.items.map((hit) => ({ ...hit, type: group.type })),
      );
    const entities: Entity[] = hits.map((hit) => ({
      type: hit.type,
      id: Number(hit.id),
      title: String(hit.title),
      href: String(hit.href),
    }));
    const candidates = hits.map((hit) => ({
      type: hit.type,
      id: hit.id,
      title: hit.title,
      subtitle: hit.subtitle,
      badge: hit.badge,
      matchedField: hit.matchedField,
    }));
    if (!hits.length) return { content: { found: false, candidates: [] } };
    // Unambiguous when exactly one hit's title contains every term (or there is only one hit at all).
    const titleMatches = hits.filter((hit) =>
      terms.every((term) => String(hit.title).toLowerCase().includes(term)),
    );
    const best =
      hits.length === 1
        ? hits[0]!
        : titleMatches.length === 1
          ? titleMatches[0]!
          : null;
    if (!best)
      return {
        content: { found: false, ambiguous: true, candidates },
        entities,
      };
    const record = await records.get(ctx, best.type, Number(best.id));
    if ("error" in record)
      return { content: { error: record.error, candidates }, entities };
    return {
      content: {
        found: true,
        type: best.type,
        [best.type]: record.row,
        files: record.display.media.map((item) => ({
          id: item.id,
          name: item.name,
          kind: item.kind,
        })),
        otherCandidates: candidates.filter(
          (item) => !(item.type === best.type && item.id === best.id),
        ),
      },
      displays: [record.display],
      entities: [...entities, ...record.entities],
    };
  },
};

const getRecord: ChariotTool = {
  name: "get_record",
  kind: "read",
  description:
    "Fetch one record in full by type and id, including its linked files (documents, images, audio) which are shown to the user as a card. Cases include submissions, requirements, tasks and chat; clients include onboarding, properties, cases and documents.",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string", enum: RECORD_TYPES },
      id: { type: "integer" },
    },
    required: ["type", "id"],
    additionalProperties: false,
  },
  async run(ctx, args) {
    const type = String(args.type);
    const result = await records.get(ctx, type, Number(args.id));
    if ("error" in result) return { content: { error: result.error } };
    return {
      content: {
        [type]: result.row,
        files: result.display.media.map((item) => ({
          id: item.id,
          name: item.name,
          kind: item.kind,
        })),
      },
      displays: [result.display],
      entities: result.entities,
    };
  },
};

const LIST_ENDPOINTS: Record<
  string,
  { path: string; type?: string; filters?: string[] }
> = {
  clients: { path: "/clients", type: "client" },
  cases: { path: "/cases", type: "case", filters: ["archived"] },
  properties: { path: "/properties", type: "property" },
  tasks: { path: "/tasks", type: "task" },
  lenders: { path: "/lenders", type: "lender" },
  invoices: { path: "/invoices", type: "invoice" },
  renewals: { path: "/renewals", type: "renewal" },
  events: { path: "/calendar", type: "event" },
  documents: {
    path: "/documents",
    type: "document",
    filters: ["clientId", "caseId", "category", "status"],
  },
  staff: { path: "/staff", type: "user" },
  conversations: { path: "/conversations", type: "conversation" },
  inbox: { path: "/chat/inbox" },
  activities: { path: "/activities", filters: ["page", "pageSize"] },
  dashboard: { path: "/dashboard" },
};

const listRecords: ChariotTool = {
  name: "list_records",
  kind: "read",
  description:
    "List records of one kind (clients, cases, properties, tasks, lenders, invoices, renewals, events, documents, staff, conversations, inbox, activities, dashboard). Documents accept clientId/caseId/category/status filters; cases accept archived=true; activities accept page/pageSize. Results are capped, so prefer search_records for anything specific.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: Object.keys(LIST_ENDPOINTS) },
      filters: {
        type: "object",
        additionalProperties: { type: ["string", "number", "boolean"] },
        description: "Query filters supported by that list",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Max items to return, default 40",
      },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  async run(ctx, args) {
    const endpoint = LIST_ENDPOINTS[String(args.kind)];
    if (!endpoint)
      return { content: { error: `Unknown list ${String(args.kind)}` } };
    const params = new URLSearchParams();
    const filters = (args.filters as Rec | undefined) ?? {};
    for (const key of endpoint.filters ?? []) {
      if (
        filters[key] !== undefined &&
        filters[key] !== null &&
        filters[key] !== ""
      )
        params.set(key, String(filters[key]));
    }
    const query = params.toString();
    const result = await ctx.api<unknown>(
      "GET",
      `${endpoint.path}${query ? `?${query}` : ""}`,
    );
    if (!result.ok) return { content: { error: result.error } };
    const limit = Number(args.limit) || 40;
    const raw = result.data;
    const rows = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as Rec).items)
        ? ((raw as Rec).items as unknown[])
        : null;
    if (!rows) return { content: { result: raw } };
    const items = rows
      .slice(0, limit)
      .map((row) =>
        row && typeof row === "object"
          ? records.slim(row as Rec, endpoint.type)
          : row,
      );
    const entities = endpoint.type
      ? items.flatMap((row) =>
          row && typeof row === "object"
            ? records.entities(endpoint.type!, row as Rec)
            : [],
        )
      : [];
    return {
      content: { total: rows.length, returned: items.length, items },
      entities,
    };
  },
};

function readFileTool(client: ModelClient): ChariotTool {
  return {
    name: "read_file",
    kind: "read",
    description:
      "Read the contents of a stored document or a file attached to this chat. PDFs, Word files, spreadsheets exported as CSV and text are returned as text; images are described and transcribed; audio cannot be transcribed. Use it to answer questions about a file or to extract data from it before proposing writes.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: ["document", "attachment"],
          description:
            "`document` for a stored client/case document, `attachment` for a file uploaded to this chat",
        },
        id: { type: "integer" },
        question: {
          type: "string",
          description: "For images: what to look for or extract",
        },
      },
      required: ["source", "id"],
      additionalProperties: false,
    },
    async run(ctx, args) {
      const id = Number(args.id);
      const source = args.source === "document" ? "document" : "attachment";
      const path =
        source === "document"
          ? `/documents/${id}/download`
          : `/chat/attachments/${id}/download`;
      const file = await fetchApiBytes(ctx.req, path);
      if (!file)
        return {
          content: {
            error: `${source === "document" ? "Document" : "Attachment"} ${id} not found`,
          },
        };
      const extracted = await extractFileContent(file.bytes, file.contentType);
      const doc = source === "document" ? await documentById(id) : null;
      const displays = doc
        ? [
            records.display(
              "document",
              doc,
              [documentMedia(doc)].filter((m) => m !== null),
            ),
          ]
        : undefined;
      const entities = doc ? records.entities("document", doc) : undefined;
      if (extracted.kind === "text") {
        return {
          content: {
            name: file.filename,
            contentType: file.contentType,
            pages: extracted.pages,
            truncated: extracted.truncated,
            text: extracted.text,
          },
          displays,
          entities,
        };
      }
      if (extracted.kind === "image") {
        const description = await client.describeImage(
          extracted.dataUrl,
          String(args.question ?? "") || undefined,
        );
        return {
          content: {
            name: file.filename,
            contentType: file.contentType,
            imageDescription: description,
          },
          displays,
          entities,
        };
      }
      return {
        content: {
          name: file.filename,
          contentType: file.contentType,
          error: extracted.reason,
        },
        displays,
        entities,
      };
    },
  };
}

/* ----------------------------------------------------------------------------
 * Write tools
 * ------------------------------------------------------------------------- */

const fileAttachmentAsDocument: ChariotTool = {
  name: "file_attachment_as_document",
  kind: "write",
  description:
    "File a document uploaded to this chat against a client (and optionally a case) under a document category, so it appears in that record's documents. Categories are free text such as ID, PROOF_OF_ADDRESS, BANK_STATEMENT, PAYSLIP, DIP, LENDER_OFFER, VALUATION, general.",
  parameters: {
    type: "object",
    properties: {
      attachmentId: {
        type: "integer",
        description: "Id of the file attached to this chat",
      },
      clientId: { type: "integer" },
      caseId: {
        type: ["integer", "null"],
        description:
          "Case the document belongs to, if any (must belong to the client)",
      },
      category: { type: "string", description: "Document category" },
      name: { type: "string", description: "Optional new file name" },
    },
    required: ["attachmentId", "clientId", "category"],
    additionalProperties: false,
  },
  async preview(ctx, args) {
    const [att] = await db
      .select({
        id: messageAttachmentsTable.id,
        name: messageAttachmentsTable.name,
      })
      .from(messageAttachmentsTable)
      .where(eq(messageAttachmentsTable.id, Number(args.attachmentId)));
    const client = await records.get(ctx, "client", Number(args.clientId));
    const clientTitle =
      "row" in client
        ? client.display.title
        : `Client ${String(args.clientId)}`;
    const changes: WritePreview["changes"] = [
      {
        field: "File",
        from: null,
        to: att?.name ?? `Attachment ${String(args.attachmentId)}`,
      },
      { field: "Client", from: null, to: clientTitle },
      { field: "Category", from: null, to: String(args.category) },
    ];
    if (args.caseId) {
      const found = await records.get(ctx, "case", Number(args.caseId));
      changes.push({
        field: "Case",
        from: null,
        to:
          "row" in found ? found.display.title : `Case ${String(args.caseId)}`,
      });
    }
    if (args.name)
      changes.push({
        field: "Name",
        from: att?.name ?? null,
        to: String(args.name),
      });
    return {
      title: "File document",
      summary: `File ${att?.name ?? "the attachment"} under ${clientTitle}`,
      target:
        "row" in client
          ? {
              type: "client",
              id: client.display.id,
              title: client.display.title,
              href: client.display.href,
            }
          : null,
      changes,
      destructive: false,
    };
  },
  async run(ctx, args) {
    const [att] = await db
      .select()
      .from(messageAttachmentsTable)
      .where(eq(messageAttachmentsTable.id, Number(args.attachmentId)));
    if (!att || att.uploadedByUserId !== ctx.user.id)
      return { content: { error: "Attachment not found" } };
    const bytes = await documentStorage.get(att.objectPath);
    const headers: Record<string, string> = {
      cookie: ctx.req.headers.cookie ?? "",
      "content-type": "application/octet-stream",
      "x-filename": String(args.name || att.name),
      "x-content-type": att.contentType,
      "x-client-id": String(args.clientId),
      "x-document-category": String(args.category),
    };
    if (args.caseId) headers["x-case-id"] = String(args.caseId);
    const response = await fetch(
      `http://127.0.0.1:${process.env.PORT}/api/documents/upload`,
      { method: "POST", headers, body: bytes },
    );
    const payload = (await response.json().catch(() => null)) as Rec | null;
    if (!response.ok)
      return {
        content: {
          error:
            (payload?.error as string) ?? `Upload failed (${response.status})`,
        },
      };
    const doc = payload ?? {};
    return {
      content: { ok: true, document: doc },
      displays: [
        records.display(
          "document",
          doc,
          [documentMedia(doc)].filter((m) => m !== null),
        ),
      ],
      entities: records.entities("document", doc),
    };
  },
};

const write = (spec: Parameters<typeof endpointTool>[0]) =>
  endpointTool<ChariotContext>(spec, records);

const WRITE_TOOLS: ChariotTool[] = [
  // Clients
  write({
    name: "create_client",
    label: "Create client",
    description:
      "Create a new client (an enquiry). Search first to avoid duplicates.",
    method: "POST",
    path: "/clients",
    body: api.CreateClientBody,
    creates: "client",
  }),
  write({
    name: "update_client",
    label: "Update client",
    description:
      "Update a client's details. Only include the fields that change.",
    method: "PATCH",
    path: "/clients/{id}",
    body: api.UpdateClientBody,
    target: { type: "client" },
  }),
  write({
    name: "update_client_onboarding_item",
    label: "Update onboarding item",
    description:
      "Set an onboarding checklist item's value or status for a client. Keys come from get_record(client).onboarding.items.",
    method: "PATCH",
    path: "/clients/{id}/onboarding/{key}",
    body: api.UpdateClientOnboardingItemBody,
    target: { type: "client" },
  }),
  // Cases
  write({
    name: "create_case",
    label: "Create case",
    description:
      "Open a new mortgage case for a client (and optionally a property).",
    method: "POST",
    path: "/cases",
    body: api.CreateCaseBody,
    creates: "case",
  }),
  write({
    name: "update_case",
    label: "Update case",
    description:
      "Update a case's details (amounts, lender, assignee, dates, notes…). Only include fields that change.",
    method: "PATCH",
    path: "/cases/{id}",
    body: api.UpdateCaseBody,
    target: { type: "case" },
  }),
  write({
    name: "advance_case",
    label: "Advance case stage",
    description: "Move a case to its next pipeline stage.",
    method: "POST",
    path: "/cases/{id}/advance",
    body: api.AdvanceCaseBody,
    target: { type: "case" },
  }),
  write({
    name: "archive_case",
    label: "Archive case",
    description:
      "Archive a case (hidden from the active pipeline; reversible).",
    method: "POST",
    path: "/cases/{id}/archive",
    target: { type: "case" },
    destructive: true,
  }),
  write({
    name: "add_case_requirement",
    label: "Add case requirement",
    description: "Add a requirement/checklist line to a case's current stage.",
    method: "POST",
    path: "/cases/{id}/requirements",
    body: api.AddCaseRequirementBody,
    target: { type: "case" },
  }),
  write({
    name: "update_case_requirement",
    label: "Update case requirement",
    description:
      "Mark a case requirement complete/incomplete or change it. reqId comes from get_record(case).requirements.",
    method: "PATCH",
    path: "/cases/{id}/requirements/{reqId}",
    body: api.UpdateCaseRequirementBody,
    target: { type: "case" },
  }),
  write({
    name: "create_case_submission",
    label: "Submit case to lender",
    description: "Record a submission of the case to a lender.",
    method: "POST",
    path: "/cases/{id}/submissions",
    body: api.CreateCaseSubmissionBody,
    target: { type: "case" },
  }),
  // Properties
  write({
    name: "create_property",
    label: "Create property",
    description: "Add a property, usually for a client.",
    method: "POST",
    path: "/properties",
    body: api.CreatePropertyBody,
    creates: "property",
  }),
  write({
    name: "update_property",
    label: "Update property",
    description:
      "Update a property's details. Only include fields that change.",
    method: "PATCH",
    path: "/properties/{id}",
    body: api.UpdatePropertyBody,
    target: { type: "property" },
  }),
  // Tasks
  write({
    name: "create_task",
    label: "Create task",
    description:
      "Create a task, optionally linked to a case/client/property and assigned to a staff user.",
    method: "POST",
    path: "/tasks",
    body: api.CreateTaskBody,
    creates: "task",
    hints: { dueDate: "YYYY-MM-DD" },
  }),
  write({
    name: "update_task",
    label: "Update task",
    description:
      "Update a task (status, due date, assignee, priority, title, notes).",
    method: "PATCH",
    path: "/tasks/{id}",
    body: api.UpdateTaskBody,
    target: { type: "task" },
    hints: { dueDate: "YYYY-MM-DD" },
  }),
  write({
    name: "delete_task",
    label: "Delete task",
    description: "Permanently delete a task.",
    method: "DELETE",
    path: "/tasks/{id}",
    target: { type: "task" },
    destructive: true,
  }),
  write({
    name: "add_task_comment",
    label: "Add task comment",
    description: "Post a comment on a task.",
    method: "POST",
    path: "/tasks/{id}/comments",
    body: api.CreateTaskCommentBody,
    target: { type: "task" },
  }),
  write({
    name: "add_task_checklist_item",
    label: "Add checklist item",
    description: "Add a checklist step to a task.",
    method: "POST",
    path: "/tasks/{id}/checklist",
    body: api.CreateTaskChecklistItemBody,
    target: { type: "task" },
  }),
  // Lenders
  write({
    name: "create_lender",
    label: "Create lender",
    description: "Add a lender.",
    method: "POST",
    path: "/lenders",
    body: api.CreateLenderBody,
    creates: "lender",
  }),
  write({
    name: "update_lender",
    label: "Update lender",
    description: "Update a lender.",
    method: "PATCH",
    path: "/lenders/{id}",
    body: api.UpdateLenderBody,
    target: { type: "lender" },
  }),
  write({
    name: "add_lender_contact",
    label: "Add lender contact",
    description: "Add a contact person to a lender.",
    method: "POST",
    path: "/lenders/{id}/contacts",
    body: api.CreateLenderContactBody,
    target: { type: "lender" },
  }),
  // Calendar
  write({
    name: "create_calendar_event",
    label: "Create calendar event",
    description: "Add a calendar event, optionally linked to a case.",
    method: "POST",
    path: "/calendar",
    body: api.CreateCalendarEventBody,
    creates: "event",
    hints: { eventDate: "ISO 8601 date-time" },
  }),
  write({
    name: "update_calendar_event",
    label: "Update calendar event",
    description: "Change a calendar event.",
    method: "PATCH",
    path: "/calendar/{id}",
    body: api.UpdateCalendarEventBody,
    target: { type: "event" },
  }),
  write({
    name: "delete_calendar_event",
    label: "Delete calendar event",
    description: "Delete a calendar event.",
    method: "DELETE",
    path: "/calendar/{id}",
    target: { type: "event" },
    destructive: true,
  }),
  // Invoices & renewals
  write({
    name: "create_invoice",
    label: "Create invoice",
    description: "Draft an invoice for a client with line items.",
    method: "POST",
    path: "/invoices",
    body: api.CreateInvoiceBody,
    creates: "invoice",
  }),
  write({
    name: "issue_invoice",
    label: "Issue invoice",
    description: "Issue a draft invoice.",
    method: "POST",
    path: "/invoices/{id}/issue",
    target: { type: "invoice" },
  }),
  write({
    name: "record_invoice_payment",
    label: "Record invoice payment",
    description: "Record a payment against an invoice.",
    method: "POST",
    path: "/invoices/{id}/payments",
    body: api.RecordInvoicePaymentBody,
    target: { type: "invoice" },
  }),
  write({
    name: "create_renewal",
    label: "Create renewal",
    description: "Track a rate/product renewal for a client.",
    method: "POST",
    path: "/renewals",
    body: api.CreateRenewalBody,
    creates: "renewal",
  }),
  write({
    name: "update_renewal",
    label: "Update renewal",
    description: "Update a renewal's dates, notes or status.",
    method: "PATCH",
    path: "/renewals/{id}",
    body: api.UpdateRenewalBody,
    target: { type: "renewal" },
  }),
  // Documents
  fileAttachmentAsDocument,
  write({
    name: "update_document",
    label: "Update document",
    description:
      "Re-categorise a document or change its status (e.g. move it to the right category).",
    method: "PATCH",
    path: "/documents/{id}",
    body: api.UpdateDocumentBody,
    target: { type: "document" },
  }),
  write({
    name: "delete_document",
    label: "Delete document",
    description: "Permanently delete a stored document and its file.",
    method: "DELETE",
    path: "/documents/{id}",
    target: { type: "document" },
    destructive: true,
  }),
  // Messaging
  write({
    name: "send_case_message",
    label: "Send case chat message",
    description:
      "Post a message in a case's chat on behalf of the current user. Attachments from this chat can be included via attachmentIds.",
    method: "POST",
    path: "/chat/cases/{id}/messages",
    body: api.SendCaseChatMessageBody,
    target: { type: "case" },
  }),
  write({
    name: "send_conversation_message",
    label: "Send message",
    description:
      "Send a message in a direct/group conversation on behalf of the current user.",
    method: "POST",
    path: "/conversations/{id}/messages",
    body: api.SendConversationMessageBody,
    target: { type: "conversation" },
  }),
  write({
    name: "create_conversation",
    label: "Start conversation",
    description:
      "Start a direct or group conversation with staff (participantUserIds from list_records(staff)).",
    method: "POST",
    path: "/conversations",
    body: api.CreateConversationBody,
    creates: "conversation",
  }),
];

export function chariotTools(client: ModelClient): ChariotTool[] {
  return [
    lookupRecord,
    searchRecords,
    getRecord,
    listRecords,
    readFileTool(client),
    askUserTool<ChariotContext>(),
    ...WRITE_TOOLS,
  ];
}
