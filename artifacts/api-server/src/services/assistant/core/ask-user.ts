import type { BaseContext, Question, Tool } from "./types";

type Rec = Record<string, unknown>;

/**
 * Built-in `ask_user` tool: instead of asking "which case?" in prose, the
 * model lists the candidates and the UI renders them as a dropdown. The turn
 * pauses until the user picks one (or types something else).
 */
export function askUserTool<Ctx extends BaseContext>(): Tool<Ctx> {
  return {
    name: "ask_user",
    kind: "ask",
    description:
      "Ask the user to choose between specific options (which case, which client, which date, which action…) when their request is ambiguous. The options are shown as a dropdown, so include every plausible candidate with a clear label; include the record type and id when an option is a record. Prefer this over asking a question in prose.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question, e.g. 'Which case do you mean?'",
        },
        options: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: {
            type: "object",
            properties: {
              value: {
                type: "string",
                description:
                  "What comes back to you when chosen (an id or short key)",
              },
              label: { type: "string", description: "Shown to the user" },
              detail: {
                type: "string",
                description: "Secondary line under the label (optional)",
              },
              type: {
                type: "string",
                description:
                  "Record type when the option is a record (optional)",
              },
              id: {
                type: "integer",
                description: "Record id when the option is a record (optional)",
              },
            },
            required: ["value", "label"],
            additionalProperties: false,
          },
        },
        allowFreeText: {
          type: "boolean",
          description: "Let the user type something that is not in the list",
        },
      },
      required: ["question", "options"],
      additionalProperties: false,
    },
    async question(_ctx, args): Promise<Question> {
      const raw = Array.isArray(args.options) ? (args.options as Rec[]) : [];
      return {
        question: String(args.question ?? "Which one?"),
        options: raw
          .filter((option) => option && typeof option === "object")
          .map((option) => ({
            value: String(option.value ?? option.label ?? ""),
            label: String(option.label ?? option.value ?? ""),
            detail: option.detail ? String(option.detail) : null,
            type: option.type ? String(option.type) : null,
            id: typeof option.id === "number" ? option.id : null,
          }))
          .filter((option) => option.value && option.label),
        allowFreeText: args.allowFreeText === true,
      };
    },
    // Never runs: the runner turns the user's answer into the tool result.
    async run() {
      return {
        content: { error: "ask_user is answered by the user, not executed" },
      };
    },
  };
}
