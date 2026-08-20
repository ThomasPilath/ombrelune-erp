const normalize = (value: unknown): string => String(value)
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLocaleLowerCase("fr")
  .trim();

export function isContractBook(articleName: unknown): boolean {
  return normalize(articleName) === "carnet de contrat";
}

export function confirmGuildCard(): Promise<boolean> {
  const dialog = document.createElement("dialog");
  dialog.className = "m-auto w-[min(34rem,calc(100%-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-slate-950/70";
  dialog.innerHTML = `<div class="border-b p-5"><p class="text-sm font-bold text-brand">Vérification obligatoire</p><h2 class="mt-1 text-xl font-bold">Carte de guilde</h2><p class="mt-2 text-sm text-muted">Le carnet de contrat ne peut être vendu qu’après vérification de la carte de guilde de l’acheteur.</p></div><div class="p-5"><label class="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border bg-surface-muted p-4"><input data-guild-card type="checkbox" class="mt-1 size-5 shrink-0 accent-[var(--color-brand)]"><span><strong class="block">Carte de guilde vérifiée</strong><span class="mt-1 block text-sm text-muted">La carte est valide et correspond bien à la personne qui réalise l’achat.</span></span></label></div><div class="flex justify-end gap-3 border-t p-4"><button type="button" data-cancel class="min-h-11 rounded-xl border px-4 font-bold">Annuler</button><button type="button" data-confirm disabled class="min-h-11 rounded-xl bg-brand px-4 font-bold text-white disabled:opacity-40">Ajouter au panier</button></div>`;
  document.body.append(dialog);
  dialog.showModal();

  return new Promise(resolve => {
    let settled = false;
    const checkbox = dialog.querySelector<HTMLInputElement>("[data-guild-card]")!;
    const confirm = dialog.querySelector<HTMLButtonElement>("[data-confirm]")!;
    const finish = (verified: boolean): void => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(verified);
    };

    checkbox.addEventListener("change", () => { confirm.disabled = !checkbox.checked; });
    dialog.querySelector("[data-cancel]")!.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(checkbox.checked));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); }, { once: true });
  });
}
