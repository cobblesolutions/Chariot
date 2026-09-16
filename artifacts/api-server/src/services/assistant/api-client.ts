import type { Request } from "express";
import type { ApiCaller } from "./core";

/**
 * The assistant reads and writes through the same HTTP API the browser uses,
 * calling this server back over loopback with the caller's session cookie.
 * That keeps one code path for validation, permissions, activity logging and
 * checklist side-effects instead of a second, assistant-only data layer.
 */
export function apiCallerFor(req: Request): ApiCaller {
  const port = process.env.PORT;
  const cookie = req.headers.cookie ?? "";
  return async (method, path, body) => {
    const url = `http://127.0.0.1:${port}/api${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      cookie,
      accept: "application/json",
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const response = await fetch(url, { method, headers, body: payload });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const error =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `Request failed (${response.status})`;
      return { ok: false, status: response.status, error };
    }
    return { ok: true, status: response.status, data: data as never };
  };
}

/** Bytes of a stored file, via the API so access rules apply. */
export async function fetchApiBytes(
  req: Request,
  path: string,
): Promise<{ bytes: Buffer; contentType: string; filename: string } | null> {
  const port = process.env.PORT;
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    headers: { cookie: req.headers.cookie ?? "" },
  });
  if (!response.ok) return null;
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
  const plain = /filename="([^"]+)"/.exec(disposition)?.[1];
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: (
      response.headers.get("content-type") ?? "application/octet-stream"
    ).split(";")[0]!,
    filename: encoded ? decodeURIComponent(encoded) : (plain ?? "file"),
  };
}
