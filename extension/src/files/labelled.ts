/**
 * Labelled fields in attached files: a value written right after its label
 * ("Aadhaar number: 0000 1111 2222", "PAN - QWERT1234Z", "UPI ID ...") is
 * personal data even when it fails the strict checks (Aadhaar checksum, PAN
 * holder type, mobile prefix, known UPI handle). Forms, statements and KYC
 * documents always label their fields, so in files the label is evidence
 * enough. Used for attached files only; chat messages and the Python package
 * keep the strict rules, and the published accuracy figures are unchanged.
 *
 * Only the value's shape is required: 12 digits, 5 letters + 4 digits + 1
 * letter, 10 digits, something@something, 6-18 account digits (or the last
 * few after "ending"), 11 IFSC characters, 15 GSTIN characters. Values that
 * repeat after the first ("+91 00000 00000 / 0000000000") are included.
 */

import { type Detection, type EntityType, makeDetection } from "../core/types.ts";

interface Field {
  readonly type: EntityType;
  readonly label: string;
  readonly value: string;
  /** Extra check on the matched value, e.g. how many digits it has. */
  readonly accept?: (value: string) => boolean;
}

const digits = (value: string) => value.replace(/[^0-9]/g, "").length;

/** Words that may sit between a label and its value. */
const FILLER = String.raw`(?:\s*(?:number|num|no\.?|#|id|card|code|details?|nos?\.?|sankhya|नंबर|संख्या))*`;
/** Separators between label and value: colon, dash, equals, a table gap. */
const GAP = String.raw`[\s:：\-–—=|]*`;
const NOT_WORD_BEFORE = String.raw`(?<![\p{L}\p{N}_])`;
const NOT_WORD_AFTER = String.raw`(?![\p{L}\p{N}_])`;

const FIELDS: readonly Field[] = [
  {
    type: "AADHAAR",
    label: String.raw`aadhaa?r|adhaa?r|uidai|uid|आधार`,
    value: String.raw`[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])`,
  },
  {
    type: "PAN",
    label: String.raw`pan|permanent\s+account\s+number|पैन`,
    value: String.raw`[A-Za-z]{5}[ -]?[0-9]{4}[ -]?[A-Za-z](?![A-Za-z0-9])`,
  },
  {
    type: "PHONE",
    label: String.raw`mobile|mob|phone|ph|contact|tel|telephone|whatsapp|cell|मोबाइल|फ़ोन|फोन`,
    value: String.raw`(?:\+?91[ -]?|0)?[0-9]{5}[ -]?[0-9]{5}(?![0-9])`,
  },
  {
    type: "UPI",
    label: String.raw`upi|vpa`,
    value: String.raw`[A-Za-z0-9._-]{2,}@[A-Za-z0-9._-]{2,}`,
  },
  {
    // Account numbers too short for the strict rule (it needs 9-18 digits),
    // grouped with spaces or dashes, in Hindi or Hinglish.
    type: "BANK_ACCOUNT",
    label: String.raw`(?:bank\s+|savings\s+|current\s+|beneficiary\s+|re-?enter\s+)?(?:a/c|acc(?:oun)?t|acct|account)|khata|खाता`,
    value: String.raw`[0-9]{2,18}(?:[ -][0-9]{2,6}){0,4}(?![0-9])`,
    accept: (v) => digits(v) >= 6 && digits(v) <= 18,
  },
  {
    // The last digits of an account: "account ending 6789", "a/c ending in 6789".
    type: "BANK_ACCOUNT",
    label: String.raw`(?:a/c|acc(?:oun)?t|acct|account)\s+(?:ending|ends)(?:\s+(?:in|with))?`,
    value: String.raw`[0-9]{3,6}(?![0-9])`,
  },
  {
    // IFSC written with a space, or not quite valid (dummy or mistyped).
    type: "IFSC",
    label: String.raw`ifsc|ifs`,
    value: String.raw`[A-Za-z]{4}[ -]?[A-Za-z0-9]{7}(?![A-Za-z0-9])`,
  },
  {
    type: "GSTIN",
    label: String.raw`gstin|gst`,
    value: String.raw`[0-9]{2}[A-Za-z0-9]{13}(?![A-Za-z0-9])`,
  },
];

/** Values that come right after one already found: "x / y", "x, y", "x or y". */
const MORE = String.raw`\s*(?:/|,|or|या)\s*`;

export function labelledFields(text: string): Detection[] {
  const found: Detection[] = [];
  for (const field of FIELDS) {
    const first = new RegExp(
      `${NOT_WORD_BEFORE}(?:${field.label})${NOT_WORD_AFTER}${FILLER}${GAP}(${field.value})`,
      "giu",
    );
    const next = new RegExp(`^${MORE}(${field.value})`, "iu");
    for (const m of text.matchAll(first)) {
      if (field.accept && !field.accept(m[1]!)) continue;
      let end = m.index + m[0].length;
      let start = end - m[1]!.length;
      found.push(makeDetection(field.type, start, end, 0.6, "labelled"));
      // Further values of the same shape listed after it.
      for (let more = next.exec(text.slice(end)); more && (!field.accept || field.accept(more[1]!)); more = next.exec(text.slice(end))) {
        start = end + more[0].length - more[1]!.length;
        end += more[0].length;
        found.push(makeDetection(field.type, start, end, 0.6, "labelled"));
      }
    }
  }
  // One value, one field: where two labels claim overlapping text, keep the first.
  const kept: Detection[] = [];
  for (const d of found.sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (!kept.some((k) => d.start < k.end && k.start < d.end)) kept.push(d);
  }
  return kept;
}

/** The engine's detections plus labelled fields that do not overlap them. */
export function withLabelled(found: readonly Detection[], labelled: readonly Detection[]): Detection[] {
  const extra = labelled.filter((x) => !found.some((d) => x.start < d.end && d.start < x.end));
  return [...found, ...extra].sort((a, b) => a.start - b.start);
}
