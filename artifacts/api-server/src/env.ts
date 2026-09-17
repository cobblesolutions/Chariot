import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load `artifacts/api-server/.env` (git-ignored, local-only secrets such as
 * GOOGLE_MAPS_API_KEY) if it exists, so the server behaves the same whether it
 * is started via `pnpm run start`, `node dist/index.mjs` or a tool. Values
 * already present in the environment take precedence. Imported first from
 * index.ts so it runs before any module reads process.env.
 */
const candidates = [
  resolve(process.cwd(), ".env"),
  resolve(dirname(fileURLToPath(import.meta.url)), "../.env"),
];
const envFile = candidates.find((file) => existsSync(file));
if (envFile) process.loadEnvFile(envFile);
