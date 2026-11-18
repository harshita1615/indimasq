/** Reading a PDF's text with pdf.js. The pdf.js module is passed in, so the
 * extension (browser build) and the tests (Node build) share this code. */

import type { PdfReadResponse } from "../shared/messages.ts";
import type { TextItem } from "./pdf.ts";

/** Longer documents are not checked (they would hold the upload too long). */
export const MAX_PAGES = 30;

/** The parts of pdf.js used here. */
export interface PdfJs {
  getDocument(params: object): { promise: Promise<PdfDocument> };
  Util: { transform(a: number[], b: number[]): number[] };
}
export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(o: { scale: number }): { transform: number[] };
    getTextContent(): Promise<{ items: object[] }>;
  }>;
  destroy(): Promise<void>;
}

/** Each page's text pieces, from an open document (also used when drawing). */
export async function pageItems(pdfjs: PdfJs, doc: PdfDocument): Promise<TextItem[][]> {
  const pages: TextItem[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const items: TextItem[] = [];
    for (const raw of (await page.getTextContent()).items) {
      const item = raw as { str?: string; transform: number[]; width: number; hasEOL?: boolean; fontName?: string };
      if (!item.str) continue;
      const tx = pdfjs.Util.transform(viewport.transform, item.transform);
      const h = Math.hypot(tx[2]!, tx[3]!);
      items.push({ str: item.str, x: tx[4]!, y: tx[5]! - h, w: item.width, h, eol: item.hasEOL, font: item.fontName });
    }
    pages.push(items);
  }
  return pages;
}

export async function readPdf(pdfjs: PdfJs, bytes: Uint8Array, options: object = {}): Promise<PdfReadResponse> {
  let doc: PdfDocument;
  try {
    doc = await pdfjs.getDocument({ data: bytes, enableXfa: false, stopAtErrors: false, ...options }).promise;
  } catch (error) {
    return { ok: false, reason: (error as Error)?.name === "PasswordException" ? "locked" : "damaged" };
  }
  try {
    if (doc.numPages > MAX_PAGES) return { ok: false, reason: "too-long" };
    return { ok: true, pages: (await pageItems(pdfjs, doc)).map((items) => ({ items })) };
  } catch {
    return { ok: false, reason: "damaged" };
  } finally {
    await doc.destroy();
  }
}
