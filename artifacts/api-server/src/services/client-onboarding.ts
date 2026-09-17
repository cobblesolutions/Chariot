import { asc, and, eq, notInArray } from "drizzle-orm";
import { appUsersTable, clientOnboardingItemsTable, clientsTable, db, documentsTable } from "@workspace/db";
import { logActivity } from "./activities";
import { sendChariotEmail } from "../integrations/resend";
import { renderChariotEmail } from "../integrations/email-template";
import { logger } from "../lib/logger";

const definitions = [
  { key: "identity", label: "Proof of identity", kind: "document", sortOrder: 1 },
  { key: "bank_statements", label: "Three latest personal bank statements", kind: "document", sortOrder: 2 },
  { key: "proof_income", label: "Proof of income", kind: "document", sortOrder: 3 },
  { key: "credit_report", label: "Credit report", kind: "document", sortOrder: 4 },
  // The Terms of Business are signed per case (services/terms-agreements.ts),
  // and the property portfolio is a property matter: neither is a client item.
  { key: "residential_status", label: "Residential status", kind: "field", sortOrder: 7 },
  { key: "current_residence_since", label: "Date moved to current residence", kind: "date", sortOrder: 8 },
  { key: "employment_start_date", label: "Employment start date", kind: "date", sortOrder: 9 },
  { key: "company_bank_details", label: "Company bank details for DDM", kind: "textarea", sortOrder: 10 },
] as const;

/** The fixed onboarding requirements every client carries. */
export const ONBOARDING_DEFINITIONS = definitions;

export async function ensureClientOnboarding(clientId: number) {
  await db.insert(clientOnboardingItemsTable).values(
    definitions.map((item) => ({ clientId, ...item, status: "required" })),
  ).onConflictDoNothing();
  // Requirements dropped from the list (e.g. the old portfolio item) go too.
  await db.delete(clientOnboardingItemsTable).where(and(
    eq(clientOnboardingItemsTable.clientId, clientId),
    notInArray(clientOnboardingItemsTable.key, definitions.map((item) => item.key)),
  ));
}

export async function getClientOnboarding(clientId: number) {
  await ensureClientOnboarding(clientId);
  const items = await db.select().from(clientOnboardingItemsTable)
    .where(eq(clientOnboardingItemsTable.clientId, clientId))
    .orderBy(asc(clientOnboardingItemsTable.sortOrder));
  const documents = await db.select({
    category: documentsTable.category,
  }).from(documentsTable).where(eq(documentsTable.clientId, clientId));
  const documentCategories = new Set(documents.map((document) => document.category));
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  const normalizedItems = items.map((item) => {
    const complete = item.kind === "document"
      ? documentCategories.has(item.key)
      : Boolean(item.value?.trim());
    return {
      item,
      status: complete ? "complete" : "required",
      complete,
      detail: null as string | null,
    } as const;
  });
  for (const { item, status } of normalizedItems) {
    if (item.status !== status) {
      await db.update(clientOnboardingItemsTable)
        .set({ status })
        .where(eq(clientOnboardingItemsTable.id, item.id));
    }
  }
  const completed = normalizedItems.filter(({ complete }) => complete).length;
  const status = completed === items.length
    ? "complete"
    : completed > 0
      ? "in_progress"
      : "not_started";
  await db.update(clientsTable).set({ onboardingStatus: status }).where(eq(clientsTable.id, clientId));
  if (status === "complete" && client && !client.onboardingCompletedAt) {
    await notifyOnboardingComplete(client).catch((error) =>
      logger.warn({ err: error, clientId }, "Onboarding-complete notification failed"));
  }
  return {
    status,
    completed,
    total: items.length,
      items: normalizedItems.map(({ item, status, detail }) => ({
        key: item.key,
        label: item.label,
        kind: item.kind,
        value: item.value,
        status,
        detail,
        updatedAt: item.updatedAt.toISOString(),
    })),
  };
}

/**
 * A nudge to a client whose onboarding has stalled: what is still missing,
 * with a link to the portal. Logged either way; delivery depends on Resend.
 */
export async function sendOnboardingReminder(clientId: number, actorName: string) {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) return null;
  const onboarding = await getClientOnboarding(clientId);
  const missing = onboarding.items.filter((item) => item.status !== "complete").map((item) => item.label);
  const portalUrl = process.env.PORTAL_URL?.replace(/\/$/, "");
  const result = await sendChariotEmail({
    purpose: "onboarding_reminder",
    to: [client.email],
    subject: "A few things we still need from you",
    html: renderChariotEmail({
      heading: "We still need a few things",
      paragraphs: [
        `Dear ${client.name.trim().split(/\s+/)[0] || client.name},`,
        missing.length
          ? `To move your case forward we still need: ${missing.join(", ")}. You can add them in your client portal in a couple of minutes.`
          : "Please log in to your client portal to check everything is complete.",
        "If anything is difficult to provide, just reply to this email and we will help.",
      ],
      cta: portalUrl ? { label: "Open your portal", url: `${portalUrl}/portal` } : undefined,
    }),
  });
  await logActivity({
    kind: "client",
    title: "Onboarding reminder sent",
    detail: `${client.name}: ${missing.length ? `${missing.length} item${missing.length === 1 ? "" : "s"} outstanding` : "nothing outstanding"}${result.status === "sent" ? "" : ` (email ${result.status})`}`,
    actorName,
    entityType: "client",
    entityId: client.id,
  });
  return { status: result.status, missing };
}

/**
 * Scope step 5 ("make sure all is completed — admin/client notified"): the
 * first time every item is done, stamp it, log it, and email the worker who
 * owns the client and the client themselves. The stamp keeps it to once.
 */
async function notifyOnboardingComplete(client: typeof clientsTable.$inferSelect) {
  const [claimed] = await db
    .update(clientsTable)
    .set({ onboardingCompletedAt: new Date() })
    .where(and(eq(clientsTable.id, client.id), eq(clientsTable.onboardingStatus, "complete")))
    .returning({ id: clientsTable.id, onboardingCompletedAt: clientsTable.onboardingCompletedAt });
  if (!claimed) return;
  await logActivity({
    kind: "onboarded",
    title: "Onboarding complete",
    detail: `${client.name} has provided every onboarding item`,
    actorName: "System",
    entityType: "client",
    entityId: client.id,
  });
  const [worker] = client.assignedUserId
    ? await db.select({ email: appUsersTable.email, displayName: appUsersTable.displayName }).from(appUsersTable).where(eq(appUsersTable.id, client.assignedUserId))
    : [];
  const sends: Promise<unknown>[] = [];
  if (worker) {
    sends.push(sendChariotEmail({
      purpose: "onboarding_complete",
      to: [worker.email],
      subject: `Onboarding complete: ${client.name}`,
      html: renderChariotEmail({
        heading: "A client has finished onboarding",
        paragraphs: [
          `Dear ${worker.displayName},`,
          `${client.name} has now provided every onboarding item. Their case can move on to the next step.`,
        ],
        cta: process.env.PORTAL_URL ? { label: "Open the client", url: `${process.env.PORTAL_URL.replace(/\/$/, "")}/add/${client.id}` } : undefined,
      }),
    }));
  }
  sends.push(sendChariotEmail({
    purpose: "onboarding_complete",
    to: [client.email],
    subject: "Thank you — we have everything we need",
    html: renderChariotEmail({
      heading: "Thank you",
      paragraphs: [
        `Dear ${client.name.trim().split(/\s+/)[0] || client.name},`,
        `We have received everything we asked for. Your adviser will be in touch with the next step; you can follow progress in your client portal.`,
      ],
    }),
  }));
  await Promise.allSettled(sends);
}

export async function updateClientOnboardingItem(args: {
  clientId: number;
  key: string;
  value?: string | null;
  status?: "required" | "complete" | "not_applicable";
  actorUserId: number;
  allowNotApplicable: boolean;
}) {
  await ensureClientOnboarding(args.clientId);
  const [item] = await db.select().from(clientOnboardingItemsTable).where(
    and(eq(clientOnboardingItemsTable.clientId, args.clientId), eq(clientOnboardingItemsTable.key, args.key)),
  );
  if (!item) return null;
  if (args.status === "not_applicable" && !args.allowNotApplicable) {
    throw new Error("Only staff can mark an onboarding item Not Applicable");
  }
  if (args.status === "not_applicable") {
    throw new Error("All client onboarding items are required");
  }
  if (item.kind === "document" && args.status === "complete") {
    throw new Error("Document requirements are completed by uploading the requested document");
  }
  const value = args.value === undefined ? item.value : args.value?.trim() || null;
  const [updated] = await db.update(clientOnboardingItemsTable).set({
    value,
    status: item.kind === "document" ? item.status : value ? "complete" : "required",
    updatedByUserId: args.actorUserId,
  }).where(eq(clientOnboardingItemsTable.id, item.id)).returning();
  await getClientOnboarding(args.clientId);
  return updated;
}

export async function syncClientOnboardingDocument(
  clientId: number,
  key: string,
  actorUserId: number,
) {
  const definition = definitions.find((item) => item.key === key && item.kind === "document");
  if (!definition) return;
  await ensureClientOnboarding(clientId);
  await db.update(clientOnboardingItemsTable).set({ updatedByUserId: actorUserId })
    .where(and(
      eq(clientOnboardingItemsTable.clientId, clientId),
      eq(clientOnboardingItemsTable.key, key),
    ));
  await getClientOnboarding(clientId);
}