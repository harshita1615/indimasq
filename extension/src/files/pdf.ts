/**
 * PDF helpers that need no PDF library, so they run in tests too:
 * putting a page's text pieces together, finding where a detected value sits
 * on the page, and writing a new PDF made of page images.
 *
 * The safe copy of a PDF is built from scratch out of page pictures with each
 * value covered by its placeholder, so nothing of the original's text,
 * metadata, forms, comments, attachments or scripts is carried over.
 */

/** One piece of text on a page, in page pixels at scale 1 (1 px = 1 pt),
 * origin top left. */
export interface TextItem {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The PDF marks the end of a line after this piece. */
  readonly eol?: boolean;
  /** pdf.js's name for the piece's font, usable in canvas once the page is drawn. */
  readonly font?: string;
}

/** A detected value: [start, end) in pageText's text, and its placeholder. */
export interface Span {
  readonly start: number;
  readonly end: number;
  readonly placeholder: string;
}

/** Width of item.str.slice(0, upTo), in page units. */
export type Measure = (item: TextItem, upTo: number) => number;

/** Without real font measurements: every character the same width. Only a
 * fallback; the extension measures with the PDF's own fonts. */
export const evenWidths: Measure = (item, upTo) => (item.str.length ? (item.w * upTo) / item.str.length : 0);

/** A box to cover on a page, with the placeholder to write in it. */
export interface Cover {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly label: string;
}

export interface PageText {
  readonly text: string;
  /** Where each item's text starts in `text`. */
  readonly starts: readonly number[];
}

/** The page's text as a person would read it: pieces on one line joined by a
 * space when there is a gap, lines by newlines. */
export function pageText(items: readonly TextItem[]): PageText {
  let text = "";
  const starts: number[] = [];
  let prev: TextItem | undefined;
  for (const item of items) {
    if (prev) {
      const newLine = prev.eol || Math.abs(item.y - prev.y) > Math.max(prev.h, item.h) * 0.5;
      if (newLine) text += "\n";
      else if (item.x - (prev.x + prev.w) > Math.min(prev.h, item.h) * 0.15 && !/\s$/.test(prev.str) && !/^\s/.test(item.str)) text += " ";
    }
    starts.push(text.length);
    text += item.str;
    prev = item;
  }
  return { text, starts };
}

/** Extra cover on each side of a value, as a share of the text height. Errs
 * towards hiding a sliver of a neighbouring character rather than leaving
 * any part of the value visible. */
export const SIDE_MARGIN = 0.35;

/** Covers for detected spans: one box per line a value is on, placed with
 * `measure`, widened by SIDE_MARGIN, labelled with the placeholder. */
export function coversFor(
  items: readonly TextItem[],
  { starts }: PageText,
  spans: readonly Span[],
  measure: Measure = evenWidths,
): Cover[] {
  const covers: Cover[] = [];
  for (const span of spans) {
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    items.forEach((item, i) => {
      const s = starts[i]!;
      const e = s + item.str.length;
      if (e <= span.start || s >= span.end || item.str.length === 0) return;
      const x0 = item.x + measure(item, Math.max(span.start, s) - s);
      const x1 = item.x + measure(item, Math.min(span.end, e) - s);
      const box = { x0: x0 - item.h * SIDE_MARGIN, x1: x1 + item.h * SIDE_MARGIN, y0: item.y, y1: item.y + item.h };
      // Join with a box on the same line (a value split over pieces).
      const same = boxes.find((b) => Math.abs(b.y0 - box.y0) < item.h * 0.5);
      if (same) {
        same.x0 = Math.min(same.x0, box.x0);
        same.x1 = Math.max(same.x1, box.x1);
        same.y0 = Math.min(same.y0, box.y0);
        same.y1 = Math.max(same.y1, box.y1);
      } else boxes.push(box);
    });
    boxes.forEach((b, i) =>
      covers.push({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0, label: i === 0 ? span.placeholder : "" }),
    );
  }
  return covers;
}

export interface PageImage {
  /** JPEG bytes of the page picture. */
  readonly jpeg: Uint8Array;
  /** Picture size in pixels. */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Page size in points (1/72 inch). */
  readonly width: number;
  readonly height: number;
}

/** A minimal PDF: one JPEG picture per page, nothing else. */
export function imagesToPdf(pages: readonly PageImage[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push("\nendobj\n");
  };
  const fmt = (v: number) => (Math.round(v * 100) / 100).toString();

  // 1: catalog, 2: page tree, then per page: page, image, contents.
  const pageId = (i: number) => 3 + i * 3;
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] >>`));
  pages.forEach((page, i) => {
    const id = pageId(i);
    object(id, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(page.width)} ${fmt(page.height)}] ` +
          `/Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
      ),
    );
    object(id + 1, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      );
      push(page.jpeg);
      push("\nendstream");
    });
    const draw = `q ${fmt(page.width)} 0 0 ${fmt(page.height)} 0 0 cm /Im0 Do Q`;
    object(id + 2, () => push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
  });

  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
