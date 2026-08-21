let activeFeatureCleanup: (() => void) | undefined;
let featureMountId = 0;

export async function mountFeature(pageId: string): Promise<void> {
  const mountId = ++featureMountId;
  activeFeatureCleanup?.();
  activeFeatureCleanup = undefined;
  const outlet = document.querySelector<HTMLElement>("#page-content");
  if (!outlet) return;
  const cleanup = pageId === "caisse"
    ? await (await import("./caisse/page")).mountCaissePage(outlet)
    : ["permis-balais", "permis-voiture", "permis-moto"].includes(pageId)
      ? await (await import("./permits/page")).mountPermitPage(outlet, pageId)
    : ["pilotage", "finances", "equipe-rh", "offre-stocks"].includes(pageId)
      ? await (await import("./direction/page")).mountDirectionPage(outlet, pageId)
    : await (await import("./operations/page")).mountOperationsPage(outlet, pageId);
  if (mountId !== featureMountId) cleanup();
  else activeFeatureCleanup = cleanup;
}

export async function mountGlobalFeatures(): Promise<void> {
  const { mountEmployeeSession } = await import("./employee-session/controller");
  await mountEmployeeSession();
}
