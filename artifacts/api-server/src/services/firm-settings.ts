import { eq } from "drizzle-orm";
import { appUsersTable, db, firmSettingsTable } from "@workspace/db";

/** Firm-wide settings: one JSON value per key. */
export async function getFirmSetting<T>(key: string): Promise<{ value: T; updatedAt: Date; updatedBy: string | null } | null> {
  const [row] = await db
    .select({ value: firmSettingsTable.value, updatedAt: firmSettingsTable.updatedAt, updatedBy: appUsersTable.displayName })
    .from(firmSettingsTable)
    .leftJoin(appUsersTable, eq(firmSettingsTable.updatedByUserId, appUsersTable.id))
    .where(eq(firmSettingsTable.key, key));
  return row ? { value: row.value as T, updatedAt: row.updatedAt, updatedBy: row.updatedBy ?? null } : null;
}

export async function setFirmSetting(key: string, value: unknown, userId: number | null) {
  await db
    .insert(firmSettingsTable)
    .values({ key, value: value as object, updatedByUserId: userId })
    .onConflictDoUpdate({ target: firmSettingsTable.key, set: { value: value as object, updatedByUserId: userId, updatedAt: new Date() } });
}
