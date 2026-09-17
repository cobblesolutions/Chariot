import "./env";
import app from "./app";
import { logger } from "./lib/logger";
import { provisionBootstrapAccounts } from "./auth/bootstrap";
import { startEmailScheduler } from "./jobs/scheduler";
import { loadDocusignConnection } from "./integrations/docusign";
import { removeLegacyFlows } from "./services/legacy-cleanup";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await provisionBootstrapAccounts();
await removeLegacyFlows().catch((err) => logger.warn({ err }, "Legacy cleanup failed"));
await loadDocusignConnection();
startEmailScheduler();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
