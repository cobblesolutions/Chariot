import {
  Router,
  type IRouter,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { z } from "zod";
import type { ModelClient } from "./openrouter";
import { runAssistantTurn } from "./runner";
import type {
  AssistantEvent,
  BaseContext,
  Tool,
  TranscriptMessage,
} from "./types";

const toolCall = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const transcriptMessage: z.ZodType<TranscriptMessage> = z.discriminatedUnion(
  "role",
  [
    z.object({
      role: z.literal("user"),
      content: z.string().max(20_000),
      attachments: z
        .array(
          z.object({
            id: z.int(),
            name: z.string(),
            contentType: z.string(),
            byteSize: z.int(),
          }),
        )
        .max(10)
        .optional(),
    }),
    z.object({
      role: z.literal("assistant"),
      content: z.string(),
      tool_calls: z.array(toolCall).optional(),
    }),
    z.object({
      role: z.literal("tool"),
      tool_call_id: z.string(),
      name: z.string(),
      content: z.string(),
      status: z.enum(["ok", "error", "rejected", "answered"]),
      displays: z.array(z.any()).optional(),
      entities: z.array(z.any()).optional(),
    }),
  ],
);

const chatBody = z.object({
  messages: z.array(transcriptMessage).min(1).max(400),
  approvals: z.record(z.string(), z.boolean()).optional(),
  answers: z
    .record(
      z.string(),
      z.object({
        value: z.string().max(2000),
        label: z.string().max(500).optional(),
      }),
    )
    .optional(),
  page: z.object({ path: z.string().max(500).optional() }).optional(),
});

export type PageContext = { path?: string };

export type AssistantRouterOptions<Ctx extends BaseContext> = {
  /** Auth middleware that rejects anonymous callers and sets whatever `context` needs. */
  requireAuth: RequestHandler;
  /** Builds the per-request tool context (user, API caller, request…). */
  context: (req: Request, res: Response) => Ctx;
  tools: Tool<Ctx>[];
  systemPrompt: (ctx: Ctx, page: PageContext | undefined) => string;
  client: ModelClient;
  /** Mount point inside the router; defaults to `/assistant`. */
  basePath?: string;
  log?: (entry: {
    tool: string;
    ms: number;
    status: string;
    userId: number;
  }) => void;
};

/**
 * Express router with `GET {base}/status` and `POST {base}/chat` (SSE). The
 * browser owns the transcript and sends it with every request, so the server
 * keeps no conversation state.
 */
export function createAssistantRouter<Ctx extends BaseContext>(
  options: AssistantRouterOptions<Ctx>,
): IRouter {
  const base = options.basePath ?? "/assistant";
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  const router: IRouter = Router();
  router.use(base, options.requireAuth);

  router.get(`${base}/status`, (_req, res) => {
    res.json({
      enabled: options.client.enabled,
      model: options.client.model,
      visionModel: options.client.visionModel,
    });
  });

  router.post(`${base}/chat`, async (req, res): Promise<void> => {
    if (!options.client.enabled) {
      res
        .status(503)
        .json({ error: "The assistant is not configured (missing API key)" });
      return;
    }
    const body = chatBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid assistant request" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const controller = new AbortController();
    req.on("close", () => controller.abort());
    const emit = (event: AssistantEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, 15_000);

    const ctx = options.context(req, res);
    try {
      await runAssistantTurn<Ctx>({
        ctx,
        tools,
        client: options.client,
        systemPrompt: options.systemPrompt(ctx, body.data.page),
        transcript: body.data.messages,
        approvals: body.data.approvals,
        answers: body.data.answers,
        signal: controller.signal,
        emit,
        log: options.log
          ? (entry) => options.log!({ ...entry, userId: ctx.user.id })
          : undefined,
      });
    } catch (error) {
      emit({
        type: "error",
        message:
          error instanceof Error ? error.message : "The assistant failed",
      });
      emit({ type: "done", awaiting: null });
    } finally {
      clearInterval(keepAlive);
      res.end();
    }
  });

  return router;
}
