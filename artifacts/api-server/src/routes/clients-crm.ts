import { Router, type IRouter, type Response } from "express";
import {
  BulkUpdateClientsBody,
  BulkUpdateClientsResponse,
  CreateClientInteractionBody,
  CreateClientInteractionParams,
  CreateClientInteractionResponse,
  DeleteClientInteractionParams,
  GetClientTimelineParams,
  GetClientTimelineResponse,
  ListClientInteractionsParams,
  ListClientInteractionsResponse,
  UpdateClientInteractionBody,
  UpdateClientInteractionParams,
  UpdateClientInteractionResponse,
} from "@workspace/api-zod";
import { activitiesTable, clientsTable, db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { isFullAccess } from "../auth/roles";
import { requireStaff } from "../auth/session";
import { activeStaffUser } from "../services/assignment";
import {
  clientTimeline,
  createInteraction,
  deleteInteraction,
  findInteraction,
  listInteractions,
  updateInteraction,
} from "../services/client-crm";
import { EMPTY_CLIENT_EXTRAS, clientExtrasFor, clientView } from "../services/clients";

/**
 * CRM additions to the client record: the interaction log, the merged
 * timeline and bulk reassignment. The core client routes stay in operations.ts.
 */
const router: IRouter = Router();
router.use(requireStaff);

const currentUser = (res: Response) => res.locals.authUser as { id: number; role: string; displayName: string };

async function loadClient(id: number) {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  return client ?? null;
}

router.post("/clients/bulk", async (req, res): Promise<void> => {
  const parsed = BulkUpdateClientsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!isFullAccess(currentUser(res).role)) {
    res.status(403).json({ error: "Only administrators can reassign clients" });
    return;
  }
  const ids = Array.from(new Set(parsed.data.ids));
  const rows = await db.select().from(clientsTable).where(inArray(clientsTable.id, ids));
  if (rows.length === 0) {
    res.status(404).json({ error: "No matching clients" });
    return;
  }
  if (parsed.data.assignedUserId !== undefined) {
    const owner = parsed.data.assignedUserId == null ? null : await activeStaffUser(parsed.data.assignedUserId);
    if (parsed.data.assignedUserId != null && !owner) {
      res.status(400).json({ error: "Assignee must be an active staff user" });
      return;
    }
    await db
      .update(clientsTable)
      .set({ assignedUserId: owner?.id ?? null })
      .where(inArray(clientsTable.id, rows.map((row) => row.id)));
    const changed = rows.filter((row) => row.assignedUserId !== (owner?.id ?? null));
    if (changed.length) {
      await db.insert(activitiesTable).values(changed.map((row) => ({
        title: owner ? "Client reassigned" : "Client unassigned",
        detail: owner ? `${row.name} is now owned by ${owner.displayName}` : `${row.name} no longer has an owner`,
        actorName: currentUser(res).displayName,
        entityType: "client" as const,
        entityId: row.id,
      })));
    }
  }
  const updated = await db.select().from(clientsTable).where(inArray(clientsTable.id, rows.map((row) => row.id)));
  const extras = await clientExtrasFor(updated);
  res.json(BulkUpdateClientsResponse.parse(
    updated.map((row) => clientView(row, extras.get(row.id) ?? EMPTY_CLIENT_EXTRAS)),
  ));
});

router.get("/clients/:id/timeline", async (req, res): Promise<void> => {
  const params = GetClientTimelineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const client = await loadClient(params.data.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(GetClientTimelineResponse.parse(await clientTimeline(client)));
});

router.get("/clients/:id/interactions", async (req, res): Promise<void> => {
  const params = ListClientInteractionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const client = await loadClient(params.data.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(ListClientInteractionsResponse.parse(await listInteractions(client.id)));
});

router.post("/clients/:id/interactions", async (req, res): Promise<void> => {
  const params = CreateClientInteractionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = CreateClientInteractionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const client = await loadClient(params.data.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const created = await createInteraction(
    client,
    {
      kind: body.data.kind,
      summary: body.data.summary,
      occurredAt: body.data.occurredAt ? new Date(body.data.occurredAt) : undefined,
      caseId: body.data.caseId ?? null,
      nextFollowUpAt: body.data.nextFollowUpAt,
    },
    currentUser(res),
  );
  res.status(201).json(CreateClientInteractionResponse.parse(created));
});

router.patch("/clients/:id/interactions/:interactionId", async (req, res): Promise<void> => {
  const params = UpdateClientInteractionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateClientInteractionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const row = await findInteraction(params.data.id, params.data.interactionId);
  if (!row) {
    res.status(404).json({ error: "Interaction not found" });
    return;
  }
  const user = currentUser(res);
  if (!isFullAccess(user.role) && row.createdByUserId !== user.id) {
    res.status(403).json({ error: "Only the author or an administrator can edit an interaction" });
    return;
  }
  res.json(UpdateClientInteractionResponse.parse(await updateInteraction(row, body.data)));
});

router.delete("/clients/:id/interactions/:interactionId", async (req, res): Promise<void> => {
  const params = DeleteClientInteractionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const row = await findInteraction(params.data.id, params.data.interactionId);
  if (!row) {
    res.status(404).json({ error: "Interaction not found" });
    return;
  }
  const user = currentUser(res);
  if (!isFullAccess(user.role) && row.createdByUserId !== user.id) {
    res.status(403).json({ error: "Only the author or an administrator can delete an interaction" });
    return;
  }
  await deleteInteraction(row);
  res.status(204).end();
});

export default router;
