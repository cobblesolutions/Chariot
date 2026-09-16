import { eq } from "drizzle-orm";
import { appUsersTable, db } from "@workspace/db";
import { hashPassword } from "./session";
import type { StaffRole } from "./roles";

interface BootstrapAccount {
  email: string;
  displayName: string;
  password?: string;
  role: StaffRole;
}

const accounts: BootstrapAccount[] = [
  {
    email: process.env.CHARIOT_ADMIN_EMAIL ?? "admin@chariot.co.uk",
    displayName: process.env.CHARIOT_ADMIN_NAME ?? "Admin",
    password: process.env.CHARIOT_ADMIN_INITIAL_PASSWORD,
    role: "broker_ceo",
  },
  {
    email: process.env.CHARIOT_WORKER_A_EMAIL ?? "worker.a@chariot.co.uk",
    displayName: process.env.CHARIOT_WORKER_A_NAME ?? "Worker A",
    password: process.env.CHARIOT_WORKER_A_INITIAL_PASSWORD,
    role: "case_manager",
  },
  {
    email: process.env.CHARIOT_WORKER_B_EMAIL ?? "worker.b@chariot.co.uk",
    displayName: process.env.CHARIOT_WORKER_B_NAME ?? "Worker B",
    password: process.env.CHARIOT_WORKER_B_INITIAL_PASSWORD,
    role: "completions_manager",
  },
];

export async function provisionBootstrapAccounts() {
  const missingPasswords = accounts
    .filter((account) => !account.password)
    .map((account) => account.email);
  if (process.env.NODE_ENV === "production" && missingPasswords.length > 0) {
    throw new Error(
      `Missing initial staff password secrets for: ${missingPasswords.join(", ")}`,
    );
  }

  for (const account of accounts) {
    if (!account.password) continue;
    const email = account.email.trim().toLowerCase();
    const [existing] = await db
      .select()
      .from(appUsersTable)
      .where(eq(appUsersTable.email, email));
    const passwordHash = await hashPassword(account.password);
    if (existing) {
      await db
        .update(appUsersTable)
        .set({
          displayName: account.displayName,
          role: account.role,
          passwordHash,
          mustChangePassword: false,
          active: true,
        })
        .where(eq(appUsersTable.id, existing.id));
    } else {
      await db
        .insert(appUsersTable)
        .values({
          displayName: account.displayName,
          email,
          role: account.role,
          passwordHash,
          mustChangePassword: false,
          active: true,
        })
        .returning({ id: appUsersTable.id });
    }
  }
}
