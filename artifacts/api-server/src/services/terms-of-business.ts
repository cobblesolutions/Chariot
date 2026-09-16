import { eq } from "drizzle-orm";
import { activitiesTable, appUsersTable, clientsTable, db } from "@workspace/db";
import { documentStorage } from "./document-storage";
import { getFirmSetting, setFirmSetting } from "./firm-settings";

export const TOB_KEY = "terms_of_business";

export interface TermsDocument {
  objectPath: string;
  filename: string;
  contentType: string;
  byteSize: number;
  version: number;
  uploadedAt: string;
  uploadedByUserId: number | null;
}

/** The firm-wide Terms of Business currently published, or null. */
export async function getTermsDocument() {
  const setting = await getFirmSetting<TermsDocument>(TOB_KEY);
  if (!setting?.value?.objectPath) return null;
  return { ...setting.value, uploadedBy: setting.updatedBy };
}

export function termsDocumentView(doc: Awaited<ReturnType<typeof getTermsDocument>>) {
  if (!doc) return null;
  return {
    filename: doc.filename,
    contentType: doc.contentType,
    byteSize: doc.byteSize,
    version: doc.version,
    uploadedAt: doc.uploadedAt,
    uploadedBy: doc.uploadedBy ?? null,
  };
}

/** Replace the published document; the version increments and the old file is removed. */
export async function publishTermsDocument(bytes: Buffer, filename: string, contentType: string, userId: number, actorName: string) {
  const previous = await getTermsDocument();
  const stored = await documentStorage.put(bytes);
  const next: TermsDocument = {
    objectPath: stored.key,
    filename,
    contentType,
    byteSize: stored.size,
    version: (previous?.version ?? 0) + 1,
    uploadedAt: new Date().toISOString(),
    uploadedByUserId: userId,
  };
  await setFirmSetting(TOB_KEY, next, userId);
  if (previous?.objectPath) await documentStorage.delete(previous.objectPath).catch(() => undefined);
  await db.insert(activitiesTable).values({
    title: "Terms of Business updated",
    detail: `${filename} published as version ${next.version}`,
    actorName,
  });
  return getTermsDocument();
}

export async function readTermsDocument() {
  const doc = await getTermsDocument();
  if (!doc) return null;
  return { doc, bytes: await documentStorage.get(doc.objectPath) };
}

export type TermsRow = Pick<typeof clientsTable.$inferSelect, "tobAcceptedAt" | "tobAcceptedVia" | "tobVersion" | "tobNote" | "tobAcceptedByUserId">;

/** The acceptance shown on the client, or null when not accepted. */
export async function termsAcceptanceView(row: TermsRow) {
  if (!row.tobAcceptedAt) return null;
  let acceptedBy: string | null = null;
  if (row.tobAcceptedByUserId) {
    const [user] = await db.select({ displayName: appUsersTable.displayName }).from(appUsersTable).where(eq(appUsersTable.id, row.tobAcceptedByUserId));
    acceptedBy = user?.displayName ?? null;
  }
  return {
    acceptedAt: row.tobAcceptedAt.toISOString(),
    via: (row.tobAcceptedVia ?? "staff") as "portal" | "signed_upload" | "staff",
    version: row.tobVersion ?? null,
    note: row.tobNote ?? null,
    acceptedBy,
  };
}

export function termsAcceptanceText(row: TermsRow) {
  if (!row.tobAcceptedAt) return null;
  const when = row.tobAcceptedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const how = row.tobAcceptedVia === "portal" ? "Accepted in the portal" : row.tobAcceptedVia === "signed_upload" ? "Signed copy received" : "Accepted (recorded by staff)";
  return `${how} · ${when}${row.tobVersion ? ` · v${row.tobVersion}` : ""}`;
}

/**
 * Record acceptance — by the client in the portal, or by staff after a signed
 * copy / phone agreement. Completes the onboarding item and logs it.
 */
export async function acceptTerms(
  clientId: number,
  options: { via: "portal" | "signed_upload" | "staff"; note?: string | null; actor: { id: number | null; displayName: string } },
) {
  const doc = await getTermsDocument();
  const [updated] = await db
    .update(clientsTable)
    .set({
      tobAcceptedAt: new Date(),
      tobAcceptedVia: options.via,
      tobVersion: doc?.version ?? null,
      tobAcceptedByUserId: options.via === "portal" ? null : options.actor.id,
      tobNote: options.note?.trim() || null,
    })
    .where(eq(clientsTable.id, clientId))
    .returning();
  if (!updated) return null;
  await db.insert(activitiesTable).values({
    title: "Terms of Business accepted",
    detail: `${updated.name}: ${options.via === "portal" ? "accepted in the portal" : options.via === "signed_upload" ? "signed copy received" : "accepted — recorded by staff"}${doc ? ` (v${doc.version})` : ""}${options.note?.trim() ? ` — ${options.note.trim()}` : ""}`,
    actorName: options.actor.displayName,
    entityType: "client",
    entityId: updated.id,
  });
  // Loaded here, not at the top: task-checklists imports client-onboarding, which imports this file.
  const { syncClientChecklists } = await import("./task-checklists");
  await syncClientChecklists(updated.id);
  return updated;
}
