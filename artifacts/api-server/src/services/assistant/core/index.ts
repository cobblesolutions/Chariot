/**
 * Assistant core — everything here is application-agnostic. See README.md in
 * this folder for how to wire it into another project.
 */
export * from "./types";
export {
  createModelClient,
  type ModelClient,
  type ModelClientConfig,
} from "./openrouter";
export {
  createAssistantRouter,
  type AssistantRouterOptions,
  type PageContext,
} from "./router";
export { runAssistantTurn, parseArgs, toolDefinitions } from "./runner";
export { askUserTool } from "./ask-user";
export {
  createRecordRegistry,
  slimRecord,
  type Rec,
  type RecordMeta,
  type RecordRegistry,
} from "./records";
export {
  endpointTool,
  type ApiCaller,
  type ApiContext,
  type ApiResult,
  type EndpointToolSpec,
} from "./endpoint-tool";
export { extractFileContent, type ExtractedFile } from "./file-text";
export {
  formatValue,
  labelize,
  readableError,
  schemaOf,
  withHints,
} from "./format";
