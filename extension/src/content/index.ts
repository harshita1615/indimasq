/**
 * Content script: runs on the supported chatbot sites.
 *
 * Watches paste and send in the message box. If the text contains Indian PII,
 * it stops the paste or send and asks: Mask, Paste/Send anyway, or Cancel.
 * Everything happens in this page; nothing is sent anywhere. One masking
 * session per tab keeps placeholders consistent across messages in a chat, and
 * lets the user point at a placeholder in the chat to see its original value,
 * on this screen only. The popup can list this tab's placeholders too.
 */

import { type EntityType, Kavach } from "../core/index.ts";
import { t } from "../shared/i18n.ts";
import { hasNote, withNote } from "../shared/note.ts";
import { addCaught, defaults, load, onChange } from "../shared/settings.ts";
import { looksLikeSendButton, type Site, siteForHost } from "../shared/sites.ts";
import { countByType, entityLabel, summarize, type TabFinds } from "../shared/summary.ts";
import { close, showNotice, showWarning } from "./banner.ts";
import { installAttachmentChecks, isOwnEvent } from "./attachments.ts";
import { labelledFields, withLabelled } from "../files/labelled.ts";
import { type Revealer, startRevealing } from "./restore.ts";
import {
  appendAtEnd,
  composerFrom,
  findComposer,
  getText,
  insertAtCaret,
  replaceAll,
  saveSelection,
} from "./dom.ts";

const site = siteForHost(location.hostname);
if (site) start(site);

function start(site: Site): void {
  const kavach = new Kavach();
  const session = kavach.session();
  let settings = defaults();
  let bypassUntil = 0; // after "Send anyway", let the re-sent message through
  let lastComposer: HTMLElement | null = null;
  let masked = false; // nothing to restore until this tab has masked something

  // When the extension is updated or reloaded, Chrome leaves this copy running
  // in already-open tabs but cuts its connection ("Extension context
  // invalidated"). An orphaned copy must switch itself off rather than throw
  // errors or keep intercepting sends; the page's next load gets the new copy.
  const lifetime = new AbortController();
  const alive = (): boolean => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  };

  function listen<K extends keyof DocumentEventMap>(
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
    _capture: true,
  ): void {
    // On the window, in the capture phase, registered before the page's own
    // scripts run (document_start): Kavach sees paste, drop and file events first.
    window.addEventListener(
      type,
      (event: Event) => {
        if (!alive()) {
          lifetime.abort();
          close();
          return;
        }
        try {
          handler(event as DocumentEventMap[K]);
        } catch (error) {
          if (alive()) throw error;
          lifetime.abort();
          close();
        }
      },
      { capture: true, signal: lifetime.signal },
    );
  }

  let revealer: Revealer | undefined;
  const update = (s: typeof settings): void => {
    settings = s;
    revealer?.scan(); // e.g. "show real values" was just switched back on
  };
  load().then(update, () => {});
  try {
    onChange(update);
  } catch {
    return; // already orphaned before it started
  }
  const enabled = () => settings.enabled[site.id];

  revealer = startRevealing(
    (placeholder) => {
      const value = session.unmask(placeholder);
      return value === placeholder ? undefined : value;
    },
    entityLabel,
    () => {
      if (!alive()) {
        lifetime.abort();
        return false;
      }
      return masked && enabled() && settings.restore;
    },
  );
  lifetime.signal.addEventListener("abort", () => revealer?.stop());

  // The popup asks this tab what it has hidden, to list it for the user.
  chrome.runtime.onMessage.addListener((message: { type?: string }, sender, sendResponse) => {
    if (message?.type !== "kavach-list" || sender.id !== chrome.runtime.id || sender.tab) return;
    const reply: TabFinds = {
      text: session.entries().map(([placeholder, value]) => ({ placeholder, label: entityLabel(placeholder), value })),
    };
    sendResponse(reply);
  });

  /** Mask text with this tab's session; placeholders in the chat can then be revealed. */
  function mask(text: string): string {
    masked = true;
    const out = session.mask(text);
    revealer?.scan();
    return out;
  }

  function record(counts: ReadonlyMap<EntityType, number>): void {
    addCaught(counts).catch(() => {});
  }

  function isSendButton(button: HTMLButtonElement): boolean {
    if (site.send.some((selector) => button.matches(selector))) return true;
    const label = [button.getAttribute("aria-label"), button.getAttribute("data-testid"), button.title]
      .filter(Boolean)
      .join(" ");
    return looksLikeSendButton(label);
  }

  function findSendButton(): HTMLButtonElement | null {
    for (const selector of site.send) {
      const b = document.querySelector<HTMLButtonElement>(selector);
      if (b) return b;
    }
    return [...document.querySelectorAll("button")].find(isSendButton) ?? null;
  }

  // --- attached files (registered first: a file paste must not reach the text check) ---

  installAttachmentChecks({
    listen,
    enabled: () => enabled() && settings.files,
    record,
    // Files also count labelled fields ("Aadhaar number: ...") that fail the
    // strict checks; see files/labelled.ts. Chat messages keep the strict rules.
    count: (text) => countByType(withLabelled(kavach.scan(text), labelledFields(text))),
    masker: {
      mask: (text) => {
        let out = "";
        let last = 0;
        for (const r of fileSpans(text).replacements) {
          out += text.slice(last, r.start) + r.placeholder;
          last = r.end;
        }
        return out + text.slice(last);
      },
      maskSpans: fileSpans,
    },
  });

  function fileSpans(text: string) {
    masked = true;
    const out = session.maskSpans(text, labelledFields(text));
    revealer?.scan();
    return out;
  }

  // --- paste -----------------------------------------------------------------------

  listen(
    "paste",
    (event) => {
      if (!enabled() || isOwnEvent(event)) return;
      const composer = composerFrom(event.target);
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!composer || !text) return;
      const detections = kavach.scan(text);
      if (detections.length === 0) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const restore = saveSelection(composer);
      const counts = countByType(detections);
      record(counts);

      showWarning(t("banner_paste_title", [summarize(counts, t)]), t("banner_body"), [
        {
          label: t("btn_mask"),
          primary: true,
          run: () => {
            restore();
            insertAtCaret(composer, mask(text));
            const note = t("masked_note");
            if (!hasNote(getText(composer), note)) appendAtEnd(composer, `\n${note}`);
          },
        },
        {
          label: t("btn_paste_anyway"),
          run: () => {
            restore();
            insertAtCaret(composer, text);
          },
        },
        { label: t("btn_cancel"), run: restore },
      ]);
    },
    true,
  );

  // --- send --------------------------------------------------------------------------

  /** If the message contains PII, stop the send and ask the user what to do. */
  function checkSend(event: Event, composer: HTMLElement | null, resend: () => void): void {
    if (!enabled() || !composer || Date.now() < bypassUntil) return;
    const text = getText(composer);
    const detections = kavach.scan(text);
    if (detections.length === 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const counts = countByType(detections);
    record(counts);

    showWarning(t("banner_send_title", [summarize(counts, t)]), t("banner_body"), [
      {
        label: t("btn_mask"),
        primary: true,
        run: () => {
          // Replace and let the user review; never send on their behalf after masking.
          replaceAll(composer, withNote(mask(getText(composer)), t("masked_note")));
          showNotice(t("notice_masked"));
        },
      },
      {
        label: t("btn_send_anyway"),
        run: () => {
          bypassUntil = Date.now() + 1500;
          resend();
        },
      },
      { label: t("btn_cancel"), run: () => composer.focus() },
    ]);
  }

  listen(
    "keydown",
    (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      const composer = composerFrom(event.target);
      if (!composer) return;
      lastComposer = composer;
      checkSend(event, composer, () => {
        const button = findSendButton();
        if (button) {
          button.click();
        } else {
          composer.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }),
          );
        }
      });
    },
    true,
  );

  listen(
    "click",
    (event) => {
      const button = (event.target as Element | null)?.closest?.("button");
      if (!button || !isSendButton(button)) return;
      checkSend(event, findComposer(site) ?? lastComposer, () => button.click());
    },
    true,
  );

  listen(
    "focusin",
    (event) => {
      const composer = composerFrom(event.target);
      if (composer) lastComposer = composer;
    },
    true,
  );
}
