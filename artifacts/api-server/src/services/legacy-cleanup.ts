import { and, eq, ne } from "drizzle-orm";
import { clientApprovalsTable, db, emailTemplatesTable, requirementsTable, tasksTable } from "@workspace/db";
import { logger } from "../lib/logger";

/**
 * Startup housekeeping for flows that were removed. Idempotent: once the rows
 * are gone each run is a no-op.
 *
 * 2026-09-17 — the Submission details stage stopped asking the client to
 * confirm the pack. Cases that were mid-flow still carry the "Details
 * confirmed by client" requirement (which nothing can tick any more), the
 * pending approval, its waiting task and the email template.
 */
export async function removeLegacyFlows() {
  const requirements = await db
    .delete(requirementsTable)
    .where(eq(requirementsTable.label, "Details confirmed by client"))
    .returning({ id: requirementsTable.id });
  const approvals = await db
    .delete(clientApprovalsTable)
    .where(eq(clientApprovalsTable.kind, "submission_details"))
    .returning({ id: clientApprovalsTable.id });
  const tasks = await db
    .delete(tasksTable)
    .where(and(eq(tasksTable.kind, "submission_details_response"), ne(tasksTable.status, "done")))
    .returning({ id: tasksTable.id });
  const templates = await db
    .delete(emailTemplatesTable)
    .where(eq(emailTemplatesTable.key, "details_confirmation"))
    .returning({ key: emailTemplatesTable.key });
  const removed = requirements.length + approvals.length + tasks.length + templates.length;
  if (removed > 0) {
    logger.info(
      { requirements: requirements.length, approvals: approvals.length, tasks: tasks.length, templates: templates.length },
      "Removed the leftovers of the details-confirmation flow",
    );
  }
}
