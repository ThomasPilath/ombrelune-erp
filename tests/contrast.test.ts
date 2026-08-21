import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function luminance(hex: string): number {
  const channels = hex.match(/[a-f\d]{2}/gi)!.map(value => Number.parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("contrastes des tokens UI", () => {
  test.each([
    ["texte principal sombre", "#ffffff", "#19113c"], ["texte secondaire sombre", "#d1d5db", "#19113c"],
    ["or Elixir sombre", "#e8a361", "#19113c"], ["violet bleuté sombre", "#b4a8ff", "#19113c"], ["bouton violet", "#ffffff", "#5742a7"],
    ["succès sombre", "#4ade80", "#19113c"], ["erreur sombre", "#f87171", "#19113c"],
    ["avertissement sombre", "#fbbf24", "#19113c"]
  ])("%s respecte 4.5:1", (_: string, foreground: string, background: string) => expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5));

  test.each([["bordure sombre", "#6f5bc4", "#19113c"]])
    ("%s respecte 3:1", (_: string, foreground: string, background: string) => expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3));

  test("le fond critique correspond au canvas du thème", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    const criticalBackground = html.match(/background-color:(#[\da-f]{6})/i)?.[1];
    const canvas = css.match(/--color-canvas:\s*(#[\da-f]{6})/i)?.[1];
    expect(criticalBackground).toBe(canvas);
  });

  test.each([
    ["texte historique", "#f8f8fb", "#192541"], ["texte secondaire historique", "#c3c5cc", "#192541"],
    ["accent historique", "#ff6b84", "#192541"], ["bouton historique", "#ffffff", "#d63353"],
    ["succès historique", "#5fd05f", "#192541"], ["avertissement historique", "#ffad32", "#192541"]
  ])("%s respecte 4.5:1", (_: string, foreground: string, background: string) => expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5));

  test("la bordure historique reste identifiable", () => {
    expect(contrast("#547aa0", "#192541")).toBeGreaterThanOrEqual(3);
  });
});
