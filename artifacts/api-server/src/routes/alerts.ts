import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  AcknowledgeAlertParams,
  AcknowledgeAlertResponse,
  EvaluateAlertsResponse,
  GetAlertSummaryResponse,
  ListAlertsQueryParams,
  ListAlertsResponse,
} from "@workspace/api-zod";
import { alertsTable, appUsersTable, casesTable, clientsTable, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireStaff } from "../auth/session";
import { isFullAccess } from "../auth/roles";
import { acknowledgeAlert, alertSummary, alertView, evaluateAlerts, listAlerts, notifyNewAlerts, recheckAlert } from "../services/alerts";
import {
  RecheckAlertParams,
  RecheckAlertResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
router.use(requireStaff);

router.get("/alerts", async (req, res): Promise<void> => {
  const query = ListAlertsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const user = res.locals.authUser;
  res.json(ListAlertsResponse.parse(await listAlerts({
    userId: user.id,
    isAdmin: isFullAccess(user.role),
    scope: query.data.scope ?? "mine",
    status: query.data.status ?? "open",
  })));
});

router.get("/alerts/summary", async (_req, res): Promise<void> => {
  const user = res.locals.authUser;
  res.json(GetAlertSummaryResponse.parse(await alertSummary(user.id)));
});

async function loadAlertView(id: number, acknowledgedBy: string | null) {
  const [row] = await db
    .select({
      alert: alertsTable,
      caseReference: sql<string | null>`coalesce(${casesTable.displayReference}, ${casesTable.reference})`,
      clientName: clientsTable.name,
      assignedTo: appUsersTable.displayName,
    })
    .from(alertsTable)
    .leftJoin(casesTable, eq(casesTable.id, alertsTable.caseId))
    .leftJoin(clientsTable, eq(clientsTable.id, alertsTable.clientId))
    .leftJoin(appUsersTable, eq(appUsersTable.id, alertsTable.assignedUserId))
    .where(eq(alertsTable.id, id));
  return row ? alertView(row.alert, { caseReference: row.caseReference, clientName: row.clientName, assignedTo: row.assignedTo, acknowledgedBy }) : null;
}

router.post("/alerts/:id/acknowledge", async (req, res): Promise<void> => {
  const params = AcknowledgeAlertParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid alert" });
    return;
  }
  const updated = await acknowledgeAlert(params.data.id, res.locals.authUser.id);
  if (!updated) {
    res.status(404).json({ error: "Alert not found or already acknowledged" });
    return;
  }
  res.json(AcknowledgeAlertResponse.parse(await loadAlertView(updated.id, res.locals.authUser.displayName)));
});

/** After fixing the cause from the card: clears the alert now if the rule no longer fires. */
router.post("/alerts/:id/recheck", async (req, res): Promise<void> => {
  const params = RecheckAlertParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid alert" });
    return;
  }
  const row = await recheckAlert(params.data.id);
  if (!row) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  res.json(RecheckAlertResponse.parse(await loadAlertView(row.id, null)));
});

/** Administrators can run the rules now instead of waiting for the scheduler. */
router.post("/alerts/evaluate", async (_req, res): Promise<void> => {
  if (!isFullAccess(res.locals.authUser.role)) {
    res.status(403).json({ error: "Only an administrator can run the alert rules" });
    return;
  }
  const result = await evaluateAlerts();
  const emailed = await notifyNewAlerts();
  res.json(EvaluateAlertsResponse.parse({ ...result, emailed }));
});

export default router;
