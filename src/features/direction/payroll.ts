import { z } from "zod";
import { rows } from "./shared";

export const erpSettingsSchema = z.object({
  taux_etudiant: z.coerce.number(),
  taux_adulte: z.coerce.number(),
  taux_co_patron: z.coerce.number(),
  taux_patron: z.coerce.number(),
  taux_taxe: z.coerce.number(),
  plafond_etudiant: z.coerce.number(),
  plafond_adulte: z.coerce.number(),
  plafond_co_patron: z.coerce.number(),
  plafond_patron: z.coerce.number(),
  prime_max_etudiant: z.coerce.number(),
  prime_max_adulte: z.coerce.number(),
  prime_max_co_patron: z.coerce.number(),
  prime_max_patron: z.coerce.number(),
  solde_reference_tresorerie: z.coerce.number(),
  reference_tresorerie_at: z.string()
});

export type ErpSettings = z.infer<typeof erpSettingsSchema>;

export async function getErpSettings(): Promise<ErpSettings> {
  const settings = (await rows("parametres_erp"))[0];
  if (!settings) throw new Error("Les paramètres ERP sont absents. Appliquez les migrations Supabase.");
  return erpSettingsSchema.parse(settings);
}

export function salaryRule(grade: unknown, settings: ErpSettings): { rate: number; ceiling: number } {
  type RateKey = "taux_etudiant" | "taux_adulte" | "taux_co_patron" | "taux_patron";
  type CeilingKey = "plafond_etudiant" | "plafond_adulte" | "plafond_co_patron" | "plafond_patron";
  const rules: Record<string, [RateKey, CeilingKey]> = {
    Étudiant: ["taux_etudiant", "plafond_etudiant"],
    Adulte: ["taux_adulte", "plafond_adulte"],
    "Co-Patron": ["taux_co_patron", "plafond_co_patron"],
    Patron: ["taux_patron", "plafond_patron"]
  };
  const [rateKey, ceilingKey] = rules[String(grade)] ?? rules.Adulte!;
  return { rate: settings[rateKey] / 100, ceiling: settings[ceilingKey] };
}

export function salaryFromProfit(profit: number, grade: unknown, settings: ErpSettings): number {
  const { rate, ceiling } = salaryRule(grade, settings);
  return Math.round(Math.min(Math.max(profit, 0) * rate, ceiling));
}

export function maximumBonus(grade: unknown, settings: ErpSettings): number {
  type BonusKey = "prime_max_etudiant" | "prime_max_adulte" | "prime_max_co_patron" | "prime_max_patron";
  const keys: Record<string, BonusKey> = {
    Étudiant: "prime_max_etudiant",
    Adulte: "prime_max_adulte",
    "Co-Patron": "prime_max_co_patron",
    Patron: "prime_max_patron"
  };
  return settings[keys[String(grade)] ?? "prime_max_adulte"];
}
