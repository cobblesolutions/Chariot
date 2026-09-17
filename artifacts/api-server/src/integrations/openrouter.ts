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
  const userContent = request.document
    ? [
        {
          type: "text",
          text: JSON.stringify({
            workflow: request.workflow,
            schema: request.schemaName,
            context: request.context,
          }),
        },
        {
          type: "file",
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
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Chariot Financial Solutions",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.systemInstruction },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenRouter request failed with status ${response.status}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned no structured result");
  }
  return {
    status: "completed",
    data: JSON.parse(content) as TResult,
    model,
  };
}
