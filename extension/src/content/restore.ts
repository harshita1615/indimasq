/**
 * Shows the original values in place of placeholders in the chat, for this tab
 * only. The AI still only ever received the placeholders.
 *
 * Text is changed in place (a text node's value), never by adding or moving
 * elements, so the chatbot's own page code keeps working while replies stream
 * in. Restored values are tinted with the CSS Custom Highlight API, which also
 * leaves the page's elements alone. The message box is never touched: putting
 * real values back there would send them on the next message. Nor are the
 * user's own sent messages: they keep showing exactly what the AI received. Kavach's own
 * banner sits in a closed shadow root, which this observer never sees.
 */

import { restorePlaceholders } from "../shared/restore.ts";

const HIGHLIGHT = "kavach-restored";
const SKIP = "textarea, input, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only'], script, style, noscript";

export interface Restorer {
  /** Restore everything on the page now, e.g. right after masking. */
  scan(): void;
  stop(): void;
}

export function startRestoring(
  lookup: (placeholder: string) => string | undefined,
  isActive: () => boolean,
  /** Extra elements to leave alone, such as the user's own sent messages. */
  skip: readonly string[] = [],
): Restorer {
  const skipSelector = [SKIP, ...skip].join(", ");
  const highlight = typeof Highlight === "function" ? new Highlight() : null;
  if (highlight && CSS.highlights) {
    CSS.highlights.set(HIGHLIGHT, highlight);
    const style = document.createElement("style");
    style.textContent = `::highlight(${HIGHLIGHT}) { background-color: rgba(245, 158, 11, 0.3); }`;
    (document.head ?? document.documentElement).append(style);
  }
  const ranges = new WeakMap<Text, Range[]>();
  const restoredValues = new Set<string>();

  function restoreNode(node: Text): void {
    const parent = node.parentElement;
    if (!parent || parent.closest(skipSelector)) return;
    const { text, spans } = restorePlaceholders(node.data, lookup);
    if (spans.length > 0) {
      for (const [start, end] of spans) restoredValues.add(text.slice(start, end));
      node.data = text;
    } else if (!ranges.has(node)) {
      return;
    }
    // The page rewrites a text node whole while a reply streams in, which
    // collapses any earlier highlight in it, so rebuild this node's highlights
    // from every value restored so far.
    if (highlight) highlightValues(node);
  }

  function highlightValues(node: Text): void {
    for (const old of ranges.get(node) ?? []) highlight!.delete(old);
    const added: Range[] = [];
    for (const value of restoredValues) {
      for (let at = node.data.indexOf(value); at !== -1; at = node.data.indexOf(value, at + value.length)) {
        const range = new Range();
        range.setStart(node, at);
        range.setEnd(node, at + value.length);
        highlight!.add(range);
        added.push(range);
      }
    }
    if (added.length > 0) ranges.set(node, added);
    else ranges.delete(node);
  }

  function restoreTree(root: Node): void {
    if (root.nodeType === Node.TEXT_NODE) {
      restoreNode(root as Text);
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) restoreNode(n as Text);
  }

  const observer = new MutationObserver((mutations) => {
    if (!isActive()) return;
    for (const m of mutations) {
      if (m.type === "characterData") restoreTree(m.target);
      else m.addedNodes.forEach(restoreTree);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  return {
    scan: () => {
      if (isActive() && document.body) restoreTree(document.body);
    },
    stop: () => {
      observer.disconnect();
      highlight?.clear();
    },
  };
}
