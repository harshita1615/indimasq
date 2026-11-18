/** Reversible masking, mirroring indimasq/masking/.
 *
 * The placeholder <-> value mapping lives only in this object's memory. It is
 * never logged, stored or sent anywhere. */

import type { Engine } from "./engine.ts";
import { WS } from "./regex.ts";
import { RULES } from "./rules.ts";
import type { Detection, EntityType } from "./types.ts";

export type Mode = "mask" | "redact" | "scan";
export const MODES: readonly Mode[] = ["mask", "redact", "scan"];

const TYPES = [...RULES.entityTypes].sort((a, b) => b.length - a.length).join("|");

/** Tolerates small LLM edits: case changes and stray spaces, e.g. "[ pan_1 ]". */
export const PLACEHOLDER = new RegExp(`\\[${WS}*(${TYPES})${WS}*_${WS}*([0-9]+)${WS}*\\]`, "giu");

export function makePlaceholder(entityType: EntityType, n: number): string {
  return `[${entityType}_${n}]`;
}

/** Canonical lookup key for a matched placeholder, whatever its spacing or case. */
function placeholderKey(typeName: string, number: string): string {
  return `[${typeName.toUpperCase()}_${BigInt(number).toString()}]`;
}

export function assertMode(mode: string): asserts mode is Mode {
  if (!(MODES as readonly string[]).includes(mode)) {
    throw new RangeError(`mode must be one of ${MODES.join(", ")}; got ${JSON.stringify(mode)}`);
  }
}

export class MaskingSession {
  readonly mode: Mode;
  readonly #engine: Engine;
  readonly #valueToPlaceholder = new Map<string, string>();
  readonly #placeholderToValue = new Map<string, string>();
  readonly #nextNumber = new Map<EntityType, number>();
  readonly #counts = new Map<EntityType, number>();

  constructor(engine: Engine, mode: Mode = "mask") {
    assertMode(mode);
    this.#engine = engine;
    this.mode = mode;
  }

  /** Detections per entity type so far. Safe to log: no values. */
  get counts(): Record<string, number> {
    return Object.fromEntries(this.#counts);
  }

  mask(text: string): string {
    const { replacements } = this.maskSpans(text);
    let out = "";
    let last = 0;
    for (const r of replacements) {
      out += text.slice(last, r.start) + r.placeholder;
      last = r.end;
    }
    return out + text.slice(last);
  }

  /** Like mask(), but returns where each placeholder goes ([start, end) in
   * `text`, UTF-16 offsets) instead of the masked text. For documents whose
   * text is spread over several pieces, such as the runs of a Word paragraph.
   *
   * `extra` adds detections found by other means (labelled fields in attached
   * files); any that overlap the engine's own detections are dropped. */
  maskSpans(
    text: string,
    extra: readonly Detection[] = [],
  ): { replacements: { start: number; end: number; placeholder: string }[] } {
    const found = this.#engine.analyze(text);
    const added = extra.filter(
      (x) => this.#engine.entities.has(x.entityType) && !found.some((d) => x.start < d.end && d.start < x.end),
    );
    const detections = [...found, ...added].sort((a, b) => a.start - b.start);
    for (const d of detections) {
      this.#counts.set(d.entityType, (this.#counts.get(d.entityType) ?? 0) + 1);
    }
    if (this.mode === "scan" || detections.length === 0) return { replacements: [] };

    // Placeholder-like strings already in the input are never reused.
    const taken = new Set([...text.matchAll(PLACEHOLDER)].map((m) => placeholderKey(m[1]!, m[2]!)));
    const replacements = detections.map((d) => ({ start: d.start, end: d.end, placeholder: this.#placeholderFor(d, text, taken) }));

    if (this.mode === "redact") this.#forgetMapping();
    return { replacements };
  }

  /** Replace known placeholders with their original values. Unknown
   * placeholders are left unchanged. */
  unmask(text: string): string {
    if (this.#placeholderToValue.size === 0) return text;
    return text.replace(PLACEHOLDER, (whole, type: string, number: string) => {
      return this.#placeholderToValue.get(placeholderKey(type, number)) ?? whole;
    });
  }

  /** Placeholders created so far with their original values, oldest first.
   * For showing the user their own data (the extension popup); never log it. */
  entries(): [placeholder: string, value: string][] {
    return [...this.#placeholderToValue];
  }

  /** Forget all mappings and counts. */
  clear(): void {
    this.#forgetMapping();
    this.#counts.clear();
  }

  #placeholderFor(d: Detection, text: string, taken: Set<string>): string {
    const key = `${d.entityType}\u0000${this.#engine.normalize(d, text)}`;
    const existing = this.#valueToPlaceholder.get(key);
    if (existing !== undefined) return existing;
    let placeholder: string;
    do {
      const n = (this.#nextNumber.get(d.entityType) ?? 0) + 1;
      this.#nextNumber.set(d.entityType, n);
      placeholder = makePlaceholder(d.entityType, n);
    } while (taken.has(placeholder));
    this.#valueToPlaceholder.set(key, placeholder);
    this.#placeholderToValue.set(placeholder, text.slice(d.start, d.end));
    return placeholder;
  }

  #forgetMapping(): void {
    this.#valueToPlaceholder.clear();
    this.#placeholderToValue.clear();
    this.#nextNumber.clear();
  }

  toString(): string {
    return `<MaskingSession mode=${this.mode} counts=${JSON.stringify(this.counts)}>`;
  }
}
