/** Turn detections into a human summary ("1 Aadhaar number and 2 PANs").
 * Only types and counts: never the detected values. */

import type { Detection, EntityType } from "../core/index.ts";
import { ENTITY_TYPES } from "../core/index.ts";
import { t } from "./i18n.ts";

export type Translate = (key: string, substitutions?: string[]) => string;

export function countByType(detections: readonly Detection[]): Map<EntityType, number> {
  const counts = new Map<EntityType, number>();
  for (const d of detections) counts.set(d.entityType, (counts.get(d.entityType) ?? 0) + 1);
  // Stable display order, independent of where items appear in the text.
  return new Map(ENTITY_TYPES.filter((t) => counts.has(t)).map((t) => [t, counts.get(t)!]));
}

/** "PAN", "Aadhaar number": the display name of an entity type, capitalised. */
export function entityName(type: EntityType, count = 1): string {
  const name = t(`entity_${type}_${count === 1 ? "one" : "other"}`);
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

/** The entity name for a placeholder such as [PAN_1] or [ pan_1 ]. */
export function entityLabel(placeholder: string): string {
  const type = /\[\s*([A-Za-z_]+?)\s*_\s*[0-9]+\s*\]/.exec(placeholder)?.[1]?.toUpperCase();
  return type && (ENTITY_TYPES as readonly string[]).includes(type) ? entityName(type as EntityType) : placeholder;
}

/** What one tab has hidden, as the popup shows it. Sent only to this extension's popup. */
export interface TabFinds {
  text: { placeholder: string; label: string; value: string }[];
}

export function summarize(counts: ReadonlyMap<EntityType, number>, t: Translate): string {
  const parts = [...counts].map(
    ([type, n]) => `${n} ${t(`entity_${type}_${n === 1 ? "one" : "other"}`)}`,
  );
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} ${t("list_and")} ${parts.at(-1)}`;
}
