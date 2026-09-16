import { z } from "zod";

type Rec = Record<string, unknown>;

/** `annualIncome` → `Annual income` */
export const labelize = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bid\b/g, "ID");

/** Human form of a field value for cards and diffs; null when there is nothing to show. */
export function formatValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))
      return value.slice(0, 16).replace("T", " ");
    // snake_case status values read better as labels.
    if (/^[a-z]+(_[a-z]+)+$/.test(value))
      return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    return value.length > 160 ? `${value.slice(0, 157)}…` : value;
  }
  if (Array.isArray(value))
    return value.length
      ? value.map((item) => formatValue(item) ?? "").join(", ")
      : null;
  return JSON.stringify(value);
}

/** Zod issue lists from an API become "field: message" lines the model can act on. */
export function readableError(error: string): string {
  try {
    const issues = JSON.parse(error) as Array<{
      path?: Array<string | number>;
      message?: string;
    }>;
    if (
      Array.isArray(issues) &&
      issues.every((issue) => issue && typeof issue === "object")
    ) {
      return issues
        .map(
          (issue) =>
            `${(issue.path ?? []).join(".") || "body"}: ${issue.message ?? "invalid"}`,
        )
        .join("; ");
    }
  } catch {
    // not JSON
  }
  return error;
}

/* ----------------------------------------------------------------------------
 * JSON schema for tool parameters, derived from zod
 * ------------------------------------------------------------------------- */

function cleanSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(cleanSchema);
  if (!node || typeof node !== "object") return node;
  const out: Rec = {};
  for (const [key, value] of Object.entries(node as Rec)) {
    if (key === "$schema") continue;
    if (
      (key === "minimum" || key === "maximum") &&
      Math.abs(Number(value)) > 1e15
    )
      continue;
    if (key === "pattern" && "format" in (node as Rec)) continue;
    out[key] = cleanSchema(value);
  }
  // `zod.coerce.date()` has no JSON form: describe it as an ISO string.
  if (Object.keys(out).length === 0)
    return { type: "string", description: "ISO 8601 date or date-time" };
  return out;
}

/** JSON schema for a zod schema, trimmed of noise the model does not need. */
export function schemaOf(schema: z.ZodType): Rec {
  return cleanSchema(
    z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
  ) as Rec;
}

/** Field-level description hints layered on top of a generated schema. */
export function withHints(schema: Rec, hints: Record<string, string>): Rec {
  const properties = { ...((schema.properties as Rec | undefined) ?? {}) };
  for (const [key, hint] of Object.entries(hints)) {
    if (properties[key] && typeof properties[key] === "object") {
      properties[key] = { ...(properties[key] as Rec), description: hint };
    }
  }
  return { ...schema, properties };
}
