const normalize = (value: unknown): string => String(value).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr").trim();

export function isCompass(articleName: unknown): boolean {
  return normalize(articleName) === "boussole";
}

export function isCompassSupplement(articleName: unknown): boolean {
  return normalize(articleName) === "supplement boussole";
}

export function confirmCompassSupplement(): Promise<boolean | null> {
  const dialog = document.createElement("dialog");
  dialog.className = "m-auto w-[min(34rem,calc(100%-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-slate-950/70";
  dialog.innerHTML = `<div class="border-b p-5"><h2 class="text-xl font-bold">Tarif de la boussole</h2><p class="mt-2 text-sm text-muted">Vérifiez la carte de l’étudiant. Le tarif de 4 000 PO est réservé aux étudiants de première année, premier semestre (A1S1).</p></div><div class="p-5"><label class="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border bg-surface-muted p-4"><input data-supplement type="checkbox" class="mt-1 size-5 shrink-0 accent-[var(--color-brand)]"><span><strong class="block">Le client n’est pas A1S1</strong><span class="mt-1 block text-sm text-muted">Ajouter automatiquement le supplément boussole de 2 000 PO.</span></span></label></div><div class="flex justify-end gap-3 border-t p-4"><button type="button" data-cancel class="min-h-11 rounded-xl border px-4 font-bold">Annuler</button><button type="button" data-confirm class="min-h-11 rounded-xl bg-brand px-4 font-bold text-white">Valider</button></div>`;
  document.body.append(dialog); dialog.showModal();
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: boolean | null): void => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(result); };
    dialog.querySelector("[data-cancel]")!.addEventListener("click", () => finish(null));
    dialog.querySelector("[data-confirm]")!.addEventListener("click", () => finish(dialog.querySelector<HTMLInputElement>("[data-supplement]")!.checked));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); }, { once: true });
  });
}

export function compassDecisionLabel(withSupplement: boolean): string {
  return withSupplement ? "Tarif hors A1S1 avec supplément" : "Tarif A1S1 sans supplément";
}
