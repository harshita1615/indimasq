/**
 * Placeholders in the chat, such as [PAN_1] in the AI's reply, are underlined;
 * pointing at one shows the original value in a small IndiMasq tooltip.
 *
 * The chat page itself is never changed: the text keeps its placeholders, so
 * the real values never enter the page, where the site's scripts could read
 * them. The underline uses the CSS Custom Highlight API and the tooltip lives
 * in a closed shadow root, so neither adds anything the page can see. Only
 * placeholders this tab created are marked; the message box is skipped.
 */

import { findPlaceholders } from "../shared/restore.ts";

const HIGHLIGHT = "indimasq-placeholder";
const SKIP =
  "textarea, input, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only'], script, style, noscript";

export interface Revealer {
  /** Mark everything on the page now, e.g. right after masking. */
  scan(): void;
  stop(): void;
}

interface Mark {
  readonly range: Range;
  readonly label: string;
  readonly value: string;
}

export function startRevealing(
  lookup: (placeholder: string) => string | undefined,
  label: (placeholder: string) => string,
  isActive: () => boolean,
): Revealer {
  const highlight = typeof Highlight === "function" ? new Highlight() : null;
  if (highlight && CSS.highlights) {
    CSS.highlights.set(HIGHLIGHT, highlight);
    const style = document.createElement("style");
    style.textContent = `::highlight(${HIGHLIGHT}) { background-color: rgba(245, 158, 11, 0.25); text-decoration: underline dotted rgb(217, 119, 6); }`;
    (document.head ?? document.documentElement).append(style);
  }
  const marks = new WeakMap<Text, Mark[]>();
  const tip = tooltip();

  function markNode(node: Text): void {
    for (const old of marks.get(node) ?? []) highlight?.delete(old.range);
    marks.delete(node);
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    const found = findPlaceholders(node.data, lookup);
    if (found.length === 0) return;
    marks.set(
      node,
      found.map((f) => {
        const range = new Range();
        range.setStart(node, f.start);
        range.setEnd(node, f.end);
        highlight?.add(range);
        return { range, label: label(f.placeholder), value: f.value };
      }),
    );
  }

  function markTree(root: Node): void {
    if (root.nodeType === Node.TEXT_NODE) return markNode(root as Text);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) markNode(n as Text);
  }

  const observer = new MutationObserver((mutations) => {
    if (!isActive()) return;
    for (const m of mutations) {
      if (m.type === "characterData") markTree(m.target);
      else m.addedNodes.forEach(markTree);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // Which mark, if any, is under the pointer.
  let frame = 0;
  let shown: Mark | null = null;
  const onMove = (event: MouseEvent) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const mark = isActive() ? markAt(event.clientX, event.clientY) : null;
      if (mark === shown) return;
      shown = mark;
      if (mark) tip.show(mark.label, mark.value, mark.range.getBoundingClientRect());
      else tip.hide();
    });
  };
  const onScroll = () => {
    shown = null;
    tip.hide();
  };
  document.addEventListener("mousemove", onMove, { passive: true });
  document.addEventListener("scroll", onScroll, { passive: true, capture: true });

  function markAt(x: number, y: number): Mark | null {
    const node =
      document.caretPositionFromPoint?.(x, y)?.offsetNode ?? document.caretRangeFromPoint?.(x, y)?.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    for (const mark of marks.get(node as Text) ?? []) {
      // The caret is the nearest position, so also check the pointer is on the text.
      for (const r of mark.range.getClientRects()) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return mark;
      }
    }
    return null;
  }

  return {
    scan: () => {
      if (isActive() && document.body) markTree(document.body);
    },
    stop: () => {
      observer.disconnect();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("scroll", onScroll, { capture: true });
      highlight?.clear();
      tip.hide();
    },
  };
}

/** A tooltip in a closed shadow root: the page cannot read what it shows. */
function tooltip(): { show(label: string, value: string, at: DOMRect): void; hide(): void } {
  let host: HTMLElement | null = null;
  let box: HTMLElement;
  let name: HTMLElement;
  let text: HTMLElement;

  function build(): void {
    host = document.createElement("indimasq-tooltip");
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .tip { position: fixed; z-index: 2147483647; pointer-events: none; max-width: 320px;
             padding: 6px 10px; border-radius: 8px; background: #1c2128; color: #f0f6fc;
             box-shadow: 0 6px 20px rgb(0 0 0 / 0.25);
             font: 13px/1.4 system-ui, -apple-system, "Segoe UI", "Noto Sans Devanagari", sans-serif; }
      .name { color: #f5b14c; font-weight: 600; margin-right: 6px; }
      .value { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; user-select: none; }`;
    box = document.createElement("div");
    box.className = "tip";
    box.setAttribute("role", "tooltip");
    name = document.createElement("span");
    name.className = "name";
    text = document.createElement("span");
    text.className = "value";
    box.append(name, text);
    root.append(style, box);
  }

  return {
    show(label, value, at) {
      if (!host) build();
      name.textContent = label;
      text.textContent = value;
      document.documentElement.append(host!);
      const below = at.top < 48;
      box.style.left = `${Math.max(8, Math.min(at.left, innerWidth - 328))}px`;
      box.style.top = below ? `${at.bottom + 6}px` : "";
      box.style.bottom = below ? "" : `${innerHeight - at.top + 6}px`;
    },
    hide() {
      host?.remove();
    },
  };
}
