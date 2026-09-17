import { useCallback, useState } from "react";

/** Where a file upload is up to, for the progress line under the picker. */
export interface UploadProgress {
  fileName: string;
  /** 0–100 of the bytes sent. At 100 the server is still processing. */
  percent: number;
  /** Position in a multi-file batch (0-based) and the batch size. */
  index: number;
  count: number;
}

interface UploadRequestOptions {
  url: string;
  method?: "POST" | "PUT";
  headers: Record<string, string>;
  body: Blob;
  onProgress?: (percent: number) => void;
}

/**
 * Sends a raw-body upload with XHR so the browser reports bytes sent —
 * `fetch` has no upload progress. Rejects with the server's `error` message
 * on a non-2xx status and resolves with the parsed JSON body (or null).
 */
export function uploadRequest<T = unknown>({
  url,
  method = "POST",
  headers,
  body,
  onProgress,
}: UploadRequestOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      const total = event.lengthComputable ? event.total : body.size;
      onProgress(total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0);
    };
    xhr.onload = () => {
      let data: any = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(data as T);
      } else {
        reject(new Error(data?.error || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(body);
  });
}

interface SendOptions {
  url: string;
  method?: "POST" | "PUT";
  headers: Record<string, string>;
  /** Position in a multi-file batch, so the line can read "2 of 5". */
  index?: number;
  count?: number;
}

/**
 * Upload state for one picker. `send` streams a file and keeps `progress`
 * current; call `reset` in the caller's `finally` once the whole batch is
 * done so the line stays up between files.
 */
export function useUpload() {
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const send = useCallback(
    <T = unknown,>(file: File, { url, method, headers, index = 0, count = 1 }: SendOptions) => {
      setProgress({ fileName: file.name, percent: 0, index, count });
      return uploadRequest<T>({
        url,
        method,
        headers,
        body: file,
        onProgress: (percent) =>
          setProgress((current) =>
            current ? { ...current, percent } : { fileName: file.name, percent, index, count },
          ),
      });
    },
    [],
  );

  const reset = useCallback(() => setProgress(null), []);

  return { progress, uploading: progress !== null, send, reset };
}

/** The standard raw-body headers the document endpoints read. */
export function documentUploadHeaders(
  file: File,
  extra: Record<string, string | number | null | undefined> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "x-filename": file.name,
    "x-content-type": file.type || "application/octet-stream",
  };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && value !== "") headers[key] = String(value);
  }
  return headers;
}
