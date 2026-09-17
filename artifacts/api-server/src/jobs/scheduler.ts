import { and, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import {
  appUsersTable,
  casesTable,
  clientsTable,
  db,
  renewalsTable,
  tasksTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { evaluateAlerts, notifyNewAlerts } from "../services/alerts";
import { sendChariotEmail } from "../integrations/resend";
import { renderChariotEmail } from "../integrations/email-template";
import { STAFF_ROLES } from "../auth/roles";
import { pollSentAgreements } from "../services/terms-agreements";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const OPEN_RENEWAL_STATUSES = new Set(["upcoming", "contacted", "in_progress"]);

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function runRenewalReminders() {
  const dueRenewals = await db
    .select({
      id: renewalsTable.id,
      clientId: renewalsTable.clientId,
      type: renewalsTable.type,
      dueDate: renewalsTable.dueDate,
      status: renewalsTable.status,
    })
    .from(renewalsTable)
    .where(
      and(
        isNull(renewalsTable.lastReminderAt),
        lte(renewalsTable.nextReminderDate, today()),
        or(...[...OPEN_RENEWAL_STATUSES].map((status) => eq(renewalsTable.status, status))),
      ),
    );
  for (const renewal of dueRenewals) {
    const [client] = await db
      .select({ name: clientsTable.name, email: clientsTable.email })
      .from(clientsTable)
      .where(eq(clientsTable.id, renewal.clientId));
    if (!client) continue;
    try {
      await sendChariotEmail({
        purpose: "renewal_reminder",
        to: [client.email],
        subject: `Your ${renewal.type.replace("_", " ")} renewal is approaching`,
        html: renderChariotEmail({
          preheader: `Your ${renewal.type.replace("_", " ")} is due ${renewal.dueDate}.`,
          heading: "Your renewal is approaching",
          paragraphs: [
            `Dear ${client.name},`,
            `We are writing to advise that your <strong>${renewal.type.replace("_", " ")}</strong> is due for renewal on <strong>${renewal.dueDate}</strong>. We recommend reviewing your options in good time to ensure continuity of terms.`,
            `Please contact your case handler at your earliest convenience so that we may discuss the most suitable arrangements ahead of the renewal date.`,
          ],
        }),
      });
      await db.update(renewalsTable).set({ lastReminderAt: new Date() }).where(eq(renewalsTable.id, renewal.id));
    } catch (error) {
      logger.warn({ err: error, renewalId: renewal.id }, "Renewal reminder email was not delivered");
    }
  }
}

async function runDailyTaskDigest() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const staff = await db
    .select({ id: appUsersTable.id, displayName: appUsersTable.displayName, email: appUsersTable.email, lastTaskDigestSentAt: appUsersTable.lastTaskDigestSentAt })
    .from(appUsersTable)
    .where(and(eq(appUsersTable.active, true), inArray(appUsersTable.role, STAFF_ROLES)));
  for (const user of staff) {
    if (user.lastTaskDigestSentAt && user.lastTaskDigestSentAt >= startOfToday) continue;
    const openTasks = await db
      .select({ title: tasksTable.title, dueDate: tasksTable.dueDate, priority: tasksTable.priority })
      .from(tasksTable)
      .where(and(eq(tasksTable.assignedUserId, user.id), ne(tasksTable.status, "done")));
    if (openTasks.length === 0) continue;
    try {
      const items = openTasks
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .map(
          (task) =>
            `<li style="margin-bottom:8px;"><strong>${task.title}</strong> — due ${task.dueDate} <span style="text-transform:capitalize;color:#6B7570;">(${task.priority} priority)</span></li>`,
        )
        .join("");
      await sendChariotEmail({
        purpose: "daily_task_digest",
        to: [user.email],
        subject: `Your daily task summary (${openTasks.length} open)`,
        html: renderChariotEmail({
          preheader: `You have ${openTasks.length} open task${openTasks.length === 1 ? "" : "s"} today.`,
          heading: "Your daily task summary",
          paragraphs: [
            `Dear ${user.displayName},`,
            `Please find below a summary of your currently outstanding tasks:`,
          ],
          rawBody: `<ul style="margin:0 0 16px 0;padding-left:20px;font-size:15px;line-height:1.6;color:#2B2E2C;">${items}</ul>`,
        }),
      });
      await db.update(appUsersTable).set({ lastTaskDigestSentAt: new Date() }).where(eq(appUsersTable.id, user.id));
    } catch (error) {
      logger.warn({ err: error, userId: user.id }, "Daily task digest email was not delivered");
    }
  }
}

async function runAlerts() {
  const result = await evaluateAlerts();
  const emailed = await notifyNewAlerts();
  if (result.raised || result.resolved || emailed) logger.info({ ...result, emailed }, "Alert rules ran");
}

async function runChecks() {
  await Promise.allSettled([runRenewalReminders(), runDailyTaskDigest(), pollSentAgreements(), runAlerts()]);
}

let started = false;

export function startEmailScheduler() {
  if (started) return;
  started = true;
  runChecks().catch((error) => logger.error({ err: error }, "Scheduled email check failed"));
  setInterval(() => {
    runChecks().catch((error) => logger.error({ err: error }, "Scheduled email check failed"));
  }, CHECK_INTERVAL_MS);
}
