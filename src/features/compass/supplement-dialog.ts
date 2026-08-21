import { closeDialog, openDialog } from "../../ui/components/dialog";
import { buttonClasses, dialogActionClasses } from "../../ui/components/primitives";

const normalize = (value: unknown): string => String(value).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr").trim();

export function isCompass(articleName: unknown): boolean {
  return normalize(articleName) === "boussole";
}

export function isCompassSupplement(articleName: unknown): boolean {
  return normalize(articleName) === "supplement boussole";
}

export function confirmCompassSupplement(): Promise<boolean | null> {
  const dialog = openDialog({
    title: "Tarif de la boussole",
    description: "Vérifiez la carte de l’étudiant. Le tarif de 4 000 PO est réservé aux étudiants de première année, premier semestre (A1S1).",
    content: '<label class="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border bg-surface-muted p-4"><input data-supplement type="checkbox" class="mt-1 size-5 shrink-0 accent-[var(--color-brand)]"><span><strong class="block">Le client n’est pas A1S1</strong><span class="mt-1 block text-sm text-muted">Ajouter automatiquement le supplément boussole de 2 000 PO.</span></span></label>',
    footer: `<div class="${dialogActionClasses}"><button type="button" data-cancel class="${buttonClasses("secondary")}">Annuler</button><button type="button" data-confirm class="${buttonClasses()}">Valider</button></div>`
  });
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: boolean | null): void => { if (settled) return; settled = true; closeDialog(dialog); resolve(result); };
    dialog.querySelector("[data-cancel]")!.addEventListener("click", () => finish(null));
    dialog.querySelector("[data-confirm]")!.addEventListener("click", () => finish(dialog.querySelector<HTMLInputElement>("[data-supplement]")!.checked));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); }, { once: true });
  });
}

export function compassDecisionLabel(withSupplement: boolean): string {
  return withSupplement ? "Tarif hors A1S1 avec supplément" : "Tarif A1S1 sans supplément";
}
