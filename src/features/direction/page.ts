import { z } from "zod";
import { readEmployeeSession } from "../../core/employee-session";
import { currentTheme, setTheme, type VisualTheme } from "../../core/theme";
import { callRpc, getSupabaseClient } from "../../data/supabase";
import { asyncState } from "../../ui/components/async-state";
import { showToast } from "../../ui/components/toast";
import { escapeHtml } from "../../ui/html";
import { panel } from "../../ui/components/panel";
import {
  labelTableControls,
  responsiveTable,
} from "../../ui/components/responsive-table";
import { withPending } from "../../ui/components/pending";
import { confirmDialog } from "../../ui/components/dialog";
import { buttonClasses, fieldClasses } from "../../ui/components/primitives";
import { mountDirectionTabs } from "./tabs";

type Row = Record<string, unknown>;

const rowSchema = z.record(z.string(), z.unknown());
const money = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const date = (value: unknown): string =>
  value ? new Date(String(value)).toLocaleDateString("fr-FR") : "—";
const dateTime = (value: unknown): string =>
  value
    ? new Date(String(value)).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Paris",
      })
    : "—";
const dateTimeLocalValue = (value: unknown = new Date()): string => {
  const parsed = new Date(String(value));
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
};
const actionLabels: Record<string, string> = {
  archive: "Archivage",
  craft_confirmed: "Fabrication confirmée",
  create: "Création",
  employee_purchase_confirmed: "Achat employé confirmé",
  expense_recorded: "Frais enregistré",
  order_cancelled: "Commande annulée",
  order_deleted: "Commande supprimée",
  order_delivered: "Commande livrée",
  order_prepared: "Préparation de commande terminée",
  order_restored: "Commande restaurée",
  order_reverted: "Retour à l’état précédent de la commande",
  permit_banned: "Permis interdit",
  permit_updated: "Permis modifié",
  permit_validated: "Permis validé",
  permit_withdrawn: "Retrait de permis confirmé",
  purchase_confirmed: "Rachat confirmé",
  sell: "Vente de permis",
  sale_confirmed: "Vente confirmée",
  technical_log_purged: "Journal technique purgé",
  transaction_recorded: "Transaction enregistrée",
  treasury_reference_updated: "Montant du coffre mis à jour",
  update: "Modification",
  update_status: "Modification du statut",
  withdraw_ticket: "Retrait de ticket",
};
const categoryLabels: Record<string, string> = {
  client: "Client",
  client_permit: "Permis client",
  commande: "Commande",
  fabrication: "Fabrication",
  periode_comptable: "Période comptable",
  permis: "Permis",
  transaction: "Transaction",
  tresorerie: "Trésorerie",
};
const elementLabels: Record<string, string> = {
  ticket: "Ticket",
  permit_broomstick: "Permis balai",
  permit_motorcycle: "Permis moto",
  permit_car: "Permis voiture",
};
const frenchAction = (value: unknown): string =>
  actionLabels[String(value)] ?? String(value);
const frenchCategory = (value: unknown): string =>
  categoryLabels[String(value)] ?? String(value).replaceAll("_", " ");
const frenchElement = (value: unknown): string =>
  elementLabels[String(value)] ?? String(value ?? "—");
const table = responsiveTable;
const field = fieldClasses();
const button = buttonClasses();
const erpSettingsSchema = z.object({
  taux_etudiant: z.coerce.number(),
  taux_adulte: z.coerce.number(),
  taux_co_patron: z.coerce.number(),
  taux_patron: z.coerce.number(),
  taux_taxe: z.coerce.number(),
  plafond_etudiant: z.coerce.number(),
  plafond_adulte: z.coerce.number(),
  plafond_co_patron: z.coerce.number(),
  plafond_patron: z.coerce.number(),
  prime_max_etudiant: z.coerce.number(),
  prime_max_adulte: z.coerce.number(),
  prime_max_co_patron: z.coerce.number(),
  prime_max_patron: z.coerce.number(),
  solde_reference_tresorerie: z.coerce.number(),
  reference_tresorerie_at: z.string(),
});
type ErpSettings = z.infer<typeof erpSettingsSchema>;

async function rows(source: string, select = "*"): Promise<Row[]> {
  const { data, error } = await getSupabaseClient().from(source).select(select);
  if (error) throw new Error(error.message);
  return z.array(rowSchema).parse(data);
}

async function mutate(
  request: PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  const { error } = await request;
  if (error) throw new Error(error.message);
}

function employeeId(): string | number {
  const session = readEmployeeSession();
  if (!session) throw new Error("Sélectionnez un employé.");
  return session.employeeId;
}

async function erpSettings(): Promise<ErpSettings> {
  const settings = (await rows("parametres_erp"))[0];
  if (!settings)
    throw new Error(
      "Les paramètres ERP sont absents. Appliquez les migrations Supabase.",
    );
  return erpSettingsSchema.parse(settings);
}

function salaryRule(
  grade: unknown,
  settings: ErpSettings,
): { rate: number; ceiling: number } {
  type RateKey = "taux_etudiant" | "taux_adulte" | "taux_co_patron" | "taux_patron";
  type CeilingKey = "plafond_etudiant" | "plafond_adulte" | "plafond_co_patron" | "plafond_patron";
  const rules: Record<string, [RateKey, CeilingKey]> = {
    Étudiant: ["taux_etudiant", "plafond_etudiant"],
    Adulte: ["taux_adulte", "plafond_adulte"],
    "Co-Patron": ["taux_co_patron", "plafond_co_patron"],
    Patron: ["taux_patron", "plafond_patron"],
  };
  const [rateKey, ceilingKey] = rules[String(grade)] ?? rules.Adulte!;
  return { rate: settings[rateKey] / 100, ceiling: settings[ceilingKey] };
}

function salaryFromProfit(
  profit: number,
  grade: unknown,
  settings: ErpSettings,
): number {
  const { rate, ceiling } = salaryRule(grade, settings);
  return Math.round(Math.min(Math.max(profit, 0) * rate, ceiling));
}

function maximumBonus(grade: unknown, settings: ErpSettings): number {
  type BonusKey = "prime_max_etudiant" | "prime_max_adulte" | "prime_max_co_patron" | "prime_max_patron";
  const keys: Record<string, BonusKey> = {
    Étudiant: "prime_max_etudiant",
    Adulte: "prime_max_adulte",
    "Co-Patron": "prime_max_co_patron",
    Patron: "prime_max_patron",
  };
  return settings[keys[String(grade)] ?? "prime_max_adulte"];
}

async function renderActivities(outlet: HTMLElement): Promise<void> {
  const [periods, employees, archives, settings] = await Promise.all([
    rows("periodes_comptables"),
    rows("employes"),
    rows("archives_rh"),
    erpSettings(),
  ]);
  periods.sort((left, right) => Number(right.id) - Number(left.id));
  const current =
    periods.find((period) => period.statut === "ouverte") ?? periods[0];
  outlet.innerHTML = panel(
    "Activités et rémunérations",
    `<div class="border-b p-4"><label class="block max-w-md text-sm font-bold">Période comptable<select data-activity-period class="mt-2 ${field}">${periods.map((period) => `<option value="${escapeHtml(period.id)}" ${period.id === current?.id ? "selected" : ""}>${dateTime(period.debut_at ?? period.date_debut)} — ${period.statut === "ouverte" ? "en cours" : dateTime(period.fin_at ?? period.date_fin)}</option>`).join("")}</select></label><p class="mt-3 text-sm text-muted">Commissions et primes maximales calculées selon les règles propres à chaque rang. Taxe ministérielle : ${money.format(settings.taux_taxe)} %.</p></div><div data-activity-list aria-live="polite"></div>`,
  );
  const periodSelect = outlet.querySelector<HTMLSelectElement>(
    "[data-activity-period]",
  )!;
  const list = outlet.querySelector<HTMLElement>("[data-activity-list]")!;
  const load = async (): Promise<void> => {
    list.innerHTML = asyncState("loading");
    const period = periods.find(
      (item) => String(item.id) === periodSelect.value,
    )!;
    const periodStart = String(period.debut_at ?? `${period.date_debut}T00:00:00`);
    const periodEnd = String(period.fin_at ?? new Date().toISOString());
    const [
      { data: transactionData, error: transactionError },
      { data: payrollData, error: payrollError },
      { data: fabricationData, error: fabricationError },
    ] = await Promise.all([
      getSupabaseClient()
        .from("transactions")
        .select(
          "vendeur_id,vendeur_nom,type_transaction,prix_total,benefice_total,quantite",
        )
        .eq("periode_id", period.id),
      getSupabaseClient()
        .from("remunerations_periodes")
        .select("*")
        .eq("periode_id", period.id),
      getSupabaseClient()
        .from("fabrications")
        .select("employe_id,nombre_crafts")
        .gte("created_at", periodStart)
        .lte("created_at", periodEnd),
    ]);
    if (transactionError) throw new Error(transactionError.message);
    if (payrollError) throw new Error(payrollError.message);
    if (fabricationError) throw new Error(fabricationError.message);
    const transactions = z.array(rowSchema).parse(transactionData);
    const payrolls = z.array(rowSchema).parse(payrollData);
    const fabrications = z.array(rowSchema).parse(fabricationData);
    const people = employees
      .filter((person) => period.statut !== "ouverte" || person.actif)
      .sort((left, right) =>
        String(left.nom_prenom).localeCompare(String(right.nom_prenom), "fr"),
      );
    const activityRows = people.map((person) => {
      const sales = transactions.filter(
        (transaction) =>
          String(transaction.vendeur_id) === String(person.id) &&
          transaction.type_transaction === "Vente",
      );
      const archived = archives.find(
        (item) =>
          String(item.periode_id) === String(period.id) &&
          String(item.employe_id) === String(person.id),
      );
      const payroll = payrolls.find(
        (item) => String(item.employe_id) === String(person.id),
      );
      const revenue =
        sales.reduce((sum, sale) => sum + Number(sale.prix_total), 0) ||
        Number(archived?.ca_ventes ?? 0);
      const profit = sales.reduce(
        (sum, sale) => sum + Number(sale.benefice_total),
        0,
      );
      const grade = payroll?.grade ?? person.grade;
      const { rate: salaryRate, ceiling: salaryCeiling } = salaryRule(
        grade,
        settings,
      );
      const uncappedSalary = Math.max(profit, 0) * salaryRate;
      const salary =
        payroll || sales.length
          ? salaryFromProfit(profit, grade, settings)
          : Math.max(
              0,
              Number(archived?.total_paye ?? 0) - Number(archived?.prime ?? 0),
            );
      const bonusMaximum = maximumBonus(
        payroll?.grade ?? person.grade,
        settings,
      );
      const prime = Math.min(
        bonusMaximum,
        Number(
          payroll?.prime ??
            archived?.prime ??
            (period.statut === "ouverte" ? person.prime_actuelle : 0),
        ),
      );
      const craftCount = fabrications
        .filter((item) => String(item.employe_id) === String(person.id))
        .reduce((sum, item) => sum + Number(item.nombre_crafts), 0);
      return {
        person,
        payroll,
        revenue,
        profit,
        salary,
        salaryCeilingReached:
          salaryCeiling > 0 && uncappedSalary >= salaryCeiling,
        salaryCeilingExceeded:
          salaryCeiling > 0 && uncappedSalary > salaryCeiling * 1.5,
        salaryCeilingDoubled:
          salaryCeiling > 0 && uncappedSalary > salaryCeiling * 2,
        prime,
        bonusMaximum,
        total: salary + prime,
        sales: sales.length,
        craftCount,
      };
    });
    list.innerHTML = table(
      [
        "Employé",
        "CA",
        "Bénéfice",
        "Ventes",
        "Fabrications",
        "Salaire",
        "Prime",
        "Total",
        ...(period.statut === "ouverte" ? [] : ["Payé"]),
        "Action",
      ],
      activityRows.map(
        ({
          person,
          payroll,
          revenue,
          profit,
          salary,
          salaryCeilingReached,
          salaryCeilingExceeded,
          salaryCeilingDoubled,
          prime,
          bonusMaximum,
          total,
          sales,
          craftCount,
        }) => [
          escapeHtml(person.nom_prenom),
          `${money.format(revenue)} PO`,
          `${money.format(profit)} PO`,
          String(sales),
          String(craftCount),
          salaryCeilingDoubled
            ? `<span class="font-bold text-danger">${money.format(salary)} PO<small class="block text-xs">Plafond + 100%</small></span>`
            : salaryCeilingExceeded
            ? `<span class="font-bold text-warning">${money.format(salary)} PO<small class="block text-xs">Plafond + 50%</small></span>`
            : salaryCeilingReached
              ? `<span class="font-bold text-threshold">${money.format(salary)} PO<small class="block text-xs">Plafond atteint</small></span>`
              : `<span>${money.format(salary)} PO</span>`,
          period.statut === "ouverte"
            ? `<input data-activity-prime="${escapeHtml(person.id)}" aria-label="Prime de ${escapeHtml(person.nom_prenom)}, maximum ${bonusMaximum} PO" type="number" min="0" max="${bonusMaximum}" step="1" value="${prime}" class="min-h-11 w-full rounded-xl border bg-surface px-3 text-ink disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-9 lg:rounded-lg lg:px-2 lg:py-1">`
            : `<span>${money.format(prime)} PO</span>`,
          `<strong data-activity-total="${escapeHtml(person.id)}">${money.format(total)} PO</strong>`,
          ...(period.statut === "ouverte" ? [] : [`<input data-activity-paid="${escapeHtml(person.id)}" type="checkbox" ${payroll?.paye ? "checked" : ""} class="size-5 accent-[var(--color-brand)]" aria-label="Salaire payé à ${escapeHtml(person.nom_prenom)}">`]),
          `<button data-save-activity="${escapeHtml(person.id)}" disabled class="min-h-11 rounded-xl border border-accent px-3 font-bold text-accent disabled:opacity-40 lg:min-h-9 lg:rounded-lg lg:px-2 lg:py-1 lg:text-sm">Enregistrer</button>`,
        ],
      ),
    );
    activityRows.forEach(({ person, payroll, salary, prime, bonusMaximum }) => {
      const primeInput = list.querySelector<HTMLInputElement>(
        `[data-activity-prime="${person.id}"]`,
      );
      const paidInput = list.querySelector<HTMLInputElement>(
        `[data-activity-paid="${person.id}"]`,
      );
      const total = list.querySelector<HTMLElement>(
        `[data-activity-total="${person.id}"]`,
      )!;
      const saveButton = list.querySelector<HTMLButtonElement>(
        `[data-save-activity="${person.id}"]`,
      )!;
      const row = saveButton.closest<HTMLTableRowElement>("tr")!;
      let savedPrime = prime;
      let savedPaid = Boolean(payroll?.paye);
      const updateState = (): void => {
        const value = primeInput ? Number(primeInput.value) : savedPrime;
        const valid = !primeInput || (primeInput.value !== "" && Number.isFinite(value) && value >= 0 && value <= bonusMaximum);
        const dirty = value !== savedPrime || (paidInput ? paidInput.checked !== savedPaid : false);
        row.classList.toggle("bg-warning/15", dirty && valid);
        row.classList.toggle("bg-danger/15", dirty && !valid);
        saveButton.disabled = !dirty || !valid;
        total.textContent = `${money.format(salary + (valid ? value : 0))} PO`;
      };
      primeInput?.addEventListener("input", updateState);
      paidInput?.addEventListener("change", updateState);
      saveButton.addEventListener("click", async () => {
          const prime = primeInput
            ? Math.min(bonusMaximum, Math.max(0, Number(primeInput.value) || 0))
            : savedPrime;
          if (primeInput) primeInput.value = String(prime);
          const paidLabel = paidInput?.checked ? "Payé" : "Non payé";
          const confirmed = await confirmSettings(
            `Confirmer la rémunération de ${String(person.nom_prenom)}`,
            paidInput
              ? `Prime : ${money.format(savedPrime)} PO. État : ${savedPaid ? "Payé" : "Non payé"} → ${paidLabel}.`
              : `Prime : ${money.format(savedPrime)} PO → ${money.format(prime)} PO.`,
          );
          if (!confirmed) return;
          try {
            await mutate(
              getSupabaseClient()
                .from("remunerations_periodes")
                .upsert(
                  {
                    periode_id: period.id,
                    employe_id: person.id,
                    employe_nom: person.nom_prenom,
                    grade: payroll?.grade ?? person.grade,
                    prime,
                    paye: paidInput?.checked ?? false,
                  },
                  { onConflict: "periode_id,employe_id" },
                ),
            );
            if (period.statut === "ouverte")
              await mutate(
                getSupabaseClient()
                  .from("employes")
                  .update({ prime_actuelle: prime })
                  .eq("id", person.id),
              );
            savedPrime = prime;
            savedPaid = paidInput?.checked ?? false;
            updateState();
            showToast(
              `Rémunération de ${person.nom_prenom} enregistrée.`,
              "success",
            );
          } catch (error) {
            showToast(
              error instanceof Error
                ? error.message
                : "Enregistrement impossible.",
              "error",
            );
          }
        });
    });
    labelTableControls(list);
  };
  periodSelect.addEventListener("change", () => void load());
  await load();
}

async function renderLogs(outlet: HTMLElement): Promise<void> {
  const pageSize = 25;
  let page = 1;
  let entries: Row[] = [];
  let total = 0;
  let loadId = 0;
  const periods = (await rows("periodes_comptables")).sort(
    (left, right) => Number(right.id) - Number(left.id),
  );
  const currentPeriod = periods.find((period) => period.statut === "ouverte") ?? periods[0];
  outlet.innerHTML = panel(
    "Journal d’activité",
    `<div class="border-b p-4"><button type="button" data-filter-toggle aria-expanded="false" aria-controls="log-filters" class="flex min-h-11 w-full items-center justify-between rounded-xl border px-4 font-bold md:hidden"><span>Afficher les filtres</span><span aria-hidden="true">＋</span></button><div id="log-filters" data-filter-panel class="mt-3 hidden gap-3 md:mt-0 md:grid md:grid-cols-2"><label class="text-sm font-bold">Session comptable<select data-period class="mt-2 ${field}"><option value="all">Toutes les périodes</option>${periods.map((period) => `<option value="${escapeHtml(period.id)}" ${String(period.id) === String(currentPeriod?.id) ? "selected" : ""}>${dateTime(period.debut_at ?? period.date_debut)} — ${period.statut === "ouverte" ? "en cours" : dateTime(period.fin_at ?? period.date_fin)}</option>`).join("")}</select></label><label class="text-sm font-bold">Recherche<input data-search type="search" placeholder="Élément, client…" class="mt-2 ${field}"></label><label class="text-sm font-bold">Employé<select data-employee class="mt-2 ${field}"><option value="">Tous les employés</option></select></label><label class="text-sm font-bold">Action<select data-action class="mt-2 ${field}"><option value="">Toutes les actions</option></select></label><div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:col-span-2"><label class="text-sm font-bold">Depuis<input data-from type="date" class="mt-2 ${field}"></label><label class="text-sm font-bold">Jusqu’au<input data-to type="date" class="mt-2 ${field}"></label></div><button type="button" data-reset class="min-h-11 rounded-xl border px-4 font-bold md:col-span-2">Réinitialiser les filtres</button></div></div><p data-count class="border-b px-4 py-3 text-sm text-muted" aria-live="polite"></p><div data-list></div><nav data-pagination class="flex items-center justify-between gap-3 border-t p-4" aria-label="Pagination du journal"><button type="button" data-previous class="min-h-11 rounded-xl border px-4 font-bold disabled:opacity-40">Précédent</button><span data-page class="text-sm font-bold"></span><button type="button" data-next class="min-h-11 rounded-xl border px-4 font-bold disabled:opacity-40">Suivant</button></nav>`,
  );
  const root = outlet.firstElementChild as HTMLElement;
  const get = (selector: string): HTMLInputElement | HTMLSelectElement =>
    root.querySelector(selector)!;
  const list = root.querySelector<HTMLElement>("[data-list]")!;
  const count = root.querySelector<HTMLElement>("[data-count]")!;
  const applyPeriod = (): void => {
    const selected = get("[data-period]").value;
    const period = periods.find((item) => String(item.id) === selected);
    get("[data-from]").value = period ? String(period.date_debut).slice(0, 10) : "";
    get("[data-to]").value = period?.date_fin ? String(period.date_fin).slice(0, 10) : "";
  };
  applyPeriod();
  const openDetails = (entry: Row, trigger: HTMLButtonElement): void => {
    const client = entry.clients as Row | null;
    const dialog = document.createElement("dialog");
    dialog.className =
      "m-auto max-h-[calc(100dvh-2rem)] w-[min(52rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-backdrop";
    const facts = [
      ["Date", new Date(String(entry.created_at)).toLocaleString("fr-FR")],
      ["Employé", entry.employe_nom],
      ["Action", frenchAction(entry.action)],
      ["Catégorie", frenchCategory(entry.entite_type)],
      ["Élément", frenchElement(entry.element ?? entry.libelle)],
      ["Client", client?.nom_prenom ?? "—"],
      ["Résultat", entry.resultat],
    ];
    dialog.innerHTML = `<div class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-surface p-5"><div><p class="text-sm font-bold text-accent">Journal d’activité</p><h2 class="mt-1 text-xl font-bold">Détails de l’action</h2></div><button type="button" data-close class="grid size-11 shrink-0 place-items-center rounded-xl border" aria-label="Fermer">×</button></div><div class="p-5"><dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">${facts.map(([label, value]) => `<div><dt class="text-xs font-bold uppercase tracking-wide text-muted">${escapeHtml(label)}</dt><dd class="mt-1 break-words font-semibold">${escapeHtml(value ?? "—")}</dd></div>`).join("")}</dl><section class="mt-6 border-t pt-5" aria-labelledby="log-technical-details"><h3 id="log-technical-details" class="font-bold">Détails</h3><div class="mt-3 grid gap-4 lg:grid-cols-3">${[
      ["Avant", entry.etat_avant],
      ["Après", entry.etat_apres],
      ["Métadonnées", entry.metadata],
    ]
      .map(
        ([label, value]) =>
          `<div class="min-w-0"><h4 class="text-sm font-bold text-muted">${label}</h4><pre class="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-muted p-4 text-xs">${escapeHtml(JSON.stringify(value ?? null, null, 2))}</pre></div>`,
      )
      .join(
        "",
      )}</div></section></div><div class="sticky bottom-0 flex justify-end border-t bg-surface p-4"><button type="button" data-close class="min-h-11 rounded-xl bg-brand px-5 font-bold text-white">Fermer</button></div>`;
    document.body.append(dialog);
    const close = (): void => dialog.close();
    dialog
      .querySelectorAll<HTMLButtonElement>("[data-close]")
      .forEach((button) => button.addEventListener("click", close));
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        trigger.focus();
      },
      { once: true },
    );
    dialog.showModal();
  };
  const draw = (): void => {
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const first = total ? (page - 1) * pageSize + 1 : 0;
    const last = Math.min(page * pageSize, total);
    count.textContent = total
      ? `Actions ${first} à ${last} sur ${total}`
      : "Aucune action correspondante";
    list.innerHTML = table(
      ["Date", "Employé", "Action", "Catégorie", "Élément", "Résultat", "Détails"],
      entries.map((entry, index) => [
        new Date(String(entry.created_at)).toLocaleString("fr-FR"),
        escapeHtml(entry.employe_nom),
        escapeHtml(frenchAction(entry.action)),
        escapeHtml(frenchCategory(entry.entite_type)),
        escapeHtml(frenchElement(entry.element ?? entry.libelle)),
        escapeHtml(entry.resultat),
        `<button type="button" data-log-details="${index}" class="inline-flex min-h-11 items-center rounded-xl border border-accent px-3 font-bold text-accent hover:bg-surface-muted" aria-label="Voir les détails de ${escapeHtml(frenchAction(entry.action))}">Voir</button>`,
      ]),
      { emptyMessage: "Aucune donnée récupérée." },
    );
    list
      .querySelectorAll<HTMLButtonElement>("[data-log-details]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          openDetails(entries[Number(button.dataset.logDetails)]!, button),
        ),
      );
    root.querySelector<HTMLElement>("[data-page]")!.textContent =
      `Page ${page} sur ${pageCount}`;
    root.querySelector<HTMLButtonElement>("[data-previous]")!.disabled =
      page <= 1;
    root.querySelector<HTMLButtonElement>("[data-next]")!.disabled =
      page >= pageCount;
    labelTableControls(list);
  };
  const pageSchema = z.object({
    entries: z.array(rowSchema),
    total: z.coerce.number().int().nonnegative(),
    employees: z.array(z.string()),
    actions: z.array(z.string()),
    entity_types: z.array(z.string()),
  });
  const fillOptions = (
    selector: string,
    values: string[],
    label: (value: string) => string = (value) => value,
  ): void => {
    const select = get(selector) as HTMLSelectElement;
    const current = select.value;
    const first = select.options[0]!.outerHTML;
    select.innerHTML = `${first}${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(label(value))}</option>`).join("")}`;
    select.value = current;
  };
  const load = async (): Promise<void> => {
    const currentLoadId = ++loadId;
    list.innerHTML = asyncState("loading");
    const selectedPeriod = get("[data-period]").value;
    const { data, error } = await getSupabaseClient().rpc(
      "lister_journal_actions_par_periode",
      {
        p_page: page,
        p_page_size: pageSize,
        p_recherche: get("[data-search]").value,
        p_employe: get("[data-employee]").value,
        p_type: "",
        p_action: get("[data-action]").value,
        p_depuis: get("[data-from]").value || null,
        p_jusqu_a: get("[data-to]").value || null,
        p_periode_id: selectedPeriod === "all" ? null : selectedPeriod,
      },
    );
    if (currentLoadId !== loadId) return;
    if (error) throw new Error(error.message);
    const result = pageSchema.parse(data);
    entries = result.entries;
    total = result.total;
    fillOptions("[data-employee]", result.employees);
    fillOptions("[data-action]", result.actions, frenchAction);
    draw();
  };
  let searchTimer: number | undefined;
  get("[data-search]").addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      page = 1;
      void load();
    }, 300);
  });
  [
    "[data-employee]",
    "[data-action]",
    "[data-from]",
    "[data-to]",
  ].forEach((selector) =>
    get(selector).addEventListener("input", () => {
      page = 1;
      void load();
    }),
  );
  get("[data-period]").addEventListener("change", () => {
    applyPeriod();
    page = 1;
    void load();
  });
  root.querySelector("[data-reset]")!.addEventListener("click", () => {
    window.clearTimeout(searchTimer);
    ["[data-search]", "[data-employee]", "[data-action]"].forEach(
      (selector) => { get(selector).value = ""; },
    );
    get("[data-period]").value = currentPeriod ? String(currentPeriod.id) : "all";
    applyPeriod();
    page = 1;
    void load();
  });
  root.querySelector("[data-previous]")!.addEventListener("click", () => {
    if (page > 1) {
      page -= 1;
      void load();
    }
  });
  root.querySelector("[data-next]")!.addEventListener("click", () => {
    if (page * pageSize < total) {
      page += 1;
      void load();
    }
  });
  const filterToggle = root.querySelector<HTMLButtonElement>(
    "[data-filter-toggle]",
  )!;
  const filterPanel = root.querySelector<HTMLElement>("[data-filter-panel]")!;
  filterToggle.addEventListener("click", () => {
    const expanded = filterToggle.getAttribute("aria-expanded") === "true";
    filterToggle.setAttribute("aria-expanded", String(!expanded));
    filterToggle.querySelector("span")!.textContent = expanded
      ? "Afficher les filtres"
      : "Masquer les filtres";
    filterToggle.querySelectorAll("span")[1]!.textContent = expanded
      ? "＋"
      : "−";
    filterPanel.classList.toggle("hidden", expanded);
    filterPanel.classList.toggle("grid", !expanded);
  });
  await load();
}

async function renderSummary(outlet: HTMLElement): Promise<void> {
  const [currentRows, history, performances, settings, treasuryRows] = await Promise.all([
    rows("periode_comptable_courante"),
    rows("historique_comptable"),
    rows("performances_employes"),
    erpSettings(),
    rows("tresorerie_courante"),
  ]);
  const current = currentRows[0];
  const transactions = current ? await rows("transactions_courantes") : [];
  const sales = transactions
    .filter((item) =>
      ["Vente", "Vente Employé"].includes(String(item.type_transaction)),
    )
    .reduce((sum, item) => sum + Number(item.prix_total), 0);
  const expenses = -transactions
    .filter(
      (item) =>
        !["Vente", "Vente Employé"].includes(String(item.type_transaction)),
    )
    .reduce((sum, item) => sum + Number(item.prix_total), 0);
  const gross = sales - expenses;
  const taxes = Math.round((Math.max(gross, 0) * settings.taux_taxe) / 100);
  const payroll = performances.reduce(
    (sum, person) =>
      sum +
      salaryFromProfit(
        Number(person.benefice_realise),
        person.grade,
        settings,
      ) +
      Math.min(
        maximumBonus(person.grade, settings),
        Number(person.prime_actuelle ?? 0),
      ),
    0,
  );
  const theoreticalTreasury = Number(treasuryRows[0]?.montant_theorique ?? 0);
  const cards = [
    ["Chiffre d’affaires", sales],
    ["Dépenses", -expenses],
    ["Bénéfice brut", gross],
    [`Taxes (${money.format(settings.taux_taxe)} %)`, -taxes],
    ["Salaires + primes", -payroll],
    ["Bénéfice net final", gross - taxes - payroll],
  ];
  const closureSummary = [
    ["CA total", sales],
    ["Dépenses", expenses],
    ["Bénéfice brut", gross],
    ["Taxes", taxes],
    ["Salaires + primes", payroll],
    ["Bénéfice net", gross - taxes - payroll],
  ]
    .map(
      ([label, value]) =>
        `<div class="rounded-xl border bg-surface-muted px-3 py-2"><dt class="text-xs font-bold text-muted">${label}</dt><dd class="mt-1 font-bold">${money.format(Number(value))} PO</dd></div>`,
    )
    .join("");
  const payrollTable = responsiveTable(
    ["Employé", "Salaire", "Prime", "Total"],
    performances.map((person) => {
      const salary = salaryFromProfit(
        Number(person.benefice_realise),
        person.grade,
        settings,
      );
      const prime = Math.min(
        maximumBonus(person.grade, settings),
        Number(person.prime_actuelle ?? 0),
      );
      return [
        `<strong>${escapeHtml(person.nom_prenom)}</strong>`,
        `${money.format(salary)} PO`,
        `${money.format(prime)} PO`,
        `<strong>${money.format(salary + prime)} PO</strong>`,
      ];
    }),
    { cardsOnMobile: true, emptyMessage: "Aucune rémunération pour cette période." },
  );
  outlet.innerHTML = `${
    current
      ? `<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">${cards.map(([label, value]) => `<section class="rounded-2xl border bg-surface p-5"><p class="text-sm font-bold text-muted">${label}</p><strong class="mt-2 block text-2xl">${money.format(Number(value))} PO</strong></section>`).join("")}</div><div class="mt-5">${panel(
          "Période en cours",
          `<div class="p-5"><p>Ouverte depuis le <strong>${dateTime(current.debut_at ?? current.date_debut)}</strong> · ${escapeHtml(current.jours_ouverts)} jour(s)</p><p class="mt-2 text-sm text-muted">${current.cloture_recommandee ? "La clôture est recommandée." : `${current.jours_avant_cloture} jour(s) avant la clôture recommandée.`}</p><details class="mt-5 rounded-xl border"><summary class="cursor-pointer p-4 font-bold">Clôturer la période</summary><form data-close-period class="border-t p-4"><div class="grid gap-4 sm:grid-cols-2"><label class="block text-sm font-bold">Date et heure de fin<input name="end" type="datetime-local" step="1" required min="${escapeHtml(dateTimeLocalValue(current.debut_at ?? current.date_debut))}" value="${dateTimeLocalValue()}" class="mt-2 ${field}"></label><label class="block text-sm font-bold">Coffre constaté (PO)<input name="treasury" type="number" min="0" step="0.01" required value="${theoreticalTreasury}" class="mt-2 ${field}"></label></div><p class="mt-2 text-sm text-muted">La période suivante commencera automatiquement une minute après cette heure. Le coffre constaté deviendra la nouvelle référence de trésorerie.</p><p class="mt-4 text-sm text-muted">Les salaires et primes proviennent de l’onglet Activités. La taxe ministérielle appliquée sera de ${money.format(settings.taux_taxe)} %.</p><section class="mt-4" aria-labelledby="closure-summary-title"><h3 id="closure-summary-title" class="mb-2 text-sm font-bold">Résumé général de la session</h3><dl class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">${closureSummary}</dl></section><div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] lg:items-start"><div class="overflow-hidden rounded-xl border">${payrollTable}</div><div><fieldset class="rounded-xl border border-warning/60 p-4"><legend class="px-2 font-bold">Journal technique</legend><label class="flex min-h-11 cursor-pointer items-center gap-3"><input data-purge-audit type="checkbox" class="size-5"><span>Purger le journal technique lors de cette clôture</span></label><p class="mt-2 text-sm text-muted">Option facultative. Le journal métier reste conservé pour les analyses de la Direction.</p><label data-backup-confirmation class="mt-3 hidden min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-warning/10 p-3 text-sm font-bold"><input data-backup-confirm type="checkbox" class="mt-0.5 size-5"><span>Je confirme avoir effectué et vérifié une sauvegarde récente de la base. La purge est irréversible.</span></label></fieldset><button class="mt-4 w-full ${button}">Clôturer et ouvrir la période suivante</button></div></div></form></details></div>`,
        )}</div>`
      : panel(
          "Période comptable",
          '<p class="p-6 text-muted">Aucune période ouverte.</p>',
        )
  }<div class="mt-5">${panel(
    "Registre comptable",
    table(
      [
        "Période",
        "CA total",
        "Dépenses",
        "Bénéfice brut",
        "Taxes",
        "Salaires versés",
        "Bénéfice net",
      ],
      history.map((period) => [
        `${dateTime(period.debut_at ?? period.date_debut)} — ${dateTime(period.fin_at ?? period.date_fin)}`,
        `${money.format(Number(period.ca_total))} PO`,
        `${money.format(Number(period.depenses))} PO`,
        `${money.format(Number(period.benefice_brut))} PO`,
        `${money.format(Number(period.taxes))} PO`,
        `${money.format(Number(period.salaires_primes))} PO`,
        `<strong>${money.format(Number(period.benefice_net))} PO</strong>`,
      ]),
    ),
  )}</div>`;
  const form = outlet.querySelector<HTMLFormElement>("[data-close-period]");
  const purgeAudit =
    form?.querySelector<HTMLInputElement>("[data-purge-audit]");
  const backupConfirmation = form?.querySelector<HTMLElement>(
    "[data-backup-confirmation]",
  );
  const backupConfirmed = form?.querySelector<HTMLInputElement>(
    "[data-backup-confirm]",
  );
  purgeAudit?.addEventListener("change", () => {
    backupConfirmation?.classList.toggle("hidden", !purgeAudit.checked);
    backupConfirmation?.classList.toggle("flex", purgeAudit.checked);
    if (backupConfirmed) {
      backupConfirmed.required = purgeAudit.checked;
      if (!purgeAudit.checked) backupConfirmed.checked = false;
    }
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (purgeAudit?.checked && !backupConfirmed?.checked) {
      showToast("Confirmez la sauvegarde avant la purge.", "error");
      backupConfirmed?.focus();
      return;
    }
    const remunerations = performances.map((person) => {
      const prime = Math.min(
        maximumBonus(person.grade, settings),
        Number(person.prime_actuelle ?? 0),
      );
      const salaire = salaryFromProfit(
        Number(person.benefice_realise),
        person.grade,
        settings,
      );
      return {
        employe_id: person.employe_id,
        prime,
        total_paye: salaire + prime,
      };
    });
    try {
      const endValue = String(new FormData(form).get("end"));
      const treasuryValue = Number(new FormData(form).get("treasury"));
      const result = await callRpc(
        "cloturer_periode_horodatee_avec_audit",
        {
          p_employe_id: employeeId(),
          p_fin_at: new Date(endValue).toISOString(),
          p_remunerations: remunerations,
          p_purger_audit: purgeAudit?.checked ?? false,
          p_sauvegarde_confirmee: backupConfirmed?.checked ?? false,
          p_coffre_valide: treasuryValue,
        },
        z.object({
          periode_id: z.coerce.number(),
          audit_rows_deleted: z.coerce.number().int().nonnegative(),
        }),
      );
      showToast(
        result.audit_rows_deleted
          ? `Période clôturée et ${result.audit_rows_deleted} trace(s) technique(s) purgée(s).`
          : "Période clôturée et archives RH créées.",
        "success",
      );
      await renderSummary(outlet);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Clôture impossible.",
        "error",
      );
    }
  });
}

async function renderExpenses(outlet: HTMLElement): Promise<void> {
  const expenses = (await rows("transactions_courantes"))
    .filter((item) => String(item.type_transaction).startsWith("Frais :"))
    .sort(
      (a, b) =>
        +new Date(String(b.created_at)) - +new Date(String(a.created_at)),
    );
  outlet.innerHTML = `${panel("Nouveau frais", `<form data-expense class="grid gap-3 p-5 sm:grid-cols-[1fr_12rem_auto]"><label class="text-sm font-bold">Motif<input name="reason" required maxlength="120" class="mt-2 ${field}"></label><label class="text-sm font-bold">Montant (PO)<input name="amount" type="number" min="0.01" step="0.01" required class="mt-2 ${field}"></label><button class="mt-auto ${button}">Enregistrer</button></form>`)}<div class="mt-5">${panel(
    "Frais de la période",
    table(
      ["Date", "Motif", "Saisi par", "Montant"],
      expenses.map((item) => [
        date(item.date_transaction),
        escapeHtml(String(item.type_transaction).replace(/^Frais :\s*/, "")),
        escapeHtml(item.vendeur_nom ?? "—"),
        `<strong>${money.format(Math.abs(Number(item.prix_total)))} PO</strong>`,
      ]),
    ),
  )}</div>`;
  outlet
    .querySelector<HTMLFormElement>("[data-expense]")!
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget as HTMLFormElement);
      try {
        await callRpc(
          "enregistrer_frais",
          {
            p_employe_id: employeeId(),
            p_motif: data.get("reason"),
            p_montant: Number(data.get("amount")),
          },
          z.coerce.number(),
        );
        showToast("Frais enregistré.", "success");
        await renderExpenses(outlet);
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "Enregistrement impossible.",
          "error",
        );
      }
    });
}

async function renderEmployees(outlet: HTMLElement): Promise<void> {
  const employees = (await rows("employes")).sort((a, b) =>
    String(a.nom_prenom).localeCompare(String(b.nom_prenom), "fr"),
  );
  outlet.innerHTML = `${panel("Ajouter un employé", `<form data-add class="grid gap-3 p-5 sm:grid-cols-[1fr_12rem_auto]"><label class="text-sm font-bold">Nom et prénom<input name="name" required class="mt-2 ${field}"></label><label class="text-sm font-bold">Rôle<select name="grade" class="mt-2 ${field}"><option>Étudiant</option><option>Adulte</option><option>Co-Patron</option><option>Patron</option></select></label><button class="mt-auto ${button}">Ajouter</button></form>`)}<div class="mt-5">${panel(
    "Équipe",
    table(
      ["Employé", "Rôle", "Note", "État", "Actions"],
      employees.map((person) => [
        `<input aria-label="Nom de ${escapeHtml(person.nom_prenom)}" data-name="${escapeHtml(person.id)}" value="${escapeHtml(person.nom_prenom)}" class="${field}">`,
        `<select aria-label="Rôle de ${escapeHtml(person.nom_prenom)}" data-grade="${escapeHtml(person.id)}" class="${field}">${["Étudiant", "Adulte", "Co-Patron", "Patron"].map((grade) => `<option ${grade === person.grade ? "selected" : ""}>${grade}</option>`).join("")}</select>`,
        `<textarea aria-label="Note concernant ${escapeHtml(person.nom_prenom)}" data-note="${escapeHtml(person.id)}" maxlength="1000" rows="2" class="${field} py-3">${escapeHtml(person.note ?? "")}</textarea>`,
        person.actif
          ? '<span class="font-bold text-success">Actif</span>'
          : '<span class="font-bold text-muted">Archivé</span>',
        `<div class="flex gap-2"><button data-save="${escapeHtml(person.id)}" class="min-h-11 rounded-xl border border-accent px-3 font-bold text-accent">Enregistrer</button><button data-toggle="${escapeHtml(person.id)}" class="min-h-11 rounded-xl border px-3 font-bold">${person.actif ? "Archiver" : "Réactiver"}</button></div>`,
      ]),
    ),
  )}</div>`;
  outlet
    .querySelector<HTMLFormElement>("[data-add]")!
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget as HTMLFormElement);
      try {
        await mutate(
          getSupabaseClient()
            .from("employes")
            .insert({ nom_prenom: data.get("name"), grade: data.get("grade") }),
        );
        showToast("Employé ajouté.", "success");
        await renderEmployees(outlet);
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "Ajout impossible.",
          "error",
        );
      }
    });
  outlet.querySelectorAll<HTMLButtonElement>("[data-save]").forEach((control) =>
    control.addEventListener("click", async () => {
      const id = control.dataset.save!;
      try {
        await mutate(
          getSupabaseClient()
            .from("employes")
            .update({
              nom_prenom: outlet.querySelector<HTMLInputElement>(
                `[data-name="${id}"]`,
              )!.value,
              grade: outlet.querySelector<HTMLSelectElement>(
                `[data-grade="${id}"]`,
              )!.value,
              note: outlet.querySelector<HTMLTextAreaElement>(
                `[data-note="${id}"]`,
              )!.value.trim(),
            })
            .eq("id", id),
        );
        showToast("Employé mis à jour.", "success");
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "Modification impossible.",
          "error",
        );
      }
    }),
  );
  outlet
    .querySelectorAll<HTMLButtonElement>("[data-toggle]")
    .forEach((control) =>
      control.addEventListener("click", async () => {
        const person = employees.find(
          (item) => String(item.id) === control.dataset.toggle,
        )!;
        try {
          await mutate(
            getSupabaseClient()
              .from("employes")
              .update({ actif: !person.actif })
              .eq("id", person.id),
          );
          showToast(
            person.actif ? "Employé archivé." : "Employé réactivé.",
            "success",
          );
          await renderEmployees(outlet);
        } catch (error) {
          showToast(
            error instanceof Error ? error.message : "Modification impossible.",
            "error",
          );
        }
      }),
    );
}

function confirmSettings(title: string, description: string): Promise<boolean> {
  return confirmDialog({ title, description });
}

async function renderErpSettings(outlet: HTMLElement): Promise<void> {
  const [settings, treasuryRows] = await Promise.all([
    erpSettings(),
    rows("tresorerie_courante"),
  ]);
  const currentTreasury = Number(treasuryRows[0]?.montant_theorique ?? 0);
  const gradeFields = [
    ["Étudiant", "etudiant", settings.taux_etudiant, settings.plafond_etudiant, settings.prime_max_etudiant],
    ["Adulte", "adulte", settings.taux_adulte, settings.plafond_adulte, settings.prime_max_adulte],
    [
      "Co-Patron",
      "co_patron",
      settings.taux_co_patron,
      settings.plafond_co_patron,
      settings.prime_max_co_patron,
    ],
    ["Patron", "patron", settings.taux_patron, settings.plafond_patron, settings.prime_max_patron],
  ] as const;
  outlet.innerHTML = `<div class="grid gap-5">${panel("Règles financières", `<form data-erp-settings class="p-5"><p class="mb-5 text-sm text-muted">Chaque grade possède son propre pourcentage, plafond et maximum de prime.</p><div class="overflow-x-auto"><table class="w-full min-w-[52rem]"><thead><tr class="border-b text-left"><th class="p-3">Grade</th><th class="p-3">Pourcentage du bénéfice</th><th class="p-3">Plafond (PO)</th><th class="p-3">Prime maximale (PO)</th></tr></thead><tbody>${gradeFields.map(([label, key, rate, ceiling, bonus]) => `<tr class="border-b"><th scope="row" class="p-3 text-left">${label}</th><td class="p-3"><label class="sr-only" for="rate-${key}">Pourcentage ${label}</label><div class="flex items-center gap-2"><input id="rate-${key}" name="taux_${key}" type="number" min="0" max="100" step="0.01" required value="${rate}" class="${field}"><span>%</span></div></td><td class="p-3"><label class="sr-only" for="ceiling-${key}">Plafond ${label}</label><input id="ceiling-${key}" name="plafond_${key}" type="number" min="0" step="1" required value="${ceiling}" class="${field}"></td><td class="p-3"><label class="sr-only" for="bonus-${key}">Prime maximale ${label}</label><input id="bonus-${key}" name="prime_max_${key}" type="number" min="0" step="1" required value="${bonus}" class="${field}"></td></tr>`).join("")}</tbody></table></div><div class="mt-5 max-w-sm"><label class="text-sm font-bold">Taxe ministérielle<div class="mt-2 flex items-center gap-2"><input name="taux_taxe" type="number" min="0" max="100" step="0.01" required value="${settings.taux_taxe}" class="${field}"><span>%</span></div></label></div><button class="mt-5 ${button}">Enregistrer les règles</button></form>`)}${panel("Référence du coffre", `<div class="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p class="text-sm font-bold text-muted">Montant dans le coffre</p><p class="mt-1 text-3xl font-black">${money.format(currentTreasury)} PO</p><p class="mt-2 text-xs text-muted">Dernier recalage le ${dateTime(settings.reference_tresorerie_at)}</p></div><button type="button" data-update-treasury class="${button} shrink-0">Mettre à jour</button></div>`)}${panel("Mot de passe Patron", `<form data-direction-password class="grid gap-4 p-5 sm:grid-cols-2"><p class="text-sm text-muted sm:col-span-2">Le nouveau mot de passe remplacera tous les accès Direction actuels. Il doit contenir au moins 6 caractères.</p><label class="text-sm font-bold">Nouveau mot de passe<input name="password" type="password" minlength="6" autocomplete="new-password" required class="mt-2 ${field}"></label><label class="text-sm font-bold">Confirmer le mot de passe<input name="confirmation" type="password" minlength="6" autocomplete="new-password" required class="mt-2 ${field}"></label><button class="${button} sm:col-span-2 sm:justify-self-start">Modifier le mot de passe</button></form>`)}${panel("Thème de l’interface", `<div class="p-5"><div class="grid max-w-2xl gap-3 sm:grid-cols-2" role="group" aria-label="Choisir le thème de l’interface"><button type="button" data-theme-choice="elixir" class="min-h-20 rounded-xl border p-4 text-left"><strong class="block">Thème Elixir</strong><span class="mt-1 block text-sm text-muted">Interface claire et lumineuse.</span></button><button type="button" data-theme-choice="heritage" class="min-h-20 rounded-xl border p-4 text-left"><strong class="block">Thème Ombrelune</strong><span class="mt-1 block text-sm text-muted">Identité historique bleu nuit.</span></button></div><p class="mt-4 text-sm text-muted">Le choix de ce paramètre est personnel et ne s’appliquera qu’à l’utilisateur actuel.</p></div>`)}</div>`;
  const settingsSections = outlet.firstElementChild as HTMLElement;
  const financialPanel = settingsSections.children[0] as HTMLElement;
  const treasuryPanel = settingsSections.children[1] as HTMLElement;
  const passwordPanel = settingsSections.children[2] as HTMLElement;
  const themePanel = settingsSections.children[3] as HTMLElement;
  const firstRow = document.createElement("div");
  firstRow.className = "grid gap-5 lg:grid-cols-[minmax(0,2.2fr)_minmax(22rem,1fr)] lg:items-stretch";
  const settingsMainColumn = document.createElement("div");
  settingsMainColumn.className = "grid h-full gap-5";
  const settingsSideColumn = document.createElement("div");
  settingsSideColumn.className = "grid h-full gap-5";
  settingsSections.insertBefore(firstRow, financialPanel);
  firstRow.append(settingsMainColumn, settingsSideColumn);
  settingsMainColumn.append(financialPanel, themePanel);
  settingsSideColumn.append(treasuryPanel, passwordPanel);
  const compactPasswordForm = passwordPanel.querySelector<HTMLFormElement>("[data-direction-password]")!;
  compactPasswordForm.className = "grid gap-4 p-5";
  [...compactPasswordForm.children].forEach(child => {
    child.classList.remove("sm:col-span-2", "sm:justify-self-start");
  });
  const treasuryButton = treasuryPanel.querySelector<HTMLButtonElement>("[data-update-treasury]")!;
  treasuryButton.parentElement!.className = "flex flex-col gap-4 p-5";
  treasuryButton.classList.add("w-full");
  treasuryButton.disabled = true;
  treasuryButton.insertAdjacentHTML("beforebegin", `<label class="text-sm font-bold">Nouvelle valeur du coffre (PO)<input data-treasury-amount type="number" min="0" step="0.01" class="mt-2 ${field}" placeholder="Saisir un montant…"></label>`);
  const treasuryAmount = treasuryPanel.querySelector<HTMLInputElement>("[data-treasury-amount]")!;
  const syncTreasuryButton = (): void => {
    const amount = Number(treasuryAmount.value);
    treasuryButton.disabled = treasuryAmount.value.trim() === "" || !Number.isFinite(amount) || amount < 0;
  };
  treasuryAmount.addEventListener("input", syncTreasuryButton);
  const themeButtons = [...outlet.querySelectorAll<HTMLButtonElement>("[data-theme-choice]")];
  const syncThemeChoices = (): void => {
    const selectedTheme = currentTheme();
    themeButtons.forEach(themeButton => {
      const selected = themeButton.dataset.themeChoice === selectedTheme;
      themeButton.setAttribute("aria-pressed", String(selected));
      themeButton.classList.toggle("border-brand", selected);
      themeButton.classList.toggle("bg-brand", selected);
      themeButton.classList.toggle("text-white", selected);
      themeButton.classList.toggle("shadow-[var(--shadow-panel)]", selected);
      themeButton.querySelector("span")?.classList.toggle("text-white/80", selected);
      themeButton.querySelector("span")?.classList.toggle("text-muted", !selected);
    });
  };
  themeButtons.forEach(themeButton => themeButton.addEventListener("click", () => {
    setTheme(themeButton.dataset.themeChoice as VisualTheme);
    syncThemeChoices();
  }));
  syncThemeChoices();
  const settingsForm = outlet.querySelector<HTMLFormElement>(
    "[data-erp-settings]",
  )!;
  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(settingsForm);
    if (
      !(await confirmSettings(
        "Confirmer les paramètres ERP",
        "Les rémunérations de la période en cours et la prochaine clôture utiliseront immédiatement ces nouvelles règles.",
      ))
    )
      return;
    const parameters = Object.fromEntries(
      [...data.entries()].map(([key, value]) => [`p_${key}`, Number(value)]),
    );
    try {
      await callRpc(
        "mettre_a_jour_parametres_erp",
        { p_employe_id: employeeId(), ...parameters },
        z.boolean(),
      );
      showToast("Paramètres ERP enregistrés.", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Modification impossible.",
        "error",
      );
    }
  });
  treasuryButton.addEventListener("click", async () => {
    const amount = Number(treasuryAmount.value);
    if (treasuryButton.disabled || !await confirmSettings(
      "Mettre à jour la référence du coffre",
      `Le montant de référence sera remplacé par ${money.format(amount)} PO et l’action sera journalisée.`,
    )) return;
    await withPending(treasuryButton, "Enregistrement…", async () => {
      try {
        await callRpc(
          "definir_reference_tresorerie",
          { p_employe_id: employeeId(), p_montant: amount },
          z.boolean(),
        );
        showToast("Montant du coffre mis à jour et journalisé.", "success");
        await renderErpSettings(outlet);
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "Modification impossible.",
          "error",
        );
      }
    });
  });
  const passwordForm = outlet.querySelector<HTMLFormElement>(
    "[data-direction-password]",
  )!;
  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(passwordForm);
    const password = String(data.get("password"));
    if (password !== data.get("confirmation")) {
      showToast("Les deux mots de passe ne correspondent pas.", "error");
      return;
    }
    if (
      !(await confirmSettings(
        "Modifier le mot de passe Patron",
        "Les anciens mots de passe Direction ne fonctionneront plus après cette action.",
      ))
    )
      return;
    try {
      await callRpc(
        "modifier_mot_de_passe_direction",
        { p_employe_id: employeeId(), p_nouveau_mot_de_passe: password },
        z.boolean(),
      );
      passwordForm.reset();
      showToast("Mot de passe Direction modifié.", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Modification impossible.",
        "error",
      );
    }
  });
}

async function renderCatalogue(outlet: HTMLElement): Promise<void> {
  const articles = (
    await rows("catalogue", "*,stocks(quantite,stock_max)")
  ).sort((a, b) => String(a.article).localeCompare(String(b.article), "fr"));
  const types = [
    ["objet", "Objet"],
    ["ingredient", "Ingrédient"],
    ["ticket", "Ticket"],
    ["document_permis", "Document permis"],
  ];
  outlet.innerHTML = `${panel("Nouvel article", `<form data-add class="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-6"><label class="text-sm font-bold xl:col-span-2">Article<input name="article" required class="mt-2 ${field}"></label><label class="text-sm font-bold">Type<select name="type" class="mt-2 ${field}">${types.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label class="text-sm font-bold">Prix d’achat<input name="buy" type="number" min="0" step="0.01" value="0" class="mt-2 ${field}"></label><label class="text-sm font-bold">Prix de vente<input name="sell" type="number" min="0" step="0.01" value="0" class="mt-2 ${field}"></label><button class="mt-auto ${button}">Ajouter</button></form>`)}<div class="mt-5">${panel(
    "Catalogue",
    table(
      ["Article", "Type", "Achat", "Vente", "État", "Actions"],
      articles.map((article) => [
        `<input data-article="${escapeHtml(article.id)}" value="${escapeHtml(article.article)}" class="${field}">`,
        `<select data-type="${escapeHtml(article.id)}" class="${field}">${types.map(([value, label]) => `<option value="${value}" ${value === article.type_article ? "selected" : ""}>${label}</option>`).join("")}</select>`,
        `<input data-buy="${escapeHtml(article.id)}" type="number" min="0" step="0.01" value="${escapeHtml(article.prix_achat)}" class="${field}">`,
        `<input data-sell="${escapeHtml(article.id)}" type="number" min="0" step="0.01" value="${escapeHtml(article.prix_vente)}" class="${field}">`,
        article.actif ? "Actif" : "Archivé",
        `<div class="flex gap-2"><button data-save="${escapeHtml(article.id)}" class="min-h-11 rounded-xl border border-accent px-3 font-bold text-accent">Enregistrer</button><button data-toggle="${escapeHtml(article.id)}" class="min-h-11 rounded-xl border px-3 font-bold">${article.actif ? "Archiver" : "Réactiver"}</button></div>`,
      ]),
    ),
  )}</div>`;
  outlet
    .querySelector<HTMLFormElement>("[data-add]")!
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget as HTMLFormElement);
      const type = String(data.get("type"));
      try {
        await mutate(
          getSupabaseClient()
            .from("catalogue")
            .insert({
              article: data.get("article"),
              type_article: type,
              categorie:
                type === "ingredient"
                  ? "Ingrédient"
                  : type === "document_permis"
                    ? "Permis"
                    : "Objet",
              prix_achat: Number(data.get("buy")),
              prix_vente: Number(data.get("sell")),
            }),
        );
        showToast(
          "Article ajouté. Renseignez sa quantité dans l’onglet Stocks.",
          "success",
        );
        await renderCatalogue(outlet);
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "Ajout impossible.",
          "error",
        );
      }
    });
  outlet.querySelectorAll<HTMLButtonElement>("[data-save]").forEach((control) =>
    control.addEventListener("click", async () => {
      const id = control.dataset.save!;
      const type = outlet.querySelector<HTMLSelectElement>(
        `[data-type="${id}"]`,
      )!.value;
      try {
        await mutate(
          getSupabaseClient()
            .from("catalogue")
            .update({
              article: outlet.querySelector<HTMLInputElement>(
                `[data-article="${id}"]`,
              )!.value,
              type_article: type,
              categorie:
                type === "ingredient"
                  ? "Ingrédient"
                  : type === "document_permis"
                    ? "Permis"
                    : "Objet",
              prix_achat: Number(
                outlet.querySelector<HTMLInputElement>(`[data-buy="${id}"]`)!
                  .value,
              ),
              prix_vente: Number(
                outlet.querySelector<HTMLInputElement>(`[data-sell="${id}"]`)!
                  .value,
              ),
            })
            .eq("id", id),
        );
        showToast("Article mis à jour.", "success");
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "Modification impossible.",
          "error",
        );
      }
    }),
  );
  outlet
    .querySelectorAll<HTMLButtonElement>("[data-toggle]")
    .forEach((control) =>
      control.addEventListener("click", async () => {
        const article = articles.find(
          (item) => String(item.id) === control.dataset.toggle,
        )!;
        try {
          await mutate(
            getSupabaseClient()
              .from("catalogue")
              .update({ actif: !article.actif })
              .eq("id", article.id),
          );
          showToast(
            article.actif ? "Article archivé." : "Article réactivé.",
            "success",
          );
          await renderCatalogue(outlet);
        } catch (error) {
          showToast(
            error instanceof Error ? error.message : "Modification impossible.",
            "error",
          );
        }
      }),
    );
}

async function renderRecipes(outlet: HTMLElement): Promise<void> {
  const articles = await rows("catalogue_actif");
  const products = articles.filter((item) => item.type_article === "objet");
  const ingredients = articles.filter(
    (item) => item.type_article === "ingredient",
  );
  outlet.innerHTML = `<div class="grid items-stretch gap-5 xl:grid-cols-[minmax(20rem,.85fr)_minmax(30rem,1.15fr)]">
    ${panel("🧪 Construire une recette", `<form data-recipe class="flex h-full flex-col gap-5 p-5"><label class="text-sm font-bold">1. Produit à fabriquer<select name="product" required class="mt-2 ${field}">${products.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.article)}</option>`).join("")}</select></label><div class="border-t pt-5"><label class="text-sm font-bold">2. Ingrédient requis<select name="ingredient" required class="mt-2 ${field}">${ingredients.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.article)}</option>`).join("")}</select></label><div class="mt-4 grid gap-4 sm:grid-cols-2"><label class="text-sm font-bold">3. Quantité requise<input name="required" type="number" min="1" value="1" class="mt-2 ${field}"></label><label class="text-sm font-bold">Quantité produite par craft<input name="produced" type="number" min="1" value="1" class="mt-2 ${field}"></label></div></div><button class="mt-auto ${button}" ${products.length && ingredients.length ? "" : "disabled"}>+ Ajouter à la recette</button></form>`)}
    ${panel("📜 Recette actuelle", `<div class="p-5"><p class="text-sm text-muted">Sélectionnez un produit à gauche pour consulter et modifier sa recette.</p><div data-current-recipe class="mt-4" aria-live="polite">${asyncState("loading")}</div></div>`)}
  </div>
  <details data-all-recipes class="mt-5 overflow-hidden rounded-2xl border bg-surface shadow-[var(--shadow-panel)]"><summary class="flex min-h-14 cursor-pointer items-center justify-between gap-4 px-5 py-3 font-bold"><span>Liste complète des recettes</span><span class="text-sm font-normal text-muted">Charger et afficher</span></summary><div data-all-recipes-content class="border-t" aria-live="polite"></div></details>`;

  const form = outlet.querySelector<HTMLFormElement>("[data-recipe]")!;
  const productSelect = form.elements.namedItem("product") as HTMLSelectElement;
  const currentRecipe = outlet.querySelector<HTMLElement>("[data-current-recipe]")!;
  const recipeSelect = "*,produit:catalogue!produit_id(article),ingredient:catalogue!ingredient_id(article)";
  let allRecipesLoaded = false;

  const productRecipes = async (productId: string): Promise<Row[]> => {
    const { data, error } = await getSupabaseClient().from("recettes_craft").select(recipeSelect).eq("produit_id", productId).order("id");
    if (error) throw new Error(error.message);
    return z.array(rowSchema).parse(data);
  };

  const recipeRows = (recipes: Row[], includeProduct: boolean): string => table(
    includeProduct ? ["Produit", "Ingrédient", "Requis", "Produit", "Action"] : ["Ingrédient", "Quantité", "Action"],
    recipes.map((recipe) => {
      const product = recipe.produit as Row;
      const ingredient = recipe.ingredient as Row;
      const cells = includeProduct ? [escapeHtml(product?.article)] : [];
      cells.push(
        escapeHtml(ingredient?.article),
        `×${escapeHtml(recipe.quantite_requise)}`,
      );
      if (includeProduct) cells.push(escapeHtml(recipe.quantite_produite));
      cells.push(`<button data-delete-recipe="${escapeHtml(recipe.id)}" class="min-h-10 rounded-xl border px-3 font-bold text-danger">Retirer</button>`);
      return cells;
    }),
  );

  const loadCurrentRecipe = async (): Promise<void> => {
    const product = products.find(item => String(item.id) === productSelect.value);
    currentRecipe.innerHTML = asyncState("loading");
    try {
      const selectedRecipes = await productRecipes(productSelect.value);
      currentRecipe.innerHTML = `<section class="overflow-hidden rounded-xl border border-accent"><div class="bg-surface-muted px-4 py-3"><h3 class="text-lg font-bold">Recette : ${escapeHtml(product?.article ?? "Produit")}</h3></div>${selectedRecipes.length ? recipeRows(selectedRecipes, false) : '<p class="p-6 text-center text-muted">Aucun ingrédient dans cette recette.</p>'}</section>`;
    } catch (error) { currentRecipe.innerHTML = asyncState("error", error instanceof Error ? error.message : undefined); }
  };

  const loadAllRecipes = async (): Promise<void> => {
    const content = outlet.querySelector<HTMLElement>("[data-all-recipes-content]")!;
    content.innerHTML = asyncState("loading");
    try {
      const recipes = await rows("recettes_craft", recipeSelect);
      content.innerHTML = recipes.length ? recipeRows(recipes, true) : '<p class="p-8 text-center text-muted">Aucune recette enregistrée.</p>';
      allRecipesLoaded = true;
    } catch (error) { content.innerHTML = asyncState("error", error instanceof Error ? error.message : undefined); }
  };

  const refreshVisibleRecipes = async (): Promise<void> => {
    await loadCurrentRecipe();
    if (allRecipesLoaded) await loadAllRecipes();
  };

  productSelect.addEventListener("change", () => void loadCurrentRecipe());
  form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget as HTMLFormElement);
      try {
        await mutate(
          getSupabaseClient()
            .from("recettes_craft")
            .insert({
              produit_id: data.get("product"),
              ingredient_id: data.get("ingredient"),
              quantite_requise: Number(data.get("required")),
              quantite_produite: Number(data.get("produced")),
            }),
        );
        showToast("Ligne de recette ajoutée.", "success");
        await refreshVisibleRecipes();
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "Ajout impossible.",
          "error",
        );
      }
    });

  outlet.querySelector<HTMLDetailsElement>("[data-all-recipes]")!.addEventListener("toggle", event => {
    const details = event.currentTarget as HTMLDetailsElement;
    if (details.open && !allRecipesLoaded) void loadAllRecipes();
  });
  outlet.addEventListener("click", async event => {
    const control = (event.target as Element).closest<HTMLButtonElement>("[data-delete-recipe]");
    if (!control) return;
        try {
          await mutate(
            getSupabaseClient()
              .from("recettes_craft")
              .delete()
              .eq("id", control.dataset.deleteRecipe),
          );
          showToast("Ligne supprimée.", "success");
          await refreshVisibleRecipes();
        } catch (error) {
          showToast(
            error instanceof Error ? error.message : "Suppression impossible.",
            "error",
          );
        }
  });
  await loadCurrentRecipe();
}

async function renderStocks(outlet: HTMLElement): Promise<void> {
  const articles = (
    await rows(
      "catalogue",
      "id,article,actif,type_article,stocks(id,quantite,stock_min,stock_max)",
    )
  ).sort((a, b) => String(a.article).localeCompare(String(b.article), "fr"));
  const stockTable = (items: Row[]): string =>
    table(
      [
        "Article",
        "Quantité",
        "Stock minimum",
        "Stock maximal",
        "État",
        "Action",
      ],
      items.map((article) => {
        const relation = Array.isArray(article.stocks)
          ? (article.stocks[0] as Row | undefined)
          : (article.stocks as Row | undefined);
        const quantity = relation?.quantite ?? 0;
        const minimum = relation?.stock_min ?? 0;
        const maximum = relation?.stock_max ?? "";
        return [
          escapeHtml(article.article),
          `<input aria-label="Quantité en stock de ${escapeHtml(article.article)}" data-quantity="${escapeHtml(article.id)}" data-initial="${escapeHtml(quantity)}" type="number" min="0" step="1" value="${escapeHtml(quantity)}" class="${field}">`,
          `<input aria-label="Stock minimum de ${escapeHtml(article.article)}" data-minimum="${escapeHtml(article.id)}" data-initial="${escapeHtml(minimum)}" type="number" min="0" step="1" value="${escapeHtml(minimum)}" class="${field}">`,
          `<input aria-label="Stock maximal de ${escapeHtml(article.article)}" data-maximum="${escapeHtml(article.id)}" data-initial="${escapeHtml(maximum)}" type="number" min="0" step="1" value="${escapeHtml(maximum)}" placeholder="Sans limite" class="${field}">`,
          article.actif ? "Actif" : "Archivé",
          `<button data-save="${escapeHtml(article.id)}" disabled class="min-h-11 rounded-xl border border-accent px-3 font-bold text-accent disabled:opacity-40">Enregistrer</button>`,
        ];
      }),
    );
  const products = articles.filter(
    (article) => article.type_article !== "ingredient",
  );
  const ingredients = articles.filter(
    (article) => article.type_article === "ingredient",
  );
  outlet.innerHTML = panel(
    "Stocks",
    `<p class="border-b p-4 text-sm text-muted">La quantité réelle et les seuils minimum et maximal peuvent alimenter les alertes, scripts et suggestions de rachat. Une ligne modifiée apparaît en jaune ; une valeur invalide apparaît en rouge.</p><div class="flex gap-2 border-b px-4 pt-3" role="tablist" aria-label="Catégories de stocks"><button id="stock-tab-products" type="button" role="tab" data-stock-category="products" aria-controls="stock-panel-products" aria-selected="true" class="min-h-11 border-b-2 border-accent px-4 font-bold text-accent">Articles (${products.length})</button><button id="stock-tab-ingredients" type="button" role="tab" data-stock-category="ingredients" aria-controls="stock-panel-ingredients" aria-selected="false" tabindex="-1" class="min-h-11 border-b-2 border-transparent px-4 font-bold text-muted">Ingrédients (${ingredients.length})</button></div><div id="stock-panel-products" role="tabpanel" aria-labelledby="stock-tab-products">${stockTable(products)}</div><div id="stock-panel-ingredients" role="tabpanel" aria-labelledby="stock-tab-ingredients" hidden>${stockTable(ingredients)}</div>`,
  );
  const categoryControls = [
    ...outlet.querySelectorAll<HTMLButtonElement>("[data-stock-category]"),
  ];
  const categoryPanels = new Map(
    categoryControls.map((categoryControl) => [
      categoryControl.dataset.stockCategory!,
      outlet.querySelector<HTMLElement>(
        `#stock-panel-${categoryControl.dataset.stockCategory}`,
      )!,
    ]),
  );
  const selectCategory = (category: string): void =>
    categoryControls.forEach((categoryControl) => {
      const active = categoryControl.dataset.stockCategory === category;
      categoryControl.setAttribute("aria-selected", String(active));
      categoryControl.tabIndex = active ? 0 : -1;
      categoryControl.classList.toggle("border-accent", active);
      categoryControl.classList.toggle("text-accent", active);
      categoryControl.classList.toggle("border-transparent", !active);
      categoryControl.classList.toggle("text-muted", !active);
      categoryPanels.get(categoryControl.dataset.stockCategory!)!.hidden =
        !active;
    });
  categoryControls.forEach((categoryControl, index) => {
    categoryControl.addEventListener("click", () =>
      selectCategory(categoryControl.dataset.stockCategory!),
    );
    categoryControl.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next =
        categoryControls[
          (index +
            (event.key === "ArrowRight" ? 1 : -1) +
            categoryControls.length) %
            categoryControls.length
        ]!;
      selectCategory(next.dataset.stockCategory!);
      next.focus();
    });
  });
  outlet
    .querySelectorAll<HTMLButtonElement>("[data-save]")
    .forEach((control) => {
      const id = control.dataset.save!;
      const quantity = outlet.querySelector<HTMLInputElement>(
        `[data-quantity="${id}"]`,
      )!;
      const minimum = outlet.querySelector<HTMLInputElement>(
        `[data-minimum="${id}"]`,
      )!;
      const maximum = outlet.querySelector<HTMLInputElement>(
        `[data-maximum="${id}"]`,
      )!;
      const row = control.closest<HTMLTableRowElement>("tr")!;
      const article = articles.find((item) => String(item.id) === id)!;
      const isValidInteger = (
        input: HTMLInputElement,
        optional = false,
      ): boolean =>
        (optional && input.value === "") || /^\d+$/.test(input.value);
      const updateState = (): void => {
        const dirty =
          quantity.value !== quantity.dataset.initial ||
          minimum.value !== minimum.dataset.initial ||
          maximum.value !== maximum.dataset.initial;
        const validValues =
          isValidInteger(quantity) &&
          isValidInteger(minimum) &&
          isValidInteger(maximum, true);
        const validRange =
          maximum.value === "" ||
          Number(minimum.value) <= Number(maximum.value);
        const valid = validValues && validRange;
        row.classList.toggle("bg-warning/15", dirty && valid);
        row.classList.toggle("bg-danger/15", dirty && !valid);
        control.disabled = !dirty || !valid;
      };
      quantity.addEventListener("input", updateState);
      minimum.addEventListener("input", updateState);
      maximum.addEventListener("input", updateState);
      control.addEventListener("click", () => {
        const oldMinimum = minimum.dataset.initial!;
        const newMinimum = minimum.value;
        const oldMaximum =
          maximum.dataset.initial === ""
            ? "Sans limite"
            : maximum.dataset.initial!;
        const newMaximum = maximum.value === "" ? "Sans limite" : maximum.value;
        const dialog = document.createElement("dialog");
        dialog.className =
          "m-auto w-[min(34rem,calc(100%-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-backdrop";
        dialog.innerHTML = `<div class="border-b p-5"><h2 class="text-xl font-bold">Confirmer la modification du stock</h2><p class="mt-2 text-sm text-muted">Vérifiez les nouvelles valeurs de <strong>${escapeHtml(article.article)}</strong>.</p></div><dl class="grid gap-4 p-5 sm:grid-cols-3"><div class="rounded-xl bg-surface-muted p-4"><dt class="text-sm font-bold">Quantité</dt><dd class="mt-2"><span class="text-muted">${escapeHtml(quantity.dataset.initial)}</span> → <strong>${escapeHtml(quantity.value)}</strong></dd></div><div class="rounded-xl bg-surface-muted p-4"><dt class="text-sm font-bold">Stock minimum</dt><dd class="mt-2"><span class="text-muted">${escapeHtml(oldMinimum)}</span> → <strong>${escapeHtml(newMinimum)}</strong></dd></div><div class="rounded-xl bg-surface-muted p-4"><dt class="text-sm font-bold">Stock maximal</dt><dd class="mt-2"><span class="text-muted">${escapeHtml(oldMaximum)}</span> → <strong>${escapeHtml(newMaximum)}</strong></dd></div></dl><div class="flex justify-end gap-3 border-t p-4"><button type="button" data-cancel class="min-h-11 rounded-xl border px-4 font-bold">Annuler</button><button type="button" data-confirm class="min-h-11 rounded-xl bg-brand px-4 font-bold text-white">Confirmer et enregistrer</button></div>`;
        document.body.append(dialog);
        const close = (): void => {
          dialog.close();
          dialog.remove();
        };
        dialog
          .querySelector<HTMLButtonElement>("[data-cancel]")!
          .addEventListener("click", close);
        dialog.addEventListener(
          "cancel",
          (event) => {
            event.preventDefault();
            close();
          },
          { once: true },
        );
        const confirm =
          dialog.querySelector<HTMLButtonElement>("[data-confirm]")!;
        confirm.addEventListener(
          "click",
          () =>
            void withPending(confirm, "Enregistrement…", async () => {
              try {
                await mutate(
                  getSupabaseClient()
                    .from("stocks")
                    .upsert(
                      {
                        article_id: id,
                        quantite: Number(quantity.value),
                        stock_min: Number(minimum.value),
                        stock_max:
                          maximum.value === "" ? null : Number(maximum.value),
                      },
                      { onConflict: "article_id" },
                    ),
                );
                quantity.dataset.initial = quantity.value;
                minimum.dataset.initial = minimum.value;
                maximum.dataset.initial = maximum.value;
                updateState();
                close();
                showToast(`Stock de ${article.article} mis à jour.`, "success");
              } catch (error) {
                showToast(
                  error instanceof Error
                    ? error.message
                    : "Modification impossible.",
                  "error",
                );
              }
            }),
        );
        dialog.showModal();
      });
    });
}

export async function mountDirectionPage(
  outlet: HTMLElement,
  pageId: string,
): Promise<() => void> {
  mountDirectionTabs(outlet, pageId, {
    activities: renderActivities,
    logs: renderLogs,
    summary: renderSummary,
    expenses: renderExpenses,
    employees: renderEmployees,
    settings: renderErpSettings,
    catalogue: renderCatalogue,
    recipes: renderRecipes,
    stocks: renderStocks
  });
  return () => undefined;
}
