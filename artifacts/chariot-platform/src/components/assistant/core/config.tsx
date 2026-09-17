import * as React from "react";
import type { LucideIcon } from "lucide-react";
import type { TranscriptAttachment } from "./types";

/** A record offered by the composer's autofill. */
export type SuggestionHit = {
  type: string;
  id: number;
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  /** e.g. "Phone: 07700 …" when the match was not on the title. */
  detail?: string | null;
};

/** How a record type looks: label, icon and the coloured tile behind it. */
export type TypeMeta = {
  label: string;
  icon: LucideIcon;
  tile: string;
};

export type LinkComponent = React.ComponentType<{
  href: string;
  className?: string;
  children?: React.ReactNode;
  onClick?: React.MouseEventHandler;
}>;

/**
 * Everything the assistant UI needs from the host application. The core
 * components read this from context, so porting the assistant to another app
 * is a matter of providing a new config (see `chariot-assistant.tsx`).
 */
export type AssistantConfig = {
  /** Base path of the assistant API, e.g. `/api/assistant`. */
  endpoint: string;
  /** Storage key for the persisted thread; include the user id. */
  storageKey: string;
  title: string;
  /** Shown under the title (model name, tagline…). */
  subtitle?: string;
  /** Empty-state copy and clickable starter prompts. */
  intro: string;
  starters: string[];
  /**
   * Uploads a file for the chat; returns what the server needs to read it
   * later. Report `onProgress(0–100)` as bytes go up so the chip shows a bar.
   */
  uploadAttachment: (
    file: File,
    onProgress: (percent: number) => void,
  ) => Promise<TranscriptAttachment>;
  /** URL that serves an uploaded attachment (for thumbnails / playback). */
  attachmentUrl: (id: number) => string;
  /** Records matching what the user is typing; the composer calls this per candidate phrase. */
  suggest: (query: string, signal: AbortSignal) => Promise<SuggestionHit[]>;
  typeMeta: (type: string) => TypeMeta;
  recordHref: (type: string, id: number) => string;
  /** The app's router link (defaults to a plain anchor). */
  Link?: LinkComponent;
  /** Current in-app path, sent to the server as page context. */
  currentPath?: () => string;
  /** Called after an approved write ran, so the app can refetch its data. */
  onDataChanged?: () => void;
  /** `accept` attribute for the file picker. */
  acceptFiles?: string;
  maxAttachmentBytes?: number;
};

const DefaultLink: LinkComponent = ({ href, className, children, onClick }) => (
  <a href={href} className={className} onClick={onClick}>
    {children}
  </a>
);

const ConfigContext = React.createContext<AssistantConfig | null>(null);

function AssistantProvider({
  config,
  children,
}: {
  config: AssistantConfig;
  children: React.ReactNode;
}) {
  return (
    <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
  );
}

function useAssistantConfig(): AssistantConfig & { Link: LinkComponent } {
  const config = React.useContext(ConfigContext);
  if (!config) {
    throw new Error(
      "Assistant components must be rendered inside <AssistantProvider>",
    );
  }
  return { ...config, Link: config.Link ?? DefaultLink };
}

export { AssistantProvider, useAssistantConfig };
