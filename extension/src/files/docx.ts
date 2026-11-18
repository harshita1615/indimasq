/**
 * Word (.docx) documents: read their text, and write a copy with personal data
 * replaced by placeholders, keeping all formatting.
 *
 * A .docx is a ZIP of XML. Text sits in <w:t> elements inside runs, and one
 * value can be split over several runs ("ABCPE" in bold, "1234F" not), so each
 * paragraph's runs are read as one string, detected as a whole, and the
 * placeholder is written into the first run the value touches. The XML is
 * edited as text, not parsed and re-serialised, so nothing else changes.
 */

import { readZip, writeZip, type ZipEntry } from "./zip.ts";

/** Parts of a document that hold its text. */
const TEXT_PARTS = /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;

export interface SpanMasker {
  maskSpans(text: string): { replacements: { start: number; end: number; placeholder: string }[] };
}

interface Piece {
  /** Text as read (entities decoded). Tabs and breaks are "\t" / "\n" with no element. */
  readonly text: string;
  /** For a <w:t>: where its opening tag and its text sit in the XML. */
  readonly el?: { tagStart: number; tagEnd: number; textEnd: number; tag: string };
}

const TOKEN = /<w:p(?=[\s>/])[^>]*>|<\/w:p>|<w:t(?=[\s>])([^>]*)>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?=[\s/])[^>]*\/>/g;

/** Paragraphs as lists of pieces. A nested paragraph (a text box) splits its parent. */
function paragraphs(xml: string): Piece[][] {
  const out: Piece[][] = [];
  let current: Piece[] = [];
  const close = () => {
    if (current.length) out.push(current);
    current = [];
  };
  for (const m of xml.matchAll(TOKEN)) {
    const token = m[0];
    if (token.startsWith("<w:p") || token === "</w:p>") close();
    else if (token === "<w:tab/>") current.push({ text: "\t" });
    else if (token.startsWith("<w:br") || token.startsWith("<w:cr")) current.push({ text: "\n" });
    else {
      const tag = `<w:t${m[1]}>`;
      const tagStart = m.index;
      const tagEnd = tagStart + tag.length;
      current.push({ text: decode(m[2]!), el: { tagStart, tagEnd, textEnd: tagEnd + m[2]!.length, tag } });
    }
  }
  close();
  return out;
}

/** All the text of a document, one paragraph per line. */
export async function docxText(file: Uint8Array): Promise<string> {
  const lines: string[] = [];
  for (const entry of await readZip(file)) {
    if (!TEXT_PARTS.test(entry.name)) continue;
    const xml = new TextDecoder().decode(entry.data);
    for (const p of paragraphs(xml)) lines.push(p.map((piece) => piece.text).join(""));
  }
  return lines.join("\n");
}

/** A copy of the document with each detected value replaced by a placeholder. */
export async function redactDocx(file: Uint8Array, masker: SpanMasker): Promise<Uint8Array<ArrayBuffer>> {
  const entries: ZipEntry[] = [];
  for (const entry of await readZip(file)) {
    if (!TEXT_PARTS.test(entry.name)) {
      entries.push(entry);
      continue;
    }
    const xml = new TextDecoder().decode(entry.data);
    entries.push({ name: entry.name, data: new TextEncoder().encode(redactXml(xml, masker)) });
  }
  return writeZip(entries);
}

/** Exported for tests: the XML of one part, redacted. */
export function redactXml(xml: string, masker: SpanMasker): string {
  const edits: { start: number; end: number; text: string }[] = [];
  for (const pieces of paragraphs(xml)) {
    const full = pieces.map((p) => p.text).join("");
    const { replacements } = masker.maskSpans(full);
    if (replacements.length === 0) continue;
    let at = 0;
    const placed = new Set<number>();
    for (const piece of pieces) {
      const start = at;
      at += piece.text.length;
      if (!piece.el) continue;
      let text = "";
      for (let i = 0; i < piece.text.length; i++) {
        const pos = start + i;
        const r = replacements.findIndex((x) => pos >= x.start && pos < x.end);
        if (r < 0) text += piece.text[i];
        else if (!placed.has(r)) {
          // The first run the value touches carries the placeholder; the rest lose their part.
          placed.add(r);
          text += replacements[r]!.placeholder;
        }
      }
      if (text === piece.text) continue;
      const { tagStart, tagEnd, textEnd, tag } = piece.el;
      // Spaces at either end are dropped by Word unless the element says to keep them.
      const keep = /^\s|\s$/.test(text) && !/xml:space=/.test(tag);
      edits.push({ start: tagStart, end: tagEnd, text: keep ? tag.replace("<w:t", '<w:t xml:space="preserve"') : tag });
      edits.push({ start: tagEnd, end: textEnd, text: encode(text) });
    }
  }
  edits.sort((a, b) => b.start - a.start);
  let out = xml;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function decode(s: string): string {
  return s.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/gi, (_, hex, dec, named) =>
    hex ? String.fromCodePoint(parseInt(hex, 16))
    : dec ? String.fromCodePoint(Number(dec))
    : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[named.toLowerCase()]!,
  );
}

function encode(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
