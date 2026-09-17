import PDFDocument from "pdfkit";
import type { TermsTemplateField } from "@workspace/db";
import { FIRM_NAME, mergedValues, renderTemplateBody } from "./terms-template";

/**
 * DocuSign places its tabs by finding these strings in the PDF. They are
 * printed in white so the reader never sees them (a standard DocuSign
 * technique) — keep them in step with `integrations/docusign.ts`.
 */
export const SIGN_ANCHOR = "/sig_client/";
export const DATE_ANCHOR = "/date_client/";

const PAGE = { size: "A4" as const, margin: 56 };
const INK = "#1f2422";
const MUTED = "#6b716e";
const RULE = "#d7dbd9";

export interface TermsPdfInput {
  title: string;
  body: string;
  fields: TermsTemplateField[];
  version: number;
  auto: Record<string, string>;
  values: Record<string, string>;
  /** Printed under the signature line. */
  signerName: string;
}

/** Splits the body into blocks: `# ` headings, `- ` bullet runs, and paragraphs. Blank blocks (an omitted optional field) are dropped. */
function blocks(text: string) {
  const out: Array<{ kind: "heading" | "paragraph"; text: string } | { kind: "bullets"; items: string[] }> = [];
  for (const raw of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const bullets = lines.filter((line) => /^[-•*]\s+/.test(line));
    if (bullets.length === lines.length) {
      out.push({ kind: "bullets", items: lines.map((line) => line.replace(/^[-•*]\s+/, "")) });
      continue;
    }
    if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0]!)) {
      out.push({ kind: "heading", text: lines[0]!.replace(/^#{1,3}\s+/, "") });
      continue;
    }
    out.push({ kind: "paragraph", text: lines.join(" ") });
  }
  return out;
}

/** Renders the agreement as a PDF buffer. Pure: the same input gives the same document (bar the generation date in `auto`). */
export function renderTermsPdf(input: TermsPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: PAGE.size,
      margins: { top: PAGE.margin, bottom: PAGE.margin + 16, left: PAGE.margin, right: PAGE.margin },
      bufferPages: true,
      info: { Title: `${input.title} — ${input.auto.clientName ?? ""}`.trim(), Author: FIRM_NAME },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = doc.page.width - PAGE.margin * 2;
    const values = mergedValues(input.fields, input.auto, input.values);
    const body = renderTemplateBody(input.body, values);

    // Masthead
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(FIRM_NAME.toUpperCase(), { characterSpacing: 1.5 });
    doc.moveDown(0.6);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(22).text(renderTemplateBody(input.title, values));
    doc.moveDown(0.3);
    const subtitle = [
      input.auto.clientName ? `Prepared for ${input.auto.clientName}` : null,
      input.auto.date ?? null,
      `Version ${input.version}`,
    ].filter(Boolean).join("  ·  ");
    doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(subtitle);
    doc.moveDown(0.8);
    doc.moveTo(PAGE.margin, doc.y).lineTo(PAGE.margin + width, doc.y).lineWidth(0.8).strokeColor(RULE).stroke();
    doc.moveDown(1.2);

    // Body
    for (const block of blocks(body)) {
      if (block.kind === "heading") {
        doc.moveDown(0.4);
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(12.5).text(block.text, { paragraphGap: 4 });
        doc.moveDown(0.2);
      } else if (block.kind === "bullets") {
        doc.fillColor(INK).font("Helvetica").fontSize(10.5);
        doc.list(block.items, { bulletRadius: 1.6, textIndent: 14, bulletIndent: 4, lineGap: 2, paragraphGap: 3 });
        doc.moveDown(0.6);
      } else {
        doc.fillColor(INK).font("Helvetica").fontSize(10.5).text(block.text, { align: "left", lineGap: 2.5, paragraphGap: 8 });
      }
    }

    // Signature block — kept together on one page.
    const blockHeight = 150;
    if (doc.y + blockHeight > doc.page.height - doc.page.margins.bottom) doc.addPage();
    doc.moveDown(1.5);
    doc.moveTo(PAGE.margin, doc.y).lineTo(PAGE.margin + width, doc.y).lineWidth(0.8).strokeColor(RULE).stroke();
    doc.moveDown(1);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text("Agreement");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10.5).text("I confirm that I have read and understood these terms and agree to be bound by them.", { lineGap: 2 });
    doc.moveDown(1.6);
    const lineY = doc.y + 28;
    const half = width / 2 - 12;
    // Left: signature. The anchor sits at the line so the tab lands on it.
    doc.moveTo(PAGE.margin, lineY).lineTo(PAGE.margin + half, lineY).lineWidth(0.6).strokeColor(INK).stroke();
    doc.fillColor("#ffffff").fontSize(6).text(SIGN_ANCHOR, PAGE.margin + 2, lineY - 26, { lineBreak: false });
    doc.fillColor(MUTED).fontSize(8.5).text("Signed by the client", PAGE.margin, lineY + 5, { width: half, lineBreak: false });
    doc.fillColor(INK).fontSize(10).text(input.signerName, PAGE.margin, lineY + 18, { width: half, lineBreak: false });
    // Right: date.
    const dateX = PAGE.margin + half + 24;
    doc.moveTo(dateX, lineY).lineTo(PAGE.margin + width, lineY).lineWidth(0.6).strokeColor(INK).stroke();
    doc.fillColor("#ffffff").fontSize(6).text(DATE_ANCHOR, dateX + 2, lineY - 14, { lineBreak: false });
    doc.fillColor(MUTED).fontSize(8.5).text("Date", dateX, lineY + 5, { width: half, lineBreak: false });

    // Footer on every page, once the page count is known.
    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      // Writing inside the bottom margin would make pdfkit start a new page; lift the margin while the footer goes on.
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - PAGE.margin + 6;
      doc.fillColor(MUTED).font("Helvetica").fontSize(8);
      doc.text(`${FIRM_NAME} · ${input.title} v${input.version}`, PAGE.margin, y, { width: width / 2, lineBreak: false });
      doc.text(`Page ${index - range.start + 1} of ${range.count}`, PAGE.margin + width / 2, y, { width: width / 2, align: "right", lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
