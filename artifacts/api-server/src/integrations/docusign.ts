import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { appUsersTable, db, firmSettingsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { DATE_ANCHOR, SIGN_ANCHOR } from "../services/terms-pdf";

/**
 * DocuSign eSignature (REST v2.1). The firm registers Chariot as a DocuSign
 * app once (integration key + secret in the environment); an administrator
 * then signs in to the firm's own DocuSign account from Settings (OAuth
 * authorization-code grant). The tokens live in `firm_settings` and are
 * refreshed automatically, so envelopes go out as that user with nobody
 * logging in again. Fail-closed like the Resend transport: nothing is sent
 * until an account is connected. Set DOCUSIGN_MOCK=true for local
 * development: envelopes then live in memory and are "signed" from a
 * development-only endpoint.
 *
 * Registering the app (once):
 *  1. developers.docusign.com → Apps and Keys → Add App: note the
 *     Integration Key; under Authentication add a Secret Key and keep it.
 *  2. Add the Redirect URI shown in Settings — exactly
 *     `${PORTAL_URL}/api/settings/docusign/callback`.
 *  3. Env: DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_SECRET_KEY, DOCUSIGN_OAUTH_HOST
 *     (account-d.docusign.com for the developer sandbox — the default — or
 *     account.docusign.com for production). Optional DOCUSIGN_REDIRECT_URL
 *     (overrides the PORTAL_URL-based one), DOCUSIGN_WEBHOOK_URL (public URL
 *     of POST /api/webhooks/docusign; defaults to PORTAL_URL + that path) and
 *     DOCUSIGN_HMAC_KEY (a Connect HMAC key, to check X-DocuSign-Signature-1).
 *  4. Settings → Terms of Business → Connect DocuSign.
 */

export type SignatureMode = "off" | "mock" | "docusign";

export interface EnvelopeState {
  envelopeId: string;
  /** DocuSign statuses: created | sent | delivered | completed | declined | voided … */
  status: string;
  completedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  /** DocuSign could not deliver the email (recipient status "autoresponded" — a bounce). */
  deliveryFailed: boolean;
}

export interface CreateEnvelopeArgs {
  pdf: Buffer;
  documentName: string;
  signer: { name: string; email: string };
  emailSubject: string;
  emailMessage: string;
}

export interface SignatureClient {
  readonly mode: SignatureMode;
  createEnvelope(args: CreateEnvelopeArgs): Promise<{ envelopeId: string }>;
  getEnvelope(envelopeId: string): Promise<EnvelopeState>;
  /** The signed document (with DocuSign's certificate of completion), or null when the provider has no copy (mock). */
  downloadSigned(envelopeId: string): Promise<Buffer | null>;
  void(envelopeId: string, reason: string): Promise<void>;
}

const APP_VARS = ["DOCUSIGN_INTEGRATION_KEY", "DOCUSIGN_SECRET_KEY"] as const;
const CONNECTION_KEY = "docusign_connection";
/** Refresh tokens issued with the `extended` scope do not expire; access tokens last 8 hours. */
const SCOPES = "signature extended";

/** What is stored in firm_settings under `docusign_connection`. */
export interface DocusignConnection {
  oauthHost: string;
  accountId: string;
  accountName: string;
  baseUri: string;
  userId: string;
  userName: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  connectedByUserId: number | null;
  connectedAt: string;
}

// The connection is read from the database once and kept here so the
// synchronous mode checks across the terms flow stay cheap; every change to it
// goes through saveConnection / clearConnection, which update the cache too.
let connection: DocusignConnection | null = null;
let connectionLoaded = false;

export async function loadDocusignConnection() {
  const [row] = await db.select({ value: firmSettingsTable.value }).from(firmSettingsTable).where(eq(firmSettingsTable.key, CONNECTION_KEY));
  const value = row?.value as Partial<DocusignConnection> | undefined;
  connection = value && typeof value.accessToken === "string" && typeof value.refreshToken === "string" ? (value as DocusignConnection) : null;
  connectionLoaded = true;
  return connection;
}

async function saveConnection(next: DocusignConnection, userId: number | null) {
  await db
    .insert(firmSettingsTable)
    .values({ key: CONNECTION_KEY, value: next, updatedByUserId: userId })
    .onConflictDoUpdate({ target: firmSettingsTable.key, set: { value: next, updatedByUserId: userId, updatedAt: new Date() } });
  connection = next;
}

export async function disconnectDocusign() {
  await db.delete(firmSettingsTable).where(eq(firmSettingsTable.key, CONNECTION_KEY));
  connection = null;
}

export function appRegistered() {
  return APP_VARS.every((name) => !!process.env[name]?.trim());
}

/** mock when DOCUSIGN_MOCK=true; docusign once the app is registered and an account is connected; otherwise off. */
export function signatureMode(): SignatureMode {
  if (process.env.DOCUSIGN_MOCK === "true") return "mock";
  if (!connectionLoaded) logger.warn("DocuSign connection read before loadDocusignConnection() ran");
  return appRegistered() && connection ? "docusign" : "off";
}

export function webhookUrl() {
  const explicit = process.env.DOCUSIGN_WEBHOOK_URL?.trim();
  if (explicit) return explicit;
  const base = process.env.PORTAL_URL?.trim();
  return base ? `${base.replace(/\/$/, "")}/api/webhooks/docusign` : null;
}

/** Where DocuSign sends the admin back after signing in; must match the app's registered redirect URI exactly. */
export function redirectUri() {
  const explicit = process.env.DOCUSIGN_REDIRECT_URL?.trim();
  if (explicit) return explicit;
  const base = process.env.PORTAL_URL?.trim();
  return base ? `${base.replace(/\/$/, "")}/api/settings/docusign/callback` : null;
}

function oauthHost() {
  return (process.env.DOCUSIGN_OAUTH_HOST?.trim() || "account-d.docusign.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** What Settings shows: the mode, the registered app, the connected account, and what is still missing. */
export async function signatureConfig() {
  const mode = signatureMode();
  const missing = APP_VARS.filter((name) => !process.env[name]?.trim());
  const [connectedBy] = connection?.connectedByUserId
    ? await db.select({ displayName: appUsersTable.displayName }).from(appUsersTable).where(eq(appUsersTable.id, connection.connectedByUserId))
    : [];
  return {
    mode,
    configured: mode === "mock" || mode === "docusign",
    missing: [...missing],
    appRegistered: appRegistered(),
    oauthHost: oauthHost(),
    redirectUri: redirectUri(),
    webhookUrl: webhookUrl(),
    hmacEnabled: !!process.env.DOCUSIGN_HMAC_KEY?.trim(),
    connection: connection
      ? {
        account: connection.accountName,
        email: connection.email,
        userName: connection.userName,
        baseUri: connection.baseUri,
        connectedAt: connection.connectedAt,
        connectedBy: connectedBy?.displayName ?? null,
      }
      : null,
  };
}

class DocusignError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function readError(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { message?: string; errorCode?: string; error?: string; error_description?: string };
    return json.message ?? json.error_description ?? json.error ?? text ?? response.statusText;
  } catch {
    return text || response.statusText;
  }
}

// ---------------------------------------------------------------------------
// OAuth authorization-code grant

/**
 * A fresh state nonce, a PKCE verifier, and the DocuSign sign-in URL to send
 * the administrator to. PKCE is always sent, so the app can be registered
 * with "Require PKCE" on or off.
 */
export function beginConnection() {
  const uri = redirectUri();
  if (!appRegistered()) throw new DocusignError(`Register the DocuSign app first: set ${APP_VARS.join(" and ")}`);
  if (!uri) throw new DocusignError("Set PORTAL_URL (or DOCUSIGN_REDIRECT_URL) so DocuSign knows where to send the administrator back");
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(`https://${oauthHost()}/oauth/auth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("client_id", process.env.DOCUSIGN_INTEGRATION_KEY!.trim());
  url.searchParams.set("redirect_uri", uri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { state, verifier, url: url.toString() };
}

interface TokenResponse { access_token: string; refresh_token: string; expires_in: number; token_type: string }

async function tokenRequest(params: Record<string, string>) {
  const basic = Buffer.from(`${process.env.DOCUSIGN_INTEGRATION_KEY!.trim()}:${process.env.DOCUSIGN_SECRET_KEY!.trim()}`).toString("base64");
  const response = await fetch(`https://${oauthHost()}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!response.ok) throw new DocusignError(`DocuSign sign-in failed: ${await readError(response)}`, response.status);
  return await response.json() as TokenResponse;
}

async function userInfo(accessToken: string) {
  const response = await fetch(`https://${oauthHost()}/oauth/userinfo`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new DocusignError(`DocuSign user lookup failed: ${await readError(response)}`, response.status);
  return await response.json() as {
    sub: string; name: string; email: string;
    accounts: Array<{ account_id: string; account_name: string; base_uri: string; is_default: boolean }>;
  };
}

/** The admin came back from DocuSign with a code: exchange it, look the account up, and store the connection. */
export async function completeConnection(code: string, verifier: string, userId: number) {
  const uri = redirectUri();
  if (!uri) throw new DocusignError("PORTAL_URL is not set");
  const token = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: uri, code_verifier: verifier });
  const info = await userInfo(token.access_token);
  const wanted = process.env.DOCUSIGN_ACCOUNT_ID?.trim();
  const account = (wanted ? info.accounts.find((item) => item.account_id === wanted) : null) ?? info.accounts.find((item) => item.is_default) ?? info.accounts[0];
  if (!account) throw new DocusignError("This DocuSign user has no accounts");
  const next: DocusignConnection = {
    oauthHost: oauthHost(),
    accountId: account.account_id,
    accountName: account.account_name,
    baseUri: account.base_uri.replace(/\/$/, ""),
    userId: info.sub,
    userName: info.name,
    email: info.email,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    connectedByUserId: userId,
    connectedAt: new Date().toISOString(),
  };
  await saveConnection(next, userId);
  return next;
}

let refreshing: Promise<DocusignConnection> | null = null;

/** The stored connection with a live access token, refreshing it when within a minute of expiry. */
async function liveConnection(): Promise<DocusignConnection> {
  if (!connectionLoaded) await loadDocusignConnection();
  if (!connection) throw new DocusignError("DocuSign is not connected — an administrator can connect it in Settings → Terms of Business");
  if (!appRegistered()) throw new DocusignError(`DocuSign app credentials are missing: set ${APP_VARS.join(" and ")}`);
  if (connection.expiresAt > Date.now() + 60_000) return connection;
  refreshing ??= (async () => {
    try {
      const token = await tokenRequest({ grant_type: "refresh_token", refresh_token: connection!.refreshToken });
      const next = { ...connection!, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000 };
      await saveConnection(next, connection!.connectedByUserId);
      return next;
    } catch (error) {
      throw new DocusignError(`DocuSign session expired — reconnect it in Settings → Terms of Business (${error instanceof Error ? error.message : String(error)})`);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function api<T>(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
  const current = await liveConnection();
  const url = `${current.baseUri}/restapi/v2.1/accounts/${current.accountId}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${current.accessToken}`,
      ...(init.body && !(init.body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new DocusignError(`DocuSign ${init.method ?? "GET"} ${path} failed: ${await readError(response)}`, response.status);
  if (init.raw) return Buffer.from(await response.arrayBuffer()) as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

const realClient: SignatureClient = {
  mode: "docusign",
  async createEnvelope(args) {
    const hook = webhookUrl();
    const body = {
      emailSubject: args.emailSubject,
      emailBlurb: args.emailMessage,
      status: "sent",
      documents: [{ documentBase64: args.pdf.toString("base64"), name: args.documentName, fileExtension: "pdf", documentId: "1" }],
      recipients: {
        signers: [{
          email: args.signer.email,
          name: args.signer.name,
          recipientId: "1",
          routingOrder: "1",
          tabs: {
            signHereTabs: [{ anchorString: SIGN_ANCHOR, anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "-6", anchorIgnoreIfNotPresent: "false" }],
            dateSignedTabs: [{ anchorString: DATE_ANCHOR, anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "0", anchorIgnoreIfNotPresent: "false" }],
          },
        }],
      },
      ...(hook
        ? {
          eventNotification: {
            url: hook,
            requireAcknowledgment: "true",
            loggingEnabled: "true",
            deliveryMode: "SIM",
            includeHMAC: process.env.DOCUSIGN_HMAC_KEY ? "true" : "false",
            events: ["envelope-sent", "envelope-delivered", "envelope-completed", "envelope-declined", "envelope-voided"],
            eventData: { version: "restv21", format: "json", includeData: ["recipients"] },
          },
        }
        : {}),
    };
    const created = await api<{ envelopeId: string }>("/envelopes", { method: "POST", body: JSON.stringify(body) });
    return { envelopeId: created.envelopeId };
  },
  async getEnvelope(envelopeId) {
    const envelope = await api<{
      envelopeId: string; status: string; completedDateTime?: string; declinedDateTime?: string; voidedDateTime?: string; voidedReason?: string;
    }>(`/envelopes/${encodeURIComponent(envelopeId)}`);
    // The recipients carry what the envelope status hides: a decline reason, or a bounced email ("autoresponded").
    const recipients = await api<{ signers?: Array<{ status?: string; declinedReason?: string }> }>(`/envelopes/${encodeURIComponent(envelopeId)}/recipients`).catch(() => null);
    const signers = recipients?.signers ?? [];
    return {
      envelopeId: envelope.envelopeId,
      status: envelope.status,
      completedAt: envelope.completedDateTime ?? null,
      declinedAt: envelope.declinedDateTime ?? null,
      declineReason: signers.find((signer) => signer.declinedReason)?.declinedReason ?? null,
      voidedAt: envelope.voidedDateTime ?? null,
      voidReason: envelope.voidedReason ?? null,
      deliveryFailed: signers.some((signer) => signer.status === "autoresponded"),
    };
  },
  async downloadSigned(envelopeId) {
    return api<Buffer>(`/envelopes/${encodeURIComponent(envelopeId)}/documents/combined?certificate=true`, { raw: true });
  },
  async void(envelopeId, reason) {
    await api(`/envelopes/${encodeURIComponent(envelopeId)}`, { method: "PUT", body: JSON.stringify({ status: "voided", voidedReason: reason.slice(0, 200) }) });
  },
};

/**
 * Development stand-in: envelopes live in this process. `mockSign` /
 * `mockDecline` move them on, which the terms flow then picks up exactly as
 * it would a DocuSign webhook. Unknown ids (after a restart) read as still sent.
 */
const mockEnvelopes = new Map<string, EnvelopeState & { pdf: Buffer }>();

export const mockSignature = {
  sign(envelopeId: string) {
    const envelope = mockEnvelopes.get(envelopeId) ?? mockEnvelopes.set(envelopeId, { ...blankState(envelopeId), pdf: Buffer.alloc(0) }).get(envelopeId)!;
    envelope.status = "completed";
    envelope.completedAt = new Date().toISOString();
  },
  bounce(envelopeId: string) {
    const envelope = mockEnvelopes.get(envelopeId) ?? mockEnvelopes.set(envelopeId, { ...blankState(envelopeId), pdf: Buffer.alloc(0) }).get(envelopeId)!;
    envelope.deliveryFailed = true;
  },
  decline(envelopeId: string, reason: string) {
    const envelope = mockEnvelopes.get(envelopeId) ?? mockEnvelopes.set(envelopeId, { ...blankState(envelopeId), pdf: Buffer.alloc(0) }).get(envelopeId)!;
    envelope.status = "declined";
    envelope.declinedAt = new Date().toISOString();
    envelope.declineReason = reason;
  },
};

const blankState = (envelopeId: string): EnvelopeState => ({
  envelopeId, status: "sent", completedAt: null, declinedAt: null, declineReason: null, voidedAt: null, voidReason: null, deliveryFailed: false,
});

const mockClient: SignatureClient = {
  mode: "mock",
  async createEnvelope(args) {
    const envelopeId = `mock-${randomUUID()}`;
    mockEnvelopes.set(envelopeId, { ...blankState(envelopeId), pdf: args.pdf });
    logger.info({ envelopeId, to: args.signer.email }, "DocuSign mock: envelope created (not sent)");
    return { envelopeId };
  },
  async getEnvelope(envelopeId) {
    const { pdf: _pdf, ...state } = mockEnvelopes.get(envelopeId) ?? { ...blankState(envelopeId), pdf: Buffer.alloc(0) };
    return state;
  },
  async downloadSigned(envelopeId) {
    const envelope = mockEnvelopes.get(envelopeId);
    return envelope && envelope.pdf.length ? envelope.pdf : null;
  },
  async void(envelopeId, reason) {
    const envelope = mockEnvelopes.get(envelopeId) ?? mockEnvelopes.set(envelopeId, { ...blankState(envelopeId), pdf: Buffer.alloc(0) }).get(envelopeId)!;
    envelope.status = "voided";
    envelope.voidedAt = new Date().toISOString();
    envelope.voidReason = reason;
  },
};

/** The client for the current mode, or null when signing is switched off. */
export function signatureClient(): SignatureClient | null {
  const mode = signatureMode();
  return mode === "docusign" ? realClient : mode === "mock" ? mockClient : null;
}

/** Settings → "Test connection": confirms the stored account still answers, or says why not. */
export async function testDocusignConnection() {
  const mode = signatureMode();
  if (mode === "mock") return { ok: true, mode, account: "Mock (development)", email: null, baseUri: null, error: null };
  if (mode === "off") {
    return {
      ok: false, mode, account: null, email: null, baseUri: null,
      error: appRegistered() ? "No DocuSign account is connected yet — click Connect DocuSign" : `Register the DocuSign app first: set ${APP_VARS.join(" and ")}`,
    };
  }
  try {
    const current = await liveConnection();
    const info = await userInfo(current.accessToken);
    return { ok: true, mode, account: current.accountName, email: info.email, baseUri: current.baseUri, error: null };
  } catch (error) {
    return { ok: false, mode, account: null, email: null, baseUri: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Checks a Connect HMAC signature when a key is configured. Without a key the
 * webhook is still safe: the handler never trusts the payload, it re-reads the
 * envelope from DocuSign before changing anything.
 */
export function verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
  const key = process.env.DOCUSIGN_HMAC_KEY?.trim();
  if (!key) return true;
  const expected = createHmac("sha256", key).update(rawBody).digest("base64");
  const candidates = Object.entries(headers)
    .filter(([name]) => /^x-docusign-signature-\d+$/i.test(name))
    .flatMap(([, value]) => (Array.isArray(value) ? value : value ? [value] : []));
  return candidates.some((candidate) => {
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export { DocusignError };
