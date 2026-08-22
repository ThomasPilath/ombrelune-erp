import { z } from "zod";
import { readEmployeeSession } from "../../core/employee-session";
import { callRpc, getSupabaseClient } from "../supabase";
import { identifierSchema } from "../schemas";

const stockStateSchema = z.union([
  z.object({ quantite: z.coerce.number().int(), stock_min: z.coerce.number().int().nonnegative().default(0), stock_max: z.coerce.number().int().nonnegative().nullable().optional() }),
  z.array(z.object({ quantite: z.coerce.number().int(), stock_min: z.coerce.number().int().nonnegative().default(0), stock_max: z.coerce.number().int().nonnegative().nullable().optional() }))
]).nullable().optional();

const recipeRowSchema = z.object({
  produit_id: identifierSchema,
  ingredient_id: identifierSchema,
  quantite_requise: z.coerce.number().int().positive(),
  quantite_produite: z.coerce.number().int().positive(),
  produit: z.object({ id: identifierSchema, article: z.string(), stocks: stockStateSchema }),
  ingredient: z.object({
    id: identifierSchema,
    article: z.string(),
    stocks: z.union([z.object({ quantite: z.coerce.number().int() }), z.array(z.object({ quantite: z.coerce.number().int() }))]).nullable().optional()
  })
});

export type RecipeRow = z.infer<typeof recipeRowSchema>;

export async function getCraftRecipes(): Promise<RecipeRow[]> {
  const { data, error } = await getSupabaseClient()
    .from("recettes_craft")
    .select("produit_id,ingredient_id,quantite_requise,quantite_produite,produit:catalogue!produit_id(id,article,stocks(quantite,stock_min,stock_max)),ingredient:catalogue!ingredient_id(id,article,stocks(quantite))")
    .order("produit_id")
    .order("ingredient_id");
  if (error) throw new Error(error.message);
  return z.array(recipeRowSchema).parse(data);
}

export interface CraftStockNeed {
  productId: string;
  article: string;
  current: number;
  minimum: number;
  maximum: number | null;
  missing: number;
  craftCount: number;
  craftableQuantity: number;
  partiallyAvailable: boolean;
  resourceUnavailable: boolean;
}

export function craftStockNeeds(recipes: RecipeRow[]): CraftStockNeed[] {
  const products = new Map<string, CraftStockNeed>();
  const recipesByProduct = new Map<string, RecipeRow[]>();
  recipes.forEach(recipe => {
    const productId = String(recipe.produit_id);
    recipesByProduct.set(productId, [...(recipesByProduct.get(productId) ?? []), recipe]);
  });
  recipesByProduct.forEach(productRecipes => {
    const recipe = productRecipes[0]!;
    const productId = String(recipe.produit_id);
    const stockRelation = recipe.produit.stocks;
    const stock = Array.isArray(stockRelation) ? stockRelation[0] : stockRelation;
    const current = stock?.quantite ?? 0;
    const minimum = stock?.stock_min ?? 0;
    const maximum = stock?.stock_max ?? null;
    if (current >= minimum) return;
    const target = maximum ?? minimum;
    const missing = Math.max(0, target - current);
    const craftCount = Math.ceil(missing / recipe.quantite_produite);
    const availableCrafts = Math.min(...productRecipes.map(line =>
      Math.floor(ingredientStock(line) / line.quantite_requise)
    ));
    const possibleCrafts = Math.min(craftCount, availableCrafts);
    const craftableQuantity = Math.min(missing, possibleCrafts * recipe.quantite_produite);
    products.set(productId, {
      productId,
      article: recipe.produit.article,
      current,
      minimum,
      maximum,
      missing,
      craftCount,
      craftableQuantity,
      partiallyAvailable: availableCrafts > 0 && availableCrafts < craftCount,
      resourceUnavailable: availableCrafts === 0
    });
  });
  return [...products.values()].sort((left, right) => left.article.localeCompare(right.article, "fr"));
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
