import type { z } from "zod";
import {
  formatValue,
  labelize,
  readableError,
  schemaOf,
  withHints,
} from "./format";
import type { Rec, RecordRegistry } from "./records";
import type { BaseContext, Tool, ToolResult, WritePreview } from "./types";

/** Calls the host application's own HTTP API as the current user. */
export type ApiCaller = <T = unknown>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
) => Promise<ApiResult<T>>;

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

export type ApiContext = BaseContext & { api: ApiCaller };

export type EndpointToolSpec = {
  name: string;
  /** Human label, e.g. "Update task". */
  label: string;
  description: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  /** e.g. `/tasks/{id}/comments` — every `{param}` becomes a required integer argument. */
  path: string;
  /** Zod schema of the request body; becomes the `data` argument's JSON schema. */
  body?: z.ZodType;
  hints?: Record<string, string>;
  /** Record type of the target (for the preview diff) and which path param names it. */
  target?: { type: string; param?: string };
  /** Record type created by this tool, for the card shown after it runs. */
  creates?: string;
  destructive?: boolean;
};

const pathParams = (path: string) =>
  [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);

const fillPath = (path: string, args: Rec) =>
  path.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(String(args[key])));

/**
 * A write tool that wraps one REST endpoint. The proposal shown to the user
 * diffs the request body against the current record; on approval the same
 * endpoint the UI uses is called, so validation and side-effects match.
 */
export function endpointTool<Ctx extends ApiContext>(
  spec: EndpointToolSpec,
  registry: RecordRegistry<Ctx>,
): Tool<Ctx> {
  const params = pathParams(spec.path);
  const properties: Rec = {};
  const required: string[] = [];
  for (const param of params) {
    properties[param] = {
      type: "integer",
      description: `${labelize(param)} of the ${spec.target ? registry.label(spec.target.type).toLowerCase() : "record"}`,
    };
    required.push(param);
  }
  if (spec.body) {
    const bodySchema = schemaOf(spec.body);
    properties.data = spec.hints
      ? withHints(bodySchema, spec.hints)
      : bodySchema;
    required.push("data");
  }
  const targetId = (args: Rec) => Number(args[spec.target?.param ?? "id"]);

  const preview = async (ctx: Ctx, args: Rec): Promise<WritePreview> => {
    const data = (args.data as Rec | undefined) ?? {};
    const changes: WritePreview["changes"] = [];
    let target: WritePreview["target"] = null;
    let summary = spec.label;

    if (spec.target) {
      const id = targetId(args);
      const current = await registry.get(ctx, spec.target.type, id);
      if ("row" in current) {
        target = {
          type: spec.target.type,
          id,
          title: current.display.title,
          href: current.display.href,
        };
        summary = `${spec.label}: ${current.display.title}`;
        for (const [key, value] of Object.entries(data)) {
          const from = formatValue(current.row[key]);
          const to = formatValue(value);
          // A PATCH body that must carry name/email repeats unchanged fields; hide those.
          if (from === to) continue;
          changes.push({ field: labelize(key), from, to });
        }
      } else {
        target = {
          type: spec.target.type,
          id,
          title: `${registry.label(spec.target.type)} ${id}`,
          href: null,
        };
        for (const [key, value] of Object.entries(data)) {
          changes.push({
            field: labelize(key),
            from: null,
            to: formatValue(value),
          });
        }
      }
    } else {
      // A create: headline it with whatever names the new record.
      const headline = formatValue(
        data.title ?? data.name ?? data.address ?? data.reference ?? data.body,
      );
      if (headline) summary = `${spec.label}: ${headline}`;
      for (const [key, value] of Object.entries(data)) {
        changes.push({
          field: labelize(key),
          from: null,
          to: formatValue(value),
        });
      }
    }
    // Nothing changes on a delete except the record itself.
    if (spec.destructive && changes.length === 0 && target) {
      changes.push({
        field: registry.label(spec.target!.type),
        from: target.title,
        to: null,
      });
    }
    return {
      title: spec.label,
      summary,
      target,
      changes,
      destructive: !!spec.destructive,
    };
  };

  const run = async (ctx: Ctx, args: Rec): Promise<ToolResult> => {
    let data = (args.data as Rec | undefined) ?? undefined;
    // Some PATCH bodies require fields that rarely change (a client's name and
    // email). The model only sends what changes; fill the rest from the record.
    if (spec.method === "PATCH" && spec.target && data) {
      const requiredKeys = ((properties.data as Rec | undefined)?.required ??
        []) as string[];
      const missing = requiredKeys.filter((key) => data![key] === undefined);
      if (missing.length) {
        const current = await registry.get(
          ctx,
          spec.target.type,
          targetId(args),
        );
        if ("row" in current) {
          data = { ...data };
          for (const key of missing) {
            if (current.row[key] !== undefined) data[key] = current.row[key];
          }
        }
      }
    }
    const result = await ctx.api<Rec>(
      spec.method,
      fillPath(spec.path, args),
      data,
    );
    if (!result.ok)
      return {
        content: { error: readableError(result.error), status: result.status },
      };
    const row =
      result.data && typeof result.data === "object" ? result.data : {};
    const type = spec.creates ?? spec.target?.type;
    if (type && typeof row.id === "number") {
      return {
        content: { ok: true, [type]: registry.slim(row, type) },
        displays: [registry.display(type, row)],
        entities: registry.entities(type, row),
      };
    }
    return { content: { ok: true, result: result.data ?? null } };
  };

  return {
    name: spec.name,
    description: spec.description,
    kind: "write",
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    run,
    preview,
  };
}
