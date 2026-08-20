type Theme = "light" | "dark";

const storageKey = "ombrelune-theme";

function preferredTheme(): Theme {
  const saved = localStorage.getItem(storageKey);
  if (saved === "light" || saved === "dark") return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyInitialTheme(): void {
  document.documentElement.dataset.theme = preferredTheme();
  const systemTheme = matchMedia("(prefers-color-scheme: dark)");
  systemTheme.addEventListener("change", event => {
    if (!localStorage.getItem(storageKey)) setTheme(event.matches ? "dark" : "light");
  });
}

export function toggleTheme(): Theme {
  const next: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setTheme(next);
  localStorage.setItem(storageKey, next);
  return next;
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new CustomEvent("ombrelune:theme-change", { detail: theme }));
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
