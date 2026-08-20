import { z } from "zod";
import { readEmployeeSession } from "../../core/employee-session";
import { callRpc, getSupabaseClient } from "../supabase";
import { identifierSchema } from "../schemas";

const recipeRowSchema = z.object({
  produit_id: identifierSchema,
  ingredient_id: identifierSchema,
  quantite_requise: z.coerce.number().int().positive(),
  quantite_produite: z.coerce.number().int().positive(),
  produit: z.object({ id: identifierSchema, article: z.string() }),
  ingredient: z.object({
    id: identifierSchema,
    article: z.string(),
    stocks: z.union([
      z.object({ quantite: z.coerce.number().int() }),
      z.array(z.object({ quantite: z.coerce.number().int() }))
    ]).nullable().optional()
  })
});

export type RecipeRow = z.infer<typeof recipeRowSchema>;

export async function getCraftRecipes(): Promise<RecipeRow[]> {
  const { data, error } = await getSupabaseClient()
    .from("recettes_craft")
    .select("produit_id,ingredient_id,quantite_requise,quantite_produite,produit:catalogue!produit_id(id,article),ingredient:catalogue!ingredient_id(id,article,stocks(quantite))")
    .order("produit_id")
    .order("ingredient_id");
  if (error) throw new Error(error.message);
  return z.array(recipeRowSchema).parse(data);
}

export async function craftArticle(articleId: string, craftCount: number): Promise<number> {
  const employee = readEmployeeSession();
  if (!employee) throw new Error("Sélectionnez un employé avant de fabriquer.");
  return callRpc("fabriquer_article", {
    p_employe_id: employee.employeeId,
    p_article_id: articleId,
    p_nombre_crafts: craftCount
  }, z.coerce.number().int().positive());
}

export function ingredientStock(recipe: RecipeRow): number {
  const stocks = recipe.ingredient.stocks;
  return (Array.isArray(stocks) ? stocks[0] : stocks)?.quantite ?? 0;
}
