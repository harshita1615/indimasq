import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { Kavach } from "../src/core/index.ts";
import { looksLikeSendButton, SITES, siteForHost } from "../src/shared/sites.ts";
import { hasNote, withNote } from "../src/shared/note.ts";
import { findPlaceholders } from "../src/shared/restore.ts";
import { merge } from "../src/shared/settings.ts";
import { countByType, entityLabel, summarize } from "../src/shared/summary.ts";

const root = new URL("../", import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf-8"));

// --- manifest: least privilege -----------------------------------------------------

const manifest = json("manifest.json");

test("manifest asks only for storage, an offscreen page for PDFs and the three chatbot sites", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage", "offscreen"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_permissions, undefined);
  assert.deepEqual(manifest.background, { service_worker: "background.js" });
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.content_security_policy, undefined, "keep the strict MV3 default CSP");
  const matches = [...new Set(manifest.content_scripts.flatMap((c: { matches: string[] }) => c.matches))];
  assert.deepEqual(matches.sort(), [
    "https://chatgpt.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
  ]);
});

test("manifest version matches package.json", () => {
  assert.equal(manifest.version, json("package.json").version);
});

test("every site in sites.ts has a content-script match, and vice versa", () => {
  const matches = manifest.content_scripts[0].matches as string[];
  const hosts = matches.map((m) => new URL(m.replace("/*", "/")).hostname).sort();
  assert.deepEqual(SITES.flatMap((s) => s.hosts).sort(), hosts);
});

// --- locales ------------------------------------------------------------------------

const locales = readdirSync(new URL("_locales/", root));
const messages = Object.fromEntries(
  locales.map((l) => [l, json(`_locales/${l}/messages.json`) as Record<string, { message: string }>]),
);

test("English and Hindi have the same message keys", () => {
  assert.deepEqual(locales.sort(), ["en", "hi"]);
  assert.deepEqual(Object.keys(messages.hi!).sort(), Object.keys(messages.en!).sort());
});

test("store limits: name <= 75 and description <= 132 characters", () => {
  for (const [locale, m] of Object.entries(messages)) {
    assert.ok([...m.ext_name!.message].length <= 75, `${locale} name too long`);
    const description = m.ext_description!.message;
    assert.ok([...description].length <= 132, `${locale} description is ${[...description].length} chars`);
  }
});

test("every entity type has singular and plural names in every locale", () => {
  for (const m of Object.values(messages)) {
    for (const type of ["AADHAAR", "PAN", "UPI", "IFSC", "BANK_ACCOUNT", "PHONE", "GSTIN", "EMAIL"]) {
      assert.ok(m[`entity_${type}_one`] && m[`entity_${type}_other`], type);
    }
  }
});

// --- sites ---------------------------------------------------------------------------

test("siteForHost", () => {
  assert.equal(siteForHost("chatgpt.com")?.id, "chatgpt");
  assert.equal(siteForHost("CLAUDE.AI")?.id, "claude");
  assert.equal(siteForHost("gemini.google.com")?.id, "gemini");
  assert.equal(siteForHost("evilchatgpt.com"), undefined);
  assert.equal(siteForHost("google.com"), undefined);
});

test("generic send-button labels", () => {
  for (const label of ["Send message", "send-button", "Send prompt", "भेजें"]) {
    assert.ok(looksLikeSendButton(label), label);
  }
  for (const label of ["Sender settings", "Resend code", "Stop", ""]) {
    assert.ok(!looksLikeSendButton(label), label);
  }
});

// --- summary --------------------------------------------------------------------------

const en = (key: string) => messages.en![key]!.message;
const hi = (key: string) => messages.hi![key]!.message;

test("summary lists types in a fixed order with plurals, never values", () => {
  const text = "UPI rahul@okaxis, PAN ABCPE1234F, PAN AAAPZ9876K, mobile 9876543210";
  const counts = countByType(new Kavach().scan(text));
  const summary = summarize(counts, en);
  assert.equal(summary, "2 PANs, 1 UPI ID and 1 phone number");
  assert.equal(summarize(counts, hi), "2 पैन, 1 यूपीआई आईडी और 1 फ़ोन नंबर");
  for (const value of ["rahul@okaxis", "ABCPE1234F", "9876543210"]) {
    assert.ok(!summary.includes(value));
  }
});

test("summary of one type", () => {
  const counts = countByType(new Kavach().scan("PAN ABCPE1234F"));
  assert.equal(summarize(counts, en), "1 PAN");
});

// --- note to the AI ------------------------------------------------------------------------

for (const locale of ["en", "hi"]) {
  const note = (locale === "en" ? en : hi)("masked_note");

  test(`${locale} note: no detectable PII and no real-looking placeholder`, () => {
    assert.deepEqual(new Kavach().scan(note), []);
    assert.doesNotMatch(note, /\[[A-Za-z_]+_[0-9]+\]/);
    assert.ok([...note].length <= 90, `${locale} note is ${[...note].length} chars; keep it one line`);
  });

  test(`${locale} note: added once, and does not shift placeholder numbering`, () => {
    const session = new Kavach().session();
    const once = withNote(session.mask("PAN ABCPE1234F"), note);
    assert.equal(once, `PAN [PAN_1]\n${note}`);
    assert.equal(withNote(once, note), once);
    assert.ok(hasNote(once.replace(/\s+/g, " "), note.replace(/\s+/g, " ")));
    // Masking again with the note present keeps the existing numbering.
    assert.equal(session.mask(`${once}\nPAN AAAPZ9876K`), `${once}\nPAN [PAN_2]`);
  });
}

// --- settings ---------------------------------------------------------------------------

test("settings merge fills defaults and ignores junk", () => {
  assert.deepEqual(merge(undefined).enabled, { chatgpt: true, claude: true, gemini: true });
  const s = merge({ enabled: { claude: false }, caught: { PAN: 3 } });
  assert.deepEqual(s.enabled, { chatgpt: true, claude: false, gemini: true });
  assert.deepEqual(s.caught, { PAN: 3 });
  assert.deepEqual(merge("nonsense").caught, {});
});

test("settings: showing real values in replies is on by default and can be turned off", () => {
  assert.equal(merge(undefined).restore, true);
  assert.equal(merge({ restore: false }).restore, false);
  assert.equal(merge({ restore: "yes" }).restore, true);
});

// --- revealing placeholders ---------------------------------------------------------

function sessionLookup() {
  const session = new Kavach().session();
  const masked = session.mask("My PAN is ABCPE1234F, refund to rahul@okaxis");
  const lookup = (p: string) => {
    const v = session.unmask(p);
    return v === p ? undefined : v;
  };
  return { session, masked, lookup };
}

test("finds this tab's placeholders and their values, in place", () => {
  const { masked, lookup } = sessionLookup();
  assert.equal(masked, "My PAN is [PAN_1], refund to [UPI_1]");
  const reply = "Refund for [PAN_1] will go to [UPI_1].";
  const found = findPlaceholders(reply, lookup);
  assert.deepEqual(
    found.map((f) => [reply.slice(f.start, f.end), f.value]),
    [["[PAN_1]", "ABCPE1234F"], ["[UPI_1]", "rahul@okaxis"]],
  );
});

test("tolerates small edits by the AI and ignores unknown placeholders", () => {
  const { lookup } = sessionLookup();
  const found = findPlaceholders("[pan_1], [ UPI_1 ] and [PHONE_9]", lookup);
  assert.deepEqual(found.map((f) => f.value), ["ABCPE1234F", "rahul@okaxis"]);
});

test("a fresh session marks nothing", () => {
  const session = new Kavach().session();
  const lookup = (p: string) => (session.unmask(p) === p ? undefined : session.unmask(p));
  assert.deepEqual(findPlaceholders("[PAN_1] and plain [brackets]", lookup), []);
});

test("the session lists its placeholders for the popup, oldest first", () => {
  const { session } = sessionLookup();
  assert.deepEqual(session.entries(), [["[PAN_1]", "ABCPE1234F"], ["[UPI_1]", "rahul@okaxis"]]);
  assert.deepEqual(new Kavach({ mode: "redact" }).session().entries(), []);
});

test("entity labels for placeholders", () => {
  // Outside the extension chrome.i18n is missing, so the label falls back to the message key.
  assert.equal(entityLabel("[pan_1]"), "Entity_PAN_one");
  assert.equal(entityLabel("[BANK_ACCOUNT_12]"), "Entity_BANK_ACCOUNT_one");
  assert.equal(entityLabel("[NOPE_1]"), "[NOPE_1]");
});
