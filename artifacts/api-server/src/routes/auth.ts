import { Router, type IRouter } from "express";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  ActivatePortalBody,
  ActivatePortalResponse,
  ChangePasswordBody,
  ForgotPasswordBody,
  GetCurrentUserResponse,
  ListStaffProfilesResponse,
  LoginBody,
  LoginResponse,
  PinLoginBody,
  PinLoginResponse,
  ResetPasswordBody,
} from "@workspace/api-zod";
import { appUsersTable, db, passwordResetTokensTable, portalInvitationsTable, sessionsTable } from "@workspace/db";
import { renderChariotEmail } from "../integrations/email-template";
import {
  createSession,
  destroySession,
  getSessionUser,
  verifyPassword,
  hashPassword,
  requireAuthenticated,
} from "../auth/session";
import { STAFF_ROLES } from "../auth/roles";
import { sendChariotEmail } from "../integrations/resend";

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000;

const router: IRouter = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();

router.post("/auth/login", async (req, res): Promise<void> => {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const limit = attempts.get(key);
  if (limit && limit.resetAt > now && limit.count >= 10) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password" });
    return;
  }
  const [user] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.email, parsed.data.email.toLowerCase()));
  const valid =
    user?.active &&
    user.passwordHash &&
    (await verifyPassword(parsed.data.password, user.passwordHash));
  if (!valid) {
    attempts.set(key, {
      count: limit && limit.resetAt > now ? limit.count + 1 : 1,
      resetAt: now + 15 * 60 * 1000,
    });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  attempts.delete(key);
  await createSession(res, user.id);
  res.json(
    LoginResponse.parse({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    }),
  );
});

router.get("/auth/staff-profiles", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: appUsersTable.id,
      displayName: appUsersTable.displayName,
      role: appUsersTable.role,
    })
    .from(appUsersTable)
    .where(and(eq(appUsersTable.active, true), inArray(appUsersTable.role, STAFF_ROLES)));
  // Staff sign-in cards must always appear in this fixed order: admin (broker_ceo),
  // then case_manager, completions_manager, adviser — regardless of DB row order.
  const roleOrder = new Map(STAFF_ROLES.map((role, index) => [role, index]));
  const sorted = [...rows].sort((a, b) => (roleOrder.get(a.role as typeof STAFF_ROLES[number]) ?? 0) - (roleOrder.get(b.role as typeof STAFF_ROLES[number]) ?? 0));
  res.json(ListStaffProfilesResponse.parse(sorted));
});

router.post("/auth/login/pin", async (req, res): Promise<void> => {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const limit = attempts.get(key);
  if (limit && limit.resetAt > now && limit.count >= 20) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }
  const parsed = PinLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Select a profile and enter your PIN" });
    return;
  }
  const [user] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.id, parsed.data.userId));
  const fail = () => {
    attempts.set(key, {
      count: limit && limit.resetAt > now ? limit.count + 1 : 1,
      resetAt: now + 15 * 60 * 1000,
    });
    res.status(401).json({ error: "Incorrect PIN" });
  };
  if (!user?.active || !user.pinHash || !STAFF_ROLES.includes(user.role as typeof STAFF_ROLES[number])) {
    fail();
    return;
  }
  if (user.pinLockedUntil && user.pinLockedUntil.getTime() > now) {
    res.status(423).json({ error: "Account temporarily locked. Try again later." });
    return;
  }
  const valid = await verifyPassword(parsed.data.pin, user.pinHash);
  if (!valid) {
    const failedAttempts = user.pinFailedAttempts + 1;
    await db.update(appUsersTable).set({
      pinFailedAttempts: failedAttempts,
      pinLockedUntil: failedAttempts >= PIN_MAX_ATTEMPTS ? new Date(now + PIN_LOCKOUT_MS) : null,
    }).where(eq(appUsersTable.id, user.id));
    fail();
    return;
  }
  attempts.delete(key);
  await db.update(appUsersTable).set({ pinFailedAttempts: 0, pinLockedUntil: null })
    .where(eq(appUsersTable.id, user.id));
  await createSession(res, user.id);
  res.json(
    PinLoginResponse.parse({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    }),
  );
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await destroySession(req, res);
  res.status(204).end();
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(GetCurrentUserResponse.parse(user));
});

router.post("/auth/activate", async (req, res): Promise<void> => {
  const parsed = ActivatePortalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid setup token and password are required" });
    return;
  }
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const passwordHash = await hashPassword(parsed.data.password);
  const user = await db.transaction(async (tx) => {
    const [invitation] = await tx
      .update(portalInvitationsTable)
      .set({ usedAt: new Date() })
      .where(and(
        eq(portalInvitationsTable.tokenHash, tokenHash),
        isNull(portalInvitationsTable.usedAt),
        gt(portalInvitationsTable.expiresAt, new Date()),
      ))
      .returning();
    if (!invitation) return null;
    const [updated] = await tx.update(appUsersTable)
      .set({ passwordHash, mustChangePassword: false })
      .where(eq(appUsersTable.id, invitation.userId))
      .returning();
    return updated ?? null;
  });
  if (!user) {
    res.status(400).json({ error: "This setup link is invalid, expired, or has already been used" });
    return;
  }
  await createSession(res, user.id);
  if (user.role === "client") {
    const portalUrl = process.env.PORTAL_URL;
    sendChariotEmail({
      purpose: "client_welcome",
      to: [user.email],
      subject: "Your Chariot client portal is now active",
      html: renderChariotEmail({
        preheader: "Your client portal has been activated.",
        heading: "Welcome to Chariot Financial Solutions",
        paragraphs: [
          `Dear ${user.displayName},`,
          `We are pleased to confirm that your client portal has been successfully activated. Through the portal you may track the progress of your case, view your documents, and review your invoices at any time.`,
          `Should you require any assistance, your case handler remains available to support you throughout the process.`,
        ],
        cta: portalUrl ? { label: "Sign in to your portal", url: portalUrl.replace(/\/$/, "") } : undefined,
      }),
    }).catch((error) => req.log.warn({ err: error, userId: user.id }, "Client welcome email was not delivered"));
  }
  res.json(ActivatePortalResponse.parse({
    id: user.id, displayName: user.displayName, email: user.email,
    role: user.role, mustChangePassword: user.mustChangePassword,
  }));
});

router.post("/auth/password/forgot", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }
  // Always respond 204 regardless of whether the account exists, so this
  // endpoint cannot be used to enumerate registered emails.
  const [user] = await db.select().from(appUsersTable)
    .where(and(eq(appUsersTable.email, parsed.data.email.toLowerCase()), eq(appUsersTable.active, true)));
  if (user) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await db.insert(passwordResetTokensTable).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const portalUrl = process.env.PORTAL_URL;
    if (portalUrl) {
      sendChariotEmail({
        purpose: "password_reset",
        to: [user.email],
        subject: "Reset your Chariot password",
        html: renderChariotEmail({
          preheader: "Use this link to reset your password within 24 hours.",
          heading: "Password reset request",
          paragraphs: [
            `Dear ${user.displayName},`,
            `We received a request to reset the password associated with your account. Please use the button below to set a new password. For security purposes, this link will expire in 24 hours.`,
            `If you did not request this change, no further action is required and your password will remain unchanged.`,
          ],
          cta: { label: "Reset your password", url: `${portalUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}` },
        }),
      }).catch((error) => req.log.warn({ err: error, userId: user.id }, "Password reset email was not delivered"));
    } else {
      req.log.warn({ userId: user.id }, "PORTAL_URL is not set; password reset email was not sent");
    }
  }
  res.status(204).end();
});

router.post("/auth/password/reset", async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid token and password are required" });
    return;
  }
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const passwordHash = await hashPassword(parsed.data.password);
  const resetResult = await db.transaction(async (tx) => {
    const [resetToken] = await tx
      .select()
      .from(passwordResetTokensTable)
      .where(and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, new Date()),
      ))
      .limit(1);
    if (!resetToken) return { user: null, tooShort: false };
    const [user] = await tx.select().from(appUsersTable)
      .where(eq(appUsersTable.id, resetToken.userId));
    if (!user) return { user: null, tooShort: false };
    const minimumPasswordLength = user.role === "client" ? 8 : 12;
    if (parsed.data.password.length < minimumPasswordLength) {
      return { user: null, tooShort: true };
    }
    await tx.update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokensTable.id, resetToken.id));
    const [updatedUser] = await tx.update(appUsersTable)
      .set({ passwordHash, mustChangePassword: false })
      .where(eq(appUsersTable.id, resetToken.userId))
      .returning();
    return { user: updatedUser ?? null, tooShort: false };
  });
  if (resetResult.tooShort) {
    res.status(400).json({ error: "Password must be at least 12 characters for staff accounts" });
    return;
  }
  if (!resetResult.user) {
    res.status(400).json({ error: "This reset link is invalid, expired, or has already been used" });
    return;
  }
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, resetResult.user.id));
  res.status(204).end();
});

router.post("/auth/password/change", requireAuthenticated, async (req, res): Promise<void> => {
  const user = res.locals.authUser;
  const minimumPasswordLength = user.role === "client" ? 8 : 12;
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success ||
    parsed.data.currentPassword.length < minimumPasswordLength ||
    parsed.data.newPassword.length < minimumPasswordLength) {
    res.status(400).json({ error: `Current and new passwords must be at least ${minimumPasswordLength} characters` });
    return;
  }
  const [stored] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, user.id));
  if (!stored?.passwordHash || !(await verifyPassword(parsed.data.currentPassword, stored.passwordHash))) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }
  await db.update(appUsersTable).set({
    passwordHash: await hashPassword(parsed.data.newPassword),
    mustChangePassword: false,
  }).where(eq(appUsersTable.id, user.id));
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
  await createSession(res, user.id);
  res.status(204).end();
});

export default router;