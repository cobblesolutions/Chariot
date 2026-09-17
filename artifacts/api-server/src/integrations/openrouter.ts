import { keyProgress, progressReport } from "../services/ai-progress";
import { streamJsonCompletion, type JsonMessageContent } from "./openrouter-stream";

export type AiWorkflow =
  | "extract_client_enquiry"
  | "extract_client_instruction"
  | "summarise_underwriting_email"
  | "create_underwriting_tasks"
  | "summarise_lender_offer"
  | "extract_lender_offer_details"
  | "verify_offer_consistency"
  | "summarise_terms_pricing"
  | "draft_client_advice";

export interface AiRequest<TContext> {
  workflow: AiWorkflow;
  context: TContext;
  schemaName: string;
  systemInstruction: string;
  /**
   * Which model to spend on. "cheap" is for simple extraction (lists out of an
   * email) and uses OPENROUTER_MODEL_CHEAP; "standard" (default) uses OPENROUTER_MODEL.
   */
  tier?: "cheap" | "standard";
  document?: {
    filename: string;
    contentType: string;
    bytes: Buffer;
  };
  /**
   * Live progress for the browser: the token it polls, and what to say when
   * each JSON key first appears in the model's answer (see services/ai-progress.ts).
   */
  progress?: { token: string | null | undefined; labels?: Record<string, string> };
}

export interface AiResult<T> {
  status: "disabled" | "completed";
  data?: T;
  model?: string;
}

/**
 * OpenRouter remains inactive until the business approves a model and provides
 * credentials through the deployment secret manager. No fallback model or provider is used.
 */
/** Cheapest model that reliably returns JSON, for extraction jobs; the standard tier for reasoning. */
export const CHEAP_MODEL_DEFAULT = "google/gemini-2.5-flash-lite";
export const STANDARD_MODEL_DEFAULT = "deepseek/deepseek-v4-pro-0813";

export function modelFor(tier: "cheap" | "standard"): string {
  if (tier === "cheap") return process.env.OPENROUTER_MODEL_CHEAP || CHEAP_MODEL_DEFAULT;
  return process.env.OPENROUTER_MODEL || process.env.ASSISTANT_MODEL || STANDARD_MODEL_DEFAULT;
}

export async function runOpenRouterWorkflow<TContext, TResult>(
  request: AiRequest<TContext>,
): Promise<AiResult<TResult>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  // A key alone switches the workflows on (as the assistant already does); OPENROUTER_ACTIVE=false forces them off.
  if (!apiKey || process.env.OPENROUTER_ACTIVE === "false") {
    return { status: "disabled" };
  }
  const model = modelFor(request.tier ?? "standard");
  const userContent: JsonMessageContent = request.document
    ? [
        {
          type: "text" as const,
          text: JSON.stringify({
            workflow: request.workflow,
            schema: request.schemaName,
            context: request.context,
          }),
        },
        {
          type: "file" as const,
          file: {
            filename: request.document.filename,
            file_data: `data:${request.document.contentType};base64,${request.document.bytes.toString("base64")}`,
          },
        },
      ]
    : JSON.stringify({
        workflow: request.workflow,
        schema: request.schemaName,
        context: request.context,
      });
  progressReport(request.progress?.token, "Sending to the model…");
  const { data } = await streamJsonCompletion({
    apiKey,
    model,
    system: request.systemInstruction,
    user: userContent,
    ...keyProgress(request.progress?.token, request.progress?.labels ?? {}),
  });
  return {
    status: "completed",
    data: data as TResult,
    model,
  };
}