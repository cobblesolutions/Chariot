# Agent guide

## Project purpose

Chariot Financial Solutions is a mortgage case-management platform with staff and client-facing workflows.

## Engineering rules

- Use pnpm and keep the workspace lockfile in sync with package manifests.
- Treat `lib/api-spec/openapi.yaml` as the API contract source of truth.
- Regenerate API clients after OpenAPI changes.
- Treat `lib/db/src/schema/chariot.ts` as the database schema source of truth.
- Use database-backed sessions and the existing application-owned authentication flow.
- Never add a third-party identity provider without an explicit product decision.
- Never commit passwords, API keys, storage credentials, tokens, or connection strings.
- Keep production authentication credentials in the deployment secret manager.
- Do not enable test credentials in production.
- Do not add demo clients, lenders, properties, cases, documents, tasks, invoices, or messages to production.
- Do not add startup-time database DDL or deployment-time schema mutation.
- Use the deployment database migration flow to apply the development schema to production.
- Keep monetary values as fixed-precision PostgreSQL values.
- Store uploaded document bytes in persistent object storage; keep only metadata and object paths in PostgreSQL.

## UI components (chariot-platform)

- `artifacts/chariot-platform` is a shadcn/ui project (`components.json`: new-york style, Radix base, Tailwind v4, `@/` alias). The `shadcn` CLI is a dev dependency.
- Every new UI element must come from the shadcn registry: run `pnpm shadcn add <component>` inside `artifacts/chariot-platform` before writing any new component. Never hand-write a button, input, dialog, table, select, toast, etc.
- `src/components/ui/*` stays byte-identical to the registry output (verify with `pnpm shadcn add <name> --overwrite --dry-run` -> "skip"). Do not edit files in `ui/`; compose and style at the call site with stock variants/sizes only.
- Registry components import `cn` from the `cn` npm package via `@/lib/utils`; do not add `clsx`/`tailwind-merge`.
- Base-nova items (e.g. `toast`) are added by URL: `pnpm shadcn add https://ui.shadcn.com/r/styles/base-nova/<name>.json`.
- Page content width is one token: `--container-page` in `src/index.css` (`max-w-page`). Every routed page wraps its content in `max-w-page mx-auto`; never hand-type a page-level `max-w-[...]`.

## Staff assistant (corner chatbot)

- Built as a reusable template. The application-agnostic parts live in `artifacts/api-server/src/services/assistant/core/` and `artifacts/chariot-platform/src/components/assistant/core/` (each has a README with a porting checklist); the Chariot wiring is `services/assistant/{index,records,tools,prompt,api-client}.ts` and `components/assistant/chariot-assistant.tsx`. Keep `core/` free of Chariot-specific imports.
- Server: `createAssistantRouter` mounts `POST /assistant/chat` (SSE) and `GET /assistant/status`. Enabled by `OPENROUTER_API_KEY` alone; model and thinking effort from `ASSISTANT_MODEL` / `ASSISTANT_VISION_MODEL` / `ASSISTANT_REASONING` (default `off` — reasoning multiplies latency).
- Tools never touch the database directly: every read and write is a loopback call to the existing REST endpoints with the caller's session cookie, so validation, permissions and side-effects stay in one place. Write tools are `endpointTool(spec, records)` entries in `WRITE_TOOLS` whose JSON schema comes from the generated `@workspace/api-zod` body. Tool kinds: `read` (runs immediately), `write` (proposal → approval), `ask` (dropdown question). Tool results carry `entities` so the UI can link every record title in prose; record cards link their fields via `fieldHref`.
- Writes are never executed on the model's say-so. The server emits a `proposal` event (field-level diff) and pauses the turn; the browser sends the decision back as `approvals[toolCallId]` (and `answers[toolCallId]` for questions) on the next request. Keep that contract when adding tools.
- The browser owns the transcript (localStorage per user) and sends it every turn; the server is stateless.

## Document reading system

- `artifacts/api-server/src/services/document-reading/` turns uploaded files into structured data. `index.ts` holds the reader registry (`READERS`), `readDocument`/`queueDocumentReading` (called after every staff and portal upload) and `readingsForDocuments` (attached as `Document.reading` on `ClientDetail`); `checks.ts` compares readings with each other and the record (`ClientDetail.documentChecks`); `xlsx.ts` turns a spreadsheet's first sheet into CSV text.
- Readers live in `readers/` and implement `DocumentReader` from `types.ts` (category list, model prompt, `normalise`, text `heuristic`, `merge`, `apply`); shared coercion/date/address/apply helpers are in `readers/shared.ts`. Current readers: `identity` (passport MRZ / driving licence → title, DOB, nationality, address), `bank_statements` (address, employer, net salary, commitments, mortgage/rent DDs, conduct flags), `proof_of_income` (annual income, employer, job title, status), `credit_report` (credit-history notes, commitments, previous address, DOB), `portfolio` (creates property records for the client — category `portfolio`, uploaded in the Add page's property column).
- Results are stored in `document_readings` (one row per document: status, source `ai`/`heuristic`, `data`, `appliedFields`). `apply` fills only empty fields (`fillEmptyClientFields`); the Add page's "Use these values" button is how staff overwrite typed values. `POST /documents/{id}/read` re-runs a reader.
- Provenance: `clients.document_filled_fields` lists the fields whose current value a reader wrote (`fillEmptyClientFields` appends in SQL; the client PATCH removes a field when staff save a different value). The Add page shows those inputs in yellow (`DOCUMENT_FILLED_CLASS` in `src/lib/document-filled.ts`) and badges portfolio-created properties "From portfolio". The client form's autosave sends only fields that differ from its seed/last save, so a reader's server-side fill is never overwritten by a stale draft.
- The model call (`model.ts`) needs only `OPENROUTER_API_KEY` (like the assistant); without it PDFs/Word/text/spreadsheets go through the heuristics, images are reported as unsupported. Add a reader by writing `readers/<name>.ts`, appending it to `READERS`, adding its data schema to `openapi.yaml`, a summary case in `chariot-platform/src/components/document-reading-line.tsx` and the category to `READABLE_CATEGORIES` in `add/client-column.tsx`.

## Commands

```bash
pnpm install
pnpm run typecheck
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/chariot-platform run dev
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/chariot-platform run build
```

## Authentication setup

The API provisions three staff accounts when their initial password secrets are available:

- `CHARIOT_ADMIN_INITIAL_PASSWORD`
- `CHARIOT_WORKER_A_INITIAL_PASSWORD`
- `CHARIOT_WORKER_B_INITIAL_PASSWORD`

Use strong, unique values. The API hashes these values with scrypt and never stores the plaintext password. Client users are created through the client workflow and receive an invitation/reset flow; they are not seeded.

## Environment handling

Secret values must be requested from the secure secret manager and must never be printed or copied into source files. Public configuration such as `PORTAL_URL`, `COOKIE_SECURE`, integration activation flags, and storage driver settings may be documented as environment variables but should still be configured per environment.

## Database handling

Apply development schema changes with:

```bash
pnpm --filter @workspace/db run push
```

Before publishing, confirm that the development database contains only intentional business data. A new production database should contain the schema and configured bootstrap staff accounts, not demo business rows.