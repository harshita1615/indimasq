/**
 * Offscreen page: opens PDFs with pdf.js, entirely on this device.
 *
 * - "read": returns each page's text pieces and where they sit.
 * - "render": draws every page as a picture, covers the given spots with
 *   their placeholders, and builds a new PDF from those pictures.
 *
 * pdf.js, its fonts and its image decoders are bundled in the extension
 * (pdf/); nothing is downloaded. The page keeps nothing between requests and
 * closes itself when idle.
 */

import * as pdfjs from "pdfjs-dist";

import { type Cover, coversFor, evenWidths, imagesToPdf, type Measure, type PageImage, pageText, type Span } from "../files/pdf.ts";
import { type PdfDocument, type PdfJs, pageItems, readPdf } from "../files/pdf-read.ts";
import { fromBase64, type OffscreenRequest, type PdfReadResponse, type PdfRenderResponse, toBase64 } from "../shared/messages.ts";

/** Page pictures: about 150 dpi, sharp enough for an AI to read. */
const RENDER_SCALE = 2;
const MAX_SIDE = 3500;
const IDLE_MS = 120_000;

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf/pdf.worker.min.mjs");

let idle: number | undefined;

const OPTIONS = {
  enableXfa: false,
  standardFontDataUrl: chrome.runtime.getURL("pdf/standard_fonts/"),
  // Plain-JavaScript image decoders: no WebAssembly, so the extension's strict
  // default security policy stays as it is.
  useWasm: false,
  wasmUrl: chrome.runtime.getURL("pdf/wasm/"),
  stopAtErrors: false,
};

const open = (bytes: Uint8Array) => pdfjs.getDocument({ data: bytes, ...OPTIONS }).promise;

function read(pdf: string): Promise<PdfReadResponse> {
  return readPdf(pdfjs as unknown as PdfJs, fromBase64(pdf), OPTIONS);
}

async function render(pdf: string, spans: Span[][]): Promise<PdfRenderResponse> {
  const doc = await open(fromBase64(pdf));
  try {
    // The same pieces, in the same order, as when the text was read.
    const pages = await pageItems(pdfjs as unknown as PdfJs, doc as unknown as PdfDocument);
    const images: PageImage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(RENDER_SCALE, MAX_SIDE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // "print": draw in one go. The default ("display") paces itself with
      // requestAnimationFrame, which never fires in a page nobody sees.
      await page.render({ canvas, canvasContext: ctx, viewport, intent: "print" }).promise;
      // The page's fonts are loaded now, so characters can be measured exactly.
      const items = pages[n - 1] ?? [];
      const covers = coversFor(items, pageText(items), spans[n - 1] ?? [], measureWith(ctx));
      for (const cover of covers) paint(ctx, cover, scale);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/jpeg", 0.85),
      );
      images.push({
        jpeg: new Uint8Array(await blob.arrayBuffer()),
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        width: base.width,
        height: base.height,
      });
    }
    return { ok: true, pdf: toBase64(imagesToPdf(images)) };
  } finally {
    await doc.destroy();
  }
}

/** Measure text in the piece's own font (loaded by pdf.js while drawing),
 * scaled so the whole piece matches the width the PDF gives it. */
function measureWith(ctx: CanvasRenderingContext2D): Measure {
  return (item, upTo) => {
    if (upTo <= 0 || !item.str.length) return 0;
    ctx.save();
    ctx.font = `100px "${item.font ?? ""}", sans-serif`;
    const whole = ctx.measureText(item.str).width;
    const part = ctx.measureText(item.str.slice(0, upTo)).width;
    ctx.restore();
    return whole > 0 ? (item.w * part) / whole : evenWidths(item, upTo);
  };
}

/** Cover a value with a white box carrying its placeholder. */
function paint(ctx: CanvasRenderingContext2D, cover: Cover, scale: number): void {
  // Vertical margin for ascenders and descenders; coversFor already widened it.
  const pad = Math.max(1, cover.h * 0.18) * scale;
  const x = cover.x * scale;
  const y = cover.y * scale - pad;
  const w = cover.w * scale;
  const h = cover.h * scale + 2 * pad;
  ctx.fillStyle = "#fff";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#555";
  ctx.lineWidth = Math.max(1, scale * 0.6);
  ctx.strokeRect(x, y, w, h);
  if (!cover.label) return;
  let size = h * 0.72;
  ctx.font = `bold ${size}px Arial, sans-serif`;
  const width = ctx.measureText(cover.label).width;
  if (width > w * 0.94) {
    size *= (w * 0.94) / width;
    ctx.font = `bold ${size}px Arial, sans-serif`;
  }
  ctx.fillStyle = "#000";
  ctx.textBaseline = "middle";
  ctx.fillText(cover.label, x + (w - ctx.measureText(cover.label).width) / 2, y + h / 2);
}

chrome.runtime.onMessage.addListener((message: OffscreenRequest, sender, sendResponse) => {
  if (message?.target !== "indimasq-offscreen" || sender.id !== chrome.runtime.id) return;
  window.clearTimeout(idle);
  const work =
    message.type === "indimasq-pdf-read"
      ? read(message.pdf)
      : render(message.pdf, message.spans).catch((): PdfRenderResponse => ({ ok: false }));
  work.then(sendResponse).finally(() => {
    idle = window.setTimeout(() => window.close(), IDLE_MS);
  });
  return true;
});
