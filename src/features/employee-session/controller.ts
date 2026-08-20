import type { EmployeeRow } from "../../data/schemas";
import { getEmployees, refreshEmployees } from "../../data/repositories/employees";
import { clearEmployeeSession, readEmployeeSession, saveEmployeeSession, type EmployeeSession } from "../../core/employee-session";
import { hasDirectionAccess, isDirectionEmployee } from "../../core/employee-session";
import { callRpc } from "../../data/supabase";
import { z } from "zod";
import { getPageFromPath } from "../../core/pages";
import { escapeHtml } from "../../ui/html";
import { icon } from "../../ui/icons";
import { showToast } from "../../ui/components/toast";
import { asyncState } from "../../ui/components/async-state";

function employeeOptions(employees: EmployeeRow[], selectedId?: EmployeeSession["employeeId"]): string {
  return employees.map(employee => `<option value="${escapeHtml(employee.id)}" ${String(employee.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(employee.nom_prenom)}</option>`).join("");
}

function employeeById(employees: EmployeeRow[], id: string): EmployeeRow | undefined {
  return employees.find(employee => String(employee.id) === id);
}

async function openActivityDialog(trigger: HTMLButtonElement): Promise<void> {
  document.querySelector("#employee-activity-dialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "employee-activity-dialog";
  dialog.className = "m-auto max-h-[calc(100dvh-2rem)] w-[min(64rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border bg-canvas p-0 text-ink shadow-2xl backdrop:bg-slate-950/70";
  dialog.innerHTML = `<div class="sticky top-0 z-20 flex items-start justify-between gap-4 border-b bg-canvas/95 p-5 backdrop-blur-xl"><div><p class="text-sm font-bold uppercase tracking-[.14em] text-brand">Gestion</p><h2 class="mt-1 text-2xl font-black">Mon activité</h2><p class="mt-1 text-sm text-muted">Votre activité et vos performances pour la période en cours.</p></div><button type="button" data-close class="grid size-11 shrink-0 place-items-center rounded-xl border bg-surface" aria-label="Fermer">×</button></div><div data-activity-content class="p-4 sm:p-6">${asyncState("loading")}</div><div class="sticky bottom-0 flex justify-end border-t bg-canvas/95 p-4 backdrop-blur-xl"><button type="button" data-close class="min-h-11 rounded-xl bg-brand px-5 font-bold text-white">Fermer</button></div>`;
  document.body.append(dialog);
  let cleanup: (() => void) | undefined;
  const close = (): void => dialog.close();
  dialog.querySelectorAll<HTMLButtonElement>("[data-close]").forEach(button => button.addEventListener("click", close));
  dialog.addEventListener("close", () => { cleanup?.(); dialog.remove(); trigger.focus(); }, { once: true });
  trigger.blur();
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>("[data-close]")!.focus();
  const content = dialog.querySelector<HTMLElement>("[data-activity-content]")!;
  const { mountOperationsPage } = await import("../operations/page");
  if (!dialog.open) return;
  const mountedCleanup = await mountOperationsPage(content, "dashboard");
  if (dialog.open) cleanup = mountedCleanup;
  else mountedCleanup();
}

function syncDirectionNavigation(): void {
  const section = document.querySelector<HTMLElement>('[data-nav-group="direction"]');
  if (section) section.hidden = !hasDirectionAccess();
}

function requestDirectionPassword(employee: EmployeeRow): Promise<boolean> {
  document.querySelector("#direction-password-dialog")?.remove();
  document.body.insertAdjacentHTML("beforeend", `<dialog id="direction-password-dialog" class="m-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-slate-950/70">
    <form class="p-6">
      <p class="text-sm font-bold text-brand">Accès Direction</p>
      <h2 class="mt-1 text-xl font-black">Bonjour ${escapeHtml(employee.nom_prenom)}</h2>
      <p class="mt-2 text-sm text-muted">Saisissez le mot de passe Direction. Il sera vérifié par le serveur et ne sera pas enregistré dans ce navigateur.</p>
      <label for="direction-password" class="mb-2 mt-5 block text-sm font-bold">Mot de passe</label>
      <input id="direction-password" name="password" type="password" required autocomplete="current-password" class="min-h-12 w-full rounded-xl border bg-surface px-3">
      <p data-password-error class="mt-3 text-sm font-semibold text-red-600" role="alert" hidden>Mot de passe incorrect.</p>
      <div class="mt-5 grid grid-cols-2 gap-3"><button type="button" data-cancel class="min-h-11 rounded-xl border font-bold">Annuler</button><button type="submit" class="min-h-11 rounded-xl bg-brand font-bold text-white">Déverrouiller</button></div>
    </form>
  </dialog>`);
  const dialog = document.querySelector<HTMLDialogElement>("#direction-password-dialog")!;
  const form = dialog.querySelector<HTMLFormElement>("form")!;
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  dialog.showModal();
  return new Promise(resolve => {
    const finish = (authorized: boolean): void => { dialog.close(); dialog.remove(); resolve(authorized); };
    dialog.querySelector("[data-cancel]")!.addEventListener("click", () => finish(false));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); }, { once: true });
    form.addEventListener("submit", async event => {
      event.preventDefault(); submit.disabled = true; submit.textContent = "Vérification…";
      try {
        const password = new FormData(form).get("password");
        const authorized = await callRpc("verifier_acces_direction", { p_employe_id: employee.id, p_mot_de_passe: password }, z.boolean());
        if (authorized) finish(true);
        else { form.querySelector<HTMLElement>("[data-password-error]")!.hidden = false; submit.disabled = false; submit.textContent = "Déverrouiller"; }
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Vérification impossible.", "error"); submit.disabled = false; submit.textContent = "Déverrouiller";
      }
    });
  });
}

async function selectEmployee(employee: EmployeeRow): Promise<EmployeeSession | null> {
  const authorized = isDirectionEmployee(employee) ? await requestDirectionPassword(employee) : false;
  if (isDirectionEmployee(employee) && !authorized) return null;
  const session = saveEmployeeSession(employee, authorized);
  syncDirectionNavigation();
  return session;
}

function renderSidebarSelector(employees: EmployeeRow[], session: EmployeeSession | null): void {
  const container = document.querySelector<HTMLElement>("#employee-session-control");
  if (!container) return;
  const activeEmployee = employees.find(employee => String(employee.id) === String(session?.employeeId));
  container.innerHTML = `<div class="group relative w-full">
      <select id="active-employee" class="min-h-11 w-full min-w-0 rounded-xl border bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-muted" aria-label="Employé utilisant l’ERP" aria-describedby="employee-session-help">
        <option value="">Choix employé</option>${employeeOptions(employees, session?.employeeId)}
      </select>
      <div class="mt-2 flex min-h-11 items-center justify-between gap-3"><div class="min-w-0"><p class="text-[.65rem] font-bold uppercase tracking-[.14em] text-muted">Rôle</p><p id="active-employee-role" class="truncate text-sm font-semibold text-ink">${escapeHtml(activeEmployee?.grade ?? "Aucun employé")}</p></div><button id="open-employee-activity" type="button" class="grid size-11 shrink-0 place-items-center rounded-xl border bg-surface text-brand hover:bg-surface-muted disabled:opacity-40" aria-label="Ouvrir mon activité" title="Mon activité" ${session ? "" : "disabled"}>${icon("chart", "size-5")}</button></div>
      <span id="employee-session-help" role="tooltip" class="pointer-events-none absolute left-0 top-[calc(100%+.45rem)] z-50 w-full translate-y-1 rounded-lg bg-slate-950 px-3 py-2 text-xs text-white opacity-0 shadow-xl transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">L’employé choisi est sauvegardé pendant 12 heures.</span>
    </div>`;

  container.querySelector<HTMLSelectElement>("#active-employee")!.addEventListener("change", async event => {
    const select = event.currentTarget as HTMLSelectElement;
    const employee = employeeById(employees, select.value);
    if (!employee) return;
    const previousId = readEmployeeSession()?.employeeId;
    const session = await selectEmployee(employee);
    if (!session) { select.value = previousId == null ? "" : String(previousId); return; }
    renderSidebarSelector(employees, session);
    showToast(`${employee.nom_prenom} utilise maintenant l’ERP.`, "success");
    if (!hasDirectionAccess() && getPageFromPath(location.pathname).group === "direction") location.assign("/caisse");
  });
  container.querySelector<HTMLButtonElement>("#open-employee-activity")!.addEventListener("click", event => void openActivityDialog(event.currentTarget as HTMLButtonElement));
}

function createSelectionDialog(employees: EmployeeRow[], onSelected: () => void): HTMLDialogElement {
  document.querySelector("#employee-session-dialog")?.remove();
  document.body.insertAdjacentHTML("beforeend", `<dialog id="employee-session-dialog" class="m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-slate-950/70">
    <form id="employee-session-form" class="p-6 sm:p-7">
      <span class="mb-5 grid size-12 place-items-center rounded-2xl bg-brand/10 text-brand">${icon("badge", "size-6")}</span>
      <p class="text-sm font-bold text-brand">Bienvenue sur Ombrelune</p>
      <h2 class="mt-1 text-2xl font-black tracking-tight">Qui utilise l’ERP ?</h2>
      <p class="mt-2 text-sm text-muted">Choisissez votre nom. Cette sélection sera utilisée sur toutes les pages pendant les 12 prochaines heures.</p>
      <label for="employee-session-select" class="mb-2 mt-6 block text-sm font-bold">Employé</label>
      <select id="employee-session-select" required class="min-h-12 w-full rounded-xl border bg-surface px-3 py-2 text-ink">
        <option value="">Sélectionner votre nom</option>${employeeOptions(employees)}
      </select>
      <button type="submit" class="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-brand bg-brand px-4 py-2 font-bold text-white hover:bg-brand-strong">Continuer</button>
    </form>
  </dialog>`);

  const dialog = document.querySelector<HTMLDialogElement>("#employee-session-dialog")!;
  dialog.addEventListener("cancel", event => event.preventDefault());
  dialog.querySelector<HTMLFormElement>("#employee-session-form")!.addEventListener("submit", async event => {
    event.preventDefault();
    const select = dialog.querySelector<HTMLSelectElement>("#employee-session-select")!;
    const employee = employeeById(employees, select.value);
    if (!employee) return;
    const session = await selectEmployee(employee);
    if (!session) return;
    renderSidebarSelector(employees, session);
    syncDirectionNavigation();
    dialog.close();
    showToast(`Bienvenue, ${employee.nom_prenom}.`, "success");
    onSelected();
  });
  return dialog;
}

function renderLoadError(): void {
  const container = document.querySelector<HTMLElement>("#employee-session-control");
  if (!container) return;
  container.innerHTML = `<p class="text-sm font-bold text-red-600">Employés indisponibles</p><button id="retry-employees" type="button" class="mt-2 min-h-11 w-full rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-surface-muted">Réessayer</button>`;
  container.querySelector("#retry-employees")!.addEventListener("click", () => void mountEmployeeSession(true));
}

export async function mountEmployeeSession(forceRefresh = false): Promise<void> {
  const container = document.querySelector<HTMLElement>("#employee-session-control");
  if (!container) return;
  container.innerHTML = '<p class="text-sm text-muted" role="status">Chargement des employés…</p>';

  try {
    const employees = await (forceRefresh ? refreshEmployees() : getEmployees());
    let session = readEmployeeSession();
    const sessionEmployeeId = session?.employeeId;
    if (session && !employees.some(employee => String(employee.id) === String(sessionEmployeeId))) {
      clearEmployeeSession();
      session = null;
    }
    renderSidebarSelector(employees, session);
    if (!session) await new Promise<void>(resolve => createSelectionDialog(employees, resolve).showModal());
  } catch {
    renderLoadError();
  }
}
