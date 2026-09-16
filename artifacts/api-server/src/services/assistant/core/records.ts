import { formatValue, labelize } from "./format";
import type { BaseContext, Entity, RecordDisplay } from "./types";

export type Rec = Record<string, unknown>;

/**
 * How one record type is fetched, headlined and linked. A project declares
 * one of these per type; the registry turns rows into cards, entities and
 * trimmed model payloads.
 */
export type RecordMeta<Ctx extends BaseContext> = {
  label: string;
  fetch: (ctx: Ctx, id: number) => Promise<Rec | null | { error: string }>;
  href: (row: Rec) => string;
  title: (row: Rec) => string;
  subtitle?: (row: Rec) => string | null;
  badge?: (row: Rec) => string | null;
  /** Keys shown on the card, in order; everything else is only in the model's JSON. */
  fields: string[];
  /** Where a field's value should link (the client behind `clientName`, …). */
  fieldHref?: Record<string, (row: Rec) => string | null | undefined>;
  /** Keys dropped from the model payload. */
  omit?: string[];
  /** Files to show on the card. */
  media?: (ctx: Ctx, row: Rec) => Promise<RecordDisplay["media"]>;
  /** Other records this row names, so the reply can link them too. */
  related?: (row: Rec) => Entity[];
};

export type RecordRegistry<Ctx extends BaseContext> = {
  types: string[];
  meta: (type: string) => RecordMeta<Ctx> | undefined;
  label: (type: string) => string;
  get: (
    ctx: Ctx,
    type: string,
    id: number,
  ) => Promise<
    { row: Rec; display: RecordDisplay; entities: Entity[] } | { error: string }
  >;
  display: (
    type: string,
    row: Rec,
    media?: RecordDisplay["media"],
  ) => RecordDisplay;
  entity: (type: string, row: Rec) => Entity;
  entities: (type: string, row: Rec) => Entity[];
  slim: (row: Rec, type?: string) => Rec;
};

const MAX_NESTED_ITEMS = 25;
const MAX_TEXT = 2000;

/**
 * Trim a record for the model: drop omitted keys, cap long text, and cap
 * nested collections (keeping the newest messages) so a record with a long
 * chat or many documents stays a few KB.
 */
export function slimRecord(row: Rec, omit: string[] = [], depth = 0): Rec {
  const out: Rec = {};
  for (const [key, value] of Object.entries(row)) {
    if (omit.includes(key)) continue;
    if (typeof value === "string" && value.length > MAX_TEXT) {
      out[key] = `${value.slice(0, MAX_TEXT)}… (truncated)`;
    } else if (Array.isArray(value)) {
      const items =
        key === "messages"
          ? value.slice(-MAX_NESTED_ITEMS)
          : value.slice(0, MAX_NESTED_ITEMS);
      out[key] = items.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? depth < 1
            ? slimRecord(
                item as Rec,
                ["reactions", "replyTo", "objectPath"],
                depth + 1,
              )
            : Object.fromEntries(
                Object.entries(item as Rec).filter(
                  ([, v]) =>
                    !Array.isArray(v) && (typeof v !== "object" || v === null),
                ),
              )
          : item,
      );
      if (value.length > items.length)
        out[`${key}Omitted`] = value.length - items.length;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function createRecordRegistry<Ctx extends BaseContext>(
  metas: Record<string, RecordMeta<Ctx>>,
): RecordRegistry<Ctx> {
  const meta = (type: string) => metas[type];
  const label = (type: string) => metas[type]?.label ?? labelize(type);

  const entity = (type: string, row: Rec): Entity => {
    const item = metas[type];
    return {
      type,
      id: Number(row.id),
      title: item ? item.title(row) : String(row.name ?? row.title ?? row.id),
      href: item ? item.href(row) : "#",
    };
  };

  const entities = (type: string, row: Rec): Entity[] => {
    const item = metas[type];
    const list = [entity(type, row), ...(item?.related?.(row) ?? [])];
    const seen = new Set<string>();
    return list.filter((candidate) => {
      const key = `${candidate.type}:${candidate.id}`;
      if (seen.has(key) || !candidate.title) return false;
      seen.add(key);
      return true;
    });
  };

  const display = (
    type: string,
    row: Rec,
    media: RecordDisplay["media"] = [],
  ): RecordDisplay => {
    const item = metas[type];
    const head = entity(type, row);
    return {
      type,
      id: head.id as number,
      title: head.title,
      subtitle: item?.subtitle?.(row) ?? null,
      badge: item?.badge?.(row) ?? null,
      href: head.href,
      fields: (item?.fields ?? [])
        .map((key) => ({
          label: labelize(key),
          value: formatValue(row[key]),
          href: item?.fieldHref?.[key]?.(row) ?? null,
        }))
        .filter(
          (
            field,
          ): field is { label: string; value: string; href: string | null } =>
            field.value !== null,
        ),
      media,
    };
  };

  const get: RecordRegistry<Ctx>["get"] = async (ctx, type, id) => {
    const item = metas[type];
    if (!item) return { error: `Unknown record type ${type}` };
    const row = await item.fetch(ctx, id);
    if (!row) return { error: `${item.label} ${id} not found` };
    if (
      "error" in row &&
      typeof row.error === "string" &&
      Object.keys(row).length === 1
    )
      return { error: row.error };
    const media = item.media ? await item.media(ctx, row as Rec) : [];
    return {
      row: slimRecord(row as Rec, item.omit),
      display: display(type, row as Rec, media.slice(0, 24)),
      entities: entities(type, row as Rec),
    };
  };

  return {
    types: Object.keys(metas),
    meta,
    label,
    get,
    display,
    entity,
    entities,
    slim: (row, type) => slimRecord(row, type ? metas[type]?.omit : undefined),
  };
}
