import { z } from "zod";
import { readEmployeeSession } from "../../core/employee-session";
import { callRpc, getSupabaseClient } from "../../data/supabase";
import { asyncState, bindRetry } from "../../ui/components/async-state";
import { showToast } from "../../ui/components/toast";
import { escapeHtml } from "../../ui/html";
import { panel } from "../../ui/components/panel";
import { labelTableControls, responsiveTable } from "../../ui/components/responsive-table";
import { withPending } from "../../ui/components/pending";

type Row = Record<string, unknown>;
type Tab = { id: string; label: string };

const rowSchema = z.record(z.string(), z.unknown());
const money = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const date = (value: unknown): string => value ? new Date(String(value)).toLocaleDateString("fr-FR") : "—";
const table = responsiveTable;
const field = "min-h-11 w-full rounded-xl border bg-surface px-3 text-ink";
const button = "min-h-11 rounded-xl bg-brand px-4 font-bold text-white disabled:opacity-40";

async function rows(source: string, select = "*"): Promise<Row[]> {
  const { data, error } = await getSupabaseClient().from(source).select(select);
  if (error) throw new Error(error.message);
  return z.array(rowSchema).parse(data);
}

async function mutate(request: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await request;
  if (error) throw new Error(error.message);
}

function employeeId(): string | number {
  const session = readEmployeeSession();
  if (!session) throw new Error("Sélectionnez un employé.");
  return session.employeeId;
}

function tabs(outlet: HTMLElement, items: Tab[], render: (id: string, content: HTMLElement) => Promise<void>): void {
  outlet.innerHTML = `<div class="mb-6 flex gap-2 overflow-x-auto border-b" role="tablist" aria-label="Sections de la page">${items.map((item, index) => `<button id="direction-tab-${item.id}" type="button" role="tab" data-tab="${item.id}" aria-controls="direction-tab-panel" aria-selected="${index === 0}" tabindex="${index ? -1 : 0}" class="min-h-11 shrink-0 border-b-2 px-4 font-bold ${index ? "border-transparent text-muted" : "border-brand text-brand"}">${escapeHtml(item.label)}</button>`).join("")}</div><div id="direction-tab-panel" role="tabpanel" tabindex="0" aria-labelledby="direction-tab-${items[0]!.id}"></div>`;
  const content = outlet.querySelector<HTMLElement>("#direction-tab-panel")!;
  const controls = [...outlet.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  let selectionId = 0;
  const select = async (id: string): Promise<void> => {
    const currentSelection = ++selectionId;
    controls.forEach(control => {
      const active = control.dataset.tab === id;
      control.setAttribute("aria-selected", String(active));
      control.tabIndex = active ? 0 : -1;
      control.classList.toggle("border-brand", active); control.classList.toggle("text-brand", active);
      control.classList.toggle("border-transparent", !active); control.classList.toggle("text-muted", !active);
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
    event.preventDefault(); controls[next]!.focus(); void select(controls[next]!.dataset.tab!);
  }));
  void select(items[0]!.id);
}

async function renderLogs(outlet: HTMLElement): Promise<void> {
  const pageSize = 25;
  let page = 1;
  let entries: Row[] = [];
  let total = 0;
  outlet.innerHTML = panel("Journal d’activité", `<div class="border-b p-4"><button type="button" data-filter-toggle aria-expanded="false" aria-controls="log-filters" class="flex min-h-11 w-full items-center justify-between rounded-xl border px-4 font-bold md:hidden"><span>Afficher les filtres</span><span aria-hidden="true">＋</span></button><div id="log-filters" data-filter-panel class="mt-3 hidden gap-3 md:mt-0 md:grid md:grid-cols-2"><input data-search type="search" placeholder="Élément, client…" class="${field}" aria-label="Recherche libre"><select data-employee aria-label="Filtrer par employé" class="${field}"><option value="">Tous les employés</option></select><select data-type aria-label="Filtrer par type d’entité" class="${field}"><option value="">Tous les types</option></select><select data-action aria-label="Filtrer par action" class="${field}"><option value="">Toutes les actions</option></select><div class="grid grid-cols-2 gap-3 md:col-span-2"><label class="text-xs font-bold text-muted">Depuis<input data-from type="date" class="mt-1 ${field}"></label><label class="text-xs font-bold text-muted">Jusqu’au<input data-to type="date" class="mt-1 ${field}"></label></div><button type="button" data-reset class="min-h-11 rounded-xl border px-4 font-bold md:col-span-2">Réinitialiser les filtres</button></div></div><p data-count class="border-b px-4 py-3 text-sm text-muted" aria-live="polite"></p><div data-list></div><nav data-pagination class="flex items-center justify-between gap-3 border-t p-4" aria-label="Pagination du journal"><button type="button" data-previous class="min-h-11 rounded-xl border px-4 font-bold disabled:opacity-40">Précédent</button><span data-page class="text-sm font-bold"></span><button type="button" data-next class="min-h-11 rounded-xl border px-4 font-bold disabled:opacity-40">Suivant</button></nav>`);
  const get = (selector: string): HTMLInputElement | HTMLSelectElement => outlet.querySelector(selector)!;
  const list = outlet.querySelector<HTMLElement>("[data-list]")!; const count = outlet.querySelector<HTMLElement>("[data-count]")!;
  const openDetails = (entry: Row, trigger: HTMLButtonElement): void => {
    const client = entry.clients as Row | null;
    const dialog = document.createElement("dialog");
    dialog.className = "m-auto max-h-[calc(100dvh-2rem)] w-[min(52rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-slate-950/70";
    const facts = [
      ["Date", new Date(String(entry.created_at)).toLocaleString("fr-FR")],
      ["Employé", entry.employe_nom],
      ["Action", entry.action],
      ["Type", entry.entite_type],
      ["Élément", entry.element ?? entry.libelle],
      ["Client", client?.nom_prenom ?? "—"],
      ["Résultat", entry.resultat]
    ];
    dialog.innerHTML = `<div class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-surface p-5"><div><p class="text-sm font-bold text-brand">Journal d’activité</p><h2 class="mt-1 text-xl font-bold">Détails de l’action</h2></div><button type="button" data-close class="grid size-11 shrink-0 place-items-center rounded-xl border" aria-label="Fermer">×</button></div><div class="p-5"><dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">${facts.map(([label, value]) => `<div><dt class="text-xs font-bold uppercase tracking-wide text-muted">${escapeHtml(label)}</dt><dd class="mt-1 break-words font-semibold">${escapeHtml(value ?? "—")}</dd></div>`).join("")}</dl><section class="mt-6 border-t pt-5" aria-labelledby="log-technical-details"><h3 id="log-technical-details" class="font-bold">Détails</h3><div class="mt-3 grid gap-4 lg:grid-cols-3">${[["Avant", entry.etat_avant], ["Après", entry.etat_apres], ["Métadonnées", entry.metadata]].map(([label, value]) => `<div class="min-w-0"><h4 class="text-sm font-bold text-muted">${label}</h4><pre class="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-muted p-4 text-xs">${escapeHtml(JSON.stringify(value ?? null, null, 2))}</pre></div>`).join("")}</div></section></div><div class="sticky bottom-0 flex justify-end border-t bg-surface p-4"><button type="button" data-close class="min-h-11 rounded-xl bg-brand px-5 font-bold text-white">Fermer</button></div>`;
    document.body.append(dialog);
    const close = (): void => dialog.close();
    dialog.querySelectorAll<HTMLButtonElement>("[data-close]").forEach(button => button.addEventListener("click", close));
    dialog.addEventListener("close", () => { dialog.remove(); trigger.focus(); }, { once: true });
    dialog.showModal();
  };
  const draw = (): void => {
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const first = total ? (page - 1) * pageSize + 1 : 0;
    const last = Math.min(page * pageSize, total);
    count.textContent = total ? `Actions ${first} à ${last} sur ${total}` : "Aucune action correspondante";
    list.innerHTML = table(["Date", "Employé", "Action", "Type", "Élément", "Résultat", "Détails"], entries.map((entry, index) => [new Date(String(entry.created_at)).toLocaleString("fr-FR"), escapeHtml(entry.employe_nom), escapeHtml(entry.action), escapeHtml(entry.entite_type), escapeHtml(entry.element ?? entry.libelle), escapeHtml(entry.resultat), `<button type="button" data-log-details="${index}" class="inline-flex min-h-11 items-center rounded-xl border border-brand px-3 font-bold text-brand hover:bg-surface-muted" aria-label="Voir les détails de ${escapeHtml(entry.action)}">Voir</button>`]));
    list.querySelectorAll<HTMLButtonElement>("[data-log-details]").forEach(button => button.addEventListener("click", () => openDetails(entries[Number(button.dataset.logDetails)]!, button)));
    outlet.querySelector<HTMLElement>("[data-page]")!.textContent = `Page ${page} sur ${pageCount}`;
    outlet.querySelector<HTMLButtonElement>("[data-previous]")!.disabled = page <= 1;
    outlet.querySelector<HTMLButtonElement>("[data-next]")!.disabled = page >= pageCount;
    labelTableControls(list);
  };
  const pageSchema = z.object({ entries: z.array(rowSchema), total: z.coerce.number().int().nonnegative(), employees: z.array(z.string()), actions: z.array(z.string()), entity_types: z.array(z.string()) });
  const fillOptions = (selector: string, values: string[]): void => {
    const select = get(selector) as HTMLSelectElement;
    const current = select.value;
    const first = select.options[0]!.outerHTML;
    select.innerHTML = `${first}${values.map(value => `<option>${escapeHtml(value)}</option>`).join("")}`;
    select.value = current;
  };
  const load = async (): Promise<void> => {
    list.innerHTML = asyncState("loading");
    const { data, error } = await getSupabaseClient().rpc("lister_journal_actions", { p_page: page, p_page_size: pageSize, p_recherche: get("[data-search]").value, p_employe: get("[data-employee]").value, p_type: get("[data-type]").value, p_action: get("[data-action]").value, p_depuis: get("[data-from]").value || null, p_jusqu_a: get("[data-to]").value || null });
    if (error) throw new Error(error.message);
    const result = pageSchema.parse(data);
    entries = result.entries; total = result.total;
    fillOptions("[data-employee]", result.employees); fillOptions("[data-type]", result.entity_types); fillOptions("[data-action]", result.actions);
    draw();
  };
  let searchTimer: number | undefined;
  get("[data-search]").addEventListener("input", () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => { page = 1; void load(); }, 300); });
  ["[data-employee]", "[data-type]", "[data-action]", "[data-from]", "[data-to]"].forEach(selector => get(selector).addEventListener("input", () => { page = 1; void load(); }));
  outlet.querySelector("[data-reset]")!.addEventListener("click", () => { outlet.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach(control => { control.value = ""; }); page = 1; void load(); });
  outlet.querySelector("[data-previous]")!.addEventListener("click", () => { if (page > 1) { page -= 1; void load(); } });
  outlet.querySelector("[data-next]")!.addEventListener("click", () => { if (page * pageSize < total) { page += 1; void load(); } });
  const filterToggle = outlet.querySelector<HTMLButtonElement>("[data-filter-toggle]")!;
  const filterPanel = outlet.querySelector<HTMLElement>("[data-filter-panel]")!;
  filterToggle.addEventListener("click", () => {
    const expanded = filterToggle.getAttribute("aria-expanded") === "true";
    filterToggle.setAttribute("aria-expanded", String(!expanded));
    filterToggle.querySelector("span")!.textContent = expanded ? "Afficher les filtres" : "Masquer les filtres";
    filterToggle.querySelectorAll("span")[1]!.textContent = expanded ? "＋" : "−";
    filterPanel.classList.toggle("hidden", expanded);
    filterPanel.classList.toggle("grid", !expanded);
  });
  await load();
}

async function renderSummary(outlet: HTMLElement): Promise<void> {
  const [currentRows, history, performances] = await Promise.all([rows("periode_comptable_courante"), rows("historique_comptable"), rows("performances_employes")]);
  const current = currentRows[0];
  const transactions = current ? await rows("transactions_courantes") : [];
  const sales = transactions.filter(item => ["Vente", "Vente Employé"].includes(String(item.type_transaction))).reduce((sum, item) => sum + Number(item.prix_total), 0);
  const expenses = -transactions.filter(item => !["Vente", "Vente Employé"].includes(String(item.type_transaction))).reduce((sum, item) => sum + Number(item.prix_total), 0);
  const cards = [["Chiffre d’affaires", sales], ["Dépenses", expenses], ["Résultat brut", sales - expenses]];
  outlet.innerHTML = `${current ? `<div class="grid gap-3 sm:grid-cols-3">${cards.map(([label, value]) => `<section class="rounded-2xl border bg-surface p-5"><p class="text-sm text-muted">${label}</p><strong class="mt-1 block text-2xl">${money.format(Number(value))} PO</strong></section>`).join("")}</div><div class="mt-5">${panel("Période en cours", `<div class="p-5"><p>Ouverte depuis le <strong>${date(current.date_debut)}</strong> · ${escapeHtml(current.jours_ouverts)} jour(s)</p><p class="mt-2 text-sm text-muted">${current.cloture_recommandee ? "La clôture est recommandée." : `${current.jours_avant_cloture} jour(s) avant la clôture recommandée.`}</p><details class="mt-5 rounded-xl border"><summary class="cursor-pointer p-4 font-bold">Clôturer la période</summary><form data-close-period class="border-t p-4"><label class="block text-sm font-bold">Date de fin<input name="end" type="date" required min="${escapeHtml(current.date_debut)}" value="${new Date().toISOString().slice(0, 10)}" class="mt-2 ${field}"></label><p class="mt-4 text-sm text-muted">Renseignez le total payé et la prime de chaque employé pour créer ses archives RH.</p><div class="mt-3 grid gap-3">${performances.map(person => `<div class="grid gap-3 rounded-xl bg-surface-muted p-3 sm:grid-cols-[1fr_10rem_10rem]"><strong>${escapeHtml(person.nom_prenom)}</strong><label class="text-xs font-bold">Prime<input data-prime="${escapeHtml(person.employe_id)}" type="number" min="0" value="${escapeHtml(person.prime_actuelle ?? 0)}" class="mt-1 ${field}"></label><label class="text-xs font-bold">Total payé<input data-paid="${escapeHtml(person.employe_id)}" type="number" min="0" value="${escapeHtml(person.prime_actuelle ?? 0)}" class="mt-1 ${field}"></label></div>`).join("")}</div><fieldset class="mt-5 rounded-xl border border-amber-500/60 p-4"><legend class="px-2 font-bold">Journal technique</legend><label class="flex min-h-11 cursor-pointer items-center gap-3"><input data-purge-audit type="checkbox" class="size-5"><span>Purger le journal technique lors de cette clôture</span></label><p class="mt-2 text-sm text-muted">Option facultative. Le journal métier reste conservé pour les analyses de la Direction.</p><label data-backup-confirmation class="mt-3 hidden min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-amber-500/10 p-3 text-sm font-bold"><input data-backup-confirm type="checkbox" class="mt-0.5 size-5"><span>Je confirme avoir effectué et vérifié une sauvegarde récente de la base. La purge est irréversible.</span></label></fieldset><button class="mt-4 ${button}">Clôturer et ouvrir la période suivante</button></form></details></div>`)}</div>` : panel("Période comptable", '<p class="p-6 text-muted">Aucune période ouverte.</p>')}<div class="mt-5">${panel("Historique financier", table(["Période", "CA", "Dépenses", "Taxes", "Salaires & primes", "Résultat net"], history.map(period => [`${date(period.date_debut)} — ${date(period.date_fin)}`, `${money.format(Number(period.ca_total))} PO`, `${money.format(Number(period.depenses))} PO`, `${money.format(Number(period.taxes))} PO`, `${money.format(Number(period.salaires_primes))} PO`, `<strong>${money.format(Number(period.benefice_net))} PO</strong>`])))}</div>`;
  const form = outlet.querySelector<HTMLFormElement>("[data-close-period]");
  const purgeAudit = form?.querySelector<HTMLInputElement>("[data-purge-audit]");
  const backupConfirmation = form?.querySelector<HTMLElement>("[data-backup-confirmation]");
  const backupConfirmed = form?.querySelector<HTMLInputElement>("[data-backup-confirm]");
  purgeAudit?.addEventListener("change", () => {
    backupConfirmation?.classList.toggle("hidden", !purgeAudit.checked);
    backupConfirmation?.classList.toggle("flex", purgeAudit.checked);
    if (backupConfirmed) { backupConfirmed.required = purgeAudit.checked; if (!purgeAudit.checked) backupConfirmed.checked = false; }
  });
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    if (purgeAudit?.checked && !backupConfirmed?.checked) { showToast("Confirmez la sauvegarde avant la purge.", "error"); backupConfirmed?.focus(); return; }
    const remunerations = performances.map(person => ({ employe_id: person.employe_id, prime: Number(form.querySelector<HTMLInputElement>(`[data-prime="${person.employe_id}"]`)!.value), total_paye: Number(form.querySelector<HTMLInputElement>(`[data-paid="${person.employe_id}"]`)!.value) }));
    try {
      const result = await callRpc("cloturer_periode_avec_audit", { p_employe_id: employeeId(), p_date_fin: new FormData(form).get("end"), p_remunerations: remunerations, p_purger_audit: purgeAudit?.checked ?? false, p_sauvegarde_confirmee: backupConfirmed?.checked ?? false }, z.object({ periode_id: z.coerce.number(), audit_rows_deleted: z.coerce.number().int().nonnegative() }));
      showToast(result.audit_rows_deleted ? `Période clôturée et ${result.audit_rows_deleted} trace(s) technique(s) purgée(s).` : "Période clôturée et archives RH créées.", "success");
      await renderSummary(outlet);
    } catch (error) { showToast(error instanceof Error ? error.message : "Clôture impossible.", "error"); }
  });
}

async function renderExpenses(outlet: HTMLElement): Promise<void> {
  const expenses = (await rows("transactions_courantes")).filter(item => String(item.type_transaction).startsWith("Frais :")).sort((a, b) => +new Date(String(b.created_at)) - +new Date(String(a.created_at)));
  outlet.innerHTML = `${panel("Nouveau frais", `<form data-expense class="grid gap-3 p-5 sm:grid-cols-[1fr_12rem_auto]"><label class="text-sm font-bold">Motif<input name="reason" required maxlength="120" class="mt-2 ${field}"></label><label class="text-sm font-bold">Montant (PO)<input name="amount" type="number" min="0.01" step="0.01" required class="mt-2 ${field}"></label><button class="mt-auto ${button}">Enregistrer</button></form>`)}<div class="mt-5">${panel("Frais de la période", table(["Date", "Motif", "Saisi par", "Montant"], expenses.map(item => [date(item.date_transaction), escapeHtml(String(item.type_transaction).replace(/^Frais :\s*/, "")), escapeHtml(item.vendeur_nom ?? "—"), `<strong>${money.format(Math.abs(Number(item.prix_total)))} PO</strong>`])))}</div>`;
  outlet.querySelector<HTMLFormElement>("[data-expense]")!.addEventListener("submit", async event => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); try { await callRpc("enregistrer_frais", { p_employe_id: employeeId(), p_motif: data.get("reason"), p_montant: Number(data.get("amount")) }, z.coerce.number()); showToast("Frais enregistré.", "success"); await renderExpenses(outlet); } catch (error) { showToast(error instanceof Error ? error.message : "Enregistrement impossible.", "error"); } });
}

async function renderEmployees(outlet: HTMLElement): Promise<void> {
  const employees = (await rows("employes")).sort((a, b) => String(a.nom_prenom).localeCompare(String(b.nom_prenom), "fr"));
  outlet.innerHTML = `${panel("Ajouter un employé", `<form data-add class="grid gap-3 p-5 sm:grid-cols-[1fr_12rem_auto]"><label class="text-sm font-bold">Nom et prénom<input name="name" required class="mt-2 ${field}"></label><label class="text-sm font-bold">Rôle<select name="grade" class="mt-2 ${field}"><option>Étudiant</option><option>Adulte</option><option>Co-Patron</option><option>Patron</option></select></label><button class="mt-auto ${button}">Ajouter</button></form>`)}<div class="mt-5">${panel("Équipe", table(["Employé", "Rôle", "Prime", "État", "Actions"], employees.map(person => [`<input aria-label="Nom de ${escapeHtml(person.nom_prenom)}" data-name="${escapeHtml(person.id)}" value="${escapeHtml(person.nom_prenom)}" class="${field}">`, `<select aria-label="Rôle de ${escapeHtml(person.nom_prenom)}" data-grade="${escapeHtml(person.id)}" class="${field}">${["Étudiant", "Adulte", "Co-Patron", "Patron"].map(grade => `<option ${grade === person.grade ? "selected" : ""}>${grade}</option>`).join("")}</select>`, `<input aria-label="Prime de ${escapeHtml(person.nom_prenom)}" data-bonus="${escapeHtml(person.id)}" type="number" min="0" step="0.01" value="${escapeHtml(person.prime_actuelle)}" class="${field}">`, person.actif ? '<span class="font-bold text-green-600">Actif</span>' : '<span class="font-bold text-muted">Archivé</span>', `<div class="flex gap-2"><button data-save="${escapeHtml(person.id)}" class="min-h-11 rounded-xl border border-brand px-3 font-bold text-brand">Enregistrer</button><button data-toggle="${escapeHtml(person.id)}" class="min-h-11 rounded-xl border px-3 font-bold">${person.actif ? "Archiver" : "Réactiver"}</button></div>`])))}</div>`;
  outlet.querySelector<HTMLFormElement>("[data-add]")!.addEventListener("submit", async event => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); try { await mutate(getSupabaseClient().from("employes").insert({ nom_prenom: data.get("name"), grade: data.get("grade") })); showToast("Employé ajouté.", "success"); await renderEmployees(outlet); } catch (error) { showToast(error instanceof Error ? error.message : "Ajout impossible.", "error"); } });
  outlet.querySelectorAll<HTMLButtonElement>("[data-save]").forEach(control => control.addEventListener("click", async () => { const id = control.dataset.save!; try { await mutate(getSupabaseClient().from("employes").update({ nom_prenom: outlet.querySelector<HTMLInputElement>(`[data-name="${id}"]`)!.value, grade: outlet.querySelector<HTMLSelectElement>(`[data-grade="${id}"]`)!.value, prime_actuelle: Number(outlet.querySelector<HTMLInputElement>(`[data-bonus="${id}"]`)!.value) }).eq("id", id)); showToast("Employé mis à jour.", "success"); } catch (error) { showToast(error instanceof Error ? error.message : "Modification impossible.", "error"); } }));
  outlet.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach(control => control.addEventListener("click", async () => { const person = employees.find(item => String(item.id) === control.dataset.toggle)!; try { await mutate(getSupabaseClient().from("employes").update({ actif: !person.actif }).eq("id", person.id)); showToast(person.actif ? "Employé archivé." : "Employé réactivé.", "success"); await renderEmployees(outlet); } catch (error) { showToast(error instanceof Error ? error.message : "Modification impossible.", "error"); } }));
}

async function renderHrHistory(outlet: HTMLElement): Promise<void> {
  const [archives, periods] = await Promise.all([rows("archives_rh"), rows("historique_comptable")]);
  const names = [...new Set(archives.map(item => String(item.employe_nom)))].sort((a, b) => a.localeCompare(b, "fr"));
  outlet.innerHTML = panel("Archives individuelles", `<div class="grid gap-3 border-b p-4 sm:grid-cols-2"><select data-person aria-label="Filtrer les archives par employé" class="${field}"><option value="">Tous les employés</option>${names.map(name => `<option>${escapeHtml(name)}</option>`).join("")}</select><select data-period aria-label="Filtrer les archives par période" class="${field}"><option value="">Toutes les périodes</option>${periods.map(period => `<option value="${escapeHtml(period.id)}">${date(period.date_debut)} — ${date(period.date_fin)}</option>`).join("")}</select></div><div data-archives aria-live="polite"></div>`);
  const draw = (): void => { const person = outlet.querySelector<HTMLSelectElement>("[data-person]")!.value; const period = outlet.querySelector<HTMLSelectElement>("[data-period]")!.value; outlet.querySelector<HTMLElement>("[data-archives]")!.innerHTML = table(["Employé", "Période", "CA ventes", "Prime", "Total payé"], archives.filter(item => (!person || item.employe_nom === person) && (!period || String(item.periode_id) === period)).map(item => { const linked = periods.find(value => String(value.id) === String(item.periode_id)); return [escapeHtml(item.employe_nom), linked ? `${date(linked.date_debut)} — ${date(linked.date_fin)}` : `#${escapeHtml(item.periode_id)}`, `${money.format(Number(item.ca_ventes))} PO`, `${money.format(Number(item.prime))} PO`, `<strong>${money.format(Number(item.total_paye))} PO</strong>`]; })); };
  outlet.querySelectorAll("select").forEach(control => control.addEventListener("input", draw)); draw();
}

async function renderCatalogue(outlet: HTMLElement): Promise<void> {
  const articles = (await rows("catalogue", "*,stocks(quantite,stock_max)")).sort((a, b) => String(a.article).localeCompare(String(b.article), "fr"));
  const types = [["objet", "Objet"], ["ingredient", "Ingrédient"], ["ticket", "Ticket"], ["document_permis", "Document permis"]];
  outlet.innerHTML = `${panel("Nouvel article", `<form data-add class="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-6"><label class="text-sm font-bold xl:col-span-2">Article<input name="article" required class="mt-2 ${field}"></label><label class="text-sm font-bold">Type<select name="type" class="mt-2 ${field}">${types.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label class="text-sm font-bold">Prix d’achat<input name="buy" type="number" min="0" step="0.01" value="0" class="mt-2 ${field}"></label><label class="text-sm font-bold">Prix de vente<input name="sell" type="number" min="0" step="0.01" value="0" class="mt-2 ${field}"></label><button class="mt-auto ${button}">Ajouter</button></form>`)}<div class="mt-5">${panel("Catalogue", table(["Article", "Type", "Achat", "Vente", "État", "Actions"], articles.map(article => [`<input data-article="${escapeHtml(article.id)}" value="${escapeHtml(article.article)}" class="${field}">`, `<select data-type="${escapeHtml(article.id)}" class="${field}">${types.map(([value, label]) => `<option value="${value}" ${value === article.type_article ? "selected" : ""}>${label}</option>`).join("")}</select>`, `<input data-buy="${escapeHtml(article.id)}" type="number" min="0" step="0.01" value="${escapeHtml(article.prix_achat)}" class="${field}">`, `<input data-sell="${escapeHtml(article.id)}" type="number" min="0" step="0.01" value="${escapeHtml(article.prix_vente)}" class="${field}">`, article.actif ? "Actif" : "Archivé", `<div class="flex gap-2"><button data-save="${escapeHtml(article.id)}" class="min-h-11 rounded-xl border border-brand px-3 font-bold text-brand">Enregistrer</button><button data-toggle="${escapeHtml(article.id)}" class="min-h-11 rounded-xl border px-3 font-bold">${article.actif ? "Archiver" : "Réactiver"}</button></div>`])))}</div>`;
  outlet.querySelector<HTMLFormElement>("[data-add]")!.addEventListener("submit", async event => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); const type = String(data.get("type")); try { await mutate(getSupabaseClient().from("catalogue").insert({ article: data.get("article"), type_article: type, categorie: type === "ingredient" ? "Ingrédient" : type === "document_permis" ? "Permis" : "Objet", prix_achat: Number(data.get("buy")), prix_vente: Number(data.get("sell")) })); showToast("Article ajouté. Renseignez sa quantité dans l’onglet Stocks.", "success"); await renderCatalogue(outlet); } catch (error) { showToast(error instanceof Error ? error.message : "Ajout impossible.", "error"); } });
  outlet.querySelectorAll<HTMLButtonElement>("[data-save]").forEach(control => control.addEventListener("click", async () => { const id = control.dataset.save!; const type = outlet.querySelector<HTMLSelectElement>(`[data-type="${id}"]`)!.value; try { await mutate(getSupabaseClient().from("catalogue").update({ article: outlet.querySelector<HTMLInputElement>(`[data-article="${id}"]`)!.value, type_article: type, categorie: type === "ingredient" ? "Ingrédient" : type === "document_permis" ? "Permis" : "Objet", prix_achat: Number(outlet.querySelector<HTMLInputElement>(`[data-buy="${id}"]`)!.value), prix_vente: Number(outlet.querySelector<HTMLInputElement>(`[data-sell="${id}"]`)!.value) }).eq("id", id)); showToast("Article mis à jour.", "success"); } catch (error) { showToast(error instanceof Error ? error.message : "Modification impossible.", "error"); } }));
  outlet.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach(control => control.addEventListener("click", async () => { const article = articles.find(item => String(item.id) === control.dataset.toggle)!; try { await mutate(getSupabaseClient().from("catalogue").update({ actif: !article.actif }).eq("id", article.id)); showToast(article.actif ? "Article archivé." : "Article réactivé.", "success"); await renderCatalogue(outlet); } catch (error) { showToast(error instanceof Error ? error.message : "Modification impossible.", "error"); } }));
}

async function renderRecipes(outlet: HTMLElement): Promise<void> {
  const [recipes, articles] = await Promise.all([rows("recettes_craft", "*,produit:catalogue!produit_id(article),ingredient:catalogue!ingredient_id(article)"), rows("catalogue_actif")]);
  const products = articles.filter(item => item.type_article === "objet"); const ingredients = articles.filter(item => item.type_article === "ingredient");
  outlet.innerHTML = `${panel("Ajouter une ligne de recette", `<form data-recipe class="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5"><label class="text-sm font-bold">Produit<select name="product" required class="mt-2 ${field}">${products.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.article)}</option>`).join("")}</select></label><label class="text-sm font-bold">Ingrédient<select name="ingredient" required class="mt-2 ${field}">${ingredients.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.article)}</option>`).join("")}</select></label><label class="text-sm font-bold">Quantité requise<input name="required" type="number" min="1" value="1" class="mt-2 ${field}"></label><label class="text-sm font-bold">Quantité produite<input name="produced" type="number" min="1" value="1" class="mt-2 ${field}"></label><button class="mt-auto ${button}" ${products.length && ingredients.length ? "" : "disabled"}>Ajouter</button></form>`)}<div class="mt-5">${panel("Recettes", table(["Produit", "Ingrédient", "Requis", "Produit", "Action"], recipes.map(recipe => { const product = recipe.produit as Row; const ingredient = recipe.ingredient as Row; return [escapeHtml(product?.article), escapeHtml(ingredient?.article), escapeHtml(recipe.quantite_requise), escapeHtml(recipe.quantite_produite), `<button data-delete="${escapeHtml(recipe.id)}" class="min-h-11 rounded-xl border px-3 font-bold text-red-600">Supprimer</button>`]; })))}</div>`;
  outlet.querySelector<HTMLFormElement>("[data-recipe]")!.addEventListener("submit", async event => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); try { await mutate(getSupabaseClient().from("recettes_craft").insert({ produit_id: data.get("product"), ingredient_id: data.get("ingredient"), quantite_requise: Number(data.get("required")), quantite_produite: Number(data.get("produced")) })); showToast("Ligne de recette ajoutée.", "success"); await renderRecipes(outlet); } catch (error) { showToast(error instanceof Error ? error.message : "Ajout impossible.", "error"); } });
  outlet.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach(control => control.addEventListener("click", async () => { try { await mutate(getSupabaseClient().from("recettes_craft").delete().eq("id", control.dataset.delete)); showToast("Ligne supprimée.", "success"); await renderRecipes(outlet); } catch (error) { showToast(error instanceof Error ? error.message : "Suppression impossible.", "error"); } }));
}

async function renderStocks(outlet: HTMLElement): Promise<void> {
  const articles = (await rows("catalogue", "id,article,actif,stocks(id,quantite,stock_max)")).sort((a, b) => String(a.article).localeCompare(String(b.article), "fr"));
  outlet.innerHTML = panel("Stocks", `<p class="border-b p-4 text-sm text-muted">La quantité réelle et le seuil maximal servent aux ventes et aux suggestions de rachat.</p>${table(["Article", "Quantité", "Stock maximal", "État", "Action"], articles.map(article => { const relation = Array.isArray(article.stocks) ? article.stocks[0] as Row | undefined : article.stocks as Row | undefined; return [escapeHtml(article.article), `<input aria-label="Quantité en stock de ${escapeHtml(article.article)}" data-quantity="${escapeHtml(article.id)}" type="number" min="0" value="${escapeHtml(relation?.quantite ?? 0)}" class="${field}">`, `<input aria-label="Stock maximal de ${escapeHtml(article.article)}" data-maximum="${escapeHtml(article.id)}" type="number" min="0" value="${escapeHtml(relation?.stock_max ?? "")}" placeholder="Sans limite" class="${field}">`, article.actif ? "Actif" : "Archivé", `<button data-save="${escapeHtml(article.id)}" class="min-h-11 rounded-xl border border-brand px-3 font-bold text-brand">Enregistrer</button>`]; }))}`);
  outlet.querySelectorAll<HTMLButtonElement>("[data-save]").forEach(control => control.addEventListener("click", () => void withPending(control, "Enregistrement…", async () => { const id = control.dataset.save!; const maximum = outlet.querySelector<HTMLInputElement>(`[data-maximum="${id}"]`)!.value; try { await mutate(getSupabaseClient().from("stocks").upsert({ article_id: id, quantite: Number(outlet.querySelector<HTMLInputElement>(`[data-quantity="${id}"]`)!.value), stock_max: maximum === "" ? null : Number(maximum) }, { onConflict: "article_id" })); showToast("Stock mis à jour.", "success"); } catch (error) { showToast(error instanceof Error ? error.message : "Modification impossible.", "error"); } })));
}

export async function mountDirectionPage(outlet: HTMLElement, pageId: string): Promise<() => void> {
  if (pageId === "pilotage") tabs(outlet, [{ id: "logs", label: "Journal d’activité" }], (_, content) => renderLogs(content));
  else if (pageId === "finances") tabs(outlet, [{ id: "summary", label: "Synthèse financière" }, { id: "expenses", label: "Frais" }], (id, content) => id === "summary" ? renderSummary(content) : renderExpenses(content));
  else if (pageId === "equipe-rh") tabs(outlet, [{ id: "employees", label: "Employés" }, { id: "history", label: "Historique RH" }], (id, content) => id === "employees" ? renderEmployees(content) : renderHrHistory(content));
  else tabs(outlet, [{ id: "catalogue", label: "Catalogue" }, { id: "recipes", label: "Recettes" }, { id: "stocks", label: "Stocks" }], (id, content) => id === "catalogue" ? renderCatalogue(content) : id === "recipes" ? renderRecipes(content) : renderStocks(content));
  return () => undefined;
}
