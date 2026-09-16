import { Router, type IRouter, type RequestHandler } from "express";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import {
  CreateUserBody,
  CreateUserResponse,
  ListUsersResponse,
  ResendUserInviteParams,
  ResendUserInviteResponse,
  UpdateUserBody,
  UpdateUserParams,
  UpdateUserResponse,
} from "@workspace/api-zod";
import {
  appUsersTable,
  db,
  passwordResetTokensTable,
  sessionsTable,
} from "@workspace/db";
import { hashPassword, requireStaff } from "../auth/session";
import { isFullAccess, STAFF_ROLES } from "../auth/roles";
import { renderChariotEmail } from "../integrations/email-template";
import { sendChariotEmail } from "../integrations/resend";

/**
 * Settings → Users. Staff accounts are managed by the administrator only.
 *
 * A new staff member never receives a password directly. They get a
 * set-password link that reuses the password-reset flow (the reset page and
 * `/auth/password/reset`), which already enforces the 12-character staff
 * minimum. Staff links live for a week rather than the 24 hours of a
 * self-service reset so the email can sit in an inbox over a weekend.
 */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type InviteStatus = "sent" | "disabled" | "failed" | "none";

const router: IRouter = Router();
router.use(requireStaff);

const requireAdmin: RequestHandler = (_req, res, next) => {
  if (!isFullAccess(res.locals.authUser.role)) {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  next();
};
router.use(requireAdmin);

const iso = (value: Date) => value.toISOString();

type StaffRow = typeof appUsersTable.$inferSelect;

function toAccount(row: StaffRow, inviteStatus: InviteStatus) {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    active: row.active,
    hasPin: row.pinHash != null,
    status: !row.active
      ? "deactivated"
      : row.passwordHash == null
        ? "invited"
        : "active",
    inviteStatus,
    createdAt: iso(row.createdAt),
  };
}

// Delivery outcome of the latest invite is not persisted (password_reset_tokens
// has no delivery columns), so the list reports "none" and the create/resend
// responses carry the live outcome of the send they just performed.
async function loadStaffRow(id: number) {
  const [row] = await db
    .select()
    .from(appUsersTable)
    .where(and(eq(appUsersTable.id, id), inArray(appUsersTable.role, STAFF_ROLES)));
  return row ?? null;
}

async function sendSetupLink(
  user: StaffRow,
  log: { warn: (obj: unknown, msg: string) => void },
): Promise<InviteStatus> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.insert(passwordResetTokensTable).values({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  const portalUrl = process.env.PORTAL_URL;
  if (!portalUrl) {
    log.warn({ userId: user.id }, "PORTAL_URL is not set; staff setup email was not sent");
    return "failed";
  }
  try {
    const result = await sendChariotEmail({
      purpose: "password_reset",
      to: [user.email],
      subject: "Set up your Chariot account",
      html: renderChariotEmail({
        preheader: "Choose your password to start using Chariot.",
        heading: "Welcome to Chariot",
        paragraphs: [
          `Dear ${user.displayName},`,
          `An account has been created for you on Chariot. Please use the button below to choose your password. Staff passwords must be at least 12 characters.`,
          `For security purposes, this link will expire in 7 days.`,
        ],
        cta: {
          label: "Set your password",
          url: `${portalUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}&setup=1`,
        },
      }),
    });
    return result.status;
  } catch (error) {
    log.warn({ err: error, userId: user.id }, "Staff setup email was not delivered");
    return "failed";
  }
}

router.get("/settings/users", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(appUsersTable)
    .where(inArray(appUsersTable.role, STAFF_ROLES))
    .orderBy(desc(appUsersTable.active), asc(appUsersTable.displayName));
  res.json(ListUsersResponse.parse(rows.map((row) => toAccount(row, "none"))));
});

router.post("/settings/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a name, a valid email and a role" });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: appUsersTable.id })
    .from(appUsersTable)
    .where(eq(appUsersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }
  const [created] = await db
    .insert(appUsersTable)
    .values({
      displayName: parsed.data.displayName.trim(),
      email,
      role: parsed.data.role,
      passwordHash: null,
      pinHash: parsed.data.pin ? await hashPassword(parsed.data.pin) : null,
      mustChangePassword: false,
      active: true,
    })
    .returning();
  const inviteStatus = await sendSetupLink(created, req.log);
  res.status(201).json(CreateUserResponse.parse(toAccount(created, inviteStatus)));
});

router.patch("/settings/users/:id", async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid user update" });
    return;
  }
  const user = await loadStaffRow(params.data.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const self = res.locals.authUser.id === user.id;
  const { displayName, role, active, pin } = parsed.data;
  // The signed-in administrator cannot lock themselves out.
  if (self && (active === false || (role && !isFullAccess(role)))) {
    res.status(400).json({ error: "You cannot deactivate or demote your own account" });
    return;
  }
  if ((active === false || (role && !isFullAccess(role))) && isFullAccess(user.role)) {
    const otherAdmins = await db
      .select({ id: appUsersTable.id })
      .from(appUsersTable)
      .where(and(
        eq(appUsersTable.role, "broker_ceo"),
        eq(appUsersTable.active, true),
        isNotNull(appUsersTable.passwordHash),
        ne(appUsersTable.id, user.id),
      ));
    if (otherAdmins.length === 0) {
      res.status(400).json({ error: "At least one active administrator must remain" });
      return;
    }
  }
  const [updated] = await db
    .update(appUsersTable)
    .set({
      ...(displayName !== undefined ? { displayName: displayName.trim() } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(pin !== undefined
        ? {
            pinHash: pin ? await hashPassword(pin) : null,
            pinFailedAttempts: 0,
            pinLockedUntil: null,
          }
        : {}),
    })
    .where(eq(appUsersTable.id, user.id))
    .returning();
  if (active === false) {
    // Deactivation signs the person out everywhere immediately.
    await db.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
  }
  res.json(UpdateUserResponse.parse(toAccount(updated!, "none")));
});

router.post("/settings/users/:id/invite", async (req, res): Promise<void> => {
  const params = ResendUserInviteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const user = await loadStaffRow(params.data.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!user.active) {
    res.status(400).json({ error: "Reactivate the account before sending a setup link" });
    return;
  }
  const inviteStatus = await sendSetupLink(user, req.log);
  res.json(ResendUserInviteResponse.parse(toAccount(user, inviteStatus)));
});

export default router;
