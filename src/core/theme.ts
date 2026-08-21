export type VisualTheme = "elixir" | "heritage";

const storageKey = "ombrelune-visual-theme";

function isVisualTheme(value: string | null): value is VisualTheme {
  return value === "elixir" || value === "heritage";
}

export function currentTheme(): VisualTheme {
  const theme = document.documentElement.dataset.theme;
  return theme === "heritage" ? "heritage" : "elixir";
}

export function setTheme(theme: VisualTheme, persist = true): void {
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem(storageKey, theme);
  window.dispatchEvent(new CustomEvent<VisualTheme>("ombrelune:theme-change", { detail: theme }));
}

export function applyInitialTheme(): void {
  const savedTheme = localStorage.getItem(storageKey);
  setTheme(isVisualTheme(savedTheme) ? savedTheme : "heritage", false);
}

export function toggleTheme(): VisualTheme {
  const nextTheme = currentTheme() === "elixir" ? "heritage" : "elixir";
  setTheme(nextTheme);
  return nextTheme;
}
