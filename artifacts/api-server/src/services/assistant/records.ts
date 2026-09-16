import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db, documentsTable } from "@workspace/db";
import {
  createRecordRegistry,
  type ApiContext,
  type Entity,
  type Rec,
  type RecordDisplay,
  type RecordMeta,
} from "./core";

/** Chariot's tool context: the signed-in staff user plus a loopback API caller. */
export type ChariotContext = ApiContext & { req: Request };

const str = (value: unknown): string | null =>
  value === null || value === undefined || value === "" ? null : String(value);

const num = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

/* ---- links between records ------------------------------------------- */

const clientHref = (row: Rec) =>
  num(row.clientId) ? `/clients/${row.clientId}` : null;
const caseHref = (row: Rec) =>
  num(row.caseId) ? `/cases/${row.caseId}` : null;
const propertyHref = (row: Rec) =>
  num(row.propertyId) ? `/properties/${row.propertyId}` : null;
const lenderHref = (row: Rec) =>
  num(row.lenderId) ? `/lenders/${row.lenderId}` : null;

/** Records a row names by id + label, for linking in prose. */
function relatedOf(row: Rec): Entity[] {
  const out: Entity[] = [];
  if (num(row.clientId) && str(row.clientName))
    out.push({
      type: "client",
      id: row.clientId as number,
      title: String(row.clientName),
      href: `/clients/${row.clientId}`,
    });
  if (num(row.caseId) && str(row.caseReference))
    out.push({
      type: "case",
      id: row.caseId as number,
      title: String(row.caseReference),
      href: `/cases/${row.caseId}`,
    });
  if (num(row.propertyId) && str(row.propertyAddress))
    out.push({
      type: "property",
      id: row.propertyId as number,
      title: String(row.propertyAddress),
      href: `/properties/${row.propertyId}`,
    });
  if (num(row.lenderId) && str(row.lenderName))
    out.push({
      type: "lender",
      id: row.lenderId as number,
      title: String(row.lenderName),
      href: `/lenders/${row.lenderId}`,
    });
  for (const key of [
    "cases",
    "properties",
    "documents",
    "tasks",
    "submissions",
  ] as const) {
    const items = Array.isArray(row[key]) ? (row[key] as Rec[]) : [];
    for (const item of items.slice(0, 25)) {
      if (typeof item.id !== "number") continue;
      if (key === "cases")
        out.push({
          type: "case",
          id: item.id,
          title: String(item.displayReference ?? item.reference ?? ""),
          href: `/cases/${item.id}`,
        });
      if (key === "properties")
        out.push({
          type: "property",
          id: item.id,
          title: String(item.address ?? ""),
          href: `/properties/${item.id}`,
        });
      if (key === "tasks")
        out.push({
          type: "task",
          id: item.id,
          title: String(item.title ?? ""),
          href: `/tasks?task=${item.id}`,
        });
      if (key === "documents")
        out.push({
          type: "document",
          id: item.id,
          title: String(item.name ?? ""),
          href: item.caseId
            ? `/cases/${item.caseId}`
            : `/clients/${item.clientId}`,
        });
      if (key === "submissions" && str(item.lenderName) && num(item.lenderId))
        out.push({
          type: "lender",
          id: item.lenderId as number,
          title: String(item.lenderName),
          href: `/lenders/${item.lenderId}`,
        });
    }
  }
  return out;
}

/* ---- files ------------------------------------------------------------ */

function mediaKind(
  type: string | null,
): RecordDisplay["media"][number]["kind"] {
  if (type?.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  if (type?.startsWith("audio/")) return "audio";
  return "file";
}

export function documentMedia(doc: Rec): RecordDisplay["media"][number] | null {
  if (!doc.uploadedAt) return null;
  return {
    kind: mediaKind(str(doc.contentType)),
    id: Number(doc.id),
    name: String(doc.name),
    url: `/api/documents/${doc.id}/view`,
    detail: str(doc.category) ?? undefined,
  };
}

function attachmentMedia(att: Rec): RecordDisplay["media"][number] {
  return {
    kind: mediaKind(str(att.contentType)),
    id: Number(att.id),
    name: String(att.name),
    url: `/api/chat/attachments/${att.id}/download`,
  };
}

const documentsMedia = (docs: Rec[]) =>
  docs
    .map(documentMedia)
    .filter((item): item is NonNullable<typeof item> => item !== null);

async function documentsFor(
  ctx: ChariotContext,
  query: string,
): Promise<Rec[]> {
  const result = await ctx.api<Rec[]>("GET", `/documents?${query}`);
  return result.ok ? result.data : [];
}

export async function documentById(id: number): Promise<Rec | null> {
  const [row] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, id));
  if (!row) return null;
  const { objectPath: _objectPath, ...rest } = row;
  return { ...rest, uploadedAt: row.uploadedAt?.toISOString() ?? null };
}

/** GET one record through the API; the error shape matches `RecordMeta.fetch`. */
const viaApi =
  (path: (id: number) => string) => async (ctx: ChariotContext, id: number) => {
    const result = await ctx.api<Rec>("GET", path(id));
    return result.ok ? result.data : { error: result.error };
  };

const chatMedia = async (_ctx: ChariotContext, row: Rec) => {
  const messages = Array.isArray(row.messages) ? (row.messages as Rec[]) : [];
  return messages.flatMap((message) =>
    (Array.isArray(message.attachments)
      ? (message.attachments as Rec[])
      : []
    ).map(attachmentMedia),
  );
};

/* ---- the registry ----------------------------------------------------- */

const META: Record<string, RecordMeta<ChariotContext>> = {
  client: {
    label: "Client",
    fetch: viaApi((id) => `/clients/${id}`),
    href: (row) => `/clients/${row.id}`,
    title: (row) => String(row.name ?? `Client ${row.id}`),
    subtitle: (row) => str(row.companyName) ?? str(row.email),
    badge: (row) => str(row.lifecycle) ?? str(row.onboardingStatus),
    fields: [
      "email",
      "phone",
      "companyName",
      "currentAddress",
      "employmentStatus",
      "annualIncome",
      "lifecycle",
      "onboardingStatus",
    ],
    omit: ["advancedInfo"],
    media: async (ctx, row) =>
      documentsMedia(
        Array.isArray(row.documents)
          ? (row.documents as Rec[])
          : await documentsFor(ctx, `clientId=${row.id}`),
      ),
    related: relatedOf,
  },
  case: {
    label: "Case",
    fetch: viaApi((id) => `/cases/${id}`),
    href: (row) => `/cases/${row.id}`,
    title: (row) =>
      String(row.displayReference ?? row.reference ?? `Case ${row.id}`),
    subtitle: (row) => str(row.clientName) ?? str(row.propertyAddress),
    badge: (row) => str(row.stage),
    fields: [
      "clientName",
      "propertyAddress",
      "matterType",
      "serviceType",
      "stage",
      "status",
      "loanAmount",
      "propertyValue",
      "lenderName",
      "lenderCaseNumber",
      "assignedTo",
      "expectedCompletionDate",
    ],
    fieldHref: {
      clientName: clientHref,
      propertyAddress: propertyHref,
      lenderName: lenderHref,
    },
    omit: ["messages", "stages"],
    media: async (ctx, row) =>
      documentsMedia(await documentsFor(ctx, `caseId=${row.id}`)),
    related: relatedOf,
  },
  property: {
    label: "Property",
    fetch: viaApi((id) => `/properties/${id}`),
    href: (row) => `/properties/${row.id}`,
    title: (row) => String(row.address ?? `Property ${row.id}`),
    subtitle: (row) => str(row.clientName) ?? str(row.matterType),
    badge: (row) => str(row.propertyType),
    fields: [
      "clientName",
      "matterType",
      "value",
      "loanAmount",
      "rent",
      "propertyType",
      "tenure",
      "bedrooms",
      "currentLender",
      "currentRateEndDate",
    ],
    fieldHref: { clientName: clientHref },
    related: relatedOf,
  },
  task: {
    label: "Task",
    fetch: viaApi((id) => `/tasks/${id}`),
    href: (row) => `/tasks?task=${row.id}`,
    title: (row) => String(row.title ?? `Task ${row.id}`),
    subtitle: (row) => str(row.caseReference) ?? str(row.clientName),
    badge: (row) => str(row.status),
    fields: [
      "assignee",
      "status",
      "priority",
      "dueDate",
      "caseReference",
      "clientName",
      "notes",
    ],
    fieldHref: { caseReference: caseHref, clientName: clientHref },
    related: relatedOf,
  },
  lender: {
    label: "Lender",
    fetch: viaApi((id) => `/lenders/${id}`),
    href: (row) => `/lenders/${row.id}`,
    title: (row) => String(row.name ?? `Lender ${row.id}`),
    badge: (row) => str(row.status),
    fields: ["status", "portfolioStage", "avgDecisionDays"],
    omit: ["profile"],
  },
  invoice: {
    label: "Invoice",
    fetch: viaApi((id) => `/invoices/${id}`),
    href: (row) => `/invoices/${row.id}`,
    title: (row) => String(row.invoiceNumber ?? `Invoice ${row.id}`),
    subtitle: (row) => str(row.clientName),
    badge: (row) => str(row.status),
    fields: [
      "clientName",
      "caseReference",
      "status",
      "total",
      "amountPaid",
      "balance",
      "dueDate",
      "issuedAt",
    ],
    fieldHref: { clientName: clientHref, caseReference: caseHref },
    related: relatedOf,
  },
  renewal: {
    label: "Renewal",
    fetch: viaApi((id) => `/renewals/${id}`),
    href: (row) => `/renewals?renewal=${row.id}`,
    title: (row) =>
      `${str(row.type) ?? "Renewal"} · ${str(row.clientName) ?? `#${row.id}`}`,
    subtitle: (row) => str(row.propertyAddress) ?? str(row.caseReference),
    badge: (row) => str(row.status),
    fields: [
      "clientName",
      "caseReference",
      "type",
      "status",
      "rateEndDate",
      "dueDate",
      "nextReminderDate",
      "notes",
    ],
    fieldHref: { clientName: clientHref, caseReference: caseHref },
    related: relatedOf,
  },
  event: {
    label: "Calendar event",
    fetch: viaApi((id) => `/calendar/${id}`),
    href: (row) => `/calendar?event=${row.id}`,
    title: (row) => String(row.title ?? `Event ${row.id}`),
    subtitle: (row) => str(row.caseReference),
    badge: (row) => str(row.eventType),
    fields: ["eventType", "eventDate", "caseReference", "completed"],
    fieldHref: { caseReference: caseHref },
    related: relatedOf,
  },
  document: {
    label: "Document",
    fetch: async (_ctx, id) => documentById(id),
    href: (row) =>
      row.caseId ? `/cases/${row.caseId}` : `/clients/${row.clientId}`,
    title: (row) => String(row.name ?? `Document ${row.id}`),
    subtitle: (row) => str(row.category),
    badge: (row) => str(row.status),
    fields: ["category", "status", "contentType", "byteSize", "uploadedAt"],
    media: async (_ctx, row) => documentsMedia([row]),
  },
  conversation: {
    label: "Conversation",
    fetch: viaApi((id) => `/conversations/${id}`),
    href: (row) => `/messages/conversation/${row.id}`,
    title: (row) => String(row.title ?? `Conversation ${row.id}`),
    subtitle: (row) => str(row.kind),
    fields: ["kind", "title"],
    media: chatMedia,
  },
  case_chat: {
    label: "Case chat",
    fetch: viaApi((id) => `/chat/cases/${id}`),
    href: (row) => `/messages/case/${row.caseId ?? row.id}`,
    title: (row) =>
      `Case chat · ${str(row.caseReference) ?? str(row.reference) ?? row.id}`,
    fields: [],
    media: chatMedia,
  },
  user: {
    label: "Staff",
    fetch: async (ctx, id) => {
      const staff = await ctx.api<Rec[]>("GET", "/staff");
      return staff.ok
        ? (staff.data.find((item) => item.id === id) ?? null)
        : { error: staff.error };
    },
    href: () => `/settings`,
    title: (row) => String(row.displayName ?? `User ${row.id}`),
    subtitle: (row) => str(row.email),
    badge: (row) => str(row.role),
    fields: ["email", "role", "active"],
  },
};

export const records = createRecordRegistry<ChariotContext>(META);
export const RECORD_TYPES = records.types;
