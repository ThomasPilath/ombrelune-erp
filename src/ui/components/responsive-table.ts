import { escapeHtml } from "../html";

interface ResponsiveTableOptions {
  cardsOnMobile?: boolean;
  emptyMessage?: string;
}

export function responsiveTable(headers: string[], rows: string[][], options: ResponsiveTableOptions = {}): string {
  if (!rows.length) return `<p class="p-8 text-center text-muted">${escapeHtml(options.emptyMessage ?? "Aucune donnée.")}</p>`;
  const head = headers.map(header => `<th scope="col" class="px-4 py-3">${escapeHtml(header)}</th>`).join("");
  const body = rows.map(row => `<tr class="border-t">${row.map(cell => `<td class="px-4 py-3 align-top">${cell}</td>`).join("")}</tr>`).join("");
  const desktop = `<div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead class="bg-surface-muted"><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  if (!options.cardsOnMobile) return desktop;
  const cards = rows.map(row => `<dl class="overflow-hidden rounded-xl border bg-surface-muted">${row.map((cell, index) => `<div class="grid grid-cols-[minmax(6.5rem,38%)_minmax(0,1fr)] gap-3 border-b px-3 py-3 last:border-b-0"><dt class="text-xs font-bold text-muted">${escapeHtml(headers[index] ?? "")}</dt><dd class="min-w-0 break-words text-right text-sm">${cell}</dd></div>`).join("")}</dl>`).join("");
  return `<div class="grid gap-3 p-3 md:hidden">${cards}</div><div class="hidden md:block">${desktop}</div>`;
}

export function labelTableControls(root: ParentNode): void {
  root.querySelectorAll<HTMLTableElement>("table").forEach(table => {
    const headers = [...table.querySelectorAll<HTMLTableCellElement>("thead th")].map(header => header.textContent?.trim() ?? "Champ");
    table.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach(row => {
      const cells = [...row.cells];
      const subject = cells[0]?.textContent?.trim() || "la ligne";
      cells.forEach((cell, index) => cell.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea").forEach(control => {
        if (!control.hasAttribute("aria-label") && !control.hasAttribute("aria-labelledby")) control.setAttribute("aria-label", `${headers[index] ?? "Champ"} — ${subject}`);
      }));
    });
  });
}
