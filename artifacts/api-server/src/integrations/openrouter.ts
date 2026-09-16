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
export async function runOpenRouterWorkflow<TContext, TResult>(
  request: AiRequest<TContext>,
): Promise<AiResult<TResult>> {
  if (process.env.OPENROUTER_ACTIVE !== "true") {
    return { status: "disabled" };
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!apiKey || !model) {
    throw new Error(
      "OPENROUTER_API_KEY and OPENROUTER_MODEL are required when OpenRouter is active",
    );
  }
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
