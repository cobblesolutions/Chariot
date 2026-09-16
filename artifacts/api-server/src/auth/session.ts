import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Request, RequestHandler, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { appUsersTable, db, sessionsTable } from "@workspace/db";
import { isStaffRole } from "./roles";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "chariot_session";
const SESSION_DAYS = 7;
const USE_SECURE_PREVIEW_COOKIES =
  process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true";
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: USE_SECURE_PREVIEW_COOKIES,
  sameSite: USE_SECURE_PREVIEW_COOKIES ? ("none" as const) : ("lax" as const),
  path: "/",
};

export type AuthUser = Pick<
  typeof appUsersTable.$inferSelect,
  "id" | "displayName" | "email" | "role" | "mustChangePassword"
>;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltText, hashText] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64");
  const actual = (await scrypt(
    password,
    Buffer.from(saltText, "base64"),
    expected.length,
  )) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createSession(res: Response, userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessionsTable).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  res.cookie(COOKIE_NAME, token, {
    ...SESSION_COOKIE_OPTIONS,
    expires: expiresAt,
  });
}

export async function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token === "string") {
    await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.tokenHash, hashToken(token)));
  }
  res.clearCookie(COOKIE_NAME, {
    ...SESSION_COOKIE_OPTIONS,
  });
}

export async function getSessionUser(req: Request): Promise<AuthUser | null> {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token !== "string") return null;
  const [row] = await db
    .select({
      id: appUsersTable.id,
      displayName: appUsersTable.displayName,
      email: appUsersTable.email,
      role: appUsersTable.role,
      mustChangePassword: appUsersTable.mustChangePassword,
      active: appUsersTable.active,
    })
    .from(sessionsTable)
    .innerJoin(appUsersTable, eq(sessionsTable.userId, appUsersTable.id))
    .where(
      and(
        eq(sessionsTable.tokenHash, hashToken(token)),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    );
  if (!row?.active) return null;
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    mustChangePassword: row.mustChangePassword,
  };
}

export const requireStaff: RequestHandler = async (req, res, next) => {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!isStaffRole(user.role)) {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    res.locals.authUser = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAuthenticated: RequestHandler = async (req, res, next) => {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.locals.authUser = user;
    next();
  } catch (error) {
    next(error);
  }
};
