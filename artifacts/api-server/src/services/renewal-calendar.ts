import { and, eq } from "drizzle-orm";
import { calendarEventsTable, clientsTable, db, renewalsTable } from "@workspace/db";

const renewalTypeLabel: Record<string, string> = {
  fixed_rate: "Fixed Rate Renewal",
  tracker: "Tracker Review",
  annual_review: "Annual Review",
  bridging: "Bridging Follow-up",
};

function shiftUtcMonthsClamped(dateValue: string, months: number): Date {
  const [year, month, date] = dateValue.split("-").map(Number);
  const targetMonthStart = new Date(Date.UTC(year!, month! - 1 + months, 1));
  const targetMonthEnd = new Date(
    Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth(),
      Math.min(date!, targetMonthEnd),
    ),
  );
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function renewalReminderDates(
  type: string,
  rateEndDate: string | null,
  completionDate: string | null,
): string[] {
  if (type.toLowerCase() === "bridging") {
    if (!completionDate) return [];
    const completion = new Date(`${completionDate}T00:00:00Z`);
    completion.setUTCDate(completion.getUTCDate() + 42);
    return [dateOnly(completion)];
  }
  if (!rateEndDate) return [];
  const rateEnd = new Date(`${rateEndDate}T00:00:00Z`);
  const start = shiftUtcMonthsClamped(rateEndDate, -6);
  const firstSunday = new Date(start);
  firstSunday.setUTCDate(firstSunday.getUTCDate() + ((7 - firstSunday.getUTCDay()) % 7));
  const dates: string[] = [];
  for (const reminder = firstSunday; reminder < rateEnd; reminder.setUTCDate(reminder.getUTCDate() + 7)) {
    dates.push(dateOnly(reminder));
  }
  return dates;
}

export async function syncRenewalCalendarEvents(row: typeof renewalsTable.$inferSelect) {
  await db.delete(calendarEventsTable).where(eq(calendarEventsTable.renewalId, row.id));
  const dates = renewalReminderDates(row.type, row.rateEndDate, row.completionDate);
  const isOpen = row.status === "upcoming" || row.status === "contacted" || row.status === "in_progress";
  if (!isOpen || dates.length === 0) return;
  const [client] = await db
    .select({ name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, row.clientId));
  await db.insert(calendarEventsTable).values(
    dates.map((eventDate) => ({
      caseId: row.caseId ?? null,
      renewalId: row.id,
      title: `${renewalTypeLabel[row.type] ?? row.type} — ${client?.name ?? "Client"}`,
      eventType: "renewal",
      source: "renewal",
      eventDate: new Date(`${eventDate}T09:00:00Z`),
      completed: false,
    })),
  );
}