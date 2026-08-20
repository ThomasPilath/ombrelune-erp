import { describe, expect, test } from "bun:test";

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
    ["texte principal clair", "#1a1230", "#fffdf8"], ["texte secondaire clair", "#615b70", "#f7f3ed"],
    ["violet Elixir clair", "#5742a7", "#fffdf8"], ["or accessible clair", "#9b5c20", "#fffdf8"],
    ["texte principal sombre", "#ffffff", "#19113c"], ["texte secondaire sombre", "#d1d5db", "#19113c"],
    ["or Elixir sombre", "#e8a361", "#19113c"], ["bouton violet", "#ffffff", "#5742a7"],
    ["succès clair", "#15803d", "#fffdf8"], ["succès sombre", "#4ade80", "#19113c"],
    ["erreur clair", "#dc2626", "#fffdf8"], ["erreur sombre", "#f87171", "#19113c"]
  ])("%s respecte 4.5:1", (_: string, foreground: string, background: string) => expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5));

  test.each([["bordure claire", "#76699e", "#f7f3ed"], ["bordure sombre", "#6f5bc4", "#19113c"]])
    ("%s respecte 3:1", (_: string, foreground: string, background: string) => expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3));
});
