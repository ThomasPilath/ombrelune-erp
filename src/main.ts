import "./styles.css";
import { applyInitialTheme } from "./core/theme";
import { renderApp } from "./ui/layout";
import { mountFeature, mountGlobalFeatures } from "./features/registry";
import { startRouter } from "./core/router";
import { hasDirectionAccess } from "./core/employee-session";
import { getPage } from "./core/pages";
import { showToast } from "./ui/components/toast";

applyInitialTheme();
document.documentElement.style.removeProperty("background-color");
document.documentElement.style.removeProperty("color");

let cleanupLayout: (() => void) | undefined;

startRouter(async page => {
  cleanupLayout?.();
  cleanupLayout = renderApp(page.id);
  await mountGlobalFeatures();
  if (page.group === "direction" && !hasDirectionAccess()) {
    const fallback = getPage("caisse");
    history.replaceState(null, "", fallback.href);
    cleanupLayout?.();
    cleanupLayout = renderApp(fallback.id);
    await mountGlobalFeatures();
    await mountFeature(fallback.id);
    showToast("Cette page est réservée à la Direction.", "error");
    return;
  }
  await mountFeature(page.id);
});
