# Assistant core (browser)

The chat UI for an in-app AI assistant: a corner launcher and modal popup,
a streaming transcript on shadcn's `MessageScroller`, a composer that
autofills records as you type, record cards with files, **approval cards**
for writes and **dropdown questions**. Nothing in this folder knows about the
host app — it reads an `AssistantConfig` from context. `../chariot-assistant.tsx`
is the Chariot wiring and the example to copy.

The server half is `services/assistant/core/` in the API and speaks the
contract in `types.ts`.

## Porting checklist

1. Copy this folder. It expects a shadcn/ui project with these registry
   items installed: `attachment`, `badge`, `bubble`, `button`, `card`,
   `dialog`, `empty`, `input`, `item`, `kbd`, `marker`, `message`,
   `message-scroller`, `popover`, `select`, `sheet`, `spinner`, `table`,
   `textarea`, `toast`, `tooltip`; plus `react-markdown`, `remark-gfm`,
   `@tailwindcss/typography` and `lucide-react`. `cn` comes from `@/lib/utils`.
2. Provide a config and mount the widget once, inside your app shell:
   ```tsx
   const config: AssistantConfig = {
     endpoint: "/api/assistant",
     storageKey: `assistant.${user.id}`,
     title: "Assistant", intro: "…", starters: ["…"],
     uploadAttachment: (file) => …,            // → { id, name, contentType, byteSize }
     attachmentUrl: (id) => `/api/files/${id}`,
     suggest: (query, signal) => …,            // → SuggestionHit[] from your search
     typeMeta: (type) => ({ label, icon, tile }),
     recordHref: (type, id) => `/things/${id}`,
     Link,                                     // your router's link component
     onDataChanged: () => queryClient.invalidateQueries(),
   };
   <AssistantProvider config={config}>
     <AssistantWidget configured mobile={isMobile} locationKey={location} />
   </AssistantProvider>
   ```
   `locationKey` closes the popup when the app navigates (links inside the
   chat go to real pages). Omit it to keep the popup open across navigation.
3. Optional: use the pieces directly (`AssistantThread`, `AssistantComposer`,
   `useAssistant`) to embed the assistant in a page instead of a popup.

## What the pieces do

| file | role |
| --- | --- |
| `use-assistant.ts` | owns the transcript (persisted in `localStorage`), parses the SSE stream, exposes `send / decide / answer / stop / reset` and the live `phase`, `activity`, `streamText` |
| `thread.tsx` | rows for user / assistant / tool activity / proposal / question; `AssistantStatus` is the "what am I doing" line |
| `composer.tsx` | textarea with record autofill (`suggest`), `@`-mentions, file upload / paste / drop, Stop while streaming |
| `record-card.tsx` | a fetched record with linked fields, image/PDF viewer, inline audio |
| `proposal-card.tsx` | Field / Current / New diff with Approve / Decline |
| `question-card.tsx` | the `ask_user` dropdown |
| `markdown.tsx` + `entities.ts` | replies rendered as markdown; every known record title becomes a link |
| `widget.tsx` | launcher, modal popup (blurred backdrop, pop-in, animated resize), bottom sheet on phones |

## Behaviour worth knowing

- Linked records are sent as `@[Label](type:id)` inside the message text and
  rendered back as chips; the server prompt tells the model to treat them as
  authoritative ids.
- A new user message implicitly declines any open proposals and skips open
  questions, so the user is never stuck on a card.
- Every record any tool returned (search hits, opened records, list items,
  created records) is remembered for the thread and auto-linked in prose, so
  "anything displayed is clickable" holds even when the model writes plain
  text.
