import { beforeEach, describe, expect, test } from "bun:test";
import { parsePublicEnv } from "../src/config/env";
import { clearEmployeeSession, hasDirectionAccess, readEmployeeSession, saveEmployeeSession } from "../src/core/employee-session";
import { getPageFromPath } from "../src/core/pages";
import type { EmployeeRow } from "../src/data/schemas";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

beforeEach(() => {
  Object.assign(globalThis, {
    localStorage: new MemoryStorage(),
    window: { dispatchEvent: () => true }
  });
});

describe("résolution des pages", () => {
  test.each([
    ["/", "caisse"],
    ["/clients", "gestion"],
    ["/tresorerie", "gestion"],
    ["/direction", "pilotage"],
    ["/synthese", "finances"],
    ["/permis_voitures", "permis-voiture"],
    ["/page-inconnue", "caisse"]
  ])("%s pointe vers %s", (path, expected) => {
    expect(getPageFromPath(path).id).toBe(expected);
  });
});

describe("configuration publique", () => {
  const required = {
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_1234567890"
  };

  test("accepte les statistiques complètement configurées", () => {
    expect(parsePublicEnv({
      ...required,
      VITE_UMAMI_SCRIPT_URL: "https://stats.example.com/script.js",
      VITE_UMAMI_WEBSITE_ID: "00000000-0000-4000-8000-000000000000"
    }).VITE_UMAMI_WEBSITE_ID).toBeTruthy();
  });

  test("refuse une URL Supabase invalide", () => {
    expect(() => parsePublicEnv({ ...required, VITE_SUPABASE_URL: "invalid" })).toThrow();
  });

  test("refuse une configuration Umami partielle", () => {
    expect(() => parsePublicEnv({ ...required, VITE_UMAMI_SCRIPT_URL: "https://stats.example.com/script.js" })).toThrow();
  });
});

describe("session employé", () => {
  const direction: EmployeeRow = { id: 1, nom_prenom: "Direction", grade: "Patron" };
  const employee: EmployeeRow = { id: 2, nom_prenom: "Employé", grade: "Adulte" };

  test("restaure une session valide", () => {
    saveEmployeeSession(employee);
    expect(readEmployeeSession()?.employeeName).toBe("Employé");
  });

  test("n'accorde la Direction qu'à un rôle autorisé et déverrouillé", () => {
    expect(hasDirectionAccess(saveEmployeeSession(employee, true))).toBeFalse();
    expect(hasDirectionAccess(saveEmployeeSession(direction, false))).toBeFalse();
    expect(hasDirectionAccess(saveEmployeeSession(direction, true))).toBeTrue();
    clearEmployeeSession();
    expect(readEmployeeSession()).toBeNull();
  });
});
