import { getPage, pages, type PageDefinition, type PageGroup } from "../core/pages";
import { hasDirectionAccess } from "../core/employee-session";
import { currentTheme, toggleTheme } from "../core/theme";
import { icon } from "./icons";
import { keepFocusInside, lockDocumentScroll } from "./focus";

const groupLabels: Record<PageGroup, string> = {
  operations: "Opérations",
  gestion: "Gestion",
  permis: "Permis",
  direction: "Direction"
};

function navigation(current: PageDefinition): string {
  return (Object.keys(groupLabels) as PageGroup[]).map(group => {
    const links = pages.filter(page => page.group === group && page.id !== "dashboard");
    return `<section data-nav-group="${group}" ${group === "direction" && !hasDirectionAccess() ? "hidden" : ""} class="mb-6" aria-labelledby="nav-${group}">
      <h2 id="nav-${group}" class="sidebar-collapsible mb-2 px-3 text-[.7rem] font-bold uppercase tracking-[.18em] text-muted">${groupLabels[group]}</h2>
      <ul class="space-y-1">${links.map(page => `<li><a href="${page.href}" title="${page.title}" aria-label="${page.title}" ${page.id === current.id ? 'aria-current="page"' : ""} class="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${page.id === current.id ? "bg-brand text-white shadow-sm" : "text-muted hover:bg-surface-muted hover:text-ink"}">${icon(page.icon, "size-[1.15rem] shrink-0")}<span class="sidebar-collapsible">${page.title}</span></a></li>`).join("")}</ul>
    </section>`;
  }).join("");
}

function pageContent(): string {
  return '<div id="page-content"></div>';
}

export function renderApp(pageId: string): () => void {
  const page = getPage(pageId);
  document.title = `${page.title} — Ombrelune`;
  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `<div id="app-shell" class="app-shell lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
    <div id="sidebar-backdrop" class="sidebar-backdrop fixed inset-0 z-30 bg-slate-950/55 lg:hidden" aria-hidden="true"></div>
    <aside id="sidebar" class="app-sidebar fixed inset-y-0 left-0 z-40 flex w-[17rem] flex-col border-r bg-surface p-4 lg:sticky lg:top-0 lg:h-screen" aria-label="Navigation principale" aria-hidden="true">
      <div class="mb-6 px-2"><div class="flex min-h-11 items-center"><div class="flex min-w-0 items-center gap-2"><span class="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-white shadow-md" aria-hidden="true">${icon("flask", "size-6")}</span><strong class="sidebar-collapsible truncate font-[Cinzel] text-lg leading-tight text-ink">Ombrelune</strong></div><button id="collapse-sidebar" class="ml-auto hidden size-11 shrink-0 place-items-center rounded-xl border lg:grid xl:hidden" aria-label="Réduire le menu" aria-expanded="true">${icon("arrow")}</button><button id="close-menu" class="ml-auto grid size-11 shrink-0 place-items-center rounded-xl hover:bg-surface-muted lg:hidden" aria-label="Fermer le menu">${icon("close")}</button></div></div>
      <nav class="min-h-0 flex-1 overflow-y-auto">${navigation(page)}</nav>
      <div id="employee-session-control" class="sidebar-collapsible mt-4 w-full shrink-0 border-t pt-4" aria-label="Session employé"><p class="text-sm text-muted" role="status">Chargement des employés…</p></div>
    </aside>
    <div id="app-main-column" class="min-w-0">
      <header class="sticky top-0 z-20 grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b bg-canvas/90 px-4 py-2 backdrop-blur-xl sm:px-7 md:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)_minmax(12rem,1fr)]">
        <div class="flex min-w-0 items-center gap-3"><button id="open-menu" class="grid size-11 shrink-0 place-items-center rounded-xl border bg-surface lg:hidden" aria-label="Ouvrir le menu" aria-controls="sidebar" aria-expanded="false">${icon("menu")}</button>
          <div class="min-w-0"><p class="truncate text-xs font-bold uppercase tracking-[.14em] text-brand">${page.eyebrow}</p><h1 class="truncate font-semibold">${page.title}</h1></div>
        </div>
        <p class="col-span-1 col-start-2 hidden text-center text-sm leading-tight text-muted md:block">${page.description}</p>
        <button id="theme-toggle" class="col-start-3 row-start-1 ml-auto grid size-11 place-items-center rounded-xl border bg-surface hover:bg-surface-muted"></button>
      </header>
      <main id="main-content" class="px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
        ${pageContent()}
      </main>
    </div>
  </div>`;

  const sidebar = document.querySelector<HTMLElement>("#sidebar")!;
  const backdrop = document.querySelector<HTMLElement>("#sidebar-backdrop")!;
  const openButton = document.querySelector<HTMLButtonElement>("#open-menu")!;
  const shell = document.querySelector<HTMLElement>("#app-shell")!;
  const collapseButton = document.querySelector<HTMLButtonElement>("#collapse-sidebar")!;
  const mainColumn = document.querySelector<HTMLElement>("#app-main-column")!;
  const desktopQuery = matchMedia("(min-width: 1024px)");
  const compactQuery = matchMedia("(min-width: 1024px) and (max-width: 1279px)");
  const setSidebarCollapsed = (collapsed: boolean, persist = true): void => {
    const active = compactQuery.matches && collapsed;
    shell.dataset.sidebarCollapsed = String(active);
    collapseButton.setAttribute("aria-expanded", String(!active));
    collapseButton.setAttribute("aria-label", active ? "Développer le menu" : "Réduire le menu");
    collapseButton.classList.toggle("rotate-180", !active);
    if (persist && compactQuery.matches) localStorage.setItem("ombrelune-sidebar-collapsed", String(collapsed));
  };
  const setMenu = (open: boolean, moveFocus = false): void => {
    sidebar.setAttribute("aria-hidden", String(!open));
    backdrop.setAttribute("aria-hidden", String(!open));
    openButton.setAttribute("aria-expanded", String(open));
    const modal = open && !desktopQuery.matches;
    mainColumn.inert = modal;
    lockDocumentScroll(modal);
    if (open && moveFocus) document.querySelector<HTMLButtonElement>("#close-menu")!.focus();
    else if (!open && moveFocus) openButton.focus();
  };
  setMenu(desktopQuery.matches);
  setSidebarCollapsed(localStorage.getItem("ombrelune-sidebar-collapsed") === "true", false);
  const handleDesktopChange = (event: MediaQueryListEvent): void => setMenu(event.matches);
  const handleCompactChange = (): void => setSidebarCollapsed(localStorage.getItem("ombrelune-sidebar-collapsed") === "true", false);
  desktopQuery.addEventListener("change", handleDesktopChange);
  compactQuery.addEventListener("change", handleCompactChange);
  collapseButton.addEventListener("click", () => setSidebarCollapsed(shell.dataset.sidebarCollapsed !== "true"));
  openButton.addEventListener("click", () => setMenu(true, true));
  document.querySelector("#close-menu")!.addEventListener("click", () => { setMenu(false); openButton.focus(); });
  backdrop.addEventListener("click", () => setMenu(false, true));
  const handleEscape = (event: KeyboardEvent): void => {
    if (sidebar.getAttribute("aria-hidden") !== "false" || desktopQuery.matches) return;
    if (event.key === "Escape") setMenu(false, true);
    else keepFocusInside(sidebar, event);
  };
  document.addEventListener("keydown", handleEscape);
  const themeButton = document.querySelector<HTMLButtonElement>("#theme-toggle")!;
  const syncThemeButton = (): void => {
    const dark = currentTheme() === "dark";
    themeButton.innerHTML = icon(dark ? "sun" : "moon");
    themeButton.setAttribute("aria-label", dark ? "Activer le thème clair" : "Activer le thème sombre");
    themeButton.setAttribute("aria-pressed", String(dark));
    themeButton.title = dark ? "Activer le thème clair" : "Activer le thème sombre";
  };
  themeButton.addEventListener("click", toggleTheme);
  window.addEventListener("ombrelune:theme-change", syncThemeButton);
  syncThemeButton();

  return () => {
    desktopQuery.removeEventListener("change", handleDesktopChange);
    compactQuery.removeEventListener("change", handleCompactChange);
    document.removeEventListener("keydown", handleEscape);
    window.removeEventListener("ombrelune:theme-change", syncThemeButton);
    lockDocumentScroll(false);
  };
}
