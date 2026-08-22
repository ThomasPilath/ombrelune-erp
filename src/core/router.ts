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
  let renderQueue = Promise.resolve();

  const renderPath = (pathname: string): void => {
    const currentNavigation = ++navigationId;
    renderQueue = renderQueue.catch(() => undefined).then(async () => {
      if (currentNavigation !== navigationId) return;
      await render(getPageFromPath(pathname));
      if (currentNavigation === navigationId) {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    });
  };

  document.addEventListener("click", event => {
    const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!anchor || !isInternalNavigation(event, anchor)) return;

    const target = new URL(anchor.href);
    if (target.pathname === location.pathname && target.search === location.search) return;
    event.preventDefault();
    history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
    renderPath(target.pathname);
  });

  window.addEventListener("popstate", () => renderPath(location.pathname));

  const initialPage = getPageFromPath(location.pathname);
  if (location.pathname === "/" || location.pathname === "/index.html") {
    history.replaceState(null, "", initialPage.href);
  }
  renderPath(initialPage.href);
}
