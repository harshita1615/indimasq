/**
 * Background service worker: only opens the offscreen page that reads PDFs,
 * and passes requests from the chat tab to it. Content scripts cannot open
 * that page themselves. Nothing is stored or sent anywhere.
 */

import type { OffscreenRequest } from "../shared/messages.ts";

const OFFSCREEN = "offscreen.html";
let opening: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const open = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN)],
  });
  if (open.length > 0) return;
  opening ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Reads PDF files on this device to check them for personal data.",
    })
    .finally(() => {
      opening = null;
    });
  await opening;
}

chrome.runtime.onMessage.addListener((message: OffscreenRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.tab || message?.target) return;
  if (message?.type !== "indimasq-pdf-read" && message?.type !== "indimasq-pdf-render") return;
  (async () => {
    try {
      await ensureOffscreen();
      const request: OffscreenRequest = { ...message, target: "indimasq-offscreen" };
      return (await chrome.runtime.sendMessage(request)) ?? { ok: false, reason: "damaged" };
    } catch {
      return { ok: false, reason: "damaged" };
    }
  })().then(sendResponse);
  return true; // reply asynchronously
});
