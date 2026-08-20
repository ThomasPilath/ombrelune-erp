import { escapeHtml } from "../html";

export function panel(title: string, content: string, action = ""): string {
  return `<section class="overflow-hidden rounded-2xl border bg-surface shadow-[var(--shadow-panel)]"><div class="flex flex-wrap items-center justify-between gap-3 border-b p-5"><h2 class="text-xl font-bold">${escapeHtml(title)}</h2>${action}</div>${content}</section>`;
}
