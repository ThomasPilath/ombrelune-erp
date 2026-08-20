type ToastKind = "success" | "error" | "info";

const colors: Record<ToastKind, string> = {
  success: "border-green-600",
  error: "border-red-600",
  info: "border-accent"
};

function toastHost(): HTMLElement {
  const openDialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  return openDialogs.item(openDialogs.length - 1) ?? document.body;
}

export function mountToastRegion(host = toastHost()): HTMLElement {
  const existing = host.querySelector<HTMLElement>(":scope > [data-toast-region]");
  if (existing) return existing;
  const region = document.createElement("div");
  region.dataset.toastRegion = "";
  region.className = host instanceof HTMLDialogElement
    ? "relative z-[100] flex w-full flex-col gap-2 border-t p-4"
    : "fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100%-2rem))] flex-col gap-2";
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  host.append(region);
  return region;
}

export function showToast(message: string, kind: ToastKind = "info"): void {
  const region = mountToastRegion();
  const toast = document.createElement("div");
  toast.className = `toast-enter rounded-xl border-l-4 bg-surface-muted p-4 text-sm font-semibold text-ink shadow-xl ${colors[kind]}`;
  toast.textContent = message;
  toast.setAttribute("role", kind === "error" ? "alert" : "status");
  region.append(toast);
  setTimeout(() => toast.remove(), 4500);
}
