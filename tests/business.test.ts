import { describe, expect, test } from "bun:test";
import { craftStockNeeds, type RecipeRow } from "../src/data/repositories/craft";
import { maximumBonus, salaryFromProfit, salaryRule, type ErpSettings } from "../src/features/direction/payroll";

const settings: ErpSettings = {
  taux_etudiant: 10, taux_adulte: 20, taux_co_patron: 30, taux_patron: 40, taux_taxe: 5,
  plafond_etudiant: 100, plafond_adulte: 200, plafond_co_patron: 300, plafond_patron: 400,
  prime_max_etudiant: 10, prime_max_adulte: 20, prime_max_co_patron: 30, prime_max_patron: 40,
  solde_reference_tresorerie: 0, reference_tresorerie_at: "2026-01-01T00:00:00Z"
};

describe("rémunérations", () => {
  test("applique le taux et le plafond du grade", () => {
    expect(salaryRule("Adulte", settings)).toEqual({ rate: 0.2, ceiling: 200 });
    expect(salaryFromProfit(500, "Adulte", settings)).toBe(100);
    expect(salaryFromProfit(2_000, "Adulte", settings)).toBe(200);
    expect(salaryFromProfit(-10, "Adulte", settings)).toBe(0);
  });

  test("applique les primes maximales", () => {
    expect(maximumBonus("Patron", settings)).toBe(40);
    expect(maximumBonus("grade inconnu", settings)).toBe(20);
  });
});

describe("besoins de fabrication", () => {
  test("vise le stock maximal et expose la quantité partiellement fabricable", () => {
    const recipe: RecipeRow = {
      produit_id: 1,
      ingredient_id: 2,
      quantite_requise: 3,
      quantite_produite: 2,
      produit: { id: 1, article: "Potion", stocks: { quantite: 1, stock_min: 6, stock_max: 10 } },
      ingredient: { id: 2, article: "Herbe", stocks: { quantite: 8 } }
    };
    expect(craftStockNeeds([recipe])).toEqual([{
      productId: "1", article: "Potion", current: 1, minimum: 6, maximum: 10,
      missing: 9, craftCount: 5, craftableQuantity: 4, partiallyAvailable: true,
      resourceUnavailable: false
    }]);
  });

  test("signale une ressource indisponible quand aucun craft n'est possible", () => {
    const recipe: RecipeRow = {
      produit_id: 1, ingredient_id: 2, quantite_requise: 3, quantite_produite: 2,
      produit: { id: 1, article: "Potion", stocks: { quantite: 1, stock_min: 6, stock_max: 10 } },
      ingredient: { id: 2, article: "Herbe", stocks: { quantite: 2 } }
    };
    expect(craftStockNeeds([recipe])[0]).toMatchObject({
      craftableQuantity: 0, partiallyAvailable: false, resourceUnavailable: true
    });
  });

  test("ignore un produit dont le stock minimum est atteint", () => {
    const recipe: RecipeRow = {
      produit_id: 1, ingredient_id: 2, quantite_requise: 1, quantite_produite: 1,
      produit: { id: 1, article: "Potion", stocks: { quantite: 6, stock_min: 6 } },
      ingredient: { id: 2, article: "Herbe", stocks: { quantite: 10 } }
    };
    expect(craftStockNeeds([recipe])).toEqual([]);
  });
});
