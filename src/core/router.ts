import { getPageFromPath, type PageDefinition } from "./pages";

type RouteHandler = (page: PageDefinition) => void | Promise<void>;

function isInternalNavigation(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  return event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && !anchor.download
    && anchor.target !== "_blank"
    && anchor.origin === location.origin;
}

export function startRouter(render: RouteHandler): void {
  let navigationId = 0;

  const renderPath = async (pathname: string): Promise<void> => {
    const currentNavigation = ++navigationId;
    const page = getPageFromPath(pathname);
    if (currentNavigation !== navigationId) return;
    await render(page);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  document.addEventListener("click", event => {
    const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!anchor || !isInternalNavigation(event, anchor)) return;

    const target = new URL(anchor.href);
    if (target.pathname === location.pathname && target.search === location.search) return;
    event.preventDefault();
    history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
    void renderPath(target.pathname);
  });

  window.addEventListener("popstate", () => void renderPath(location.pathname));

  const initialPage = getPageFromPath(location.pathname);
  if (location.pathname === "/" || location.pathname === "/index.html") {
    history.replaceState(null, "", initialPage.href);
  }
  void renderPath(initialPage.href);
}
