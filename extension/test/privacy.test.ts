/** No part of the extension may log, transmit or run remote code. The
 * detection core may not even touch browser storage or extension APIs. */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const SRC = new URL("../src/", import.meta.url);

const EVERYWHERE = [
  "console.",
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
  "eval(",
  "new Function",
  "import(",
  "chrome.runtime.sendMessage",
  "chrome.tabs",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "document.cookie",
];
const CORE_ONLY = ["chrome."];
// PDF checks pass the file to the extension's own offscreen page, so these two
// files may message within the extension; only in the one-argument form, which
// cannot address another extension.
const INTERNAL_MESSAGING = new Set(["content/attachments.ts", "background/background.ts"]);
const OWN_MESSAGE = /chrome\.runtime\.sendMessage\(request\)/g;
// The popup asks the active tab what it has hidden, to show the user; the tab
// answers only this extension (see content/index.ts).
const POPUP_TAB_QUERY = /chrome\.tabs\.(?:query|sendMessage)\(/g;
// A URL inside a string literal could be fetched or loaded; URLs in comments are fine.
const URL_STRING = /["'`]\s*(?:https?:)?\/\//;

function files(dir: URL, prefix = ""): { path: string; url: URL }[] {
  return readdirSync(dir).flatMap((name) => {
    const url = new URL(name, dir);
    return statSync(url).isDirectory()
      ? files(new URL(`${name}/`, dir), `${prefix}${name}/`)
      : [{ path: `${prefix}${name}`, url }];
  });
}

for (const file of files(SRC).filter((f) => /\.(ts|html)$/.test(f.path))) {
  test(`${file.path}: no logging, network, remote code or extra storage`, () => {
    let source = readFileSync(file.url, "utf-8");
    if (INTERNAL_MESSAGING.has(file.path)) source = source.replace(OWN_MESSAGE, "");
    if (file.path === "popup/popup.ts") source = source.replace(POPUP_TAB_QUERY, "");
    const forbidden = file.path.startsWith("core/") ? [...EVERYWHERE, ...CORE_ONLY] : EVERYWHERE;
    for (const token of forbidden) {
      assert.ok(!source.includes(token), `${file.path} contains ${token}`);
    }
    assert.doesNotMatch(source, URL_STRING, `${file.path} contains a URL string`);
  });
}
