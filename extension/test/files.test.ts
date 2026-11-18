/** Attached files: ZIP, Word documents, PDFs. Fixtures hold made-up values only. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Kavach } from "../src/core/index.ts";
import { docxText, redactDocx, redactXml } from "../src/files/docx.ts";
import { readZip, writeZip } from "../src/files/zip.ts";
import { coversFor, imagesToPdf, pageText, SIDE_MARGIN } from "../src/files/pdf.ts";
import { type PdfJs, readPdf } from "../src/files/pdf-read.ts";
import { labelledFields } from "../src/files/labelled.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const VALUES = ["ABCPE1234F", "rahul@okaxis", "2345 6789 0124", "98765 43210", "30012345678", "SBIN0001234", "rahul@example.com", "priya@example.com"];

test("ZIP: what is written reads back the same", async () => {
  const entries = [
    { name: "a.txt", data: new TextEncoder().encode("hello ".repeat(100)) },
    { name: "dir/ü.xml", data: new TextEncoder().encode("<x>नमस्ते</x>") },
    { name: "empty", data: new Uint8Array(0) },
  ];
  const back = await readZip(await writeZip(entries));
  assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name));
  for (let i = 0; i < entries.length; i++) assert.deepEqual(back[i]!.data, entries[i]!.data);
});

test("Word: reads the text of a real .docx, including tables and footers", async () => {
  const text = await docxText(fixture("sample.docx"));
  // "ABCPE" is bold and "1234F" is not: two runs, read as one word.
  assert.match(text, /PAN: ABCPE1234F/);
  assert.match(text, /a\/c 30012345678, IFSC SBIN0001234/);
  assert.match(text, /priya@example\.com/); // footer
});

test("Word: the safe copy has placeholders instead of every value, and reads back", async () => {
  const session = new Kavach().session();
  const safe = await redactDocx(fixture("sample.docx"), session);
  const text = await docxText(safe);
  for (const value of VALUES) assert.ok(!text.includes(value), `${value} is still in the copy`);
  assert.match(text, /PAN: \[PAN_1\], refund to UPI \[UPI_1\]\./);
  assert.match(text, /\[AADHAAR_1\]/);
  assert.match(text, /\[EMAIL_2\]/); // the footer's address, numbered after the body's
  // Not one of the raw values survives anywhere in the file's XML either.
  const xml = (await readZip(safe)).map((e) => new TextDecoder().decode(e.data)).join("");
  for (const value of ["ABCPE", "1234F", "rahul@okaxis", "30012345678"]) assert.ok(!xml.includes(value), value);
  // The chat's session knows the placeholders, so they can be revealed on hover.
  assert.equal(session.unmask("[PAN_1]"), "ABCPE1234F");
});

test("Word: a value split over runs is replaced in the first run, the rest emptied", () => {
  const xml =
    '<w:p><w:r><w:t xml:space="preserve">PAN: </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ABCPE</w:t></w:r>' +
    "<w:r><w:t>1234F now</w:t></w:r></w:p>";
  const out = redactXml(xml, new Kavach().session());
  assert.equal(
    out,
    '<w:p><w:r><w:t xml:space="preserve">PAN: </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>[PAN_1]</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve"> now</w:t></w:r></w:p>',
  );
});

test("Word: special characters are kept escaped, other XML untouched", () => {
  const xml = "<w:p><w:r><w:t>R&amp;D: PAN ABCPE1234F &lt;ok&gt;</w:t></w:r></w:p><w:tbl/>";
  assert.equal(redactXml(xml, new Kavach().session()), "<w:p><w:r><w:t>R&amp;D: PAN [PAN_1] &lt;ok&gt;</w:t></w:r></w:p><w:tbl/>");
});

test("Word: a document without personal data comes back unchanged in text", async () => {
  const xml = "<w:p><w:r><w:t>Order no. 4029381123 delivered</w:t></w:r></w:p>";
  assert.equal(redactXml(xml, new Kavach().session()), xml);
});

// --- PDF ------------------------------------------------------------------------------------

const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJs;
const NODE_OPTIONS = { standardFontDataUrl: new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), verbosity: 0 };

test("PDF: reads the text of a real PDF (Word export) with each piece's position", async () => {
  const read = await readPdf(pdfjs, fixture("sample.pdf"), NODE_OPTIONS);
  assert.ok(read.ok);
  const text = read.pages.map((p) => pageText(p.items).text).join("\n");
  for (const value of ["ABCPE1234F", "rahul@okaxis", "2345 6789 0124", "SBIN0001234", "rahul@example.com", "priya@example.com"]) {
    assert.ok(text.includes(value), `${value} not read`);
  }
  for (const item of read.pages[0]!.items) assert.ok(item.w >= 0 && item.h > 0 && item.x >= 0 && item.y >= 0);
});

test("PDF: every detected value gets a cover on its page, labelled with its placeholder", async () => {
  const read = await readPdf(pdfjs, fixture("sample.pdf"), NODE_OPTIONS);
  assert.ok(read.ok);
  const session = new Kavach().session();
  const page = read.pages[0]!;
  const text = pageText(page.items);
  const spans = session.maskSpans(text.text).replacements;
  const covers = coversFor(page.items, text, spans);
  const labels = covers.map((c) => c.label).filter(Boolean);
  assert.ok(labels.includes("[PAN_1]") && labels.includes("[AADHAAR_1]") && labels.includes("[UPI_1]"), labels.join(" "));
  assert.equal(labels.length, spans.length, "one labelled cover per value");
  // The PAN's cover sits where the PAN is: after "PAN: " on the same line.
  const panItem = page.items.find((i) => i.str.includes("PAN"))!;
  const pan = covers.find((c) => c.label === "[PAN_1]")!;
  assert.ok(Math.abs(pan.y - panItem.y) < panItem.h && pan.x > panItem.x && pan.w > 0);
});

test("PDF: a locked PDF is reported as locked, a scanned one as having no text", async () => {
  assert.deepEqual(await readPdf(pdfjs, fixture("locked.pdf"), NODE_OPTIONS), { ok: false, reason: "locked" });
  const scanned = await readPdf(pdfjs, fixture("scanned.pdf"), NODE_OPTIONS);
  assert.ok(scanned.ok && scanned.pages.length === 1 && scanned.pages[0]!.items.length === 0);
  assert.deepEqual(await readPdf(pdfjs, new TextEncoder().encode("not a pdf"), NODE_OPTIONS), { ok: false, reason: "damaged" });
});

test("PDF: pieces on one line are joined with spaces where there is a gap, lines with newlines", () => {
  const items = [
    { str: "PAN:", x: 10, y: 10, w: 40, h: 12 },
    { str: "ABCPE", x: 55, y: 10, w: 50, h: 12 },
    { str: "1234F", x: 105, y: 10, w: 50, h: 12 }, // touching: same word
    { str: "Next line", x: 10, y: 30, w: 80, h: 12 },
  ];
  const text = pageText(items);
  assert.equal(text.text, "PAN: ABCPE1234F\nNext line");
  // One box for the value split over two pieces, widened by the margin on both sides.
  const covers = coversFor(items, text, [{ start: 5, end: 15, placeholder: "[PAN_1]" }]);
  const m = 12 * SIDE_MARGIN;
  assert.equal(covers.length, 1);
  assert.equal(covers[0]!.label, "[PAN_1]");
  assert.ok(Math.abs(covers[0]!.x - (55 - m)) < 1e-9 && Math.abs(covers[0]!.w - (100 + 2 * m)) < 1e-9);
});

test("PDF: the copy Kavach writes is a valid PDF of pictures, with no text at all", async () => {
  const jpeg = Uint8Array.from(atob(TINY_JPEG), (c) => c.charCodeAt(0));
  const pdf = imagesToPdf([
    { jpeg, pixelWidth: 4, pixelHeight: 4, width: 595.28, height: 841.89 },
    { jpeg, pixelWidth: 4, pixelHeight: 4, width: 841.89, height: 595.28 },
  ]);
  const read = await readPdf(pdfjs, pdf, NODE_OPTIONS);
  assert.ok(read.ok);
  assert.equal(read.pages.length, 2);
  assert.ok(read.pages.every((p) => p.items.length === 0));
  assert.ok(!new TextDecoder("latin1").decode(pdf).includes("/Author"), "no metadata");
});

const TINY_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAEAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==";

// --- labelled fields (files only) ----------------------------------------------------------

/** Rows as the onboarding-form PDF's text reads: dummy values that fail the strict checks. */
const FORM = [
  "Aadhaar number 0000 1111 2222 12 digits with spaces; dummy",
  "PAN QWERT1234Z PAN-shaped dummy string; not assigned",
  "Mobile +91 00000 00000 / 0000000000 Repeated in two formats",
  "I, Aarav Mehta, confirm that the mobile number +91 00000 00000 and email aarav@example.com may be used.",
  "UPI ID aarav.mehta@upi-demo",
  "GSTIN: 00AAAAA0000A0Z0",
].join("\n");

test("labelled fields: dummy values next to their label are found, with their type", () => {
  const found = labelledFields(FORM).map((d) => [d.entityType, FORM.slice(d.start, d.end)]);
  assert.deepEqual(found, [
    ["AADHAAR", "0000 1111 2222"],
    ["PAN", "QWERT1234Z"],
    ["PHONE", "+91 00000 00000"],
    ["PHONE", "0000000000"],
    ["PHONE", "+91 00000 00000"],
    ["UPI", "aarav.mehta@upi-demo"],
    ["GSTIN", "00AAAAA0000A0Z0"],
  ]);
});

test("labelled fields: the safe copy masks them all, alongside the strict detections", () => {
  const session = new Kavach().session();
  const { replacements } = session.maskSpans(FORM, labelledFields(FORM));
  let out = "";
  let last = 0;
  for (const r of replacements) {
    out += FORM.slice(last, r.start) + r.placeholder;
    last = r.end;
  }
  out += FORM.slice(last);
  for (const value of ["0000 1111 2222", "QWERT1234Z", "00000 00000", "0000000000", "aarav.mehta@upi-demo", "aarav@example.com", "00AAAAA0000A0Z0"]) {
    assert.ok(!out.includes(value), `${value} still visible:\n${out}`);
  }
  // The same number, in either format, gets the same placeholder all three times.
  assert.equal(out.match(/\[PHONE_1\]/g)?.length, 3);
  assert.match(out, /\[EMAIL_1\]/);
});

test("labelled fields: look-alikes without a label, or with no value, are left alone", () => {
  for (const text of [
    "Order no. 4029381123 delivered",
    "Invoice 0000 1111 2222 paid",
    "PAN-shaped dummy string; not assigned",
    "Mobile number: N/A",
    "Company PANORAMA1234X", // "pan" inside a word
    "Expanded 12345 67890 rows",
    "email support@example.com",
  ]) {
    assert.deepEqual(labelledFields(text), [], text);
  }
});

test("labelled fields: Hindi and Hinglish labels", () => {
  const text = "मेरा आधार नंबर 0000 1111 2222 है, mera mobile 00000 00000";
  assert.deepEqual(labelledFields(text).map((d) => d.entityType), ["AADHAAR", "PHONE"]);
});

test("labelled fields: bank details the strict rules miss", () => {
  const cases: [string, string, string][] = [
    ["Bank account: 98765432", "BANK_ACCOUNT", "98765432"], // 8 digits: too short for the strict rule
    ["Please transfer only to account ending 6789.", "BANK_ACCOUNT", "6789"],
    ["A/c ending in 4321", "BANK_ACCOUNT", "4321"],
    ["IFSC: SBIN 0001234", "IFSC", "SBIN 0001234"], // written with a space
    ["IFSC Code - ABCD1234567", "IFSC", "ABCD1234567"], // not a valid IFSC (5th character must be 0)
    ["खाता संख्या 1234567", "BANK_ACCOUNT", "1234567"],
  ];
  for (const [text, type, value] of cases) {
    assert.deepEqual(labelledFields(text).map((d) => [d.entityType, text.slice(d.start, d.end)]), [[type, value]], text);
  }
});

test("labelled fields: bank-like look-alikes are left alone", () => {
  for (const text of [
    "Account holder Aarav Mehta",
    "Account opened on 12 10 2026", // a date, not 6+ digits in a row with a label
    "Accounts team: 2 members",
    "IFSC requested separately",
    "Account type: Savings",
    "Accounting year 2026-27",
  ]) {
    assert.deepEqual(labelledFields(text), [], text);
  }
});
