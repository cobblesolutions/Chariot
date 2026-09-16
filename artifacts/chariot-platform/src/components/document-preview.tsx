import { useEffect, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface PreviewRequest {
  href: string;
  name: string;
  downloadHref?: string;
}

const EVENT = "chariot:preview-document";

/**
 * Open a document in the in-app preview dialog. Works from anywhere — the
 * dialog itself is mounted once in App and listens for this event.
 */
export function previewDocument(href: string, name = "Document", downloadHref?: string) {
  window.dispatchEvent(new CustomEvent<PreviewRequest>(EVENT, { detail: { href, name, downloadHref } }));
}

/** Mounted once. Shows whatever `previewDocument` was last asked to open. */
export function DocumentPreviewHost() {
  const [request, setRequest] = useState<PreviewRequest | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => {
      setLoaded(false);
      setRequest((event as CustomEvent<PreviewRequest>).detail);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  const downloadHref = request?.downloadHref ?? request?.href.replace(/\/view(\?.*)?$/, "/download$1");

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && setRequest(null)}>
      <DialogContent className="flex h-[92dvh] max-w-[min(96vw,1200px)] flex-col gap-3 p-4 sm:max-w-[min(96vw,1200px)] sm:p-5">
        <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 pr-8">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">{request?.name}</DialogTitle>
            <DialogDescription className="sr-only">Document preview</DialogDescription>
          </div>
          <div className="flex shrink-0 gap-1">
            {downloadHref ? (
              <Button variant="ghost" size="sm" asChild>
                <a href={downloadHref} download={request?.name}>
                  <Download /> Download
                </a>
              </Button>
            ) : null}
            {request ? (
              <Button variant="ghost" size="sm" asChild>
                <a href={request.href} target="_blank" rel="noreferrer">
                  <ExternalLink /> Open in tab
                </a>
              </Button>
            ) : null}
          </div>
        </DialogHeader>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          {!loaded ? <Skeleton className="absolute inset-0" /> : null}
          {request ? (
            <iframe
              key={request.href}
              title={request.name}
              src={request.href}
              onLoad={() => setLoaded(true)}
              className="h-full w-full border-0 bg-white"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
