import type { IRouter } from "express";
import { requireStaff } from "../../auth/session";
import { logger } from "../../lib/logger";
import { apiCallerFor } from "./api-client";
import { createAssistantRouter, createModelClient } from "./core";
import { systemPrompt } from "./prompt";
import type { ChariotContext } from "./records";
import { chariotTools } from "./tools";
import { DEFAULT_MODEL, DEFAULT_VISION_MODEL } from "./models";

/**
 * Chariot's wiring of the assistant core: OpenRouter + DeepSeek, staff-only,
 * tools over the loopback REST API. `POST /assistant/chat` and
 * `GET /assistant/status` come from `createAssistantRouter`.
 */
export { DEFAULT_MODEL, DEFAULT_VISION_MODEL } from "./models";

const client = createModelClient({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.ASSISTANT_MODEL || DEFAULT_MODEL,
  visionModel: process.env.ASSISTANT_VISION_MODEL || DEFAULT_VISION_MODEL,
  referer: process.env.PORTAL_URL,
  title: "Chariot Financial Solutions",
  reasoning: reasoningLevel(process.env.ASSISTANT_REASONING),
  providerSort: providerSort(process.env.ASSISTANT_PROVIDER_SORT),
  onCall: (info) => logger.info(info, "assistant model call"),
});

function providerSort(value: string | undefined) {
  return value === "throughput" || value === "price" ? value : "latency";
}

function reasoningLevel(value: string | undefined) {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : "off";
}

export const assistantRouter: IRouter = createAssistantRouter<ChariotContext>({
  requireAuth: requireStaff,
  context: (req, res) => ({
    req,
    api: apiCallerFor(req),
    user: res.locals.authUser,
  }),
  tools: chariotTools(client),
  systemPrompt: (ctx, page) => systemPrompt({ user: ctx.user, page }),
  client,
  log: (entry) => logger.info(entry, "assistant tool"),
});
