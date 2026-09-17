import { inflateRawSync } from "node:zlib";

export const XLSX_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

/**
 * Minimal .xlsx reader: enough to turn the first worksheet into CSV text so a
 * spreadsheet can go through the same text readers as a CSV. Handles shared
 * strings, inline strings and plain values; formulas contribute their cached
 * value. Not a general spreadsheet library — anything odd falls back to "".
 */
export function xlsxToCsv(bytes: Buffer): string {
  const files = readZip(bytes);
  const workbook = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  // First sheet in the workbook order, resolved through the relationships part.
  let sheetPath = "xl/worksheets/sheet1.xml";
  if (workbook && rels) {
    const relId = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
    const target = relId ? rels.match(new RegExp(`<Relationship\\b[^>]*\\bId="${relId}"[^>]*\\bTarget="([^"]+)"`))?.[1] : null;
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheet = files.get(sheetPath);
  if (!sheet) return "";
  const shared = parseSharedStrings(files.get("xl/sharedStrings.xml") ?? "");
  const rows: string[][] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1]!;
      const body = cell[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1] ?? "";
      const column = columnIndex(ref);
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      let value = "";
      if (type === "s") {
        const index = Number(body.match(/<v>([^<]*)<\/v>/)?.[1] ?? "-1");
        value = shared[index] ?? "";
      } else if (type === "inlineStr") {
        value = decode(body.match(/<t[^>]*>([^<]*)<\/t>/g)?.map((t) => t.replace(/<[^>]+>/g, "")).join("") ?? "");
      } else {
        value = decode(body.match(/<v>([^<]*)<\/v>/)?.[1] ?? "");
      }
      while (cells.length < column) cells.push("");
      cells[column] = value;
    }
    if (cells.some((value) => value.trim() !== "")) rows.push(cells);
  }
  return rows.map((row) => row.map(csvField).join(",")).join("\n");
}

function csvField(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function columnIndex(letters: string) {
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    decode([...si[1]!.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]!).join("")));
}

function decode(value: string) {
  return value
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

/** Walks the zip's central directory and inflates every entry we might need. */
function readZip(bytes: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return files;
  const entries = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!/^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/.test(name)) continue;
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(start, start + compressedSize);
    try {
      files.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
    } catch {
      // A corrupt part is skipped; the caller sees an empty sheet.
    }
  }
  return files;
}
