import * as React from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAssistantStatusQueryKey,
  globalSearch,
  useGetAssistantStatus,
  type MessageAttachment,
} from "@workspace/api-client-react";
import { useAuth } from "@/components/auth-provider";
import { useIsMobile } from "@/hooks/use-mobile";
import { SEARCH_TYPES } from "@/lib/search";
import {
  AssistantProvider,
  AssistantWidget,
  type AssistantConfig,
} from "./core";

/** In-app path for a record, matching the API's record cards. */
export function recordHref(type: string, id: number): string {
  switch (type) {
    case "client":
      return `/clients/${id}`;
    case "case":
      return `/cases/${id}`;
    case "property":
      return `/properties/${id}`;
    case "task":
      return `/tasks?task=${id}`;
    case "lender":
      return `/lenders/${id}`;
    case "invoice":
      return `/invoices/${id}`;
    case "renewal":
      return `/renewals?renewal=${id}`;
    case "event":
      return `/calendar?event=${id}`;
    case "conversation":
      return `/messages/conversation/${id}`;
    case "case_chat":
      return `/messages/case/${id}`;
    case "message":
      return `/messages`;
    case "user":
      return `/settings`;
    case "notification":
      return `/activity`;
    default:
      return "/dashboard";
  }
}

/** Assistant record types → the global search's icon + tile colour. */
function typeMeta(type: string) {
  const searchType =
    type === "conversation" || type === "case_chat" ? "message" : type;
  const meta =
    SEARCH_TYPES.find((item) => item.type === searchType) ??
    SEARCH_TYPES.find((item) => item.type === "notification")!;
  return { label: meta.label, icon: meta.icon, tile: meta.tile };
}

async function uploadAttachment(file: File) {
  const response = await fetch("/api/chat/attachments", {
    method: "POST",
    headers: {
      "x-filename": file.name,
      "x-content-type": file.type || "application/octet-stream",
      "Content-Type": "application/octet-stream",
    },
    body: await file.arrayBuffer(),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `Upload failed (${response.status})`);
  }
  const attachment = (await response.json()) as MessageAttachment;
  return {
    id: attachment.id,
    name: attachment.name,
    contentType: attachment.contentType,
    byteSize: attachment.byteSize,
  };
}

/** Record types the composer autofills: the things people name in a request. Tasks, documents, activity and messages only ever matched on incidental text. */
const AUTOFILL_TYPES = ["client", "case", "property", "user"].join(",");

const STARTERS = [
  "What's on my plate today?",
  "Which cases are waiting on the lender?",
  "Create a task to chase the valuation on",
  "File this document under",
];

/**
 * Chariot's wiring of the assistant core: staff only, records from the
 * global search, files via chat attachments, links through wouter.
 */
function ChariotAssistant() {
  const { user } = useAuth();
  const mobile = useIsMobile();
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const enabled = !!user && user.role !== "client";
  const status = useGetAssistantStatus({
    query: {
      queryKey: getGetAssistantStatusQueryKey(),
      enabled,
      staleTime: Infinity,
      retry: false,
    },
  });

  const config = React.useMemo<AssistantConfig | null>(
    () =>
      user
        ? {
            endpoint: "/api/assistant",
            storageKey: `chariot.assistant.${user.id}`,
            title: "Chariot Assistant",
            intro:
              "Ask about any client, case, property or task. Type a name or reference and pick it from the list to link it. Anything the assistant writes is shown to you first for approval.",
            starters: STARTERS,
            uploadAttachment,
            attachmentUrl: (id) => `/api/chat/attachments/${id}/download`,
            suggest: async (query, signal) => {
              const results = await globalSearch(
                { q: query, limit: 4, types: AUTOFILL_TYPES },
                { signal },
              );
              return results.groups.flatMap((group) =>
                group.items.map((hit) => ({
                  type: hit.type,
                  id: hit.id,
                  title: hit.title,
                  subtitle: hit.subtitle,
                  badge: hit.badge,
                  detail:
                    hit.matchedField && hit.snippet
                      ? `${hit.matchedField}: ${hit.snippet}`
                      : null,
                })),
              );
            },
            typeMeta,
            recordHref,
            Link,
            currentPath: () => window.location.pathname,
            onDataChanged: () => void queryClient.invalidateQueries(),
          }
        : null,
    [user, queryClient],
  );

  if (!enabled || !config) return null;
  return (
    <AssistantProvider config={config}>
      <AssistantWidget
        configured={status.data?.enabled ?? true}
        mobile={mobile}
        locationKey={location}
      />
    </AssistantProvider>
  );
}

export { ChariotAssistant };
