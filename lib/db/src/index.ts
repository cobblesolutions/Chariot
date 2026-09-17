import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { SUPABASE_CA_CERT } from "./supabase-ca";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// A DATABASE_URL copied from local dev may carry sslmode=verify-full plus a
// sslrootcert query param pointing at a path that only exists on that
// developer's machine. Strip both and verify against the bundled CA instead,
// so the same connection string works unmodified in any environment.
const connectionUrl = new URL(process.env.DATABASE_URL);
const sslMode = connectionUrl.searchParams.get("sslmode");
connectionUrl.searchParams.delete("sslmode");
connectionUrl.searchParams.delete("sslrootcert");
const ssl =
  sslMode && sslMode !== "disable"
    ? { ca: SUPABASE_CA_CERT, rejectUnauthorized: true }
    : undefined;

// Hosted poolers (Supabase session mode) close connections that sit idle. Recycle
// ours first, keep them alive while checked out, and never let a background
// connection error escape as an unhandled event — it would take the process down
// or leave the pool full of dead clients that fail every next query.
export const pool = new Pool({
  connectionString: connectionUrl.toString(),
  ssl,
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
