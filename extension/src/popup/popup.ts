/** Toolbar popup: per-site switches and counts of items caught. */

import { ENTITY_TYPES } from "../core/types.ts";
import { t } from "../shared/i18n.ts";
import { load, onChange, save, type Settings } from "../shared/settings.ts";
import { SITES } from "../shared/sites.ts";
import type { TabFinds } from "../shared/summary.ts";

document.documentElement.lang = chrome.i18n.getUILanguage();
for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
  el.textContent = t(el.dataset.i18n!);
}

const sitesList = document.getElementById("sites")!;
const caughtList = document.getElementById("caught")!;
const none = document.getElementById("none")!;
const reset = document.getElementById("reset")!;
const restore = document.getElementById("restore") as HTMLInputElement;
const files = document.getElementById("files") as HTMLInputElement;

files.addEventListener("change", async () => {
  const latest = await load();
  latest.files = files.checked;
  await save(latest);
});

restore.addEventListener("change", async () => {
  const latest = await load();
  latest.restore = restore.checked;
  await save(latest);
});

function render(settings: Settings): void {
  restore.checked = settings.restore;
  files.checked = settings.files;
  sitesList.replaceChildren(
    ...SITES.map((site) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = site.name;
      name.id = `site-${site.id}`;

      const label = document.createElement("label");
      label.className = "switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = settings.enabled[site.id];
      input.setAttribute("aria-labelledby", name.id);
      input.addEventListener("change", async () => {
        const latest = await load();
        latest.enabled[site.id] = input.checked;
        await save(latest);
      });
      label.append(input, document.createElement("span"));
      li.append(name, label);
      return li;
    }),
  );

  const caught = ENTITY_TYPES.filter((type) => (settings.caught[type] ?? 0) > 0);
  caughtList.replaceChildren(
    ...caught.map((type) => {
      const n = settings.caught[type]!;
      const li = document.createElement("li");
      const name = document.createElement("span");
      // Entity names are lowercase for use mid-sentence in the banner; in this
      // list each starts a line, so capitalise the first letter.
      const label = t(`entity_${type}_${n === 1 ? "one" : "other"}`);
      name.textContent = label.charAt(0).toLocaleUpperCase() + label.slice(1);
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = n.toLocaleString();
      li.append(name, count);
      return li;
    }),
  );
  none.hidden = caught.length > 0;
  reset.hidden = caught.length === 0;
}

reset.addEventListener("click", async () => {
  const settings = await load();
  settings.caught = {};
  await save(settings);
});

/** What the current chat tab has hidden. Asked from that tab's own memory;
 * nothing is stored. Empty on any other page. */
async function showChat(): Promise<void> {
  let finds: TabFinds | undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) finds = await chrome.tabs.sendMessage(tab.id, { type: "indimasq-list" });
  } catch {
    return; // not a chatbot tab, or IndiMasq has not loaded there
  }
  if (!finds || finds.text.length === 0) return;
  const rows = finds.text.map((f) => row(f.label, f.value, f.placeholder));
  document.getElementById("chat-list")!.replaceChildren(...rows);
  document.getElementById("chat")!.hidden = false;
}

function row(label: string, value: string, title?: string): HTMLLIElement {
  const li = document.createElement("li");
  const name = document.createElement("span");
  name.className = "label";
  name.textContent = label;
  if (title) name.title = title;
  const v = document.createElement("span");
  v.className = "value";
  v.textContent = value;
  li.append(name, v);
  return li;
}

showChat();
load().then(render);
onChange(render);
