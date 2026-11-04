/** Swap known placeholders in a piece of text back to their original values.
 *
 * Pure function: the content script applies it to the chat page, and the tests
 * call it directly. `lookup` returns the original value for a placeholder, or
 * undefined for one this tab never created (left as it is). */

import { PLACEHOLDER } from "../core/session.ts";

export interface Restored {
  readonly text: string;
  /** [start, end) of each restored value in `text`, in UTF-16 offsets. */
  readonly spans: readonly (readonly [number, number])[];
}

export function restorePlaceholders(text: string, lookup: (placeholder: string) => string | undefined): Restored {
  const pattern = new RegExp(PLACEHOLDER.source, PLACEHOLDER.flags);
  const spans: [number, number][] = [];
  let out = "";
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const value = lookup(m[0]);
    if (value === undefined) continue;
    out += text.slice(last, m.index);
    spans.push([out.length, out.length + value.length]);
    out += value;
    last = m.index + m[0].length;
  }
  if (spans.length === 0) return { text, spans };
  return { text: out + text.slice(last), spans };
}
