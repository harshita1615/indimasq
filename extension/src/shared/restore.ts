/** Find this tab's placeholders in a piece of text.
 *
 * Pure function: the content script uses it to mark placeholders in the chat
 * (hover to see the original), and the tests call it directly. `lookup`
 * returns the original value for a placeholder, or undefined for one this tab
 * never created (ignored). */

import { PLACEHOLDER } from "../core/session.ts";

export interface FoundPlaceholder {
  /** [start, end) of the placeholder in the text, in UTF-16 offsets. */
  readonly start: number;
  readonly end: number;
  readonly placeholder: string;
  readonly value: string;
}

export function findPlaceholders(text: string, lookup: (placeholder: string) => string | undefined): FoundPlaceholder[] {
  const pattern = new RegExp(PLACEHOLDER.source, PLACEHOLDER.flags);
  const found: FoundPlaceholder[] = [];
  for (const m of text.matchAll(pattern)) {
    const value = lookup(m[0]);
    if (value !== undefined) found.push({ start: m.index, end: m.index + m[0].length, placeholder: m[0], value });
  }
  return found;
}
