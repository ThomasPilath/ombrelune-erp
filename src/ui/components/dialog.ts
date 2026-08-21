import { keepFocusInside, lockDocumentScroll } from "../focus";
import { escapeHtml } from "../html";
import { buttonClasses, dialogActionClasses, type ButtonVariant } from "./primitives";

export type DialogSize = "small" | "medium" | "large";

interface OpenDialogOptions {
  title: string;
  description?: string;
  eyebrow?: string;
  content?: string;
  footer?: string;
  size?: DialogSize;
  labelledContent?: boolean;
}

interface ConfirmDialogOptions extends OpenDialogOptions {
  cancelLabel?: string;
  confirmLabel?: string;
  variant?: Extract<ButtonVariant, "primary" | "danger">;
}

const widths: Record<DialogSize, string> = {
  small: "w-[min(28rem,calc(100%-2rem))]",
  medium: "w-[min(36rem,calc(100%-2rem))]",
  large: "w-[min(52rem,calc(100%-2rem))]"
};

let openDialogCount = 0;
let dialogId = 0;

export function openDialog(options: OpenDialogOptions): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  const titleId = `dialog-title-${++dialogId}`;
  dialog.className = `m-auto max-h-[calc(100dvh-2rem)] ${widths[options.size ?? "medium"]} overflow-y-auto rounded-2xl border bg-surface p-0 text-ink shadow-2xl backdrop:bg-backdrop`;
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.innerHTML = `<div class="border-b p-5">${options.eyebrow ? `<p class="text-sm font-bold text-accent">${escapeHtml(options.eyebrow)}</p>` : ""}<h2 id="${titleId}" class="${options.eyebrow ? "mt-1 " : ""}text-xl font-bold">${escapeHtml(options.title)}</h2>${options.description ? `<p class="mt-2 text-sm text-muted">${escapeHtml(options.description)}</p>` : ""}</div>${options.content ? `<div class="p-5">${options.content}</div>` : ""}${options.footer ?? ""}`;
  document.body.append(dialog);
  openDialogCount += 1;
  lockDocumentScroll(true);
  dialog.addEventListener("keydown", event => keepFocusInside(dialog, event));
  dialog.addEventListener("close", () => {
    openDialogCount = Math.max(0, openDialogCount - 1);
    lockDocumentScroll(openDialogCount > 0);
  }, { once: true });
  dialog.showModal();
  return dialog;
}

export function closeDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) dialog.close();
  dialog.remove();
}

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  const footer = `<div class="${dialogActionClasses}"><button type="button" data-dialog-cancel class="${buttonClasses("secondary")}">${escapeHtml(options.cancelLabel ?? "Annuler")}</button><button type="button" data-dialog-confirm class="${buttonClasses(options.variant ?? "primary")}">${escapeHtml(options.confirmLabel ?? "Confirmer")}</button></div>`;
  const dialog = openDialog({ ...options, footer });
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      closeDialog(dialog);
      resolve(result);
    };
    dialog.querySelector("[data-dialog-cancel]")!.addEventListener("click", () => finish(false));
    dialog.querySelector("[data-dialog-confirm]")!.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); }, { once: true });
  });
}
