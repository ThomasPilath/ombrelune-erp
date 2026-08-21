import { asyncState, bindRetry } from "./async-state";
import { labelTableControls } from "./responsive-table";
import { escapeHtml } from "../html";

export interface TabDefinition {
  id: string;
  label: string;
}

export function mountTabs(outlet: HTMLElement, items: TabDefinition[], render: (id: string, content: HTMLElement) => Promise<void>): void {
  outlet.innerHTML = `<div class="mb-6 flex gap-2 overflow-x-auto border-b" role="tablist" aria-label="Sections de la page">${items.map((item, index) => `<button id="direction-tab-${item.id}" type="button" role="tab" data-tab="${item.id}" aria-controls="direction-tab-panel" aria-selected="${index === 0}" tabindex="${index ? -1 : 0}" class="min-h-11 shrink-0 border-b-2 px-4 font-bold ${index ? "border-transparent text-muted" : "border-accent text-accent"}">${escapeHtml(item.label)}</button>`).join("")}</div><div id="direction-tab-panel" role="tabpanel" tabindex="0" aria-labelledby="direction-tab-${items[0]!.id}"></div>`;
  const content = outlet.querySelector<HTMLElement>("#direction-tab-panel")!;
  const controls = [...outlet.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  let selectionId = 0;

  const select = async (id: string): Promise<void> => {
    const currentSelection = ++selectionId;
    controls.forEach(control => {
      const active = control.dataset.tab === id;
      control.setAttribute("aria-selected", String(active));
      control.tabIndex = active ? 0 : -1;
      control.classList.toggle("border-accent", active);
      control.classList.toggle("text-accent", active);
      control.classList.toggle("border-transparent", !active);
      control.classList.toggle("text-muted", !active);
    });
    content.setAttribute("aria-labelledby", `direction-tab-${id}`);
    content.innerHTML = asyncState("loading");
    const staging = document.createElement("div");
    try {
      await render(id, staging);
      if (currentSelection !== selectionId) return;
      content.replaceChildren(...staging.childNodes);
      labelTableControls(content);
    } catch (error) {
      if (currentSelection !== selectionId) return;
      content.innerHTML = asyncState("error", error instanceof Error ? error.message : undefined, "Réessayer");
      bindRetry(content, () => void select(id));
    }
  };

  controls.forEach(control => control.addEventListener("click", () => void select(control.dataset.tab!)));
  controls.forEach((control, index) => control.addEventListener("keydown", event => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % controls.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + controls.length) % controls.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = controls.length - 1;
    else return;
    event.preventDefault();
    controls[next]!.focus();
    void select(controls[next]!.dataset.tab!);
  }));
  void select(items[0]!.id);
}
