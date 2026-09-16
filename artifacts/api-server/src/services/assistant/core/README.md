# Assistant core (server)

An application-agnostic agent loop for an in-app AI assistant: streaming
replies, tool calling, **approval-gated writes**, **dropdown questions**, and
file reading. Nothing in this folder knows about the host application; the
sibling files (`../records.ts`, `../tools.ts`, `../prompt.ts`, `../index.ts`)
are the Chariot-specific wiring and double as the example to copy.

The browser half lives in `components/assistant/core/` of the web app and
speaks the contract in `types.ts` (SSE events + transcript messages).

## Porting checklist

1. Copy this folder. Dependencies: `express`, `zod` (v4, for `z.toJSONSchema`),
   and for file reading `pdf-parse` + `mammoth` (mark both as bundler
   externals if you bundle the server).
2. Create a model client:
   ```ts
   const client = createModelClient({
     apiKey: process.env.OPENROUTER_API_KEY,
     model: "deepseek/deepseek-v4-pro-0813",     // any OpenRouter / OpenAI-compatible model with tool calling
     visionModel: "deepseek/deepseek-v4.1-flash", // used by read_file for images
     referer: process.env.PUBLIC_URL, title: "My app",
   });
   ```
3. Describe your records with `createRecordRegistry({...})` — one
   `RecordMeta` per type: how to `fetch` it, its `title`/`href`, the card
   `fields`, `fieldHref` for values that are themselves records, `media`
   (files to show) and `related` (records it names, for prose linking).
4. Write tools (`Tool<Ctx>`): `kind: "read"` runs immediately, `kind: "write"`
   pauses for approval and needs a `preview`, `kind: "ask"` pauses for an
   answer. `endpointTool(spec, registry)` builds a write tool around one REST
   endpoint with the diff preview and required-field back-fill for free —
   pass the endpoint's zod body and the JSON schema is generated. Include
   `askUserTool()` so the model can offer choices as a dropdown.
5. Mount the router:
   ```ts
   app.use("/api", createAssistantRouter({
     requireAuth,                          // your session middleware
     context: (req, res) => ({ user: res.locals.user, api: apiCallerFor(req), req }),
     tools, client,
     systemPrompt: (ctx, page) => `You are …`,
   }));
   ```
   `context` must return at least `{ user: { id, displayName, role } }`.

## Contract

`POST {base}/chat` body: `{ messages, approvals?, answers?, page? }` — the
whole transcript every turn (the server is stateless), plus decisions on the
previous turn's proposals (`approvals[toolCallId]: boolean`) and questions
(`answers[toolCallId]: { value, label }`).

The response is `text/event-stream`; each `data:` line is one
`AssistantEvent`:

| event | meaning |
| --- | --- |
| `status` | `thinking` (waiting on the model) or `writing` (text is streaming) |
| `text` | a reply delta |
| `tool_call` / `tool_result` | a read tool started / finished (`displays` = cards, `entities` = records to link) |
| `proposal` | a write awaiting approval, with a field-level `preview` |
| `question` | an `ask` tool awaiting an answer (`options` → dropdown) |
| `transcript` | the messages appended this turn — store them and send them back next time |
| `error` / `done` | `done.awaiting` is `approval`, `answer` or `null` |

Write tools never run on the model's say-so: the runner emits the proposal
and ends the turn; only an `approvals[id] === true` on the next request runs
the tool. Declines and unanswered questions are fed back to the model as
tool results so it can carry on sensibly.

## Latency

Every model call re-sends the system prompt and all tool schemas (~10k tokens), so
time-to-first-token is mostly prefill. What keeps it fast, in order of impact:

1. `reasoning: "off"` on the client (DeepSeek thinks for 5–30 s otherwise).
2. `providerSort: "latency"` — OpenRouter's default routing picked providers with
   4–6 s TTFT; latency-sorted routing lands on ~1–2 s and cache hits follow.
3. Fewer hops: give the model a one-shot tool for the common case (Chariot's
   `lookup_record` = search + open) instead of forcing search → get → answer.
4. Trimmed tool schemas (`schemaOf` drops validation-only keywords).

The client's `onCall` reports `ttftMs`, `promptTokens`, `cachedTokens` and
`provider` per call — log it to see where a slow turn went.

## Guarantees worth keeping

- Tool results carry `entities` so the UI can turn every record title in
  the reply into a link, even when the model forgets to.
- Nested collections in records are capped (`slimRecord`) so a long chat or
  document list cannot blow the context window.
- `endpointTool` hides unchanged fields from the diff and fills required
  fields the model omitted from the current record before a PATCH.
