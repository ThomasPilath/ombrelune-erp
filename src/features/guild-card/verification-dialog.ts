const normalize = (value: unknown): string => String(value)
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLocaleLowerCase("fr")
  .trim();

export function isContractBook(articleName: unknown): boolean {
  return normalize(articleName) === "carnet de contrat";
}

export function confirmGuildCard(): Promise<boolean> {
  const dialog = openDialog({
    eyebrow: "Vérification obligatoire",
    title: "Carte de guilde",
    description: "Le carnet de contrat ne peut être vendu qu’après vérification de la carte de guilde de l’acheteur.",
    content: '<label class="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border bg-surface-muted p-4"><input data-guild-card type="checkbox" class="mt-1 size-5 shrink-0 accent-[var(--color-brand)]"><span><strong class="block">Carte de guilde vérifiée</strong><span class="mt-1 block text-sm text-muted">La carte est valide et correspond bien à la personne qui réalise l’achat.</span></span></label>',
    footer: `<div class="${dialogActionClasses}"><button type="button" data-cancel class="${buttonClasses("secondary")}">Annuler</button><button type="button" data-confirm disabled class="${buttonClasses()}">Ajouter au panier</button></div>`
  });

  return new Promise(resolve => {
    let settled = false;
    const checkbox = dialog.querySelector<HTMLInputElement>("[data-guild-card]")!;
    const confirm = dialog.querySelector<HTMLButtonElement>("[data-confirm]")!;
    const finish = (verified: boolean): void => {
      if (settled) return;
      settled = true;
      closeDialog(dialog);
      resolve(verified);
    };

    checkbox.addEventListener("change", () => { confirm.disabled = !checkbox.checked; });
    dialog.querySelector("[data-cancel]")!.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(checkbox.checked));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); }, { once: true });
  });
}
import { closeDialog, openDialog } from "../../ui/components/dialog";
import { buttonClasses, dialogActionClasses } from "../../ui/components/primitives";
