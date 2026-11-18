/** Messages between the content script, the background script and the
 * offscreen page that reads PDFs. All of it stays inside the extension. */

import type { Span, TextItem } from "../files/pdf.ts";

/** Read a PDF's text (bytes as base64). */
export interface PdfReadRequest {
  readonly type: "indimasq-pdf-read";
  readonly pdf: string;
}

export interface PdfPage {
  readonly items: TextItem[];
}

export type PdfReadResponse =
  | { readonly ok: true; readonly pages: PdfPage[] }
  | { readonly ok: false; readonly reason: "locked" | "too-long" | "damaged" };

/** Draw the PDF's pages as pictures with these values covered: for each page,
 * the spans of its pageText() text with their placeholders. The boxes are
 * worked out while drawing, measured with the PDF's own fonts. */
export interface PdfRenderRequest {
  readonly type: "indimasq-pdf-render";
  readonly pdf: string;
  readonly spans: Span[][];
}

export type PdfRenderResponse = { readonly ok: true; readonly pdf: string } | { readonly ok: false };

export type OffscreenRequest = (PdfReadRequest | PdfRenderRequest) & { readonly target?: "indimasq-offscreen" };

/** Bytes to base64 and back, in chunks (messages carry text, not bytes). */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
