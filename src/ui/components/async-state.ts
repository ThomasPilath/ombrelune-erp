import { icon } from "../icons";
import { escapeHtml } from "../html";

type StateKind = "loading" | "empty" | "error";

const stateContent: Record<StateKind, { title: string; description: string; iconName: string }> = {
  loading: { title: "Chargement en cours", description: "Les données sont en train d’être récupérées.", iconName: "pulse" },
  empty: { title: "Aucune donnée", description: "Aucun élément ne correspond à cette vue pour le moment.", iconName: "boxes" },
  error: { title: "Impossible de charger les données", description: "Une erreur est survenue. Réessayez dans quelques instants.", iconName: "close" }
};

export function asyncState(kind: StateKind, detail?: string, retryLabel?: string): string {
  const state = stateContent[kind];
  return `<div class="grid min-h-56 place-items-center p-8 text-center" role="${kind === "error" ? "alert" : "status"}" aria-live="polite">
    <div><span class="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-surface-muted text-brand">${icon(state.iconName, "size-6")}</span>
    <h3 class="font-bold">${state.title}</h3><p class="mt-1 max-w-md text-sm text-muted">${escapeHtml(detail ?? state.description)}</p>${kind === "error" && retryLabel ? `<button type="button" data-retry class="mt-4 min-h-11 rounded-xl border border-brand px-4 font-bold text-brand">${escapeHtml(retryLabel)}</button>` : ""}</div>
  </div>`;
}

export function bindRetry(root: ParentNode, retry: () => void): void {
  root.querySelector<HTMLButtonElement>("[data-retry]")?.addEventListener("click", retry);
}
