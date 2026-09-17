import { activitiesTable, db } from "@workspace/db";
import { classifyActivityTitle, type ActivityKind } from "./activity-kinds";

type ActivityInsert = Omit<typeof activitiesTable.$inferInsert, "kind"> & { kind?: ActivityKind };

/**
 * Write an activity with its kind stored. Prefer this over inserting into
 * `activitiesTable` directly; the kind defaults to what the title classifies as.
 */
export async function logActivity(values: ActivityInsert) {
  const [row] = await db
    .insert(activitiesTable)
    .values({ ...values, kind: values.kind ?? classifyActivityTitle(values.title) })
    .returning();
  return row!;
}
