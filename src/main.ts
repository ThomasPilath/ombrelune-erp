import "./styles.css";
import { applyInitialTheme } from "./core/theme";
import { renderApp } from "./ui/layout";
import { mountFeature, mountGlobalFeatures } from "./features/registry";
import { startRouter } from "./core/router";
import { hasDirectionAccess } from "./core/employee-session";
import { getPage } from "./core/pages";
import { showToast } from "./ui/components/toast";
import { getPublicEnv } from "./config/env";
import { initializeAnalytics } from "./core/analytics";

function renderStartupError(error: unknown): void {
  const message = error instanceof Error ? error.message : "Configuration invalide.";
  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `<main class="grid min-h-screen place-items-center p-6"><section class="w-full max-w-xl rounded-2xl border bg-surface p-6 shadow-[var(--shadow-panel)]" role="alert"><h1 class="text-2xl font-bold">Configuration impossible</h1><p class="mt-3 text-muted">Ombrelune ne peut pas démarrer. Vérifiez les variables publiques Supabase dans <code>config.js</code> ou <code>.env.local</code>.</p><pre class="mt-4 overflow-x-auto rounded-xl bg-surface-muted p-4 text-sm whitespace-pre-wrap"></pre></section></main>`;
  document.querySelector("pre")!.textContent = message;
}

try {
  applyInitialTheme();
  initializeAnalytics(getPublicEnv());
  document.documentElement.style.removeProperty("background-color");
  document.documentElement.style.removeProperty("color");
} catch (error) {
  renderStartupError(error);
  throw error;
}

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
