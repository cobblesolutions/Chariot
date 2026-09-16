import type { Entity } from "./types";

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Turns every mention of a known record into a markdown link, so anything
 * the assistant displays is clickable even when the model wrote plain text.
 * Existing links, inline code and code fences are left alone; longer titles
 * win over shorter ones ("Sophie Marchetti" before "Marchetti Developments").
 */
export function linkEntities(markdown: string, entities: Entity[]): string {
  const usable = entities
    .filter((entity) => entity.title.trim().length >= 3 && entity.href)
    .sort((a, b) => b.title.length - a.title.length);
  if (!usable.length || !markdown) return markdown;

  const byTitle = new Map<string, Entity>();
  for (const entity of usable) {
    const key = entity.title.toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, entity);
  }
  const pattern = new RegExp(
    `(?<![\\w@\\[/])(${[...byTitle.keys()].map(escapeRegExp).join("|")})(?![\\w\\]\\(])`,
    "gi",
  );

  // Split into protected segments (code, links) and free text.
  const protectedPattern =
    /(```[\s\S]*?```|`[^`\n]*`|\[[^\]\n]*\]\([^)\n]*\)|<[^>\n]+>)/g;
  const parts = markdown.split(protectedPattern);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part; // a protected segment
      return part.replace(pattern, (match) => {
        const entity = byTitle.get(match.toLowerCase());
        return entity ? `[${match}](${entity.href})` : match;
      });
    })
    .join("");
}
