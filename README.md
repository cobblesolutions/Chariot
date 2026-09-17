# Chariot Financial Solutions

Chariot is an enterprise mortgage case-management platform with a staff workspace and client portal. It manages clients, properties, mortgage cases, lender workflows, underwriting, documents, tasks, communications, calendars, invoices, renewals, and controlled stage progression.

## Technology

- React, Vite, TypeScript, Tailwind CSS
- Express, PostgreSQL, Drizzle ORM
- Zod and OpenAPI-generated browser/server contracts
- Application-owned authentication with scrypt password hashing and database-backed sessions
- Optional transactional email, AI workflow, Companies House, and S3-compatible document storage integrations

## Workspace layout

```text
artifacts/chariot-platform/   Browser application
artifacts/api-server/         Express API
lib/api-spec/                 OpenAPI source of truth
lib/api-zod/                  Generated request/response validation
lib/api-client-react/         Generated React Query client
lib/db/                       Drizzle schema and database connection
scripts/                      Workspace maintenance scripts
```

## Requirements

- Node.js 24+
- pnpm
- PostgreSQL

Install dependencies:

```bash
pnpm install
```

## Local setup

1. Provision PostgreSQL and provide `DATABASE_URL` through the runtime environment.
2. Apply the schema:

   ```bash
   pnpm --filter @workspace/db run push
   ```

3. Configure the three initial staff password secrets described below.
4. Start the API:

   ```bash
   pnpm --filter @workspace/api-server run dev
   ```

5. Start the browser application in a second process, telling the Vite dev
   server where to proxy `/api` requests (the port the API is listening on):

   ```bash
   API_PORT=<api port> pnpm --filter @workspace/chariot-platform run dev
   ```

   Alternatively set `API_URL=http://localhost:<api port>`. Without one of
   these, `/api` requests fall through to the SPA and every page fails to load.

The API creates or updates only the configured bootstrap staff accounts on startup. It does not create clients, properties, cases, lenders, documents, invoices, messages, tasks, or other business records.

## Environment configuration

### Runtime-managed values

These are supplied by the hosting environment and must not be committed or manually copied into source code:

- `DATABASE_URL`
- `PGHOST`
- `PGPORT`
- `PGUSER`
- `PGPASSWORD`
- `PGDATABASE`

`DATABASE_URL` is the value used by Drizzle and the API. The individual `PG*` values are useful for tooling but are not required by the application code.

### Required secrets

Store these in the deployment secret manager. Do not put them in `.env` files committed to the repository, source code, or chat.

| Name | Type | Purpose |
| --- | --- | --- |
| `CHARIOT_ADMIN_INITIAL_PASSWORD` | Secret/password | Initial password for the full-access `admin@chariot.co.uk` account |
| `CHARIOT_WORKER_A_INITIAL_PASSWORD` | Secret/password | Initial password for `worker.a@chariot.co.uk` |
| `CHARIOT_WORKER_B_INITIAL_PASSWORD` | Secret/password | Initial password for `worker.b@chariot.co.uk` |
| `RESEND_API_KEY` | API key | Sends password reset, portal invitation, and other transactional email |
| `ENQUIRY_INBOUND_SECRET` | Shared secret | Optional. Enables the forward-in enquiry webhook (`POST /api/clients/inbound`, header `x-enquiry-inbound-secret`) |
| `OPENROUTER_API_KEY` | API key | Optional AI-assisted workflows (enquiry email extraction, underwriting, lender offers) and the staff assistant (corner chatbot) |
| `COMPANIES_HOUSE_API_KEY` | API key | Optional Companies House company lookup |
| `GOOGLE_MAPS_API_KEY` | API key | Optional Google Places address autocomplete (needs the "Places API (New)" enabled; restrict the key to that API) |
| `S3_ACCESS_KEY_ID` | Access credential | Optional S3-compatible document storage |
| `S3_SECRET_ACCESS_KEY` | Secret credential | Optional S3-compatible document storage |

Use unique passwords of at least 16 characters for the three staff accounts. The application stores only scrypt password hashes. After first sign-in, staff can change their password through the application.

For local development, `pnpm --filter @workspace/api-server run start` (and `dev`) also reads `artifacts/api-server/.env` if it exists (`KEY=value` lines, one per line). That file is git-ignored — put local secrets such as `GOOGLE_MAPS_API_KEY` there instead of exporting them in every shell.

### Non-secret configuration

| Name | Purpose |
| --- | --- |
| `CHARIOT_ADMIN_EMAIL` | Optional override for the admin email |
| `CHARIOT_ADMIN_NAME` | Optional override for the admin display name |
| `CHARIOT_WORKER_A_EMAIL` | Optional override for worker A email |
| `CHARIOT_WORKER_A_NAME` | Optional override for worker A display name |
| `CHARIOT_WORKER_B_EMAIL` | Optional override for worker B email |
| `CHARIOT_WORKER_B_NAME` | Optional override for worker B display name |
| `PORTAL_URL` | Public application URL used in email links |
| `COOKIE_SECURE` | Set to `true` when the app is served over HTTPS |
| `RESEND_ACTIVE` | Set to `true` only after `RESEND_API_KEY` and sender-domain setup are complete |
| `OPENROUTER_ACTIVE` | The key alone switches the AI workflows on; set to `false` to force them off while keeping the key |
| `OPENROUTER_MODEL` | Model for the standard-tier workflows (advice, offers); defaults to `ASSISTANT_MODEL`, then `deepseek/deepseek-v4-pro-0813` |
| `OPENROUTER_MODEL_CHEAP` | Model for cheap-tier extraction (underwriting requirements out of a lender email); defaults to `google/gemini-2.5-flash-lite` |
| `ASSISTANT_MODEL` | OpenRouter model behind the staff assistant; defaults to `deepseek/deepseek-v4-pro-0813`. The assistant only needs `OPENROUTER_API_KEY` (not `OPENROUTER_ACTIVE`) |
| `DOCUMENT_READER_MODEL` / `DOCUMENT_READER_VISION_MODEL` | Models behind the document reading system (proof-of-income extraction on upload); default to `ASSISTANT_MODEL` / `ASSISTANT_VISION_MODEL`. Without `OPENROUTER_API_KEY` the reader falls back to text patterns on PDFs, Word and text files; images need the model |
| `ASSISTANT_VISION_MODEL` | OpenRouter model the assistant uses to read images; defaults to `deepseek/deepseek-v4.1-flash` |
| `ASSISTANT_PROVIDER_SORT` | OpenRouter provider routing for the assistant: `latency` (default), `throughput` or `price`. Default routing was landing on slow providers (4–6 s to first token) |
| `ASSISTANT_REASONING` | `off` (default, fastest), `low`, `medium` or `high` — the model's thinking effort before each reply; when on, the thinking streams into the status line |
| `GOOGLE_PLACES_REGION_CODES` | Comma-separated ISO country codes address suggestions are limited to; defaults to `gb`, empty string searches worldwide |
| `DOCUMENT_STORAGE_DRIVER` | `local` for development or `s3` for persistent object storage |
| `S3_ENDPOINT` | S3-compatible storage endpoint |
| `S3_BUCKET` | S3-compatible storage bucket |
| `S3_REGION` | Storage region; defaults to `us-east-1` |
| `S3_FORCE_PATH_STYLE` | Set to `false` only when the storage provider requires virtual-hosted URLs |
| `FIRM_NAME` | Name printed on generated documents (Terms of Business); defaults to `Chariot` |
| `DOCUSIGN_INTEGRATION_KEY` / `DOCUSIGN_SECRET_KEY` | Register Chariot as a DocuSign app once (developers.docusign.com → Apps and Keys: integration key + secret key, redirect URI `PORTAL_URL/api/settings/docusign/callback`). An administrator then signs in to the firm's DocuSign account from Settings → Terms of Business; tokens are stored in `firm_settings` and refreshed automatically. `DOCUSIGN_MOCK=true` instead simulates envelopes in-process for development |
| `DOCUSIGN_OAUTH_HOST` | `account-d.docusign.com` (developer sandbox, the default) or `account.docusign.com` (production) |
| `DOCUSIGN_REDIRECT_URL` | Optional override of the OAuth redirect URI (defaults to `PORTAL_URL` + `/api/settings/docusign/callback`) |
| `DOCUSIGN_ACCOUNT_ID` | Optional: which of the signed-in user's accounts to send from; defaults to their default account |
| `DOCUSIGN_WEBHOOK_URL` | Optional public URL of `POST /api/webhooks/docusign` (defaults to `PORTAL_URL` + that path). Without a reachable URL, sent envelopes are polled every 15 minutes instead |
| `DOCUSIGN_HMAC_KEY` | Optional Connect HMAC key (DocuSign Settings → Connect) to verify webhook signatures; the webhook re-reads the envelope from DocuSign either way |
| `PG_POOL_MAX` | Max DB connections per API process; defaults to 8. Set low (3–4) on Supabase session-mode poolers, which cap a project at 15 clients across every process |
| `LOG_LEVEL` | API log level; defaults to `info` |

The local document driver writes to `.data/chariot-documents`. Production should use an S3-compatible driver so uploaded documents are not tied to an application instance.

## Database lifecycle

The Drizzle schema in `lib/db/src/schema/chariot.ts` is the source of truth for all application tables.

Development schema changes:

```bash
pnpm --filter @workspace/db run push
```

The post-merge setup applies the development schema automatically. Publishing should synchronize the development schema to the production database through the deployment database migration flow. Do not add schema mutation to the API startup command or deployment build command.

On a fresh production database:

1. All tables are created from the Drizzle schema.
2. The API creates the three configured staff accounts.
3. All client and business tables remain empty.
4. Staff create real clients, properties, cases, documents, tasks, invoices, and other records through the application.

There is intentionally no demo-data seeder in this repository.

## Contracts and code generation

When changing an API contract:

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
```

The OpenAPI document is the contract source of truth. Do not hand-edit generated files.

## Quality checks

```bash
pnpm run typecheck
pnpm --filter @workspace/chariot-platform run build
pnpm --filter @workspace/api-server run build
git diff --check
```

## Production checklist

- Set the three initial staff password secrets.
- Set `PORTAL_URL` to the final public application URL.
- Set `COOKIE_SECURE=true`.
- Configure `RESEND_API_KEY` and verify the sender domain before setting `RESEND_ACTIVE=true`.
- Configure persistent object storage before accepting document uploads.
- Configure AI and Companies House keys only if those features are approved.
- Apply and review the development schema before publishing.
- Confirm that no demo-data script or synthetic business rows are present.
- Publish only after the build and typechecks pass.