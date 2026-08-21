import { z } from "zod";
import { readEmployeeSession } from "../../core/employee-session";
import { searchClients } from "../../data/repositories/pos";
import type { ClientRow } from "../../data/schemas";
import { callRpc, getSupabaseClient } from "../../data/supabase";
import { asyncState, bindRetry } from "../../ui/components/async-state";
import { confirmDialog } from "../../ui/components/dialog";
import { showToast } from "../../ui/components/toast";
import { escapeHtml } from "../../ui/html";

type PermitPageId = "permis-balais" | "permis-voiture" | "permis-moto";
type ClientSelection = ClientRow | null;

interface PermitConfig {
  dbType: "broomstick" | "car" | "motorcycle";
  legacyType: "Balais" | "Voiture" | "Moto";
  label: string;
  emoji: string;
}

const configs: Record<PermitPageId, PermitConfig> = {
  "permis-balais": { dbType: "broomstick", legacyType: "Balais", label: "balais", emoji: "🧹" },
  "permis-voiture": { dbType: "car", legacyType: "Voiture", label: "voiture", emoji: "🚗" },
  "permis-moto": { dbType: "motorcycle", legacyType: "Moto", label: "moto", emoji: "🏍️" }
};

const clientSchema = z.object({ id: z.union([z.string(), z.number()]), nom_prenom: z.string(), hibou: z.string().nullable() });
const permitSchema = z.object({ id: z.union([z.string(), z.number()]), attempts: z.coerce.number(), notes: z.string(), passage_date: z.string().nullable(), status: z.string() });
const waitingSchema = z.object({ id: z.union([z.string(), z.number()]), client_id: z.union([z.string(), z.number()]).nullable(), candidat: z.string(), hibou: z.string().nullable(), notes: z.string().nullable(), hibou_envoye: z.boolean() });
const clientWithPermitsSchema = clientSchema.extend({ client_permits: z.array(permitSchema) });

const employeeId = (): string | number => {
  const employee = readEmployeeSession();
  if (!employee) throw new Error("Sélectionnez un employé.");
  return employee.employeeId;
};

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function createClientDialog(nameValue: string, owlValue: string): Promise<ClientRow | null> {
  const dialog = document.createElement("dialog");
  dialog.className = "m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-backdrop";
  dialog.innerHTML = `<form class="p-5"><h2 class="text-xl font-bold">Créer le client</h2><p class="mt-1 text-sm text-muted">Les informations saisies ont été reprises automatiquement.</p><div class="mt-5 grid gap-4"><label class="text-sm font-bold">Nom et prénom<input name="name" required minlength="2" value="${escapeHtml(nameValue)}" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"></label><label class="text-sm font-bold">Hibou<input name="owl" required inputmode="numeric" pattern="[0-9]{2,5}" value="${escapeHtml(owlValue)}" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"></label></div><div class="mt-6 flex justify-end gap-3"><button type="button" data-cancel class="min-h-11 rounded-xl border px-4 font-bold">Annuler</button><button class="min-h-11 rounded-xl bg-brand px-4 font-bold text-white">Créer le client</button></div></form>`;
  document.body.append(dialog);
  return new Promise(resolve => {
    const close = (client: ClientRow | null): void => { dialog.close(); dialog.remove(); resolve(client); };
    dialog.querySelector("[data-cancel]")!.addEventListener("click", () => close(null));
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(null); }, { once: true });
    dialog.querySelector("form")!.addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const name = String(form.get("name") ?? "").trim();
      const owl = String(form.get("owl") ?? "").trim();
      try {
        const id = await callRpc("creer_client", { p_nom_prenom: name, p_hibou: owl, p_employe_id: employeeId() }, z.union([z.string(), z.number()]));
        showToast("Client créé et sélectionné.", "success");
        close(clientSchema.parse({ id, nom_prenom: name, hibou: owl }));
      } catch (error) { showToast(error instanceof Error ? error.message : "Création impossible.", "error"); }
    });
    dialog.showModal();
  });
}

function openPermitDialog(client: ClientRow, permit: z.infer<typeof permitSchema>, config: PermitConfig): void {
  const statusLabels: Record<string, string> = {
    pending: "En attente",
    accepted: "Validé",
    refused: "Refusé",
    cancelled: "Annulé",
    sold: "Vendu"
  };
  const passageDate = permit.passage_date
    ? new Date(`${permit.passage_date}T12:00:00`).toLocaleDateString("fr-FR")
    : "Non renseignée";
  const dialog = document.createElement("dialog");
  dialog.className = "m-auto w-[min(38rem,calc(100%-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-backdrop";
  dialog.setAttribute("aria-labelledby", "permit-file-title");
  dialog.innerHTML = `<div>
    <div class="flex items-start justify-between gap-4 border-b p-5"><div><p class="text-sm font-bold uppercase tracking-wide text-accent">Dossier client</p><h2 id="permit-file-title" class="mt-1 text-xl font-bold">${escapeHtml(client.nom_prenom)}</h2><p class="mt-1 text-sm text-muted">Hibou ${escapeHtml(client.hibou ?? "non renseigné")}</p></div><button type="button" data-close class="grid size-11 shrink-0 place-items-center rounded-xl border text-xl" aria-label="Fermer">×</button></div>
    <div class="p-5"><div class="grid gap-3 sm:grid-cols-2"><section class="rounded-xl bg-surface-muted p-4"><p class="text-xs font-bold uppercase tracking-wide text-muted">Permis</p><strong class="mt-1 block">${config.emoji} Permis ${config.label}</strong></section><section class="rounded-xl bg-surface-muted p-4"><p class="text-xs font-bold uppercase tracking-wide text-muted">Statut</p><strong class="mt-1 block">${escapeHtml(statusLabels[permit.status] ?? permit.status)}</strong></section><section class="rounded-xl bg-surface-muted p-4"><p class="text-xs font-bold uppercase tracking-wide text-muted">Dernier passage</p><strong class="mt-1 block">${escapeHtml(passageDate)}</strong></section><section class="rounded-xl bg-surface-muted p-4"><p class="text-xs font-bold uppercase tracking-wide text-muted">Tentatives</p><strong class="mt-1 block">${permit.attempts}</strong></section></div><section class="mt-3 rounded-xl border p-4"><p class="text-xs font-bold uppercase tracking-wide text-muted">Note du dossier</p><p class="mt-2 whitespace-pre-wrap ${permit.notes ? "" : "text-muted"}">${escapeHtml(permit.notes || "Aucune note renseignée.")}</p></section></div>
    <div class="flex justify-end border-t p-4"><button type="button" data-close class="min-h-11 rounded-xl bg-brand px-5 font-bold text-white">Fermer</button></div>
  </div>`;
  document.body.append(dialog);
  const close = (): void => { dialog.close(); dialog.remove(); };
  dialog.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); }, { once: true });
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>("[data-close]")?.focus();
}

function bindClientPicker(options: {
  name: HTMLInputElement;
  owl: HTMLInputElement;
  results: HTMLElement;
  onSelection: (client: ClientSelection) => void;
  onResults?: (count: number | null) => void;
}): { get: () => ClientSelection; select: (client: ClientSelection) => void } {
  let selected: ClientSelection = null;
  let sequence = 0;
  const select = (client: ClientSelection): void => {
    selected = client;
    if (client) { options.name.value = client.nom_prenom; options.owl.value = client.hibou ?? ""; options.results.hidden = true; }
    options.onSelection(client);
  };
  const find = async (field: "name" | "owl", term: string): Promise<void> => {
    const current = ++sequence;
    select(null);
    if (!term || (field === "name" && term.length < 2)) { options.results.hidden = true; options.onResults?.(null); return; }
    try {
      const clients = await searchClients(term, field);
      if (current !== sequence) return;
      options.onResults?.(clients.length);
      options.results.hidden = false;
      options.results.innerHTML = clients.length
        ? clients.map(client => `<button type="button" data-client="${escapeHtml(client.id)}" class="flex min-h-12 w-full items-center justify-between gap-4 border-b px-3 py-2 text-left hover:bg-surface-muted"><strong>${escapeHtml(client.nom_prenom)}</strong><span class="text-muted">${escapeHtml(client.hibou ?? "Sans hibou")}</span></button>`).join("")
        : '<p class="p-3 text-sm text-muted">Aucun client trouvé. Vous pouvez créer une nouvelle fiche.</p>';
      options.results.querySelectorAll<HTMLButtonElement>("[data-client]").forEach(button => button.addEventListener("click", () => select(clients.find(client => String(client.id) === button.dataset.client) ?? null)));
    } catch (error) { options.onResults?.(null); options.results.innerHTML = `<p class="p-3 text-sm text-danger">${escapeHtml(error instanceof Error ? error.message : "Recherche impossible.")}</p>`; }
  };
  options.name.addEventListener("input", () => void find("name", options.name.value.trim()));
  options.owl.addEventListener("input", () => void find("owl", options.owl.value.trim()));
  return { get: () => selected, select };
}

async function render(outlet: HTMLElement, config: PermitConfig): Promise<void> {
  const [waitingResponse, clientsResponse] = await Promise.all([
    getSupabaseClient().from("inscriptions_permis").select("id,client_id,candidat,hibou,notes,hibou_envoye").eq("type_permis", config.legacyType).order("id"),
    getSupabaseClient().from("clients_actifs").select("id,nom_prenom,hibou,client_permits(id,attempts,notes,passage_date,status,type)").eq("client_permits.type", config.dbType).order("nom_prenom")
  ]);
  if (waitingResponse.error) throw new Error(waitingResponse.error.message);
  if (clientsResponse.error) throw new Error(clientsResponse.error.message);
  const waiting = z.array(waitingSchema).parse(waitingResponse.data);
  const dossierClients = z.array(clientWithPermitsSchema).parse(clientsResponse.data).filter(client => client.client_permits.length);
  outlet.innerHTML = `<div class="grid items-stretch gap-5 xl:grid-cols-[minmax(22rem,.9fr)_minmax(34rem,1.35fr)]">
    <section class="flex h-full flex-col overflow-hidden rounded-2xl border bg-surface shadow-[var(--shadow-panel)]">
      <div class="border-b p-5"><h2 class="text-xl font-bold"><span aria-hidden="true">${config.emoji}</span> Nouveau passage — permis ${config.label}</h2><p class="mt-1 text-sm text-muted">Sélectionnez un client puis créez ou mettez à jour son dossier.</p></div>
      <form id="permit-passage-form" class="flex flex-1 flex-col p-5"><div class="grid gap-4"><label class="text-sm font-bold">Nom et prénom<input id="passage-name" autocomplete="off" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3" placeholder="Rechercher par nom…"></label><label class="text-sm font-bold">Hibou<input id="passage-owl" autocomplete="off" inputmode="numeric" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3" placeholder="Rechercher par hibou…"></label><div id="passage-results" class="max-h-44 overflow-y-auto rounded-xl border" hidden></div><p id="passage-client-status" class="text-sm text-muted">Sélectionnez un client dans les résultats.</p><div class="grid gap-4 sm:grid-cols-2"><label class="text-sm font-bold">Date de passage<input id="passage-date" type="date" required value="${today()}" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"></label><label class="text-sm font-bold">Résultat<select id="passage-result" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"><option value="success">Réussite</option><option value="failure">Échec</option></select></label></div><label class="text-sm font-bold">Nombre de tentatives<input id="passage-attempts" type="number" min="1" required value="1" class="mt-2 min-h-11 w-full rounded-xl border bg-surface px-3"></label><label class="text-sm font-bold">Note du dossier<textarea id="passage-notes" class="mt-2 min-h-24 w-full rounded-xl border bg-surface px-3 py-2" placeholder="Suivi des tentatives, suspension, interdiction…"></textarea></label></div><div class="mt-auto grid gap-3 pt-6"><button id="client-action" type="button" disabled class="min-h-11 rounded-xl border px-4 font-bold disabled:opacity-50">Sélectionner un client</button><button id="submit-passage" disabled class="min-h-12 rounded-xl bg-brand px-4 font-bold text-white disabled:opacity-50">Valider le passage</button></div></form>
    </section>
    <section class="flex h-full min-h-[38rem] flex-col overflow-hidden rounded-2xl border bg-surface shadow-[var(--shadow-panel)]">
      <div class="border-b p-5"><h2 class="text-xl font-bold">📝 Liste d’inscriptions</h2><p class="mt-1 text-sm text-muted">Liste indicative des personnes intéressées par le permis ${config.label}.</p></div>
      <form id="waiting-form" class="border-b bg-surface-muted p-4"><div class="grid gap-3 md:grid-cols-[minmax(10rem,1fr)_9rem_minmax(12rem,1fr)_auto]"><label class="text-sm font-bold">Nom et prénom<input id="waiting-name" autocomplete="off" class="mt-1 min-h-11 w-full rounded-xl border bg-surface px-3" placeholder="Nom…"></label><label class="text-sm font-bold">Hibou<input id="waiting-owl" autocomplete="off" inputmode="numeric" class="mt-1 min-h-11 w-full rounded-xl border bg-surface px-3" placeholder="Numéro…"></label><label class="text-sm font-bold">Notes / disponibilités<input id="waiting-notes" class="mt-1 min-h-11 w-full rounded-xl border bg-surface px-3" placeholder="Disponible le soir…"></label><button id="waiting-action" disabled class="mt-auto min-h-11 rounded-xl bg-brand px-4 font-bold text-white disabled:opacity-50">Ajouter</button></div><div id="waiting-results" class="mt-2 max-h-40 overflow-y-auto rounded-xl border bg-surface" hidden></div><p id="waiting-status" class="mt-2 text-sm text-muted">Sélectionnez un client existant.</p></form>
      <div class="min-h-0 flex-1 overflow-auto" aria-live="polite">${waiting.length ? `<table class="w-full min-w-[42rem] text-left"><thead class="sticky top-0 bg-surface-muted"><tr><th class="px-4 py-3">Candidat</th><th class="px-4 py-3">Hibou</th><th class="px-4 py-3">Notes</th><th class="px-4 py-3 text-center">Hibou envoyé</th><th class="px-4 py-3 text-right">Action</th></tr></thead><tbody>${waiting.map(item => `<tr class="border-t"><td class="px-4 py-3 font-bold">${escapeHtml(item.candidat)}</td><td class="px-4 py-3">${escapeHtml(item.hibou ?? "—")}</td><td class="px-4 py-3 text-muted">${escapeHtml(item.notes ?? "—")}</td><td class="px-4 py-3 text-center"><input data-sent="${escapeHtml(item.id)}" type="checkbox" ${item.hibou_envoye ? "checked" : ""} class="size-6" aria-label="Hibou envoyé à ${escapeHtml(item.candidat)}"></td><td class="px-4 py-3 text-right"><button data-remove="${escapeHtml(item.id)}" class="min-h-10 rounded-lg border px-3 font-bold text-danger" aria-label="Retirer ${escapeHtml(item.candidat)} de la liste">Retirer</button></td></tr>`).join("")}</tbody></table>` : '<p class="p-8 text-center text-muted">Aucun candidat dans la liste d’attente.</p>'}</div>
    </section>
  </div>
  <section class="mt-5 overflow-hidden rounded-2xl border bg-surface shadow-[var(--shadow-panel)]"><div class="border-b p-5"><h2 class="text-xl font-bold">🔍 Rechercher un dossier — permis ${config.label}</h2><p class="mt-1 text-sm text-muted">Recherchez par nom, prénom ou numéro de hibou.</p><label for="permit-file-search" class="sr-only">Rechercher un dossier</label><input id="permit-file-search" type="search" autocomplete="off" class="mt-4 min-h-12 w-full rounded-xl border bg-surface px-4" placeholder="Nom, prénom ou numéro de hibou…"></div><div id="permit-file-results" aria-live="polite"><p class="p-8 text-center text-muted">Saisissez au moins deux caractères pour afficher un dossier.</p></div></section>`;

  const passageName = outlet.querySelector<HTMLInputElement>("#passage-name")!;
  const passageOwl = outlet.querySelector<HTMLInputElement>("#passage-owl")!;
  const passageStatus = outlet.querySelector<HTMLElement>("#passage-client-status")!;
  const clientAction = outlet.querySelector<HTMLButtonElement>("#client-action")!;
  const submitPassage = outlet.querySelector<HTMLButtonElement>("#submit-passage")!;
  let currentPermit: z.infer<typeof permitSchema> | null = null;
  let passageMayCreate = false;
  const updatePassageCreateAction = (): void => {
    if (passagePicker.get()) return;
    const valid = passageName.value.trim().length >= 2 && /^\d{2,5}$/.test(passageOwl.value.trim());
    clientAction.disabled = !(passageMayCreate && valid);
    clientAction.textContent = clientAction.disabled ? "Sélectionner un client" : "Créer le client";
    passageStatus.textContent = clientAction.disabled ? "Sélectionnez un client dans les résultats." : "Aucun client correspondant. Vous pouvez créer sa fiche.";
  };
  const passagePicker = bindClientPicker({ name: passageName, owl: passageOwl, results: outlet.querySelector("#passage-results")!, onSelection: client => void syncPassageClient(client), onResults: count => { passageMayCreate = count === 0; updatePassageCreateAction(); } });

  async function syncPassageClient(client: ClientSelection): Promise<void> {
    currentPermit = null;
    submitPassage.disabled = !client;
    if (!client) {
      updatePassageCreateAction();
      return;
    }
    passageStatus.textContent = `Client sélectionné : ${client.nom_prenom}. Vérification du dossier…`;
    const response = await getSupabaseClient().from("client_permits").select("id,attempts,notes,passage_date,status").eq("client_id", client.id).eq("type", config.dbType).maybeSingle();
    if (response.error) { showToast(response.error.message, "error"); return; }
    currentPermit = response.data ? permitSchema.parse(response.data) : null;
    clientAction.disabled = !currentPermit;
    clientAction.textContent = currentPermit ? "Voir le dossier client" : "Aucun dossier client";
    if (currentPermit) {
      outlet.querySelector<HTMLInputElement>("#passage-attempts")!.value = String(currentPermit.attempts + 1);
      outlet.querySelector<HTMLTextAreaElement>("#passage-notes")!.value = currentPermit.notes;
      passageStatus.textContent = `Dossier existant trouvé — statut actuel : ${currentPermit.status}.`;
    } else passageStatus.textContent = "Ce client n’a pas encore de dossier pour ce permis.";
  }

  const refreshUnselectedAction = (): void => { passageMayCreate = false; if (!passagePicker.get()) void syncPassageClient(null); };
  passageName.addEventListener("input", refreshUnselectedAction);
  passageOwl.addEventListener("input", refreshUnselectedAction);
  clientAction.addEventListener("click", async () => {
    const client = passagePicker.get();
    if (client && currentPermit) { openPermitDialog(client, currentPermit, config); return; }
    if (!client) {
      const created = await createClientDialog(passageName.value.trim(), passageOwl.value.trim());
      if (created) passagePicker.select(created);
    }
  });
  outlet.querySelector<HTMLFormElement>("#permit-passage-form")!.addEventListener("submit", async event => {
    event.preventDefault(); const client = passagePicker.get(); if (!client) return;
    try {
      await callRpc("enregistrer_passage_permis_dossier", { p_client_id: client.id, p_type: config.dbType, p_date_passage: outlet.querySelector<HTMLInputElement>("#passage-date")!.value, p_resultat: outlet.querySelector<HTMLSelectElement>("#passage-result")!.value, p_tentatives: Number(outlet.querySelector<HTMLInputElement>("#passage-attempts")!.value), p_notes: outlet.querySelector<HTMLTextAreaElement>("#passage-notes")!.value, p_employe_id: employeeId() }, z.union([z.string(), z.number()]));
      showToast("Passage enregistré et dossier mis à jour.", "success"); await render(outlet, config);
    } catch (error) { showToast(error instanceof Error ? error.message : "Enregistrement impossible.", "error"); }
  });

  const waitingName = outlet.querySelector<HTMLInputElement>("#waiting-name")!;
  const waitingOwl = outlet.querySelector<HTMLInputElement>("#waiting-owl")!;
  const waitingStatus = outlet.querySelector<HTMLElement>("#waiting-status")!;
  const waitingAction = outlet.querySelector<HTMLButtonElement>("#waiting-action")!;
  let waitingMayCreate = false;
  const waitingPicker = bindClientPicker({ name: waitingName, owl: waitingOwl, results: outlet.querySelector("#waiting-results")!, onSelection: client => { waitingMayCreate = false; waitingAction.disabled = !client; waitingAction.textContent = "Ajouter"; waitingStatus.textContent = client ? `Client sélectionné : ${client.nom_prenom}.` : "Recherchez un client existant."; }, onResults: count => { waitingMayCreate = count === 0 && waitingName.value.trim().length >= 2 && /^\d{2,5}$/.test(waitingOwl.value.trim()); waitingAction.disabled = !waitingMayCreate; waitingAction.textContent = waitingMayCreate ? "Créer le client" : "Ajouter"; if (waitingMayCreate) waitingStatus.textContent = "Aucun client correspondant. Vous pouvez créer sa fiche."; } });
  outlet.querySelector<HTMLFormElement>("#waiting-form")!.addEventListener("submit", async event => {
    event.preventDefault(); const client = waitingPicker.get();
    if (!client && waitingMayCreate) {
      const created = await createClientDialog(waitingName.value.trim(), waitingOwl.value.trim());
      if (created) waitingPicker.select(created);
      return;
    }
    if (!client) { showToast("Sélectionnez d’abord le client.", "error"); return; }
    const response = await getSupabaseClient().from("inscriptions_permis").insert({ type_permis: config.legacyType, client_id: client.id, candidat: client.nom_prenom, hibou: client.hibou, notes: outlet.querySelector<HTMLInputElement>("#waiting-notes")!.value.trim() || null });
    if (response.error) showToast(response.error.message, "error"); else { showToast("Candidat ajouté à la liste indicative.", "success"); await render(outlet, config); }
  });
  outlet.querySelectorAll<HTMLInputElement>("[data-sent]").forEach(input => input.addEventListener("change", async () => { const response = await getSupabaseClient().from("inscriptions_permis").update({ hibou_envoye: input.checked }).eq("id", input.dataset.sent!); if (response.error) { input.checked = !input.checked; showToast(response.error.message, "error"); } }));
  outlet.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach(button => button.addEventListener("click", async () => { if (!await confirmDialog({ title: "Retirer cette inscription ?", description: "Seule la liste indicative sera modifiée. Le client et ses dossiers seront conservés.", confirmLabel: "Retirer", variant: "danger", size: "small" })) return; const response = await getSupabaseClient().from("inscriptions_permis").delete().eq("id", button.dataset.remove!); if (response.error) showToast(response.error.message, "error"); else await render(outlet, config); }));

  const fileSearch = outlet.querySelector<HTMLInputElement>("#permit-file-search")!;
  const fileResults = outlet.querySelector<HTMLElement>("#permit-file-results")!;
  const normalize = (value: unknown): string => String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
  const drawFiles = (): void => {
    const term = normalize(fileSearch.value.trim());
    if (term.length < 2) { fileResults.innerHTML = '<p class="p-8 text-center text-muted">Saisissez au moins deux caractères pour afficher un dossier.</p>'; return; }
    const matches = dossierClients.filter(client => normalize(`${client.nom_prenom} ${client.hibou}`).includes(term));
    fileResults.innerHTML = matches.length ? `<div class="divide-y">${matches.map(client => { const permit = client.client_permits[0]!; return `<article class="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5"><div><strong class="text-lg">${escapeHtml(client.nom_prenom)}</strong><p class="mt-1 text-sm text-muted">Hibou ${escapeHtml(client.hibou ?? "—")} · ${permit.attempts} tentative(s)</p></div><button type="button" data-open-file="${escapeHtml(client.id)}" class="min-h-11 rounded-xl border border-accent px-4 font-bold text-accent">Voir le dossier client</button></article>`; }).join("")}</div>` : '<p class="p-8 text-center text-muted">Aucun dossier correspondant pour ce permis.</p>';
    fileResults.querySelectorAll<HTMLButtonElement>("[data-open-file]").forEach(button => button.addEventListener("click", () => { const client = dossierClients.find(item => String(item.id) === button.dataset.openFile); if (client) openPermitDialog(client, client.client_permits[0]!, config); }));
  };
  fileSearch.addEventListener("input", drawFiles);
}

export async function mountPermitPage(outlet: HTMLElement, pageId: string): Promise<() => void> {
  let active = true;
  const config = configs[pageId as PermitPageId];
  outlet.innerHTML = asyncState("loading");
  try { await render(outlet, config); }
  catch (error) { if (active) { outlet.innerHTML = asyncState("error", error instanceof Error ? error.message : undefined, "Réessayer"); bindRetry(outlet, () => void mountPermitPage(outlet, pageId)); } }
  return () => { active = false; };
}
