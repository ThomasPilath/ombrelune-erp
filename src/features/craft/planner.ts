import { craftArticle, getCraftRecipes, ingredientStock, type RecipeRow } from "../../data/repositories/craft";
import { showToast } from "../../ui/components/toast";
import { escapeHtml } from "../../ui/html";

export interface CraftSelection { productId: string; craftCount: number }

interface CraftPlannerOptions {
  initial?: CraftSelection[];
  maxItems?: number;
  allowAdd?: boolean;
  onCrafted?: (productId: string, produced: number) => void | Promise<void>;
  onComplete?: () => void;
}

const idOf = (value: string | number): string => String(value);

export class CraftPlanner {
  private recipes: RecipeRow[] = [];
  private selections: CraftSelection[];
  private completed = new Set<string>();
  private busy = new Set<string>();

  constructor(private root: HTMLElement, private options: CraftPlannerOptions = {}) {
    this.selections = options.initial?.map(selection => ({ ...selection })) ?? [];
  }

  async mount(): Promise<void> {
    this.recipes = await getCraftRecipes();
    if (!this.selections.length && this.products().length) {
      this.selections.push({ productId: this.products()[0]![0], craftCount: 1 });
    }
    this.render();
  }

  selectProduct(productId: string, craftCount = 1): boolean {
    if (!this.products().some(([id]) => id === productId)) return false;
    const existing = this.selections.find(selection => selection.productId === productId);
    if (existing) existing.craftCount = Math.max(1, Math.trunc(craftCount));
    else {
      const maxItems = this.options.maxItems ?? 3;
      if (this.selections.length >= maxItems) {
        showToast(`Retirez une fabrication avant d’en ajouter une nouvelle (maximum ${maxItems}).`, "error");
        return false;
      }
      this.selections.push({ productId, craftCount: Math.max(1, Math.trunc(craftCount)) });
    }
    this.completed.delete(productId);
    this.render();
    return true;
  }

  private products(): Array<[string, string]> {
    const products = new Map<string, string>();
    this.recipes.forEach(recipe => products.set(idOf(recipe.produit.id), recipe.produit.article));
    return [...products].sort((a, b) => a[1].localeCompare(b[1], "fr"));
  }

  private productRecipes(productId: string): RecipeRow[] {
    return this.recipes.filter(recipe => idOf(recipe.produit_id) === productId);
  }

  private cumulativeNeeds(): Map<string, number> {
    const totals = new Map<string, number>();
    this.selections.filter(selection => !this.completed.has(selection.productId)).forEach(selection => this.productRecipes(selection.productId).forEach(recipe => {
      const ingredientId = idOf(recipe.ingredient_id);
      totals.set(ingredientId, (totals.get(ingredientId) ?? 0) + recipe.quantite_requise * selection.craftCount);
    }));
    return totals;
  }

  private canCraft(selection: CraftSelection): boolean {
    const recipes = this.productRecipes(selection.productId);
    return recipes.length > 0 && recipes.every(recipe => ingredientStock(recipe) >= recipe.quantite_requise * selection.craftCount);
  }

  private render(): void {
    const products = this.products();
    const totals = this.cumulativeNeeds();
    const maxItems = this.options.maxItems ?? 3;
    const mayAdd = this.options.allowAdd !== false && this.selections.length < maxItems && this.selections.length < products.length;
    this.root.innerHTML = `<div class="space-y-4">
      ${this.selections.length ? this.selections.map((selection, index) => this.selectionHtml(selection, index, products, totals)).join("") : '<p class="rounded-xl bg-surface-muted p-5 text-center text-muted">Aucune fabrication nécessaire.</p>'}
      ${this.options.allowAdd === false ? "" : `<button type="button" data-add-craft ${mayAdd ? "" : "disabled"} class="grid min-h-11 w-full place-items-center rounded-xl border border-dashed font-bold disabled:opacity-40" aria-label="Ajouter une fabrication">+ Ajouter un objet à fabriquer${mayAdd ? "" : " (maximum 3)"}</button>`}
    </div>`;
    this.bind();
  }

  private selectionHtml(selection: CraftSelection, index: number, products: Array<[string, string]>, totals: Map<string, number>): string {
    const recipes = this.productRecipes(selection.productId);
    const done = this.completed.has(selection.productId);
    const isBusy = this.busy.has(selection.productId);
    const individuallyPossible = this.canCraft(selection);
    const options = products.map(([id, name]) => `<option value="${escapeHtml(id)}" ${id === selection.productId ? "selected" : ""} ${id !== selection.productId && this.selections.some((item, itemIndex) => itemIndex !== index && item.productId === id) ? "disabled" : ""}>${escapeHtml(name)}</option>`).join("");
    const ingredients = recipes.length ? recipes.map(recipe => {
      const needed = recipe.quantite_requise * selection.craftCount;
      const stock = ingredientStock(recipe);
      const total = totals.get(idOf(recipe.ingredient_id)) ?? needed;
      const cumulativeShortage = total > stock;
      return `<li class="flex items-baseline justify-between gap-4 py-2 ${cumulativeShortage ? "text-amber-600 dark:text-amber-400" : ""}"><span>${escapeHtml(recipe.ingredient.article)}${cumulativeShortage ? '<small class="mt-1 block font-bold">Ressource indisponible</small>' : ""}</span><span class="shrink-0"><strong class="text-base">${needed}</strong><span class="text-sm font-normal"> /${stock}</span></span></li>`;
    }).join("") : '<li class="py-3 text-sm text-amber-600 dark:text-amber-400">Aucune recette disponible pour cet objet.</li>';
    const hasCumulativeShortage = recipes.some(recipe => (totals.get(idOf(recipe.ingredient_id)) ?? 0) > ingredientStock(recipe));
    return `<section class="rounded-2xl border ${done ? "bg-surface-muted" : "bg-surface"}" data-craft-line="${index}">
      <div class="flex flex-wrap items-end gap-3 p-4">
        <label class="min-w-[12rem] flex-1 text-sm font-bold">Objet<select data-product ${done ? "disabled" : ""} class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3">${options}</select></label>
        <label class="w-28 text-sm font-bold">Crafts<input data-count ${done ? "disabled" : ""} type="number" min="1" value="${selection.craftCount}" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"></label>
        <button type="button" data-crafted ${done || isBusy || !individuallyPossible ? "disabled" : ""} class="min-h-11 rounded-xl bg-brand px-4 font-bold text-white disabled:opacity-40">${done ? "Fabriqué ✓" : isBusy ? "Fabrication…" : "Fabriqué"}</button>
        ${this.options.allowAdd === false ? "" : '<button type="button" data-remove class="grid size-11 place-items-center rounded-xl border" aria-label="Retirer cette fabrication">×</button>'}
      </div>
      ${done ? "" : `<div class="border-t px-4 py-2"><p class="pt-2 text-sm font-bold">Composants nécessaires</p><ul class="divide-y">${ingredients}</ul>${hasCumulativeShortage ? '<p class="pb-2 text-sm text-amber-600 dark:text-amber-400">Le stock actuel ne permet pas de fabriquer toute la sélection.</p>' : ""}</div>`}
    </section>`;
  }

  private bind(): void {
    this.root.querySelector<HTMLButtonElement>("[data-add-craft]")?.addEventListener("click", () => {
      const firstAvailable = this.products().find(([id]) => !this.selections.some(selection => selection.productId === id));
      this.selections.push({ productId: firstAvailable?.[0] ?? this.products()[0]![0], craftCount: 1 });
      this.render();
    });
    this.root.querySelectorAll<HTMLElement>("[data-craft-line]").forEach(line => {
      const index = Number(line.dataset.craftLine);
      line.querySelector<HTMLSelectElement>("[data-product]")?.addEventListener("change", event => {
        this.selections[index]!.productId = (event.currentTarget as HTMLSelectElement).value;
        this.render();
      });
      line.querySelector<HTMLInputElement>("[data-count]")?.addEventListener("change", event => {
        const value = Number((event.currentTarget as HTMLInputElement).value);
        this.selections[index]!.craftCount = Math.max(1, Number.isFinite(value) ? Math.trunc(value) : 1);
        this.render();
      });
      line.querySelector<HTMLButtonElement>("[data-remove]")?.addEventListener("click", () => { this.completed.delete(this.selections[index]!.productId); this.selections.splice(index, 1); this.render(); });
      line.querySelector<HTMLButtonElement>("[data-crafted]")?.addEventListener("click", () => void this.craft(index));
    });
  }

  private async craft(index: number): Promise<void> {
    const selection = this.selections[index];
    if (!selection || !this.canCraft(selection)) return;
    if (!await this.confirmCraft(selection)) return;
    this.busy.add(selection.productId); this.render();
    try {
      const produced = await craftArticle(selection.productId, selection.craftCount);
      this.completed.add(selection.productId);
      showToast(`${produced} unité(s) produite(s).`, "success");
      await this.options.onCrafted?.(selection.productId, produced);
      this.recipes = await getCraftRecipes();
      this.render();
      if (this.selections.every(item => this.completed.has(item.productId))) this.options.onComplete?.();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Fabrication impossible", "error");
    } finally {
      this.busy.delete(selection.productId); this.render();
    }
  }

  private confirmCraft(selection: CraftSelection): Promise<boolean> {
    const recipes = this.productRecipes(selection.productId);
    const productName = recipes[0]?.produit.article ?? "cet objet";
    const produced = (recipes[0]?.quantite_produite ?? 0) * selection.craftCount;
    const ingredients = recipes.map(recipe => `<li class="flex justify-between gap-4 py-2"><span>${escapeHtml(recipe.ingredient.article)}</span><strong>${recipe.quantite_requise * selection.craftCount}</strong></li>`).join("");
    const dialog = document.createElement("dialog");
    dialog.className = "m-auto w-[min(34rem,calc(100%-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-slate-950/70";
    dialog.innerHTML = `<div class="border-b p-5"><h2 class="text-xl font-bold">Confirmer la fabrication</h2><p class="mt-1 text-sm text-muted">Cette action modifiera immédiatement les stocks.</p></div><div class="p-5"><p><strong>${escapeHtml(productName)}</strong> — ${selection.craftCount} craft(s), ${produced} unité(s)</p><ul class="mt-4 divide-y rounded-xl border px-4">${ingredients}</ul></div><div class="flex justify-end gap-3 border-t p-4"><button type="button" data-cancel class="min-h-11 rounded-xl border px-4 font-bold">Annuler</button><button type="button" data-confirm class="min-h-11 rounded-xl bg-brand px-4 font-bold text-white">Confirmer la fabrication</button></div>`;
    document.body.append(dialog);
    dialog.showModal();
    return new Promise(resolve => {
      const finish = (confirmed: boolean): void => { dialog.close(); dialog.remove(); resolve(confirmed); };
      dialog.querySelector("[data-cancel]")!.addEventListener("click", () => finish(false));
      dialog.querySelector("[data-confirm]")!.addEventListener("click", () => finish(true));
      dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); }, { once: true });
    });
  }
}
