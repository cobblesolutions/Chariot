import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Hosted poolers (Supabase session mode) close connections that sit idle. Recycle
// ours first, keep them alive while checked out, and never let a background
// connection error escape as an unhandled event — it would take the process down
// or leave the pool full of dead clients that fail every next query.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 8),
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  allowExitOnIdle: true,
});
pool.on("error", (error) => {
  console.error("[db] idle client error — connection dropped, it will be replaced", error.message);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
