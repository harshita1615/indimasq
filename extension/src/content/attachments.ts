/**
 * Files attached to the chat (file picker, drag and drop, paste) are checked
 * for personal data before the page sees them.
 *
 * The page's event is held back while the file is read on this device. If
 * nothing is found, the same files are handed to the page as if nothing
 * happened. If something is found, the user chooses: a copy with the values
 * replaced by placeholders (the same ones this chat uses, so they can be
 * revealed on hover), the original, or nothing.
 */

import type { EntityType } from "../core/types.ts";
import { ENTITY_TYPES } from "../core/types.ts";
import { docxText, redactDocx, type SpanMasker } from "../files/docx.ts";
import { pageText } from "../files/pdf.ts";
import {
  fromBase64,
  type PdfPage,
  type PdfReadRequest,
  type PdfReadResponse,
  type PdfRenderRequest,
  type PdfRenderResponse,
  toBase64,
} from "../shared/messages.ts";
import { t } from "../shared/i18n.ts";
import { summarize } from "../shared/summary.ts";
import { showNotice, showWarning } from "./banner.ts";

/** Larger files are let through unchecked (with a notice): reading them would stall the page. */
const MAX_BYTES = 20 * 1024 * 1024;

/** Events this script re-dispatches, which its own listeners must let through. */
const ours = new WeakSet<Event>();
export const isOwnEvent = (event: Event): boolean => ours.has(event);

export interface AttachmentDeps {
  listen<K extends keyof DocumentEventMap>(type: K, handler: (event: DocumentEventMap[K]) => void, capture: true): void;
  enabled(): boolean;
  record(counts: ReadonlyMap<EntityType, number>): void;
  /** Detect without changing the chat's masking session. */
  count(text: string): Map<EntityType, number>;
  /** The chat's masking session: same value, same placeholder, across messages and files. */
  masker: SpanMasker & { mask(text: string): string };
}

/** A kind of file IndiMasq can read. */
interface Reader {
  accepts(file: File): boolean;
  /** The file's text. Throws FileProblem when it cannot be checked. */
  text(file: File): Promise<string>;
  redact(file: File, masker: AttachmentDeps["masker"]): Promise<File>;
}

/** Why a file could not be checked: the user is told and decides. */
export class FileProblem extends Error {
  readonly kind: "locked" | "too-long" | "damaged" | "no-text";
  constructor(kind: FileProblem["kind"]) {
    super(kind);
    this.kind = kind;
  }
}

/** A PDF's pages as read, kept between the check and the safe copy. */
const pdfPages = new WeakMap<File, PdfPage[]>();
/** Never wait for the PDF page longer than this. */
const PDF_TIMEOUT_MS = 30_000;

async function ask<T>(request: PdfReadRequest | PdfRenderRequest): Promise<T | undefined> {
  return (await Promise.race([
    chrome.runtime.sendMessage(request),
    new Promise((resolve) => setTimeout(() => resolve(undefined), PDF_TIMEOUT_MS)),
  ])) as T | undefined;
}

const pdfReader: Reader = {
  accepts: (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name),
  async text(file) {
    const request: PdfReadRequest = { type: "indimasq-pdf-read", pdf: toBase64(new Uint8Array(await file.arrayBuffer())) };
    const response = await ask<PdfReadResponse>(request);
    if (!response) throw new FileProblem("damaged");
    if (!response.ok) throw new FileProblem(response.reason);
    if (response.pages.every((p) => p.items.length === 0)) throw new FileProblem("no-text");
    pdfPages.set(file, response.pages);
    return response.pages.map((p) => pageText(p.items).text).join("\n");
  },
  async redact(file, masker) {
    const pages = pdfPages.get(file);
    if (!pages) throw new FileProblem("damaged");
    const spans = pages.map((p) => masker.maskSpans(pageText(p.items).text).replacements);
    const request: PdfRenderRequest = { type: "indimasq-pdf-render", pdf: toBase64(new Uint8Array(await file.arrayBuffer())), spans };
    const response = await ask<PdfRenderResponse>(request);
    if (!response?.ok) throw new FileProblem("damaged");
    return new File([fromBase64(response.pdf)], file.name, { type: "application/pdf", lastModified: Date.now() });
  },
};

/** Pages of a PDF with no text (scanned pictures): they cannot be checked. */
export function unreadablePages(file: File): number[] {
  return (pdfPages.get(file) ?? []).flatMap((p, i) => (p.items.length === 0 ? [i + 1] : []));
}

const TEXT_EXTENSIONS = /\.(?:txt|csv|tsv|json|md|markdown|log|xml|yaml|yml|ini|sql)$/i;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const READERS: readonly Reader[] = [
  {
    accepts: (f) => f.type.startsWith("text/") || f.type === "application/json" || TEXT_EXTENSIONS.test(f.name),
    text: (f) => f.text(),
    redact: async (f, masker) => new File([masker.mask(await f.text())], f.name, { type: f.type, lastModified: Date.now() }),
  },
  {
    accepts: (f) => f.type === DOCX || /\.docx$/i.test(f.name),
    text: async (f) => docxText(new Uint8Array(await f.arrayBuffer())),
    redact: async (f, masker) =>
      new File([await redactDocx(new Uint8Array(await f.arrayBuffer()), masker)], f.name, { type: f.type || DOCX, lastModified: Date.now() }),
  },
  pdfReader,
];

const readerFor = (file: File) => READERS.find((r) => r.accepts(file));

export function installAttachmentChecks(deps: AttachmentDeps): void {
  const readable = (files: File[]) => files.some((f) => readerFor(f));

  // --- file picker ---------------------------------------------------------------------
  deps.listen(
    "change",
    (event) => {
      const input = event.target;
      if (ours.has(event) || !(input instanceof HTMLInputElement) || input.type !== "file") return;
      const files = [...(input.files ?? [])];
      if (!deps.enabled() || !readable(files)) return;
      event.stopImmediatePropagation();
      check(files, {
        deliver: (out) => {
          input.files = transfer(out).files;
          for (const type of ["input", "change"]) {
            const e = new Event(type, { bubbles: true });
            ours.add(e);
            input.dispatchEvent(e);
          }
        },
        cancel: () => {
          input.value = "";
        },
      });
    },
    true,
  );

  // --- drag and drop ----------------------------------------------------------------------
  deps.listen(
    "drop",
    (event) => {
      const files = [...(event.dataTransfer?.files ?? [])];
      if (ours.has(event) || !deps.enabled() || !readable(files)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = event.target instanceof Node && event.target.isConnected ? event.target : document.body;
      const at = { clientX: event.clientX, clientY: event.clientY };
      check(files, {
        deliver: (out) => {
          const e = new DragEvent("drop", { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer(out), ...at });
          ours.add(e);
          target.dispatchEvent(e);
        },
        cancel: () => {
          // Let the page hide its "drop here" overlay.
          const e = new DragEvent("dragleave", { bubbles: true, composed: true, dataTransfer: new DataTransfer(), ...at });
          ours.add(e);
          target.dispatchEvent(e);
        },
      });
    },
    true,
  );

  // --- paste (a copied file) ----------------------------------------------------------------
  deps.listen(
    "paste",
    (event) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (ours.has(event) || !deps.enabled() || !readable(files)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = event.target instanceof Node && event.target.isConnected ? event.target : document.body;
      check(files, {
        deliver: (out) => {
          const e = new ClipboardEvent("paste", { bubbles: true, cancelable: true, composed: true, clipboardData: transfer(out) });
          ours.add(e);
          target.dispatchEvent(e);
        },
        cancel: () => {},
      });
    },
    true,
  );

  async function check(files: File[], to: { deliver: (files: File[]) => void; cancel: () => void }): Promise<void> {
    showNotice(t("notice_checking_file"), 60_000);
    const found: File[] = [];
    const counts = new Map<EntityType, number>();
    const problems: { file: File; kind: FileProblem["kind"] }[] = [];
    let unchecked = false;
    for (const file of files) {
      const reader = readerFor(file);
      if (!reader) continue;
      if (file.size > MAX_BYTES) {
        unchecked = true;
        continue;
      }
      try {
        const c = deps.count(await reader.text(file));
        if (c.size === 0) continue;
        found.push(file);
        for (const [type, n] of c) counts.set(type, (counts.get(type) ?? 0) + n);
      } catch (error) {
        if (error instanceof FileProblem) problems.push({ file, kind: error.kind });
        else unchecked = true;
      }
    }

    // A file IndiMasq could not open or read (a locked or scanned PDF): say why, let the user decide.
    if (found.length === 0 && problems.length > 0) {
      const { file, kind } = problems[0]!;
      showWarning(t(`problem_${kind.replace("-", "_")}`, [file.name]), t("problem_body"), [
        { label: t("btn_upload_anyway"), primary: true, run: () => to.deliver(files) },
        { label: t("btn_cancel"), run: to.cancel },
      ]);
      return;
    }

    if (found.length === 0) {
      // Say so either way, so a quiet upload never looks like a skipped check.
      showNotice(t(unchecked ? "notice_file_failed" : "notice_file_clean"), 3000);
      to.deliver(files);
      return;
    }

    const ordered = new Map(ENTITY_TYPES.filter((type) => counts.has(type)).map((type) => [type, counts.get(type)!]));
    deps.record(ordered);
    const title = t(found.length === 1 ? "banner_file_title" : "banner_files_title", [summarize(ordered, t)]);
    // Say plainly what was not checked: other files, or scanned pages of a PDF.
    const skippedPages = found.flatMap((f) => unreadablePages(f));
    const notes = [
      ...(problems.length > 0 ? [t("note_files_unchecked", [problems.map((p) => p.file.name).join(", ")])] : []),
      ...(skippedPages.length > 0 ? [t("note_pages_unchecked", [skippedPages.join(", ")])] : []),
    ];
    showWarning(title, [t("banner_file_body"), ...notes].join(" "), [
      {
        label: t("btn_upload_redacted"),
        primary: true,
        run: async () => {
          try {
            const safe = new Map<File, File>();
            for (const file of found) safe.set(file, await readerFor(file)!.redact(file, deps.masker));
            to.deliver(files.map((f) => safe.get(f) ?? f));
            showNotice(t("notice_redacted"), 6000);
          } catch {
            // Never fall back to the original silently.
            showNotice(t("notice_redact_failed"), 6000);
            to.cancel();
          }
        },
      },
      { label: t("btn_upload_anyway"), run: () => to.deliver(files) },
      { label: t("btn_cancel"), run: to.cancel },
    ]);
  }
}

function transfer(files: File[]): DataTransfer {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return dt;
}
