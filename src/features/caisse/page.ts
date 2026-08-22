import type { CatalogueRow, ClientRow } from "../../data/schemas";
import { checkout, checkoutEmployee, getClientPermit, getEmployeeCosts, getPreparedOrders, getSellableCatalogue, getTicketCount, orderToBasketStorageKey, searchClients, type BasketLine, type PermitWithdrawal, type PreparedOrder } from "../../data/repositories/pos";
import { asyncState, bindRetry } from "../../ui/components/async-state";
import { showToast } from "../../ui/components/toast";
import { escapeHtml } from "../../ui/html";
import { getCraftRecipes, ingredientStock, type RecipeRow } from "../../data/repositories/craft";
import { CraftPlanner, type CraftSelection } from "../craft/planner";
import { compassDecisionLabel, confirmCompassSupplement, isCompass, isCompassSupplement } from "../compass/supplement-dialog";
import { confirmGuildCard, isContractBook } from "../guild-card/verification-dialog";
import { keepFocusInside, lockDocumentScroll } from "../../ui/focus";
import { withPending } from "../../ui/components/pending";
import { icon } from "../../ui/icons";
import { buttonClasses, fieldClasses, iconButtonClasses } from "../../ui/components/primitives";

const money = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const field = fieldClasses();
const primaryButton = buttonClasses();
const secondaryIconButton = iconButtonClasses("secondary");
const articlePacks = [
  {
    id: "newcomer",
    label: "Pack nouveau",
    items: [
      { article: "Baguette", quantity: 1 },
      { article: "Bloc-notes", quantity: 1 },
      { article: "Lettres", quantity: 10 }
    ]
  }
] as const;
const stockOf = (article: CatalogueRow): number => {
  const stock = Array.isArray(article.stocks) ? article.stocks[0] : article.stocks;
  return stock?.quantite ?? 0;
};

function clientDialog(id: string, title: string, extra = ""): string {
  return `<dialog id="${id}" class="m-auto w-[min(36rem,calc(100%-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-backdrop">
    <div class="border-b p-5"><div class="flex justify-between gap-4"><div><h2 class="text-xl font-bold">${title}</h2><p class="mt-1 text-sm text-muted">Recherchez puis sélectionnez la personne.</p></div><button type="button" data-close class="${secondaryIconButton}" aria-label="Fermer">×</button></div></div>
    <div class="space-y-4 p-5">${extra}<div class="grid gap-3 sm:grid-cols-2"><label class="text-sm font-bold">Nom et prénom<input data-client-name class="mt-2 ${field}" autocomplete="off"></label><label class="text-sm font-bold">Hibou<input data-client-owl inputmode="numeric" class="mt-2 ${field}" autocomplete="off"></label></div><div data-results class="max-h-52 overflow-y-auto rounded-xl border" hidden></div><div data-client-status class="rounded-xl bg-surface-muted p-4 text-sm text-muted">Sélectionnez un client.</div></div>
    <div class="flex justify-end border-t p-4"><button type="button" data-confirm disabled class="${primaryButton}">Confirmer</button></div></dialog>`;
}

class CashRegister {
  private catalogue: CatalogueRow[] = [];
  private preparedOrders: PreparedOrder[] = [];
  private employeeCosts = new Map<string, number>();
  private isEmployeePurchase = false;
  private craftableQuantities = new Map<string, number>();
  private basket = new Map<string, number>();
  private orderGroups = new Map<string, PreparedOrder>();
  private packGroups = new Map<string, { label: string; articleIds: string[] }>();
  private basketOpen = false;
  private query = "";
  private ticketClient: ClientRow | null = null;
  private ticketAuthorized = false;
  private permitWithdrawals: PermitWithdrawal[] = [];
  private compassWithSupplement: boolean | null = null;
  private destroyed = false;
  private submitting = false;
  constructor(private outlet: HTMLElement) {}

  async mount(): Promise<void> {
    this.outlet.innerHTML = asyncState("loading");
    try {
      const [catalogue, recipes, preparedOrders] = await Promise.all([getSellableCatalogue(), getCraftRecipes(), getPreparedOrders()]);
      this.catalogue = catalogue;
      this.preparedOrders = preparedOrders;
      this.employeeCosts = await getEmployeeCosts(catalogue.map(article => article.id));
      this.updateCraftability(recipes);
      if (!this.destroyed) {
        this.render();
        const pendingOrderId = sessionStorage.getItem(orderToBasketStorageKey);
        if (pendingOrderId) {
          sessionStorage.removeItem(orderToBasketStorageKey);
          await this.addPreparedOrder(pendingOrderId);
          this.setBasketOpen(true);
        }
      }
    }
    catch (error) { this.outlet.innerHTML = asyncState("error", error instanceof Error ? error.message : undefined, "Réessayer"); bindRetry(this.outlet, () => void this.mount()); }
  }
  destroy(): void { this.destroyed = true; document.removeEventListener("keydown", this.handleKeydown); lockDocumentScroll(false); }
  private article(id: string): CatalogueRow | undefined { return this.catalogue.find(row => String(row.id) === id); }
  private groupedQuantity(articleId: string): number {
    return [...this.orderGroups.values()].reduce(
      (sum, order) => sum + order.lines.reduce(
        (orderSum, line) => orderSum + (String(line.article_id) === articleId ? line.quantite : 0),
        0,
      ),
      0,
    );
  }
  private checkoutQuantities(): Map<string, number> {
    const quantities = new Map(this.basket);
    this.orderGroups.forEach(order => order.lines.forEach(line => {
      const id = String(line.article_id);
      quantities.set(id, (quantities.get(id) ?? 0) + line.quantite);
    }));
    return quantities;
  }
  private ticketQuantity(): number { return [...this.checkoutQuantities()].reduce((n, [id, q]) => n + (this.article(id)?.type_article === "ticket" ? q : 0), 0); }
  private permitLines(): CatalogueRow[] { return [...this.checkoutQuantities().keys()].map(id => this.article(id)).filter((row): row is CatalogueRow => row?.type_article === "document_permis"); }
  private unitPrice(article: CatalogueRow): number { return this.isEmployeePurchase ? (this.employeeCosts.get(String(article.id)) ?? 0) : (article.prix_vente ?? 0); }
  private total(): number { return [...this.checkoutQuantities()].reduce((sum, [id, q]) => sum + (this.article(id) ? this.unitPrice(this.article(id)!) : 0) * q, 0); }
  private basketQuantity(): number { return [...this.checkoutQuantities().values()].reduce((sum, quantity) => sum + quantity, 0); }
  private canCheckout(): boolean { return this.basket.size > 0 || this.orderGroups.size > 0; }
  private assignedPermits(articleId: string): number { return this.permitWithdrawals.filter(item => String(item.article_id) === articleId).length; }
  private updateCraftability(recipes: RecipeRow[]): void {
    this.craftableQuantities.clear();
    const byProduct = new Map<string, RecipeRow[]>();
    recipes.forEach(recipe => {
      const productId = String(recipe.produit_id);
      byProduct.set(productId, [...(byProduct.get(productId) ?? []), recipe]);
    });
    byProduct.forEach((lines, productId) => {
      const possibleCrafts = Math.min(...lines.map(line => Math.floor(ingredientStock(line) / line.quantite_requise)));
      this.craftableQuantities.set(productId, possibleCrafts * lines[0]!.quantite_produite);
    });
  }
  private shortages(): Array<[CatalogueRow, number]> { return [...this.checkoutQuantities()].map(([id, quantity]) => [this.article(id)!, Math.max(0, quantity - stockOf(this.article(id)!))] as [CatalogueRow, number]).filter(([article, shortage]) => !isCompassSupplement(article.article) && shortage > 0); }
  private maximumQuantity(row: CatalogueRow): number {
    if (row.type_article === "ticket") return Math.min(2, stockOf(row));
    if (row.type_article === "document_permis") return Math.min(1, stockOf(row) + (this.craftableQuantities.get(String(row.id)) ?? 0));
    return stockOf(row) + (this.craftableQuantities.get(String(row.id)) ?? 0);
  }
  private remainingCraftableQuantity(row: CatalogueRow): number {
    const reservedForCraft = Math.max(0, (this.checkoutQuantities().get(String(row.id)) ?? 0) - stockOf(row));
    return Math.max(0, (this.craftableQuantities.get(String(row.id)) ?? 0) - reservedForCraft);
  }

  private renderArticleList(): void {
    const list = this.outlet.querySelector<HTMLElement>("#article-list");
    if (!list) return;
    const articles = this.catalogue.filter(row => !isCompassSupplement(row.article) && row.article.toLocaleLowerCase("fr").includes(this.query.toLocaleLowerCase("fr")));
    list.innerHTML = articles.length ? articles.map(row => this.articleRow(row)).join("") : '<p class="p-8 text-center text-muted">Aucun article trouvé.</p>';
    list.setAttribute("aria-label", `${articles.length} article${articles.length > 1 ? "s" : ""} trouvé${articles.length > 1 ? "s" : ""}`);
    this.bindArticleButtons(list);
  }

  private render(): void {
    const articles = this.catalogue.filter(row => !isCompassSupplement(row.article) && row.article.toLocaleLowerCase("fr").includes(this.query.toLocaleLowerCase("fr")));
    this.outlet.innerHTML = `<section class="grid h-[calc(100dvh-7.5rem)] min-h-0 overflow-hidden rounded-2xl border bg-surface shadow-[var(--shadow-panel)] lg:h-[calc(100dvh-9rem)] lg:min-h-[38rem] lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]">
      <div id="catalogue-panel" class="flex min-h-0 min-w-0 flex-col lg:border-r"><div class="grid shrink-0 gap-3 border-b p-4 sm:grid-cols-[minmax(0,1fr)_14rem]"><input id="article-search" type="search" value="${escapeHtml(this.query)}" placeholder="Rechercher un article…" aria-label="Rechercher un article" aria-controls="article-list" class="min-h-12 w-full rounded-xl border bg-surface px-4"><label><span class="sr-only">Ajout rapide au panier</span><select id="quick-add-select" class="min-h-12 w-full rounded-xl border bg-surface px-4 font-bold"><option value="">Ajout rapide…</option><optgroup label="Packs">${articlePacks.map(pack => `<option value="pack:${escapeHtml(pack.id)}">${escapeHtml(pack.label)}</option>`).join("")}</optgroup>${this.preparedOrders.length ? `<optgroup label="Commandes préparées">${this.preparedOrders.map(order => `<option value="order:${escapeHtml(order.id)}">${escapeHtml(order.clientName)}</option>`).join("")}</optgroup>` : ""}</select></label></div><div id="article-list" class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24 lg:pb-0" aria-live="polite">${articles.length ? articles.map(row => this.articleRow(row)).join("") : '<p class="p-8 text-center text-muted">Aucun article trouvé.</p>'}</div></div>
      <button id="basket-backdrop" type="button" class="fixed inset-0 z-30 bg-backdrop lg:hidden" aria-label="Fermer le panier"></button>
      <div id="basket-panel" role="dialog" aria-modal="true" aria-labelledby="basket-title" class="fixed inset-x-0 bottom-0 z-40 flex max-h-[78dvh] min-h-0 min-w-0 flex-col rounded-t-2xl border bg-surface shadow-2xl transition-transform duration-200 motion-reduce:transition-none lg:visible lg:pointer-events-auto lg:static lg:z-auto lg:max-h-none lg:min-h-[32rem] lg:translate-y-0 lg:rounded-none lg:border-0 lg:shadow-none"><div class="relative flex shrink-0 flex-wrap items-start justify-between gap-4 border-b p-4 pr-16 lg:pr-4"><div><h2 id="basket-title" class="text-xl font-bold">Panier</h2><p id="basket-summary" class="text-sm text-muted"></p></div><label class="flex min-h-11 items-center gap-3 rounded-xl border px-3 font-bold has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"><input id="employee-purchase" type="checkbox" ${this.isEmployeePurchase ? "checked" : ""} ${this.permitLines().length || this.orderGroups.size ? "disabled" : ""} class="size-5 accent-[var(--color-brand)]"><span>Achat employé</span></label><button id="close-basket" type="button" class="absolute right-4 top-4 grid size-11 place-items-center rounded-xl border lg:hidden" aria-label="Fermer le panier">×</button></div><div id="basket-lines" class="min-h-0 flex-1 overflow-y-auto overscroll-contain"></div>
      <div id="basket-actions" class="mt-auto shrink-0 border-t bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"></div></div>
    </section>${clientDialog("ticket-dialog", "Bénéficiaire des tickets")}<dialog id="craft-dialog" class="m-auto max-h-[calc(100%-2rem)] w-[min(48rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-backdrop"><div class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-surface p-5"><div><h2 class="text-xl font-bold">Fabrications nécessaires</h2><p class="mt-1 text-sm text-muted">Fabriquez les articles manquants avant de valider le panier.</p></div><button type="button" data-close class="grid size-11 place-items-center rounded-xl border" aria-label="Fermer">×</button></div><div id="cash-craft-planner" class="p-5"></div></dialog>`;
    this.outlet.insertAdjacentHTML("beforeend", `<button id="open-basket" type="button" class="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-brand px-5 font-bold text-white shadow-xl lg:hidden" aria-controls="basket-panel"><span id="mobile-basket-count"></span><span id="mobile-basket-total"></span></button>`);
    this.bind();
    this.renderBasket();
    this.setBasketOpen(this.basketOpen, false);
  }

  private articleRow(row: CatalogueRow): string {
    const stock = stockOf(row);
    const craftableNow = this.remainingCraftableQuantity(row) > 0;
    const unavailable = (this.checkoutQuantities().get(String(row.id)) ?? 0) >= this.maximumQuantity(row);
    return `<button data-add="${escapeHtml(row.id)}" ${unavailable ? "disabled" : ""} class="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b px-4 py-2 text-left hover:bg-surface-muted disabled:opacity-45 sm:grid-cols-[minmax(0,1fr)_8rem_9rem] sm:gap-x-6 ${!stock && craftableNow ? "border-l-2 border-l-accent bg-accent/5" : ""}"><strong class="truncate">${escapeHtml(row.article)}</strong><span class="row-start-2 text-right text-sm ${!stock && craftableNow ? "font-bold text-accent" : "text-muted"} sm:row-start-auto">${stock ? `Stock : ${stock}` : "Rupture"}</span><span class="row-span-2 text-right font-bold sm:row-span-1">${money.format(this.unitPrice(row))} PO${this.isEmployeePurchase ? '<small class="block font-normal text-muted">prix coûtant</small>' : ""}</span></button>`;
  }
  private basketRow(row: CatalogueRow, quantity: number): string {
    const price = this.unitPrice(row);
    if (isCompassSupplement(row.article)) return `<div class="border-b p-4" data-line="${escapeHtml(row.id)}"><div class="flex justify-between gap-4"><div><strong>${escapeHtml(row.article)}</strong><p class="mt-1 text-sm text-muted">Ajout automatique — ${escapeHtml(compassDecisionLabel(true))}</p></div><span>${money.format(price)} PO</span></div><div class="mt-3 flex items-center justify-between"><span class="rounded-lg bg-surface-muted px-3 py-2 text-sm font-bold">Quantité liée : ${quantity}</span><strong>${money.format(price * quantity)} PO</strong></div></div>`;
    const maximumFreeQuantity = Math.max(0, this.maximumQuantity(row) - this.groupedQuantity(String(row.id)));
    return `<div class="border-b p-4" data-line="${escapeHtml(row.id)}"><div class="flex justify-between gap-4"><strong>${escapeHtml(row.article)}</strong><span>${money.format(price)} PO</span></div><div class="mt-3 flex flex-wrap items-center justify-between gap-3"><div class="inline-grid grid-cols-5 overflow-hidden rounded-xl border"><button data-remove class="grid size-11 place-items-center border-r font-bold text-danger" aria-label="Retirer ${escapeHtml(row.article)} du panier" title="Retirer du panier">${icon("trash", "size-5")}</button><button data-minus class="size-11 font-bold" aria-label="Retirer une unité">−</button><input data-quantity value="${quantity}" inputmode="numeric" class="size-11 border-x bg-surface text-center font-bold" aria-label="Quantité"><button data-plus class="size-11 font-bold" aria-label="Ajouter une unité" ${quantity >= maximumFreeQuantity ? "disabled" : ""}>+</button><button data-plus-ten class="size-11 border-l text-sm font-bold" aria-label="Ajouter dix unités" ${quantity >= maximumFreeQuantity ? "disabled" : ""}>+10</button></div><strong>${money.format(price * quantity)} PO</strong></div>${!this.isEmployeePurchase && row.type_article === "document_permis" ? `<p class="mt-2 text-sm text-muted">${this.assignedPermits(String(row.id))}/${quantity} bénéficiaire(s) associé(s) — complété lors de la validation</p>` : ""}${quantity > stockOf(row) ? `<p class="mt-2 text-sm text-warning">${quantity - stockOf(row)} unité(s) à fabriquer</p>` : ""}</div>`;
  }

  private orderGroupHtml(order: PreparedOrder): string {
    const total = order.lines.reduce((sum, line) => {
      const article = this.article(String(line.article_id));
      return sum + (article ? this.unitPrice(article) * line.quantite : 0);
    }, 0);
    return `<section data-order-group="${escapeHtml(order.id)}" class="border-y-2 border-accent bg-accent/5"><div class="flex items-center justify-between gap-3 border-b border-accent/40 px-4 py-3"><strong>Commande : ${escapeHtml(order.clientName)}</strong><button type="button" data-remove-order-group="${escapeHtml(order.id)}" class="grid size-10 place-items-center rounded-lg border border-danger text-danger" aria-label="Retirer toute la commande de ${escapeHtml(order.clientName)}" title="Retirer toute la commande">${icon("trash", "size-5")}</button></div><ul class="divide-y">${order.lines.map(line => { const article = this.article(String(line.article_id)); if (!article) return ""; return `<li class="flex items-center justify-between gap-4 px-4 py-2"><span>${escapeHtml(article.article)} <strong>× ${line.quantite}</strong></span><span class="shrink-0 font-bold">${money.format(this.unitPrice(article) * line.quantite)} PO</span></li>`; }).join("")}</ul><div class="flex justify-between border-t border-accent/40 px-4 py-2 text-sm"><span class="text-muted">Quantités verrouillées</span><strong>${money.format(total)} PO</strong></div></section>`;
  }

  private packGroupHtml(pack: { label: string; articleIds: string[] }): string {
    const rows = pack.articleIds.flatMap(id => {
      const article = this.article(id);
      const quantity = this.basket.get(id) ?? 0;
      return article && quantity ? [this.basketRow(article, quantity)] : [];
    });
    if (!rows.length) return "";
    return `<section class="border-y-2"><div class="bg-surface-muted px-4 py-2 text-sm font-bold">${escapeHtml(pack.label)}</div>${rows.join("")}</section>`;
  }

  private bind(): void {
    this.outlet.querySelector<HTMLInputElement>("#article-search")!.addEventListener("input", event => {
      this.query = (event.currentTarget as HTMLInputElement).value;
      this.renderArticleList();
    });
    this.outlet.querySelector<HTMLSelectElement>("#quick-add-select")!.addEventListener("change", event => {
      const select = event.currentTarget as HTMLSelectElement;
      const [kind, id] = select.value.split(":");
      select.value = "";
      if (kind === "pack" && id) void this.addPack(id);
      if (kind === "order" && id) void this.addPreparedOrder(id);
    });
    this.bindArticleButtons(this.outlet);
    this.outlet.querySelector<HTMLInputElement>("#employee-purchase")!.addEventListener("change", event => { this.isEmployeePurchase = (event.currentTarget as HTMLInputElement).checked; this.render(); });
    this.outlet.querySelector("#open-basket")!.addEventListener("click", () => this.setBasketOpen(true));
    this.outlet.querySelector("#close-basket")!.addEventListener("click", () => this.setBasketOpen(false));
    this.outlet.querySelector("#basket-backdrop")!.addEventListener("click", () => this.setBasketOpen(false));
    this.outlet.querySelectorAll<HTMLDialogElement>("dialog").forEach(dialog => dialog.querySelector("[data-close]")!.addEventListener("click", () => dialog.close()));
    document.removeEventListener("keydown", this.handleKeydown);
    document.addEventListener("keydown", this.handleKeydown);
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (!this.basketOpen || matchMedia("(min-width: 1024px)").matches) return;
    if (event.key === "Escape") this.setBasketOpen(false);
    else {
      const panel = this.outlet.querySelector<HTMLElement>("#basket-panel");
      if (panel) keepFocusInside(panel, event);
    }
  };

  private bindArticleButtons(root: ParentNode): void {
    root.querySelectorAll<HTMLElement>("[data-add]").forEach(el => el.addEventListener("click", () => void this.addArticle(el.dataset.add!)));
  }

  private setBasketOpen(open: boolean, moveFocus = true): void {
    this.basketOpen = open;
    const panel = this.outlet.querySelector<HTMLElement>("#basket-panel");
    const backdrop = this.outlet.querySelector<HTMLButtonElement>("#basket-backdrop");
    const trigger = this.outlet.querySelector<HTMLButtonElement>("#open-basket");
    if (!panel || !backdrop || !trigger) return;
    const mobile = !matchMedia("(min-width: 1024px)").matches;
    const catalogue = this.outlet.querySelector<HTMLElement>("#catalogue-panel");
    panel.classList.toggle("translate-y-full", !open);
    panel.classList.toggle("invisible", !open);
    panel.classList.toggle("pointer-events-none", !open);
    panel.inert = mobile && !open;
    if (catalogue) catalogue.inert = mobile && open;
    panel.setAttribute("aria-modal", String(mobile && open));
    backdrop.hidden = !mobile || !open;
    trigger.hidden = mobile && open;
    trigger.setAttribute("aria-expanded", String(open));
    lockDocumentScroll(mobile && open);
    if (moveFocus && mobile) (open ? panel.querySelector<HTMLButtonElement>("#close-basket") : trigger)?.focus();
  }

  private renderBasket(): void {
    const summary = this.outlet.querySelector<HTMLElement>("#basket-summary");
    const lines = this.outlet.querySelector<HTMLElement>("#basket-lines");
    const actions = this.outlet.querySelector<HTMLElement>("#basket-actions");
    if (!summary || !lines || !actions) return;
    summary.textContent = this.canCheckout() ? `${this.basketQuantity()} article(s)${this.orderGroups.size ? ` · ${this.orderGroups.size} commande(s)` : ""}` : "Ajoutez un article depuis la liste.";
    const groupedLines = [...this.orderGroups.values()].map(order => this.orderGroupHtml(order)).join("");
    const packedArticleIds = new Set([...this.packGroups.values()].flatMap(pack => pack.articleIds));
    const packedLines = [...this.packGroups.values()].map(pack => this.packGroupHtml(pack)).join("");
    const freeLines = [...this.basket].filter(([id]) => !packedArticleIds.has(id)).map(([id, q]) => this.basketRow(this.article(id)!, q)).join("");
    lines.innerHTML = this.canCheckout() ? `${groupedLines}${packedLines}${freeLines}` : '<p class="p-8 text-center text-muted">Le panier est vide.</p>';
    actions.innerHTML = `<div class="mb-4 flex items-baseline justify-between"><strong>${this.isEmployeePurchase ? "Total à rembourser" : "Total"}</strong><strong class="text-2xl">${money.format(this.total())} PO</strong></div>${this.ticketQuantity() ? `<p class="mb-3 text-sm text-muted">${this.ticketAuthorized ? `Bénéficiaire des tickets : ${escapeHtml(this.ticketClient?.nom_prenom ?? "vérifié")}.` : "Le bénéficiaire des tickets sera vérifié lors de la validation."}</p>` : ""}<div class="grid grid-cols-1 gap-3 sm:grid-cols-2"><button id="craft-action" ${this.shortages().length ? "" : "disabled"} class="min-h-12 rounded-xl border border-accent font-bold text-accent disabled:opacity-40">Craft</button><button id="checkout" ${this.canCheckout() && !this.shortages().length && !this.submitting ? "" : "disabled"} class="min-h-12 rounded-xl bg-brand font-bold text-white disabled:opacity-40">${this.isEmployeePurchase ? "Valider l’achat" : "Valider"}</button></div>`;
    const quantity = this.basketQuantity();
    this.outlet.querySelector<HTMLElement>("#mobile-basket-count")!.textContent = `Panier (${quantity} article${quantity > 1 ? "s" : ""})`;
    this.outlet.querySelector<HTMLElement>("#mobile-basket-total")!.textContent = `${money.format(this.total())} PO`;
    this.outlet.querySelectorAll<HTMLElement>("[data-line]").forEach(el => { const id = el.dataset.line!; const remove = el.querySelector<HTMLElement>("[data-remove]"); const minus = el.querySelector<HTMLElement>("[data-minus]"); const plus = el.querySelector<HTMLElement>("[data-plus]"); const plusTen = el.querySelector<HTMLElement>("[data-plus-ten]"); const quantity = el.querySelector<HTMLInputElement>("[data-quantity]"); remove?.addEventListener("click", () => this.setQuantity(id, 0)); minus?.addEventListener("click", () => this.setQuantity(id, (this.basket.get(id) ?? 1) - 1)); plus?.addEventListener("click", () => this.setQuantity(id, (this.basket.get(id) ?? 0) + 1)); plusTen?.addEventListener("click", () => this.setQuantity(id, (this.basket.get(id) ?? 0) + 10)); quantity?.addEventListener("change", event => this.setQuantity(id, Number((event.currentTarget as HTMLInputElement).value))); });
    this.outlet.querySelectorAll<HTMLButtonElement>("[data-remove-order-group]").forEach(button => button.addEventListener("click", () => {
      this.orderGroups.delete(button.dataset.removeOrderGroup!);
      this.permitWithdrawals = [];
      this.ticketClient = null;
      this.ticketAuthorized = false;
      this.renderArticleList();
      this.renderBasket();
    }));
    this.outlet.querySelector("#craft-action")!.addEventListener("click", () => void this.openCraftDialog());
    this.outlet.querySelector<HTMLButtonElement>("#checkout")!.addEventListener("click", event => void withPending(event.currentTarget as HTMLButtonElement, "Validation…", () => this.submit()));
  }
  private async addArticle(id: string): Promise<void> {
    const row = this.article(id); if (!row) return;
    if (isContractBook(row.article) && !this.basket.has(id)) {
      const verified = await confirmGuildCard();
      if (!verified || this.destroyed) return;
    }
    if (isCompass(row.article) && !this.basket.has(id)) {
      const decision = await confirmCompassSupplement();
      if (decision === null || this.destroyed) return;
      this.compassWithSupplement = decision;
    }
    this.setQuantity(id, (this.basket.get(id) ?? 0) + 1);
  }
  private async addPack(packId: string): Promise<void> {
    const pack = articlePacks.find(candidate => candidate.id === packId);
    if (!pack) return;
    const resolved = pack.items.map(item => ({ item, article: this.catalogue.find(article => article.article.localeCompare(item.article, "fr", { sensitivity: "base" }) === 0) }));
    const missing = resolved.filter(line => !line.article).map(line => line.item.article);
    if (missing.length) {
      showToast(`Pack indisponible : ${missing.join(", ")} absent du catalogue.`, "error");
      return;
    }
    const added = await this.addQuickLines(resolved.map(line => ({ article_id: line.article!.id, quantite: line.item.quantity })), pack.label);
    if (added) {
      this.packGroups.set(pack.id, { label: pack.label, articleIds: resolved.map(line => String(line.article!.id)) });
      this.renderBasket();
      showToast(`${pack.label} ajouté au panier.`, "success");
    }
  }
  private async addPreparedOrder(orderId: string): Promise<void> {
    const order = this.preparedOrders.find(candidate => String(candidate.id) === orderId);
    if (!order) return;
    if (this.orderGroups.has(String(order.id))) {
      showToast(`La commande de ${order.clientName} est déjà dans le panier.`, "error");
      return;
    }
    const resolved = order.lines.map(line => ({ line, article: this.article(String(line.article_id)) }));
    const missing = resolved.filter(item => !item.article).map(item => `#${item.line.article_id}`);
    if (missing.length) {
      showToast(`Impossible d’ajouter la commande : article(s) indisponible(s) ${missing.join(", ")}.`, "error");
      return;
    }
    const current = this.checkoutQuantities();
    const unavailable = resolved.flatMap(({ line, article }) => (current.get(String(article!.id)) ?? 0) + line.quantite > this.maximumQuantity(article!) ? [article!.article] : []);
    if (unavailable.length) {
      showToast(`Stock insuffisant pour ajouter la commande : ${unavailable.join(", ")}.`, "error");
      return;
    }
    for (const { article } of resolved) {
      const id = String(article!.id);
      if (isContractBook(article!.article) && !current.has(id) && !await confirmGuildCard()) return;
    }
    this.isEmployeePurchase = false;
    this.orderGroups.set(String(order.id), order);
    this.render();
    showToast(`Commande de ${order.clientName} ajoutée au panier.`, "success");
  }
  private async addQuickLines(lines: BasketLine[], label: string): Promise<boolean> {
    const resolved = lines.map(line => ({ line, article: this.article(String(line.article_id)) }));
    const missing = resolved.filter(item => !item.article).map(item => `#${item.line.article_id}`);
    if (missing.length) {
      showToast(`Impossible d’ajouter ${label} : article(s) indisponible(s) ${missing.join(", ")}.`, "error");
      return false;
    }
    const unavailable = resolved.flatMap(item => {
      const article = item.article!;
      const requested = (this.checkoutQuantities().get(String(article.id)) ?? 0) + item.line.quantite;
      return requested > this.maximumQuantity(article) ? [article.article] : [];
    });
    if (unavailable.length) {
      showToast(`Stock insuffisant pour ajouter ${label} : ${unavailable.join(", ")}.`, "error");
      return false;
    }
    for (const { article } of resolved) {
      if (isContractBook(article!.article) && !this.basket.has(String(article!.id)) && !await confirmGuildCard()) return false;
      if (isCompass(article!.article) && !this.basket.has(String(article!.id))) {
        const decision = await confirmCompassSupplement();
        if (decision === null || this.destroyed) return false;
        this.compassWithSupplement = decision;
      }
    }
    resolved.forEach(({ line, article }) => this.setQuantity(String(article!.id), (this.basket.get(String(article!.id)) ?? 0) + line.quantite));
    this.renderBasket();
    return true;
  }
  private setQuantity(id: string, requested: number): void {
    const row = this.article(id); if (!row) return;
    if (isCompassSupplement(row.article)) return;
    const maximum = Math.max(0, this.maximumQuantity(row) - this.groupedQuantity(id));
    const quantity = Math.max(0, Math.min(Number.isFinite(requested) ? Math.trunc(requested) : 0, maximum));
    if (!quantity) {
      this.basket.delete(id);
      this.packGroups.forEach((pack, packId) => {
        if (pack.articleIds.every(articleId => !this.basket.has(articleId))) this.packGroups.delete(packId);
      });
    } else this.basket.set(id, quantity);
    if (row.type_article === "document_permis") {
      this.isEmployeePurchase = false;
      const retained = this.permitWithdrawals.filter(item => String(item.article_id) !== id);
      const current = this.permitWithdrawals.filter(item => String(item.article_id) === id).slice(0, quantity);
      this.permitWithdrawals = [...retained, ...current];
    }
    if (isCompass(row.article)) {
      const supplement = this.catalogue.find(article => isCompassSupplement(article.article));
      if (!quantity) this.compassWithSupplement = null;
      if (supplement) {
        if (quantity && this.compassWithSupplement) this.basket.set(String(supplement.id), quantity);
        else this.basket.delete(String(supplement.id));
      }
    }
    if (row.type_article === "ticket") { this.ticketClient = null; this.ticketAuthorized = false; }
    if (row.type_article === "document_permis") this.render();
    else { this.renderArticleList(); this.renderBasket(); }
  }

  private async openCraftDialog(): Promise<void> {
    const dialog = this.outlet.querySelector<HTMLDialogElement>("#craft-dialog")!;
    const root = dialog.querySelector<HTMLElement>("#cash-craft-planner")!;
    root.innerHTML = asyncState("loading");
    dialog.addEventListener("close", () => { if (!this.destroyed && dialog.isConnected) this.render(); }, { once: true });
    dialog.showModal();
    try {
      const recipes = await getCraftRecipes();
      const outputs = new Map<string, number>();
      recipes.forEach(recipe => outputs.set(String(recipe.produit_id), recipe.quantite_produite));
      const initial: CraftSelection[] = this.shortages().flatMap(([article, shortage]) => {
        const output = outputs.get(String(article.id));
        return output ? [{ productId: String(article.id), craftCount: Math.ceil(shortage / output) }] : [];
      });
      if (initial.length !== this.shortages().length) showToast("Certains articles en rupture n’ont pas de recette de fabrication.", "error");
      const planner = new CraftPlanner(root, {
        initial,
        allowAdd: false,
        onCrafted: async () => {
          const [catalogue, refreshedRecipes] = await Promise.all([getSellableCatalogue(), getCraftRecipes()]);
          this.catalogue = catalogue;
          this.updateCraftability(refreshedRecipes);
        },
        onComplete: () => dialog.close()
      });
      await planner.mount();
    } catch (error) { root.innerHTML = asyncState("error", error instanceof Error ? error.message : undefined); }
  }

  private openTicketDialog(): Promise<boolean> {
    const dialog = this.outlet.querySelector<HTMLDialogElement>("#ticket-dialog")!;
    const name = dialog.querySelector<HTMLInputElement>("[data-client-name]")!; const owl = dialog.querySelector<HTMLInputElement>("[data-client-owl]")!;
    const results = dialog.querySelector<HTMLElement>("[data-results]")!; const status = dialog.querySelector<HTMLElement>("[data-client-status]")!; const confirm = dialog.querySelector<HTMLButtonElement>("[data-confirm]")!;
    const controller = new AbortController(); const { signal } = controller;
    let selected: ClientRow | null = null;
    const search = async (field: "name" | "owl", term: string): Promise<void> => {
      selected = null; confirm.disabled = true;
      if (!term || (field === "name" && term.length < 3)) { results.hidden = true; return; }
      try {
        const clients = await searchClients(term, field); results.hidden = false;
        results.innerHTML = clients.length ? clients.map(client => `<button data-client="${escapeHtml(client.id)}" class="flex min-h-12 w-full justify-between border-b px-3 py-2 text-left"><strong>${escapeHtml(client.nom_prenom)}</strong><span class="text-muted">${escapeHtml(client.hibou ?? "Sans hibou")}</span></button>`).join("") : '<p class="p-3 text-muted">Aucun client trouvé.</p>';
        results.querySelectorAll<HTMLButtonElement>("[data-client]").forEach(button => button.addEventListener("click", async () => {
          selected = clients.find(client => String(client.id) === button.dataset.client)!; name.value = selected.nom_prenom; owl.value = selected.hibou ?? ""; results.hidden = true; status.textContent = "Vérification…";
          try {
            const count = await getTicketCount(selected.id); const remaining = Math.max(0, 2 - count); if (this.ticketQuantity() > remaining) throw new Error(`${count}/2 retiré(s) — quota restant insuffisant pour ce panier.`); status.textContent = `${count}/2 retiré(s) — ${remaining} disponible(s).`;
            confirm.disabled = false;
          } catch (error) { status.textContent = error instanceof Error ? error.message : "Contrôle impossible."; }
        }, { signal }));
      } catch (error) { status.textContent = error instanceof Error ? error.message : "Recherche impossible."; }
    };
    name.value = ""; owl.value = ""; results.hidden = true; status.textContent = "Sélectionnez un client."; confirm.disabled = true;
    name.addEventListener("input", () => void search("name", name.value.trim()), { signal }); owl.addEventListener("input", () => { owl.value = owl.value.replace(/\D/g, ""); void search("owl", owl.value); }, { signal });
    dialog.showModal(); name.focus();
    return new Promise(resolve => {
      let settled = false;
      const finish = (authorized: boolean): void => { if (settled) return; settled = true; controller.abort(); resolve(authorized); };
      confirm.addEventListener("click", () => { if (!selected) return; this.ticketClient = selected; this.ticketAuthorized = true; dialog.close(); this.renderBasket(); finish(true); }, { signal });
      dialog.addEventListener("close", () => finish(false), { once: true, signal });
    });
  }

  private selectPermitBeneficiary(article: CatalogueRow, position: number, total: number): Promise<PermitWithdrawal | null> {
    const dialog = document.createElement("dialog");
    dialog.className = "m-auto w-[min(36rem,calc(100%-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-backdrop";
    dialog.innerHTML = `<div class="border-b p-5"><h2 class="text-xl font-bold">Vérifier le permis</h2><p class="mt-1 text-sm text-muted">${escapeHtml(article.article)} — permis ${position}/${total}</p></div><div class="space-y-4 p-5"><div class="grid gap-3 sm:grid-cols-2"><label class="text-sm font-bold">Nom et prénom<input data-name autocomplete="off" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"></label><label class="text-sm font-bold">Hibou<input data-owl autocomplete="off" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"></label></div><div data-results class="max-h-52 overflow-y-auto rounded-xl border" hidden></div><p data-status class="rounded-xl bg-surface-muted p-4 text-sm text-muted">Sélectionnez un client.</p></div><div class="flex justify-end gap-3 border-t p-4"><button type="button" data-cancel class="min-h-11 rounded-xl border px-4 font-bold">Annuler la validation</button><button type="button" data-confirm disabled class="min-h-11 rounded-xl bg-brand px-4 font-bold text-white disabled:opacity-40">Valider ce permis</button></div>`;
    document.body.append(dialog); dialog.showModal();
    return new Promise(resolve => {
      const name = dialog.querySelector<HTMLInputElement>("[data-name]")!; const owl = dialog.querySelector<HTMLInputElement>("[data-owl]")!; const results = dialog.querySelector<HTMLElement>("[data-results]")!; const status = dialog.querySelector<HTMLElement>("[data-status]")!; const confirm = dialog.querySelector<HTMLButtonElement>("[data-confirm]")!;
      let withdrawal: PermitWithdrawal | null = null; let settled = false;
      const finish = (value: PermitWithdrawal | null): void => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(value); };
      const find = async (field: "name" | "owl", term: string): Promise<void> => { withdrawal = null; confirm.disabled = true; if (!term || (field === "name" && term.length < 3)) { results.hidden = true; return; } try { const clients = await searchClients(term, field); results.hidden = false; results.innerHTML = clients.length ? clients.map(client => `<button type="button" data-client="${escapeHtml(client.id)}" class="flex min-h-12 w-full justify-between border-b px-3 py-2 text-left"><strong>${escapeHtml(client.nom_prenom)}</strong><span class="text-muted">${escapeHtml(client.hibou ?? "Sans hibou")}</span></button>`).join("") : '<p class="p-3 text-muted">Aucun client trouvé.</p>'; results.querySelectorAll<HTMLButtonElement>("[data-client]").forEach(button => button.addEventListener("click", async () => { const client = clients.find(item => String(item.id) === button.dataset.client)!; name.value = client.nom_prenom; owl.value = client.hibou ?? ""; results.hidden = true; status.textContent = "Vérification du dossier…"; try { const permit = article.type_permis ? await getClientPermit(client.id, article.type_permis) : null; if (!permit) throw new Error("Aucun dossier correspondant."); if (permit.status === "sold") throw new Error("Ce document a déjà été vendu."); if (permit.status === "pending") throw new Error("Ce dossier est encore en attente."); if (permit.status === "refused") throw new Error("Ce permis a été refusé."); if (permit.status === "cancelled") throw new Error("Ce permis a été annulé."); if (this.permitWithdrawals.some(item => String(item.permit_id) === String(permit.id))) throw new Error("Ce dossier est déjà associé à un autre document du panier."); withdrawal = { article_id: article.id, permit_id: permit.id }; status.textContent = `${client.nom_prenom} — permis validé, document disponible.`; confirm.disabled = false; } catch (error) { withdrawal = null; confirm.disabled = true; status.textContent = error instanceof Error ? error.message : "Contrôle impossible."; } })); } catch (error) { status.textContent = error instanceof Error ? error.message : "Recherche impossible."; } };
      name.addEventListener("input", () => void find("name", name.value.trim())); owl.addEventListener("input", () => void find("owl", owl.value.trim())); confirm.addEventListener("click", () => { if (withdrawal) finish(withdrawal); }); dialog.querySelector("[data-cancel]")!.addEventListener("click", () => finish(null)); dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); }, { once: true }); name.focus();
    });
  }

  private async ensurePermitBeneficiaries(): Promise<boolean> {
    for (const article of this.permitLines().sort((left, right) => left.article.localeCompare(right.article, "fr"))) {
      const quantity = this.checkoutQuantities().get(String(article.id)) ?? 0;
      while (this.assignedPermits(String(article.id)) < quantity) {
        const withdrawal = await this.selectPermitBeneficiary(article, this.assignedPermits(String(article.id)) + 1, quantity);
        if (!withdrawal) return false;
        this.permitWithdrawals.push(withdrawal);
      }
    }
    return true;
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    if (this.ticketQuantity() && !this.ticketAuthorized && !await this.openTicketDialog()) { this.renderBasket(); return; }
    if (!this.isEmployeePurchase && !await this.ensurePermitBeneficiaries()) { this.renderBasket(); return; }
    this.submitting = true;
    const lines = [...this.checkoutQuantities()].map(([article_id, quantite]) => ({ article_id, quantite }));
    const orderIds = [...this.orderGroups.values()].map(order => order.id);
    try { const employeePurchase = this.isEmployeePurchase; const total = employeePurchase ? await checkoutEmployee(lines, this.ticketClient?.id ?? null) : await checkout(lines, this.ticketClient?.id ?? null, this.permitWithdrawals, orderIds); showToast(`${employeePurchase ? "Achat employé" : "Vente"} enregistré : ${money.format(total)} PO.`, "success"); this.basket.clear(); this.orderGroups.clear(); this.packGroups.clear(); this.isEmployeePurchase = false; this.compassWithSupplement = null; this.ticketClient = null; this.ticketAuthorized = false; this.permitWithdrawals = []; [this.catalogue, this.preparedOrders] = await Promise.all([getSellableCatalogue(), getPreparedOrders()]); this.render(); }
    catch (error) { showToast(error instanceof Error ? error.message : "L’opération a échoué.", "error"); }
    finally { this.submitting = false; }
  }
}

export async function mountCaissePage(outlet: HTMLElement): Promise<() => void> { const register = new CashRegister(outlet); await register.mount(); return () => register.destroy(); }
