import { z } from "zod";
import { readEmployeeSession } from "../../core/employee-session";
import { callRpc, getSupabaseClient } from "../../data/supabase";
import { asyncState, bindRetry } from "../../ui/components/async-state";
import { showToast } from "../../ui/components/toast";
import { escapeHtml } from "../../ui/html";
import { CraftPlanner } from "../craft/planner";
import { craftStockNeeds, getCraftRecipes, type CraftStockNeed } from "../../data/repositories/craft";
import { orderToBasketStorageKey, searchClients } from "../../data/repositories/pos";
import { icon } from "../../ui/icons";
import { panel } from "../../ui/components/panel";
import { labelTableControls, responsiveTable } from "../../ui/components/responsive-table";
import { compassDecisionLabel, confirmCompassSupplement, isCompass, isCompassSupplement } from "../compass/supplement-dialog";
import { confirmDialog } from "../../ui/components/dialog";
import { buttonClasses, fieldClasses } from "../../ui/components/primitives";

const rowSchema = z.record(z.string(), z.unknown());
const newClientSchema = z.object({
  name: z.string().trim().min(2).regex(/^[\p{L}\p{M}][\p{L}\p{M}'’ -]*$/u),
  owl: z.string().trim().regex(/^\d{2,5}$/)
});
const money = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const compactBuybackPrice = (value: number): string => value > 100_000 ? `${money.format(value / 1_000)}k` : money.format(value);
const alphabetically = (left: Record<string, unknown>, right: Record<string, unknown>): number => String(left.article ?? left.nom_prenom ?? "").localeCompare(String(right.article ?? right.nom_prenom ?? ""), "fr", { sensitivity: "base" });
const table = (headers: string[], rows: string[][]): string => responsiveTable(headers, rows, { cardsOnMobile: true });
const sessionId = (): string | number => { const session = readEmployeeSession(); if (!session) throw new Error("Sélectionnez un employé."); return session.employeeId; };
const field = fieldClasses();
const primaryButton = buttonClasses();
const secondaryButton = buttonClasses("secondary");

function confirmAction(title: string, description: string): Promise<boolean> {
  return confirmDialog({ title, description, size: "small" });
}

async function rows(source: string, select = "*"): Promise<Record<string, unknown>[]> {
  const { data, error } = await getSupabaseClient().from(source).select(select);
  if (error) throw new Error(error.message);
  return z.array(rowSchema).parse(data);
}

async function employeeRows(source: string, employeeId: string | number, select = "*", column = "employe_id"): Promise<Record<string, unknown>[]> {
  const { data, error } = await getSupabaseClient().from(source).select(select).eq(column, employeeId);
  if (error) throw new Error(error.message);
  return z.array(rowSchema).parse(data);
}

async function renderCraft(outlet: HTMLElement): Promise<void> {
  const mayManageMultipleCrafts = ["Patron", "Co-Patron"].includes(readEmployeeSession()?.employeeGrade ?? "");
  const needsHtml = (needs: CraftStockNeed[]): string => needs.length
    ? `<ul class="divide-y">${needs.map(need => `<li class="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6"><span><strong>${escapeHtml(need.article)}</strong>${need.resourceUnavailable ? '<span class="mt-1 block rounded-lg bg-warning/15 px-2 py-1 text-sm font-black text-warning">Ressource indisponible</span>' : need.partiallyAvailable ? `<span class="mt-1 block text-sm font-semibold text-warning/80">Stock pour en fabriquer : ${need.craftableQuantity}</span>` : ""}</span><span class="text-sm text-muted">Stock : <strong class="text-warning">${need.current}</strong> – min/max : <strong class="text-warning">${need.minimum}/${need.maximum ?? "—"}</strong></span><button type="button" data-load-stock-need="${escapeHtml(need.productId)}" class="min-h-11 rounded-xl border border-accent px-3 font-bold text-accent">Charger dans l’outil</button></li>`).join("")}</ul>`
    : '<p class="p-4 text-sm text-muted">Tous les objets craftables respectent leur seuil minimum.</p>';
  const initialNeeds = craftStockNeeds(await getCraftRecipes());
  outlet.innerHTML = `<div class="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start"><div>${panel("Lancer une fabrication", '<div id="craft-planner" class="p-5"></div>')}</div><details data-stock-needs ${initialNeeds.length ? "open" : ""} class="overflow-hidden rounded-2xl border bg-surface shadow-[var(--shadow-panel)]"><summary class="flex min-h-12 cursor-pointer items-center justify-between gap-4 px-5 py-3 font-bold">Besoins du stock <span data-stock-needs-count class="rounded-full bg-surface-muted px-3 py-1 text-sm text-muted">${initialNeeds.length}</span></summary><div data-stock-needs-list class="border-t" aria-live="polite">${needsHtml(initialNeeds)}</div></details></div>`;
  const needsList = outlet.querySelector<HTMLElement>("[data-stock-needs-list]")!;
  const needsCount = outlet.querySelector<HTMLElement>("[data-stock-needs-count]")!;
  const plannerRoot = outlet.querySelector<HTMLElement>("#craft-planner")!;
  const refreshNeeds = async (): Promise<void> => {
    const needs = craftStockNeeds(await getCraftRecipes());
    needsList.innerHTML = needsHtml(needs);
    needsCount.textContent = String(needs.length);
  };
  const planner = new CraftPlanner(plannerRoot, { maxItems: 3, allowAdd: mayManageMultipleCrafts, onCrafted: refreshNeeds });
  await planner.mount();
  needsList.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-load-stock-need]");
    if (!button) return;
    planner.loadProduct(button.dataset.loadStockNeed!, 1);
  });
}

async function renderPurchase(outlet: HTMLElement): Promise<void> {
  const catalogue = await rows("catalogue_actif", "id,article,prix_achat,stocks(quantite,stock_max)");
  renderBuyback(outlet, catalogue.filter(row => Number(row.prix_achat) > 0).sort(alphabetically));
}

const buybackTabs = [
  { id: "all", label: "Tout" },
  { id: "providis", label: "Providis" },
  { id: "citizens", label: "Citoyens" },
  { id: "clauser", label: "Clauser" },
  { id: "forge", label: "Forge" },
  { id: "other", label: "Autres" }
] as const;

type BuybackTabId = typeof buybackTabs[number]["id"];

const citizenBuybackArticles = [
  "Ashwagandha", "Bois ancestral", "Chapô de champignon hallucinogène", "Cristal arc-en-ciel",
  "Diamant", "Écorce de cèdre lunaire", "Flacon d'encre magique", "Jades", "Menthe poivrée", "Miel",
  "Mousse de golem", "Rubis", "Sang de salamandre", "Seve de tavell", "Steak de troll",
  "Toiles d'araignées", "Topazes", "Ver de terre"
];
const clauserBuybackArticles = ["Eau minérale pure", "Poudre de corne de licorne", "Fiole de rosée du matin", "Aconit"];
const forgeBuybackArticles = ["Fil d'argent", "Cristal arc-en-ciel"];
const otherBuybackArticles = ["Ticket à gratter"];
const providisBuybackArticles = [...new Set([...citizenBuybackArticles, ...clauserBuybackArticles, ...forgeBuybackArticles])];

const normalizeArticleName = (value: unknown): string => String(value ?? "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLocaleLowerCase("fr")
  .trim();

const buybackArticleNames: Record<Exclude<BuybackTabId, "all">, Set<string>> = {
  providis: new Set(providisBuybackArticles.map(normalizeArticleName)),
  citizens: new Set(citizenBuybackArticles.map(normalizeArticleName)),
  clauser: new Set(clauserBuybackArticles.map(normalizeArticleName)),
  forge: new Set(forgeBuybackArticles.map(normalizeArticleName)),
  other: new Set(otherBuybackArticles.map(normalizeArticleName))
};

function articlesForBuybackTab(articles: Record<string, unknown>[], tab: BuybackTabId): Record<string, unknown>[] {
  if (tab === "all") return articles;
  const filtered = articles.filter(article => buybackArticleNames[tab].has(normalizeArticleName(article.article)));
  if (tab !== "providis") return filtered;
  return filtered.sort((left, right) => {
    const priorityDifference = Number(Boolean(preferredSupplierInProvidis(left, tab))) - Number(Boolean(preferredSupplierInProvidis(right, tab)));
    return priorityDifference || alphabetically(left, right);
  });
}

function preferredSupplierInProvidis(article: Record<string, unknown>, tab: BuybackTabId): "Clauser" | "Forge" | null {
  if (tab !== "providis") return null;
  const name = normalizeArticleName(article.article);
  if (buybackArticleNames.clauser.has(name)) return "Clauser";
  if (buybackArticleNames.forge.has(name)) return "Forge";
  return null;
}

function renderBuyback(outlet: HTMLElement, articles: Record<string, unknown>[]): void {
  const quantities = new Map<string, number>();
  let activeTab: BuybackTabId = "all";
  const stock = (row: Record<string, unknown>): { current: number; maximum: number | null } => {
    const value = Array.isArray(row.stocks) ? row.stocks[0] : row.stocks;
    const item = value as Record<string, unknown> | undefined;
    return { current: Number(item?.quantite ?? 0), maximum: item?.stock_max == null ? null : Number(item.stock_max) };
  };
  const total = (): number => articles.reduce((sum, article) => sum + (quantities.get(String(article.id)) ?? 0) * Number(article.prix_achat), 0);
  const summary = (): string => {
    const lines = articles.flatMap(article => { const quantity = quantities.get(String(article.id)) ?? 0; return quantity ? [`${article.article} × ${quantity} : ${money.format(quantity * Number(article.prix_achat))} PO`] : []; });
    return `Rachat de matières premières\n\n${lines.length ? lines.join("\n") : "Aucun article"}\n\nTotal estimé : ${money.format(total())} PO\nEmployé : ${readEmployeeSession()?.employeeName ?? "—"}`;
  };
  const draw = (preserveText = false): void => {
    const previousText = preserveText ? outlet.querySelector<HTMLTextAreaElement>("#buyback-summary")?.value : undefined;
    const visibleArticles = articlesForBuybackTab(articles, activeTab);
    const buybackRows = visibleArticles.map(article => { const values = stock(article); return { article, values, suggested: values.maximum == null ? "—" : Math.max(0, values.maximum - values.current), quantity: quantities.get(String(article.id)) ?? 0, preferredSupplier: preferredSupplierInProvidis(article, activeTab) }; });
    const emptyState = '<p class="p-8 text-center text-muted">Aucun article disponible dans cet onglet.</p>';
    const suggestedWithStockTooltip = (article: Record<string, unknown>, suggested: number | string, currentStock: number, preferredSupplier: string | null): string => {
      const tooltip = `<span role="tooltip" class="pointer-events-none absolute bottom-full left-0 z-20 mb-1 whitespace-nowrap rounded-md bg-backdrop px-2 py-1 text-xs font-normal text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">Stock actuel : ${currentStock}</span>`;
      const value = typeof suggested === "number"
        ? `<button type="button" data-buyback-suggested="${escapeHtml(article.id)}" data-suggested="${suggested}" class="inline-flex min-h-11 min-w-11 items-center justify-start font-bold ${preferredSupplier ? "text-muted" : "text-success"} underline-offset-4 hover:underline" aria-label="Utiliser la quantité suggérée de ${suggested} pour ${escapeHtml(article.article)} — stock actuel : ${currentStock}">${suggested}</button>`
        : `<span class="inline-flex min-h-11 min-w-11 items-center justify-start font-bold ${preferredSupplier ? "text-muted" : "text-success"}">${suggested}</span>`;
      return `<span class="group relative inline-flex">${value}${tooltip}</span>`;
    };
    const mobileBuyback = `<div class="grid max-h-[32rem] gap-3 overflow-y-auto p-3 md:hidden">${buybackRows.length ? buybackRows.map(({ article, values, suggested, quantity, preferredSupplier }) => `<section class="rounded-xl border bg-surface-muted p-4 ${preferredSupplier ? "text-muted" : ""}"><div class="flex items-start justify-between gap-3"><div><h3 class="font-bold">${escapeHtml(article.article)}${preferredSupplier ? `<span class="ml-2 text-xs font-normal text-warning/80">Priorité ${preferredSupplier}</span>` : ""}</h3><p class="mt-1 text-sm text-muted">${compactBuybackPrice(Number(article.prix_achat))} · stock ${values.current}${values.maximum == null ? "" : `/${values.maximum}`}</p></div><strong>${money.format(quantity * Number(article.prix_achat))}</strong></div><div class="mt-4 grid grid-cols-2 gap-3"><p class="text-sm"><span class="block text-xs font-bold text-muted">Qté suggérée</span>${typeof suggested === "number" ? `<button type="button" data-buyback-suggested="${escapeHtml(article.id)}" data-suggested="${suggested}" class="min-h-11 font-bold ${preferredSupplier ? "text-muted" : "text-success"} underline-offset-4 hover:underline" aria-label="Utiliser la quantité suggérée de ${suggested} pour ${escapeHtml(article.article)}">${suggested}</button>` : `<strong class="block py-3 ${preferredSupplier ? "text-muted" : "text-success"}">${suggested}</strong>`}</p><label class="text-xs font-bold text-muted">Qté rachetée<input data-buyback="${escapeHtml(article.id)}" type="number" min="0" value="${quantity}" class="mt-1 min-h-11 w-full rounded-xl border bg-surface px-3 text-base text-ink" aria-label="Quantité rachetée pour ${escapeHtml(article.article)}"></label></div></section>`).join("") : emptyState}</div>`;
    const desktopBuyback = `<div class="buyback-desktop-list hidden max-h-[32rem] overflow-auto md:block">${buybackRows.length ? `<table class="w-full min-w-[52rem] table-fixed text-left"><colgroup><col class="w-[40%]"><col class="w-[12%]"><col class="w-[17%]"><col class="w-[15%]"><col class="w-[16%]"></colgroup><thead class="sticky top-0 z-10 bg-surface-muted text-sm"><tr><th class="px-3 py-3">Article</th><th class="px-3 py-3">Prix d’achat</th><th class="px-2 py-3">Qté suggérée</th><th class="px-2 py-3">Qté rachetée</th><th class="px-3 py-3">Coût</th></tr></thead><tbody>${buybackRows.map(({ article, values, suggested, quantity, preferredSupplier }) => `<tr class="border-t ${preferredSupplier ? "text-muted" : ""}"><td class="whitespace-nowrap px-3 py-3 font-bold">${escapeHtml(article.article)}${preferredSupplier ? `<span class="ml-2 text-xs font-normal text-warning/80">Priorité ${preferredSupplier}</span>` : ""}</td><td class="px-3 py-3 text-left">${compactBuybackPrice(Number(article.prix_achat))}</td><td class="px-2 py-3 text-left">${suggestedWithStockTooltip(article, suggested, values.current, preferredSupplier)}</td><td class="px-2 py-3 text-left"><input data-buyback="${escapeHtml(article.id)}" type="number" min="0" value="${quantity}" class="min-h-11 w-20 rounded-xl border bg-surface px-3 text-left" aria-label="Quantité rachetée pour ${escapeHtml(article.article)}"></td><td class="whitespace-nowrap px-3 py-3 text-left font-bold">${money.format(quantity * Number(article.prix_achat))}</td></tr>`).join("")}</tbody></table>` : emptyState}</div>`;
    const tabs = `<div class="flex gap-2 overflow-x-auto border-b px-2" role="tablist" aria-label="Filtres de rachat">${buybackTabs.map(tab => { const active = tab.id === activeTab; const count = articlesForBuybackTab(articles, tab.id).length; return `<button id="buyback-tab-${tab.id}" type="button" role="tab" data-buyback-tab="${tab.id}" aria-controls="buyback-list" aria-selected="${active}" tabindex="${active ? 0 : -1}" class="min-h-11 shrink-0 border-b-2 px-3 font-bold ${active ? "border-accent text-accent" : "border-transparent text-muted"}">${tab.label} <span class="text-xs">(${count})</span></button>`; }).join("")}</div>`;
    outlet.innerHTML = `<div class="buyback-workspace grid gap-5">
      <section class="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-surface shadow-[var(--shadow-panel)]"><div class="flex flex-wrap items-center justify-between gap-3 border-b p-5"><h2 class="text-xl font-bold">Matières premières rachetées</h2><button id="reset-buyback" type="button" ${[...quantities.values()].some(quantity => quantity > 0) ? "" : "disabled"} class="min-h-11 rounded-xl border px-4 font-bold text-danger hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40">Reset</button></div>${tabs}<div id="buyback-list" role="tabpanel" aria-labelledby="buyback-tab-${activeTab}" class="flex min-h-0 flex-1 flex-col">${mobileBuyback}${desktopBuyback}</div></section>
      <aside class="buyback-summary grid gap-5" aria-label="Récapitulatif du rachat">
        <section class="rounded-2xl border border-accent bg-surface p-6 text-center shadow-[var(--shadow-panel)]"><p class="text-sm font-bold text-muted">Total à payer</p><p class="mt-1 text-3xl font-black text-accent">${money.format(total())} PO</p></section>
        <section class="buyback-summary-card flex min-h-0 flex-col rounded-2xl border bg-surface p-5 shadow-[var(--shadow-panel)]"><label for="buyback-summary" class="text-lg font-bold">Résumé pour Discord / RP</label><textarea id="buyback-summary" class="buyback-summary-text mt-3 min-h-48 w-full flex-1 resize-y rounded-xl border bg-surface-muted p-4 font-mono text-sm">${escapeHtml(previousText ?? summary())}</textarea><div class="buyback-summary-actions mt-3 grid shrink-0 gap-3 sm:grid-cols-2"><button id="copy-buyback-text" class="min-h-11 rounded-xl border border-accent font-bold text-accent">Copier le texte</button><button id="apply-buyback-text" class="min-h-11 rounded-xl border font-bold">Appliquer le texte</button></div></section>
        <button id="submit-buyback" ${total() ? "" : "disabled"} class="min-h-14 w-full rounded-2xl bg-brand px-5 font-bold text-white shadow-[var(--shadow-panel)] disabled:opacity-40">Valider la commande</button>
      </aside>
    </div>`;
    outlet.querySelectorAll<HTMLTableCellElement>("th").forEach(header => { header.scope = "col"; });
    const tabControls = [...outlet.querySelectorAll<HTMLButtonElement>("[data-buyback-tab]")];
    const selectTab = (tab: BuybackTabId): void => { activeTab = tab; draw(true); };
    tabControls.forEach((control, index) => {
      control.addEventListener("click", () => selectTab(control.dataset.buybackTab as BuybackTabId));
      control.addEventListener("keydown", event => {
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % tabControls.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + tabControls.length) % tabControls.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabControls.length - 1;
        else return;
        event.preventDefault();
        selectTab(tabControls[next]!.dataset.buybackTab as BuybackTabId);
        requestAnimationFrame(() => outlet.querySelector<HTMLButtonElement>(`[data-buyback-tab="${activeTab}"]`)?.focus());
      });
    });
    outlet.querySelectorAll<HTMLButtonElement>("[data-buyback-suggested]").forEach(button => button.addEventListener("click", () => {
      quantities.set(button.dataset.buybackSuggested!, Number(button.dataset.suggested));
      draw();
    }));
    outlet.querySelector<HTMLButtonElement>("#reset-buyback")!.addEventListener("click", () => {
      quantities.clear();
      draw();
    });
    outlet.querySelectorAll<HTMLInputElement>("[data-buyback]").forEach(input => input.addEventListener("change", () => { quantities.set(input.dataset.buyback!, Math.max(0, Math.trunc(Number(input.value) || 0))); draw(); }));
    outlet.querySelector("#copy-buyback-text")!.addEventListener("click", async () => { try { await navigator.clipboard.writeText(outlet.querySelector<HTMLTextAreaElement>("#buyback-summary")!.value); showToast("Texte copié.", "success"); } catch { showToast("Copie impossible : sélectionnez puis copiez le texte manuellement.", "error"); } });
    outlet.querySelector("#apply-buyback-text")!.addEventListener("click", () => {
      const text = outlet.querySelector<HTMLTextAreaElement>("#buyback-summary")!.value;
      const parsed = new Map<string, number>(); const errors: string[] = [];
      const byName = new Map(articles.map(article => [String(article.article).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr"), article]));
      text.split(/\r?\n/).filter(line => /[×x]\s*\d/.test(line)).forEach(line => { const match = line.match(/^\s*(.+?)\s*[×x]\s*(\d+)/); if (!match) return; const article = byName.get(match[1]!.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr")); if (!article) { errors.push(`Article inconnu : ${match[1]!.trim()}`); return; } const id = String(article.id); if (parsed.has(id)) errors.push(`Article présent deux fois : ${article.article}`); else parsed.set(id, Number(match[2])); });
      if (!parsed.size) errors.push("Aucune ligne de rachat reconnue.");
      if (errors.length) { showToast(errors.join(" "), "error"); return; }
      quantities.clear(); parsed.forEach((quantity, id) => quantities.set(id, quantity)); draw(); showToast("Quantités restaurées depuis le texte.", "success");
    });
    outlet.querySelector("#submit-buyback")!.addEventListener("click", async () => { const lines = [...quantities].filter(([, quantity]) => quantity > 0).map(([article_id, quantite]) => ({ article_id, quantite })); if (!lines.length) return; try { const amount = await callRpc("enregistrer_rachat", { p_employe_id: sessionId(), p_lignes: lines }, z.coerce.number()); showToast(`Rachat enregistré : ${money.format(amount)} PO.`, "success"); await renderPurchase(outlet); } catch (error) { showToast(error instanceof Error ? error.message : "Rachat impossible.", "error"); } });
  };
  draw();
}

async function renderOrders(outlet: HTMLElement): Promise<void> {
  const [orders, articles] = await Promise.all([rows("commandes", "*,clients(nom_prenom,hibou),lignes_commandes(article_nom,quantite,prix_unitaire)"), rows("catalogue_actif", "id,article,prix_vente")]);
  const sellable = articles.filter(article => Number(article.prix_vente) > 0).sort(alphabetically);
  const selectable = sellable.filter(article => !isCompassSupplement(article.article));
  const supplement = sellable.find(article => isCompassSupplement(article.article));
  const form = `<form id="order-form" class="space-y-5 p-5"><div><p class="text-sm font-bold">Client</p><div class="mt-2 grid gap-3 sm:grid-cols-2"><label class="text-sm font-bold">Nom et prénom<input id="order-client-name" autocomplete="off" class="mt-2 ${field}" placeholder="Rechercher par nom…"></label><label class="text-sm font-bold">Hibou<input id="order-client-owl" autocomplete="off" class="mt-2 ${field}" placeholder="Rechercher par hibou…"></label></div><div id="order-client-results" class="mt-2 max-h-52 overflow-y-auto rounded-xl border" hidden></div><p id="order-client-status" class="mt-2 text-sm text-muted" hidden></p></div><div><div class="mb-3 flex items-center justify-between gap-3"><h3 class="font-bold">Objets commandés</h3><button type="button" id="add-order-line" class="${secondaryButton}">+ Ajouter un objet</button></div><div id="order-lines" class="space-y-3"></div></div><details class="rounded-xl border bg-surface-muted"><summary class="flex min-h-11 cursor-pointer items-center px-4 py-3 font-bold">Ajouter une note <span class="ml-2 text-sm font-normal text-muted">(facultatif)</span></summary><div class="border-t p-4"><label class="block text-sm font-bold">Note<textarea name="notes" class="mt-2 min-h-24 w-full rounded-xl border bg-surface p-3" placeholder="Informations utiles pour la commande…"></textarea></label></div></details><div class="flex flex-wrap items-center justify-between gap-4 border-t pt-5"><p>Total estimé : <strong id="order-total" class="text-xl">0 PO</strong></p><button class="${primaryButton}">Créer la commande</button></div></form>`;
  const orderCards = orders.length ? `<div class="grid max-h-[42rem] gap-3 overflow-y-auto p-3 overscroll-contain">${orders.map(order => {
    const client = order.clients as Record<string, unknown> | null;
    const orderLines = order.lignes_commandes as Record<string, unknown>[] | null;
    const status = String(order.statut_livraison);
    const next = ["En attente", "En préparation"].includes(status) ? "Prêt" : null;
    const mayCancel = !["Vendu", "Livré", "Annulée"].includes(status);
    const isCancelled = status === "Annulée";
    const mayReverse = ["Prêt", "Annulée"].includes(status);
    const reverseAction = isCancelled ? "Restauration" : "Retour arrière";
    const reverseLabel = isCancelled ? "Restaurer la commande" : `Revenir à l’état précédent depuis ${status}`;
    const clientName = escapeHtml(client?.nom_prenom ?? order.client_nom ?? "Client archivé");
    const articleList = orderLines?.length ? `<ul class="grid gap-1">${orderLines.map(line => `<li class="flex min-w-0 items-baseline justify-between gap-4"><span class="truncate">${escapeHtml(line.article_nom ?? "Article archivé")}</span><strong class="shrink-0">× ${escapeHtml(line.quantite ?? 0)}</strong></li>`).join("")}</ul>` : '<p class="text-sm text-muted">Aucun article.</p>';
    const statusClass = ["Vendu", "Livré"].includes(status) ? "bg-success/10 text-success" : isCancelled ? "bg-danger/10 text-danger" : status === "Prêt" ? "bg-accent/10 text-accent" : "bg-warning/10 text-warning";
    const actions = `${next ? `<button data-order="${order.id}" data-next="${next}" class="min-h-9 rounded-lg border border-accent px-3 text-sm font-bold text-accent">Préparer</button>` : ""}${status === "Prêt" ? `<a href="/caisse" data-add-order-basket="${escapeHtml(order.id)}" class="inline-flex min-h-9 items-center justify-center rounded-lg bg-brand px-3 text-center text-sm font-bold text-white">Ajouter au panier</a>` : ""}${mayReverse ? `<button data-restore-order="${order.id}" data-reverse-action="${reverseAction}" class="grid size-9 place-items-center rounded-lg border text-accent" aria-label="${escapeHtml(reverseLabel)}" title="${escapeHtml(reverseLabel)}">${icon("reverse", "size-3.5")}</button>` : ""}${mayCancel ? `<button data-cancel-order="${order.id}" data-cancel-label="${clientName}" class="grid size-9 place-items-center rounded-lg border text-danger" aria-label="Annuler la commande" title="Annuler la commande">×</button>` : ""}${isCancelled ? `<button data-delete-order="${order.id}" data-delete-label="${clientName}" class="grid size-9 place-items-center rounded-lg border text-danger" aria-label="Supprimer définitivement la commande" title="Supprimer définitivement">${icon("trash", "size-3.5")}</button>` : ""}`;
    return `<article class="overflow-hidden rounded-xl border bg-surface-muted shadow-sm"><header class="grid items-center gap-2 border-b px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><div class="min-w-0"><h3 class="truncate font-bold">${clientName} <span class="ml-1 text-xs font-normal text-muted">(${new Date(String(order.date_commande)).toLocaleDateString("fr-FR")})</span></h3></div><span class="w-fit rounded-full px-2.5 py-1 text-xs font-bold ${statusClass}">${escapeHtml(status)}</span><strong class="whitespace-nowrap text-base sm:min-w-24 sm:text-right">${money.format(Number(order.prix_total))} PO</strong></header>${order.contenu ? `<p class="border-b px-3 py-2 text-sm text-muted">${escapeHtml(order.contenu)}</p>` : ""}<div class="grid items-end gap-3 p-3 sm:grid-cols-2"><div class="min-w-0 rounded-lg bg-surface px-3 py-2 text-sm">${articleList}</div>${actions ? `<div class="flex shrink-0 flex-wrap items-center justify-end gap-1 self-end">${actions}</div>` : ""}</div></article>`;
  }).join("")}</div>` : '<p class="p-8 text-center text-muted">Aucune commande pour le moment.</p>';
  outlet.innerHTML = `<div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start"><div>${panel("Nouvelle commande", form)}</div><div>${panel("Commandes", orderCards)}</div></div>`;
  const lines: Array<{ articleId: string; quantity: number; automatic?: boolean }> = selectable.length ? [{ articleId: String(selectable[0]!.id), quantity: 1 }] : [];
  let compassWithSupplement: boolean | null = null;
  let selectedClientId: string | number | null = null;
  const clientName = outlet.querySelector<HTMLInputElement>("#order-client-name")!; const clientOwl = outlet.querySelector<HTMLInputElement>("#order-client-owl")!; const clientResults = outlet.querySelector<HTMLElement>("#order-client-results")!; const clientStatus = outlet.querySelector<HTMLElement>("#order-client-status")!;
  let clientSearchSequence = 0;
  const findClient = async (field: "name" | "owl", term: string): Promise<void> => {
    const sequence = ++clientSearchSequence; selectedClientId = null; clientStatus.hidden = true; clientStatus.textContent = "";
    if (!term || (field === "name" && term.length < 3)) { clientResults.hidden = true; return; }
    try {
      const matches = await searchClients(term, field); if (sequence !== clientSearchSequence) return;
      clientResults.hidden = false; clientResults.innerHTML = matches.length ? matches.map(client => `<button type="button" data-order-client="${escapeHtml(client.id)}" class="flex min-h-12 w-full items-center justify-between gap-4 border-b px-3 py-2 text-left hover:bg-surface-muted"><strong>${escapeHtml(client.nom_prenom)}</strong><span class="text-muted">${escapeHtml(client.hibou ?? "Sans hibou")}</span></button>`).join("") : '<p class="p-3 text-muted">Aucun client trouvé.</p>';
      clientResults.querySelectorAll<HTMLButtonElement>("[data-order-client]").forEach(button => button.addEventListener("click", () => { const client = matches.find(item => String(item.id) === button.dataset.orderClient)!; selectedClientId = client.id; clientName.value = client.nom_prenom; clientOwl.value = client.hibou ?? ""; clientResults.hidden = true; clientStatus.hidden = false; clientStatus.textContent = `Client sélectionné : ${client.nom_prenom}${client.hibou ? ` — hibou ${client.hibou}` : ""}.`; }));
    } catch (error) { if (sequence === clientSearchSequence) { clientStatus.hidden = false; clientStatus.textContent = error instanceof Error ? error.message : "Recherche impossible."; } }
  };
  clientName.addEventListener("input", () => void findClient("name", clientName.value.trim()));
  clientOwl.addEventListener("input", () => void findClient("owl", clientOwl.value.trim()));
  const syncCompassSupplement = (): void => {
    const compassLine = lines.find(line => isCompass(sellable.find(article => String(article.id) === line.articleId)?.article));
    for (let index = lines.length - 1; index >= 0; index -= 1) if (lines[index]!.automatic) lines.splice(index, 1);
    if (compassLine && compassWithSupplement && supplement) lines.push({ articleId: String(supplement.id), quantity: compassLine.quantity, automatic: true });
  };
  const drawLines = (): void => {
    const root = outlet.querySelector<HTMLElement>("#order-lines")!;
    root.innerHTML = lines.length ? lines.map((line, index) => line.automatic ? `<div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface-muted p-4"><div><strong>${escapeHtml(supplement?.article ?? "Supplément boussole")}</strong><p class="text-sm text-muted">Ajout automatique — ${escapeHtml(compassDecisionLabel(true))}</p></div><div class="text-right"><span class="text-sm text-muted">Quantité liée : ${line.quantity}</span><strong class="block">${money.format(Number(supplement?.prix_vente ?? 0) * line.quantity)} PO</strong></div></div>` : `<div data-order-line="${index}" class="grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_8rem_2.75rem]"><label class="text-sm font-bold">Article<select data-order-article class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3">${selectable.map(article => { const id = String(article.id); const usedElsewhere = lines.some((item, itemIndex) => itemIndex !== index && item.articleId === id); return `<option value="${escapeHtml(id)}" ${line.articleId === id ? "selected" : ""} ${usedElsewhere ? "disabled" : ""}>${escapeHtml(article.article)} — ${money.format(Number(article.prix_vente))} PO</option>`; }).join("")}</select></label><label class="text-sm font-bold">Quantité<input data-order-quantity type="number" min="1" value="${line.quantity}" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"></label><button type="button" data-remove-order-line class="mt-auto grid size-11 place-items-center rounded-xl border" aria-label="Retirer cet objet">×</button></div>`).join("") : '<p class="rounded-xl bg-surface-muted p-4 text-center text-muted">Ajoutez au moins un objet.</p>';
    const total = lines.reduce((sum, line) => sum + line.quantity * Number(sellable.find(article => String(article.id) === line.articleId)?.prix_vente ?? 0), 0);
    outlet.querySelector("#order-total")!.textContent = `${money.format(total)} PO`;
    outlet.querySelector<HTMLButtonElement>("#add-order-line")!.disabled = lines.filter(line => !line.automatic).length >= selectable.length;
    root.querySelectorAll<HTMLElement>("[data-order-line]").forEach(element => { const index = Number(element.dataset.orderLine); element.querySelector<HTMLSelectElement>("[data-order-article]")!.addEventListener("change", async event => { const nextId = (event.currentTarget as HTMLSelectElement).value; const wasCompass = isCompass(sellable.find(article => String(article.id) === lines[index]!.articleId)?.article); const willBeCompass = isCompass(sellable.find(article => String(article.id) === nextId)?.article); if (willBeCompass && !wasCompass) { const decision = await confirmCompassSupplement(); if (decision === null) { drawLines(); return; } compassWithSupplement = decision; } else if (wasCompass && !willBeCompass) compassWithSupplement = null; lines[index]!.articleId = nextId; syncCompassSupplement(); drawLines(); }); element.querySelector<HTMLInputElement>("[data-order-quantity]")!.addEventListener("change", event => { const value = Number((event.currentTarget as HTMLInputElement).value); lines[index]!.quantity = Math.max(1, Number.isFinite(value) ? Math.trunc(value) : 1); syncCompassSupplement(); drawLines(); }); element.querySelector("[data-remove-order-line]")!.addEventListener("click", () => { if (isCompass(sellable.find(article => String(article.id) === lines[index]!.articleId)?.article)) compassWithSupplement = null; lines.splice(index, 1); syncCompassSupplement(); drawLines(); }); });
  };
  outlet.querySelector("#add-order-line")!.addEventListener("click", () => { const available = selectable.find(article => !lines.some(line => line.articleId === String(article.id))); if (available) { lines.push({ articleId: String(available.id), quantity: 1 }); drawLines(); } });
  drawLines();
  outlet.querySelector<HTMLFormElement>("#order-form")!.addEventListener("submit", async event => { event.preventDefault(); if (!selectedClientId) { showToast("Sélectionnez un client dans les résultats de recherche.", "error"); return; } if (!lines.length) { showToast("Ajoutez au moins un objet à la commande.", "error"); return; } const data = new FormData(event.currentTarget as HTMLFormElement); const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; try { await callRpc("creer_commande", { p_client_id: selectedClientId, p_employe_id: sessionId(), p_date_livraison: today, p_lignes: lines.map(line => ({ article_id: line.articleId, quantite: line.quantity })), p_contenu: String(data.get("notes") ?? "").trim() || null }, z.coerce.number()); showToast("Commande créée.", "success"); await renderOrders(outlet); } catch (e) { showToast(e instanceof Error ? e.message : "Création impossible", "error"); } });
  const confirmStatusChange = (title: string, description: string, confirmLabel: string): Promise<boolean> => {
    return confirmDialog({ title, description, confirmLabel, size: "small" });
  };
  outlet.querySelectorAll<HTMLButtonElement>("[data-order]").forEach(button => button.addEventListener("click", async () => { const next = button.dataset.next!; if (!await confirmStatusChange("Confirmer le changement d’état", `Passer cette commande à l’état « ${next} » ? L’action sera journalisée avec l’employé sélectionné.`, "Confirmer")) return; try { await callRpc("gerer_commande", { p_commande_id: button.dataset.order, p_employe_id: sessionId(), p_action: "Préparation terminée" }, z.null()); showToast("Commande prête à être ajoutée au panier.", "success"); await renderOrders(outlet); } catch (e) { showToast(e instanceof Error ? e.message : "Modification impossible", "error"); } }));
  outlet.querySelectorAll<HTMLAnchorElement>("[data-add-order-basket]").forEach(link => link.addEventListener("click", () => sessionStorage.setItem(orderToBasketStorageKey, link.dataset.addOrderBasket!)));
  outlet.querySelectorAll<HTMLButtonElement>("[data-cancel-order]").forEach(button => button.addEventListener("click", async () => {
    if (!await confirmDialog({ title: "Annuler la commande ?", description: `La commande de ${button.dataset.cancelLabel} restera dans l’historique avec le statut « Annulée ».`, cancelLabel: "Conserver", confirmLabel: "Confirmer l’annulation", variant: "danger", size: "small" })) return;
    try { await callRpc("gerer_commande", { p_commande_id: button.dataset.cancelOrder, p_employe_id: sessionId(), p_action: "Annulation" }, z.null()); showToast("Commande annulée et action journalisée.", "success"); await renderOrders(outlet); } catch (error) { showToast(error instanceof Error ? error.message : "Annulation impossible.", "error"); }
  }));
  outlet.querySelectorAll<HTMLButtonElement>("[data-restore-order]").forEach(button => button.addEventListener("click", async () => { const restoring = button.dataset.reverseAction === "Restauration"; if (!await confirmStatusChange(restoring ? "Restaurer la commande ?" : "Revenir à l’état précédent ?", restoring ? "La commande retrouvera l’état qu’elle avait avant son annulation." : "L’état actuel sera remplacé par l’état précédent. Cette action sera journalisée.", restoring ? "Restaurer" : "Revenir en arrière")) return; try { await callRpc("gerer_commande", { p_commande_id: button.dataset.restoreOrder, p_employe_id: sessionId(), p_action: button.dataset.reverseAction }, z.null()); showToast(restoring ? "Commande restaurée." : "Commande revenue à l’état précédent.", "success"); await renderOrders(outlet); } catch (error) { showToast(error instanceof Error ? error.message : "Retour arrière impossible.", "error"); } }));
  outlet.querySelectorAll<HTMLButtonElement>("[data-delete-order]").forEach(button => button.addEventListener("click", async () => {
    if (!await confirmDialog({ title: "Supprimer définitivement ?", description: `La commande de ${button.dataset.deleteLabel} sera supprimée de la base. Une trace restera dans le journal backend.`, cancelLabel: "Conserver", confirmLabel: "Supprimer définitivement", variant: "danger", size: "small" })) return;
    try { await callRpc("gerer_commande", { p_commande_id: button.dataset.deleteOrder, p_employe_id: sessionId(), p_action: "Suppression" }, z.null()); showToast("Commande supprimée définitivement.", "success"); await renderOrders(outlet); } catch (error) { showToast(error instanceof Error ? error.message : "Suppression impossible.", "error"); }
  }));
}

async function renderPermits(outlet: HTMLElement): Promise<void> {
  const clients = (await rows("clients_actifs", "id,nom_prenom,hibou,client_permits(id,type,status,passage_date,attempts,notes)")).sort(alphabetically);
  const typeLabels: Record<string, string> = { broomstick: "Permis balais", motorcycle: "Permis moto", car: "Permis voiture" };
  const statusLabels: Record<string, string> = { pending: "En attente", accepted: "Validé", refused: "Refusé", cancelled: "Annulé", sold: "Vendu" };
  const normalize = (value: unknown): string => String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
  outlet.innerHTML = panel("Dossiers de permis", '<div class="border-b p-4"><label for="permit-search" class="mb-2 block text-sm font-bold">Rechercher une personne</label><input id="permit-search" type="search" placeholder="Nom, prénom ou numéro de hibou…" autocomplete="off" class="min-h-12 w-full rounded-xl border bg-surface px-4" aria-describedby="permit-search-help"><p id="permit-search-help" class="mt-2 text-sm text-muted">Saisissez au moins 2 caractères pour afficher un dossier.</p></div><div id="permit-results" aria-live="polite"><p class="p-8 text-center text-muted">Aucun dossier affiché. Commencez par rechercher une personne.</p></div>');
  const results = outlet.querySelector<HTMLElement>("#permit-results")!; const search = outlet.querySelector<HTMLInputElement>("#permit-search")!;
  search.value = new URLSearchParams(location.search).get("q") ?? "";

  const openEditor = (initialClient?: Record<string, unknown>, permit?: Record<string, unknown>): void => {
    const sold = permit?.status === "sold"; let selectedClient = initialClient ?? null;
    const dialog = document.createElement("dialog"); dialog.className = "m-auto max-h-[calc(100%-2rem)] w-[min(38rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-backdrop";
    dialog.innerHTML = `<form><div class="border-b p-5"><h2 class="text-xl font-bold">${permit ? "Modifier le dossier" : "Créer un dossier"}</h2><p class="mt-1 text-sm text-muted">${sold ? "Un permis vendu est conservé en lecture seule." : `Dossier de ${escapeHtml(initialClient?.nom_prenom ?? "la personne sélectionnée")}.`}</p></div><div class="space-y-4 p-5"><div class="grid gap-3 sm:grid-cols-2"><label class="text-sm font-bold">Nom et prénom<input data-name autocomplete="off" value="${escapeHtml(initialClient?.nom_prenom ?? "")}" ${initialClient || sold ? "readonly" : ""} class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3 read-only:bg-surface-muted"></label><label class="text-sm font-bold">Hibou<input data-owl autocomplete="off" value="${escapeHtml(initialClient?.hibou ?? "")}" ${initialClient || sold ? "readonly" : ""} class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3 read-only:bg-surface-muted"></label></div><div data-client-results class="max-h-48 overflow-y-auto rounded-xl border" hidden></div><p data-client-status class="text-sm text-muted">${initialClient ? `Personne sélectionnée : ${escapeHtml(initialClient.nom_prenom)}` : "Sélectionnez un client dans les résultats."}</p><div class="grid gap-3 sm:grid-cols-2"><label class="text-sm font-bold">Type de permis<select data-type ${sold ? "disabled" : ""} class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3">${Object.entries(typeLabels).map(([value, label]) => `<option value="${value}" ${permit?.type === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="text-sm font-bold">État actuel<select data-status ${sold ? "disabled" : ""} class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3">${Object.entries(statusLabels).filter(([value]) => value !== "sold" || sold).map(([value, label]) => `<option value="${value}" ${permit?.status === value ? "selected" : ""}>${label}</option>`).join("")}</select></label></div></div><div class="flex justify-end gap-3 border-t p-4"><button type="button" data-cancel class="min-h-11 rounded-xl border px-4 font-bold">${sold ? "Fermer" : "Annuler"}</button>${sold ? "" : '<button data-save disabled class="min-h-11 rounded-xl bg-brand px-4 font-bold text-white disabled:opacity-40">Enregistrer</button>'}</div></form>`;
    document.body.append(dialog); const name = dialog.querySelector<HTMLInputElement>("[data-name]")!; const owl = dialog.querySelector<HTMLInputElement>("[data-owl]")!; const found = dialog.querySelector<HTMLElement>("[data-client-results]")!; const clientStatus = dialog.querySelector<HTMLElement>("[data-client-status]")!; const save = dialog.querySelector<HTMLButtonElement>("[data-save]");
    const updateSave = (): void => { if (save) save.disabled = !selectedClient; };
    const find = async (field: "name" | "owl", term: string): Promise<void> => { selectedClient = null; updateSave(); if (!term || (field === "name" && term.length < 3)) { found.hidden = true; return; } try { const matches = await searchClients(term, field); found.hidden = false; found.innerHTML = matches.length ? matches.map(client => `<button type="button" data-client="${escapeHtml(client.id)}" class="flex min-h-12 w-full justify-between border-b px-3 py-2 text-left"><strong>${escapeHtml(client.nom_prenom)}</strong><span class="text-muted">${escapeHtml(client.hibou ?? "Sans hibou")}</span></button>`).join("") : '<p class="p-3 text-muted">Aucun client trouvé.</p>'; found.querySelectorAll<HTMLButtonElement>("[data-client]").forEach(button => button.addEventListener("click", () => { selectedClient = matches.find(client => String(client.id) === button.dataset.client)!; name.value = String(selectedClient.nom_prenom ?? ""); owl.value = String(selectedClient.hibou ?? ""); found.hidden = true; clientStatus.textContent = `Client sélectionné : ${String(selectedClient.nom_prenom ?? "")}`; updateSave(); })); } catch (error) { clientStatus.textContent = error instanceof Error ? error.message : "Recherche impossible."; } };
    name.addEventListener("input", () => void find("name", name.value.trim())); owl.addEventListener("input", () => void find("owl", owl.value.trim()));
    const close = (): void => { dialog.close(); dialog.remove(); }; dialog.querySelector("[data-cancel]")!.addEventListener("click", close); dialog.addEventListener("cancel", event => { event.preventDefault(); close(); }, { once: true });
    dialog.querySelector("form")!.addEventListener("submit", async event => { event.preventDefault(); if (!selectedClient || sold) return; if (permit && !await confirmAction("Confirmer la modification", "L’état actuel du permis sera remplacé et l’action sera journalisée avec l’employé sélectionné.")) return; try { await callRpc("enregistrer_client_permit", { p_permit_id: permit?.id ?? null, p_client_id: selectedClient.id, p_type: dialog.querySelector<HTMLSelectElement>("[data-type]")!.value, p_status: dialog.querySelector<HTMLSelectElement>("[data-status]")!.value, p_employe_id: sessionId() }, z.coerce.number()); close(); showToast(permit ? "Dossier modifié et journalisé." : "Dossier créé et journalisé.", "success"); await renderPermits(outlet); } catch (error) { showToast(error instanceof Error ? error.message : "Enregistrement impossible.", "error"); } });
    updateSave(); dialog.showModal(); if (!initialClient) name.focus();
  };

  const draw = (): void => {
    const term = normalize(search.value.trim());
    if (term.length < 2) {
      results.innerHTML = '<p class="p-8 text-center text-muted">Aucun dossier affiché. Saisissez au moins 2 caractères.</p>';
      return;
    }
    const filtered = clients.filter(client => normalize(`${client.nom_prenom} ${client.hibou}`).includes(term));
    results.innerHTML = filtered.length ? `<div class="divide-y">${filtered.map(client => {
      const permits = ((client.client_permits as Record<string, unknown>[] | null) ?? []).sort((left, right) => String(typeLabels[String(left.type)]).localeCompare(String(typeLabels[String(right.type)]), "fr"));
      return `<section class="p-4 sm:p-5"><div><strong class="text-lg">${escapeHtml(client.nom_prenom)}</strong><span class="mt-1 block text-sm text-muted">Hibou ${escapeHtml(client.hibou ?? "—")}</span></div>${permits.length ? `<div class="mt-4 grid gap-2">${permits.map(permit => `<div class="flex min-h-12 items-start justify-between gap-3 rounded-xl border p-3"><span><strong>${escapeHtml(typeLabels[String(permit.type)] ?? permit.type)}</strong><span class="ml-2 text-sm text-muted">${escapeHtml(statusLabels[String(permit.status)] ?? permit.status)}</span><span class="mt-1 block text-sm text-muted">${permit.passage_date ? `Dernier passage : ${new Date(`${permit.passage_date}T12:00:00`).toLocaleDateString("fr-FR")} · ` : ""}${escapeHtml(permit.attempts ?? 1)} tentative(s)</span>${permit.notes ? `<span class="mt-1 block text-sm">${escapeHtml(permit.notes)}</span>` : ""}</span><button data-edit-permit="${escapeHtml(permit.id)}" data-client-id="${escapeHtml(client.id)}" class="grid size-10 shrink-0 place-items-center rounded-lg border text-accent" aria-label="Modifier le permis de ${escapeHtml(client.nom_prenom)}" title="Modifier">${icon("edit", "size-5")}</button></div>`).join("")}</div>` : '<p class="mt-4 rounded-xl bg-surface-muted p-3 text-sm text-muted">Cette personne ne possède encore aucun dossier de permis.</p>'}</section>`;
    }).join("")}</div>` : '<p class="p-8 text-center text-muted">Aucune personne correspondante.</p>';
    results.querySelectorAll<HTMLButtonElement>("[data-edit-permit]").forEach(button => button.addEventListener("click", () => { const client = clients.find(item => String(item.id) === button.dataset.clientId)!; const permit = ((client.client_permits as Record<string, unknown>[] | null) ?? []).find(item => String(item.id) === button.dataset.editPermit)!; openEditor(client, permit); }));
  };
  search.addEventListener("input", draw);
  draw();
}

async function renderAudit(outlet: HTMLElement): Promise<void> {
  const entries = (await rows("journal_actions", "*,clients(nom_prenom)")).sort((left, right) => new Date(String(right.created_at)).getTime() - new Date(String(left.created_at)).getTime());
  const employees = [...new Set(entries.map(entry => String(entry.employe_nom)))].sort((left, right) => left.localeCompare(right, "fr", { sensitivity: "base" }));
  const actions = [...new Set(entries.map(entry => String(entry.action)))].sort((left, right) => left.localeCompare(right, "fr", { sensitivity: "base" }));
  const entities = [...new Set(entries.map(entry => String(entry.entite_type)))].sort((left, right) => left.localeCompare(right, "fr", { sensitivity: "base" }));
  outlet.innerHTML = panel("Journal des actions sensibles", `<div class="grid gap-3 border-b p-4 sm:grid-cols-2 xl:grid-cols-4"><input id="audit-search" type="search" placeholder="Rechercher…" class="min-h-11 rounded-xl border bg-surface px-3" aria-label="Rechercher dans le journal"><select id="audit-employee" aria-label="Filtrer le journal par employé" class="min-h-11 rounded-xl border bg-surface px-3"><option value="">Tous les employés</option>${employees.map(name => `<option>${escapeHtml(name)}</option>`).join("")}</select><select id="audit-action" aria-label="Filtrer le journal par action" class="min-h-11 rounded-xl border bg-surface px-3"><option value="">Toutes les actions</option>${actions.map(action => `<option>${escapeHtml(action)}</option>`).join("")}</select><select id="audit-entity" aria-label="Filtrer le journal par type d’entité" class="min-h-11 rounded-xl border bg-surface px-3"><option value="">Toutes les entités</option>${entities.map(entity => `<option>${escapeHtml(entity)}</option>`).join("")}</select></div><p id="audit-count" class="border-b px-4 py-3 text-sm text-muted" aria-live="polite"></p><div id="audit-list"></div>`);
  const search = outlet.querySelector<HTMLInputElement>("#audit-search")!; const employee = outlet.querySelector<HTMLSelectElement>("#audit-employee")!; const action = outlet.querySelector<HTMLSelectElement>("#audit-action")!; const entity = outlet.querySelector<HTMLSelectElement>("#audit-entity")!; const list = outlet.querySelector<HTMLElement>("#audit-list")!;
  const draw = (): void => { const term = search.value.trim().toLocaleLowerCase("fr"); const filtered = entries.filter(entry => { const client = entry.clients as Record<string, unknown> | null; return (!employee.value || entry.employe_nom === employee.value) && (!action.value || entry.action === action.value) && (!entity.value || entry.entite_type === entity.value) && (!term || `${entry.employe_nom} ${entry.action} ${entry.element ?? entry.libelle} ${entry.entite_type} ${client?.nom_prenom ?? ""}`.toLocaleLowerCase("fr").includes(term)); }); outlet.querySelector<HTMLElement>("#audit-count")!.textContent = `${filtered.length} résultat${filtered.length > 1 ? "s" : ""} sur ${entries.length}`; list.innerHTML = table(["Date", "Employé", "Action", "Élément", "Client", "Résultat", "Détails"], filtered.map(entry => { const client = entry.clients as Record<string, unknown> | null; return [new Date(String(entry.created_at)).toLocaleString("fr-FR"), escapeHtml(entry.employe_nom), escapeHtml(entry.action), escapeHtml(entry.element ?? entry.libelle), escapeHtml(client?.nom_prenom ?? "—"), escapeHtml(entry.resultat), `<details><summary class="cursor-pointer font-bold text-accent">Voir</summary><pre class="mt-2 max-w-xl overflow-auto whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-xs">${escapeHtml(JSON.stringify({ avant: entry.etat_avant, apres: entry.etat_apres, metadata: entry.metadata }, null, 2))}</pre></details>`]; })); };
  [search, employee, action, entity].forEach(control => control.addEventListener("input", draw)); draw();
}

async function renderDirection(outlet: HTMLElement): Promise<void> {
  const domains = [
    { id: "pilotage", label: "Pilotage", icon: "pulse", description: "Suivre les actions sensibles et contrôler l’activité." },
    { id: "finances", label: "Finances", icon: "chart", description: "Analyser les résultats, les périodes et les frais." },
    { id: "equipe", label: "Paramètres", icon: "badge", description: "Gérer les employés et les règles de l’ERP." },
    { id: "offre", label: "Offre & stocks", icon: "boxes", description: "Maintenir catalogue, recettes et quantités." }
  ] as const;
  outlet.innerHTML = `<section class="mb-5" aria-labelledby="direction-workspace-title"><p class="text-sm font-bold text-accent">Poste de pilotage</p><h2 id="direction-workspace-title" class="mt-1 text-2xl font-black">Toute la Direction, au même endroit</h2><p class="mt-2 max-w-3xl text-muted">Les outils sont regroupés par responsabilité métier pour éviter de multiplier les pages et les entrées de menu.</p></section><div class="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="tablist" aria-label="Domaines de la Direction">${domains.map((domain, index) => `<button type="button" role="tab" data-direction-domain="${domain.id}" aria-selected="${index === 0}" class="min-h-28 rounded-2xl border bg-surface p-4 text-left shadow-[var(--shadow-panel)] hover:border-accent"><span class="flex items-center gap-2 font-bold text-ink">${icon(domain.icon, "size-5 text-accent")} ${domain.label}</span><span class="mt-2 block text-sm text-muted">${domain.description}</span></button>`).join("")}</div><div id="direction-domain-content" role="tabpanel" aria-live="polite"></div>`;
  const content = outlet.querySelector<HTMLElement>("#direction-domain-content")!;
  const buttons = [...outlet.querySelectorAll<HTMLButtonElement>("[data-direction-domain]")];
  const renderDomain = async (domainId: string): Promise<void> => {
    buttons.forEach(button => {
      const selected = button.dataset.directionDomain === domainId;
      button.setAttribute("aria-selected", String(selected));
      button.classList.toggle("border-accent", selected);
      button.classList.toggle("ring-2", selected);
      button.classList.toggle("ring-brand/20", selected);
    });
    if (domainId === "pilotage") { content.innerHTML = asyncState("loading"); await renderAudit(content); return; }
    const domain = domains.find(item => item.id === domainId)!;
    const responsibilities = domainId === "finances"
      ? [["Synthèse financière", "Résultats et périodes comptables"], ["Frais", "Saisie et suivi des dépenses"]]
      : domainId === "equipe"
        ? [["Employés", "Équipe, grades et notes"], ["ERP", "Rémunérations, taxe et accès Direction"]]
        : [["Catalogue", "Articles et tarifs"], ["Recettes", "Composition des fabrications"], ["Stocks", "Quantités et seuils"]];
    content.innerHTML = panel(domain.label, `<div class="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">${responsibilities.map(([title, description]) => `<section class="rounded-xl bg-surface-muted p-4"><h3 class="font-bold">${title}</h3><p class="mt-1 text-sm text-muted">${description}</p><p class="mt-4 text-xs font-bold uppercase tracking-wide text-accent">Fonction à intégrer</p></section>`).join("")}</div>`);
  };
  buttons.forEach(button => button.addEventListener("click", () => void renderDomain(button.dataset.directionDomain!)));
  await renderDomain("pilotage");
}

async function renderTreasury(outlet: HTMLElement): Promise<void> {
  const [current, historyRows] = await Promise.all([rows("tresorerie_courante"), rows("registre_tresorerie", "*,employes(nom_prenom)")]);
  const theoretical = Number(current[0]?.montant_theorique ?? 0);
  const history = historyRows.sort((left, right) => new Date(String(right.created_at)).getTime() - new Date(String(left.created_at)).getTime());
  outlet.innerHTML = `${panel("Trésorerie actuelle", `<div class="p-5"><p class="text-sm text-muted">Montant théorique</p><p class="mt-1 text-3xl font-black">${money.format(theoretical)} PO</p><form id="treasury-form" class="mt-6 grid gap-4 sm:grid-cols-[12rem_1fr_auto]"><label class="text-sm font-bold">Montant constaté<input name="amount" type="number" value="${theoretical}" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"></label><label class="text-sm font-bold">Note<input name="notes" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"></label><button class="mt-auto min-h-11 rounded-xl bg-brand px-5 font-bold text-white">Enregistrer</button></form></div>`)}<div class="mt-5">${panel("Contrôles précédents", table(["Date et heure", "Employé", "Théorique", "Constaté", "Écart", "Note"], history.map(record => { const employee = record.employes as Record<string, unknown> | null; return [new Date(String(record.created_at)).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }), escapeHtml(employee?.nom_prenom ?? "Employé inconnu"), money.format(Number(record.treso_theorique)), money.format(Number(record.montant_saisi)), money.format(Number(record.ecart)), escapeHtml(record.notes)]; })))}</div>`;
  outlet.querySelector<HTMLFormElement>("#treasury-form")!.addEventListener("submit", async event => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); try { await callRpc("enregistrer_controle_tresorerie", { p_employe_id: sessionId(), p_montant_saisi: Number(data.get("amount")), p_notes: data.get("notes") }, z.coerce.number()); showToast("Contrôle enregistré.", "success"); await renderTreasury(outlet); } catch (e) { showToast(e instanceof Error ? e.message : "Contrôle impossible", "error"); } });
}

async function renderManagement(outlet: HTMLElement): Promise<void> {
  outlet.innerHTML = `<div class="management-workspace grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]"><div class="management-treasury" data-management-treasury></div><div class="management-clients" data-management-clients></div></div>`;
  const treasuryRoot = outlet.querySelector<HTMLElement>("[data-management-treasury]")!;
  const clientsRoot = outlet.querySelector<HTMLElement>("[data-management-clients]")!;
  await Promise.all([renderTreasury(treasuryRoot), renderSimple(clientsRoot, "clients")]);
}

async function renderSimple(outlet: HTMLElement, pageId: string): Promise<void> {
  if (pageId === "clients") {
    const data = (await rows("clients_actifs")).sort(alphabetically);
    const normalize = (value: unknown): string => String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
    outlet.innerHTML = panel("Fichier client", '<div class="border-b p-4"><input id="client-search" type="search" placeholder="Rechercher par nom ou hibou…" class="min-h-11 w-full rounded-xl border bg-surface px-4" aria-label="Rechercher un client"></div><div id="client-list" class="max-h-[36rem] overflow-y-auto lg:max-h-none"></div>', '<button type="button" data-add-client class="min-h-11 rounded-xl bg-brand px-4 font-bold text-white">Ajouter un client</button>');
    const list = outlet.querySelector<HTMLElement>("#client-list")!; const search = outlet.querySelector<HTMLInputElement>("#client-search")!;
    const openClientEditor = (client: Record<string, unknown>): void => {
      const dialog = document.createElement("dialog"); dialog.className = "m-auto w-[min(34rem,calc(100%-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-backdrop";
      dialog.innerHTML = `<form><div class="border-b p-5"><h2 class="text-xl font-bold">Modifier le client</h2><p class="mt-1 text-sm text-muted">La modification sera enregistrée dans le journal.</p></div><div class="grid gap-4 p-5 sm:grid-cols-2"><label class="text-sm font-bold">Nom et prénom<input name="name" required value="${escapeHtml(client.nom_prenom)}" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"></label><label class="text-sm font-bold">Hibou<input name="owl" value="${escapeHtml(client.hibou ?? "")}" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"></label></div><div class="flex justify-end gap-3 border-t p-4"><button type="button" data-cancel class="min-h-11 rounded-xl border px-4 font-bold">Annuler</button><button class="min-h-11 rounded-xl bg-brand px-4 font-bold text-white">Enregistrer</button></div></form>`;
      document.body.append(dialog); const close = (): void => { dialog.close(); dialog.remove(); }; dialog.querySelector("[data-cancel]")!.addEventListener("click", close);
      dialog.querySelector("form")!.addEventListener("submit", async event => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); if (!await confirmAction("Confirmer la modification", "Le nom ou le hibou du client sera modifié et l’action sera journalisée.")) return; try { await callRpc("modifier_client", { p_client_id: client.id, p_nom_prenom: String(form.get("name")), p_hibou: String(form.get("owl")), p_employe_id: sessionId() }, z.coerce.number()); close(); showToast("Client modifié et action journalisée.", "success"); await renderSimple(outlet, pageId); } catch (error) { showToast(error instanceof Error ? error.message : "Modification impossible.", "error"); } });
      dialog.showModal();
    };
    const openArchiveDialog = (client: Record<string, unknown>): void => {
      const dialog = document.createElement("dialog"); dialog.className = "m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-backdrop";
      dialog.innerHTML = `<div class="border-b p-5"><h2 class="text-xl font-bold">Archiver ${escapeHtml(client.nom_prenom)} ?</h2><p class="mt-2 text-sm text-muted">Le client ne sera plus proposé dans les recherches opérationnelles. L’action restera journalisée.</p></div><div class="p-5"><label class="text-sm font-bold">Motif<select data-reason class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"><option value="departure">Départ</option><option value="death">Mort</option><option value="other">Autre</option></select></label></div><div class="flex justify-end gap-3 border-t p-4"><button data-cancel class="min-h-11 rounded-xl border px-4 font-bold">Annuler</button><button data-confirm class="min-h-11 rounded-xl bg-danger px-4 font-bold text-white">Archiver</button></div>`;
      document.body.append(dialog); const close = (): void => { dialog.close(); dialog.remove(); }; dialog.querySelector("[data-cancel]")!.addEventListener("click", close); dialog.querySelector("[data-confirm]")!.addEventListener("click", async () => { try { await callRpc("archiver_client", { p_client_id: client.id, p_reason: dialog.querySelector<HTMLSelectElement>("[data-reason]")!.value, p_employe_id: sessionId() }, z.coerce.number()); close(); showToast("Client archivé et action journalisée.", "success"); await renderSimple(outlet, pageId); } catch (error) { showToast(error instanceof Error ? error.message : "Archivage impossible.", "error"); } }); dialog.showModal();
    };
    const drawClients = (): void => { const term = normalize(search.value.trim()); const filtered = data.filter(client => !term || normalize(client.nom_prenom).includes(term) || normalize(client.hibou).includes(term)); list.innerHTML = table(["Nom et prénom", "Hibou", "Actions"], filtered.map(r => [escapeHtml(r.nom_prenom), escapeHtml(r.hibou ?? "—"), `<div class="flex justify-end gap-2"><button data-edit-client="${escapeHtml(r.id)}" class="grid size-10 place-items-center rounded-lg border text-accent" aria-label="Modifier ${escapeHtml(r.nom_prenom)}" title="Modifier">${icon("edit", "size-5")}</button><button data-archive-client="${escapeHtml(r.id)}" class="grid size-10 place-items-center rounded-lg border text-danger" aria-label="Archiver ${escapeHtml(r.nom_prenom)}" title="Archiver">${icon("archive", "size-5")}</button></div>`])); list.querySelectorAll<HTMLButtonElement>("[data-edit-client]").forEach(button => button.addEventListener("click", () => openClientEditor(data.find(client => String(client.id) === button.dataset.editClient)!))); list.querySelectorAll<HTMLButtonElement>("[data-archive-client]").forEach(button => button.addEventListener("click", () => openArchiveDialog(data.find(client => String(client.id) === button.dataset.archiveClient)!))); };
    search.addEventListener("input", drawClients); drawClients();
    outlet.querySelector<HTMLButtonElement>("[data-add-client]")!.addEventListener("click", () => {
      const dialog = document.createElement("dialog");
      dialog.className = "m-auto w-[min(34rem,calc(100%-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-backdrop";
      dialog.innerHTML = `<form data-create-client><div class="border-b p-5"><h2 class="text-xl font-bold">Ajouter un client</h2><p class="mt-1 text-sm text-muted">Renseignez les informations puis validez la création.</p></div><div class="grid gap-4 p-5 sm:grid-cols-2"><label class="text-sm font-bold">Nom et prénom<input name="name" type="text" required minlength="2" autocomplete="name" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"></label><label class="text-sm font-bold">Hibou<input name="owl" type="text" required inputmode="numeric" pattern="[0-9]{2,5}" minlength="2" maxlength="5" autocomplete="off" aria-describedby="new-client-owl-help" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"><span id="new-client-owl-help" class="mt-1 block text-xs font-normal text-muted">Entre 2 et 5 chiffres.</span></label></div><div class="flex flex-col-reverse gap-3 border-t p-4 sm:flex-row sm:justify-end"><button type="button" data-cancel class="min-h-11 rounded-xl border px-4 font-bold">Annuler</button><button class="min-h-11 rounded-xl bg-brand px-4 font-bold text-white">Valider la création</button></div></form>`;
      document.body.append(dialog);
      const form = dialog.querySelector<HTMLFormElement>("[data-create-client]")!;
      const nameInput = form.elements.namedItem("name") as HTMLInputElement;
      const owlInput = form.elements.namedItem("owl") as HTMLInputElement;
      const close = (): void => { dialog.close(); dialog.remove(); };
      dialog.querySelector<HTMLButtonElement>("[data-cancel]")!.addEventListener("click", close);
      dialog.addEventListener("cancel", event => { event.preventDefault(); close(); }, { once: true });
      form.addEventListener("submit", async event => {
        event.preventDefault();
        nameInput.setCustomValidity(""); owlInput.setCustomValidity("");
        const parsed = newClientSchema.safeParse({ name: nameInput.value, owl: owlInput.value });
        if (!parsed.success) {
          const invalidFields = new Set(parsed.error.issues.map(issue => issue.path[0]));
          if (invalidFields.has("name")) nameInput.setCustomValidity("Saisissez un nom et un prénom en lettres (2 caractères minimum).");
          if (invalidFields.has("owl")) owlInput.setCustomValidity("Saisissez un hibou composé de 2 à 5 chiffres.");
          form.reportValidity();
          return;
        }
        const submit = form.querySelector<HTMLButtonElement>("button:not([type])")!;
        submit.disabled = true;
        try {
          await callRpc("creer_client", { p_nom_prenom: parsed.data.name, p_hibou: parsed.data.owl, p_employe_id: sessionId() }, z.coerce.number());
          close(); showToast("Client ajouté et action journalisée.", "success"); await renderSimple(outlet, pageId);
        } catch (error) {
          submit.disabled = false;
          showToast(error instanceof Error ? error.message : "Création impossible.", "error");
        }
      });
      dialog.showModal();
      nameInput.focus();
    });
  }
}

async function renderDashboard(outlet: HTMLElement): Promise<void> {
  const employee = readEmployeeSession(); if (!employee) throw new Error("Sélectionnez un employé.");
  const [performance, transactions, fabrications] = await Promise.all([
    employeeRows("performances_employes", employee.employeeId),
    employeeRows("transactions_courantes", employee.employeeId, "*", "vendeur_id"),
    employeeRows("fabrications", employee.employeeId)
  ]);
  const stats = performance[0] ?? {}; const buybacks = transactions.filter(item => item.type_transaction === "Achat");
  const craftQuantity = fabrications.reduce((sum, item) => sum + Number(item.quantite_produite), 0); const buybackTotal = -buybacks.reduce((sum, item) => sum + Number(item.prix_total), 0);
  const cards = [["Chiffre d’affaires", `${money.format(Number(stats.ca_realise ?? 0))} PO`], ["Bénéfice", `${money.format(Number(stats.benefice_realise ?? 0))} PO`], ["Articles vendus", String(stats.articles_vendus ?? 0)], ["Unités fabriquées", String(craftQuantity)], ["Rachats de la période", `${money.format(buybackTotal)} PO`]];
  outlet.innerHTML = `<div class="mb-5"><p class="text-sm font-bold text-accent">Employé</p><h2 class="text-2xl font-black">${escapeHtml(employee.employeeName)}</h2><p class="mt-2 text-sm text-muted">Vue générale de votre activité sur la période en cours.</p></div><div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">${cards.map(([label, value]) => `<div class="rounded-2xl border bg-surface p-4 shadow-[var(--shadow-panel)]"><p class="text-sm text-muted">${label}</p><strong class="mt-1 block text-xl">${value}</strong></div>`).join("")}</div>`;
}

export async function mountOperationsPage(outlet: HTMLElement, pageId: string): Promise<() => void> {
  let active = true; outlet.innerHTML = asyncState("loading");
  try {
    if (pageId === "craft") await renderCraft(outlet);
    else if (pageId === "rachat") await renderPurchase(outlet);
    else if (pageId === "commandes") await renderOrders(outlet);
    else if (pageId === "permis") await renderPermits(outlet);
    else if (pageId === "gestion") await renderManagement(outlet);
    else if (pageId === "tresorerie") await renderTreasury(outlet);
    else if (pageId === "clients") await renderSimple(outlet, pageId);
    else if (pageId === "dashboard") await renderDashboard(outlet);
    else if (pageId === "direction") await renderDirection(outlet);
    else outlet.innerHTML = panel("Fonction à venir", '<p class="p-6 text-muted">Cette fonction appartient au futur espace Direction.</p>');
  } catch (error) { if (active) { outlet.innerHTML = asyncState("error", error instanceof Error ? error.message : undefined, "Réessayer"); bindRetry(outlet, () => void mountOperationsPage(outlet, pageId)); } }
  labelTableControls(outlet);
  const handleEmployeeChange = (): void => {
    if (!active) return;
    if (pageId === "dashboard") void renderDashboard(outlet);
    else if (pageId === "craft") void renderCraft(outlet);
  };
  window.addEventListener("ombrelune:employee-change", handleEmployeeChange);
  return () => { active = false; window.removeEventListener("ombrelune:employee-change", handleEmployeeChange); };
}
