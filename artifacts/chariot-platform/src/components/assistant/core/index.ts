/**
 * Assistant core — application-agnostic chat UI for an AI assistant with
 * approval-gated writes. See README.md in this folder for how to reuse it.
 */
export * from "./types";
export {
  AssistantProvider,
  useAssistantConfig,
  type AssistantConfig,
  type SuggestionHit,
  type TypeMeta,
  type LinkComponent,
} from "./config";
export {
  useAssistant,
  collectEntities,
  type AssistantState,
  type Activity,
  type Phase,
} from "./use-assistant";
export { AssistantWidget } from "./widget";
export { AssistantThread, AssistantStatus, activityLabel } from "./thread";
export { AssistantComposer, type ComposerSubmit } from "./composer";
export { RecordCard, TypeTile } from "./record-card";
export { ProposalCard } from "./proposal-card";
export { QuestionCard } from "./question-card";
export { Markdown } from "./markdown";
export { linkEntities } from "./entities";
