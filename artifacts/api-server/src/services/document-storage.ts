import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export interface StoredDocument {
  key: string;
  size: number;
}

/**
 * Private document storage boundary. Database values contain only opaque keys;
 * neither this driver's local root nor an S3 bucket/key is sent to callers.
 *
 * S3 support intentionally requires a configured deployment adapter rather
 * than silently storing production files on local disk.  The local driver is
 * for explicit development use only.
 */
export class PrivateDocumentStorage {
  private readonly driver = process.env.DOCUMENT_STORAGE_DRIVER ?? "local";
  private readonly root = resolve(process.env.DOCUMENT_STORAGE_LOCAL_DIR ?? ".data/chariot-documents");

  private assertSize(bytes: Buffer) {
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
      throw new Error("Documents must not exceed 50 MB");
    }
  }

  private pathFor(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid document key");
    return join(this.root, key);
  }

  private s3Config() {
    const endpoint = process.env.S3_ENDPOINT;
    const bucket = process.env.S3_BUCKET;
    const accessKey = process.env.S3_ACCESS_KEY_ID;
    const secret = process.env.S3_SECRET_ACCESS_KEY;
    if (!endpoint || !bucket || !accessKey || !secret) {
      throw new Error("S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required for S3 storage");
    }
    return { endpoint: endpoint.replace(/\/$/, ""), bucket, accessKey, secret, region: process.env.S3_REGION ?? "us-east-1" };
  }

  private async s3(method: string, key: string, body?: Buffer): Promise<Response> {
    const config = this.s3Config();
    const endpoint = new URL(config.endpoint);
    const pathStyle = process.env.S3_FORCE_PATH_STYLE !== "false";
    const host = pathStyle ? endpoint.host : `${config.bucket}.${endpoint.host}`;
    const path = pathStyle ? `/${encodeURIComponent(config.bucket)}/${key}` : `/${key}`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256").update(body ?? "").digest("hex");
    const headers: Record<string, string> = {
      host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate,
    };
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join("");
    const canonical = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${date}/${config.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash("sha256").update(canonical).digest("hex")}`;
    const hmac = (value: string | Buffer, keyValue: string | Buffer) => createHmac("sha256", keyValue).update(value).digest();
    const signingKey = hmac("aws4_request", hmac("s3", hmac(config.region, hmac(date, `AWS4${config.secret}`))));
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${createHmac("sha256", signingKey).update(stringToSign).digest("hex")}`;
    const url = `${endpoint.protocol}//${host}${path}`;
    const response = await fetch(url, { method, headers, body });
    if (!response.ok && !(method === "DELETE" && response.status === 404)) {
      throw new Error(`S3 ${method} failed with status ${response.status}`);
    }
    return response;
  }

  async put(bytes: Buffer): Promise<StoredDocument> {
    this.assertSize(bytes);
    if (this.driver !== "local") {
      if (this.driver === "s3") {
        const key = randomUUID();
        await this.s3("PUT", key, bytes);
        return { key, size: bytes.byteLength };
      }
      throw new Error("DOCUMENT_STORAGE_DRIVER must be local or s3");
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const key = randomUUID();
    await writeFile(this.pathFor(key), bytes, { mode: 0o600, flag: "wx" });
    return { key, size: bytes.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    if (this.driver === "s3") return Buffer.from(await (await this.s3("GET", key)).arrayBuffer());
    if (this.driver !== "local") throw new Error("Configured document storage driver is unavailable");
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    if (this.driver === "s3") { await this.s3("DELETE", key); return; }
    if (this.driver !== "local") throw new Error("Configured document storage driver is unavailable");
    await rm(this.pathFor(key), { force: true });
  }

  /** Safe audit correlation without exposing an object key. */
  publicReference(key: string) {
    return createHash("sha256").update(key).digest("hex").slice(0, 16);
  }
}

export const documentStorage = new PrivateDocumentStorage();