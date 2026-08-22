import { z } from "zod";
import { readEmployeeSession } from "../../core/employee-session";
import { catalogueRowSchema, clientRowSchema, permitRowSchema, type CatalogueRow, type ClientRow, type PermitRow } from "../schemas";
import { callRpc, getSupabaseClient } from "../supabase";

export interface BasketLine { article_id: string | number; quantite: number }
export interface PermitWithdrawal { article_id: string | number; permit_id: string | number }
export const orderToBasketStorageKey = "ombrelune-order-to-basket";
export interface PreparedOrder {
  id: string | number;
  clientName: string;
  lines: BasketLine[];
}

const preparedOrderSchema = z.object({
  id: z.union([z.string(), z.number()]),
  client_nom: z.string().nullable(),
  clients: z.object({ nom_prenom: z.string() }).nullable(),
  lignes_commandes: z.array(z.object({
    article_id: z.union([z.string(), z.number()]),
    quantite: z.coerce.number().int().positive()
  }))
});

export async function getEmployeeCosts(articleIds: CatalogueRow["id"][]): Promise<Map<string, number>> {
  const entries = await Promise.all(articleIds.map(async articleId => {
    const cost = await callRpc("cout_revient_article", {
      p_article_id: articleId,
      p_articles_visites: []
    }, z.coerce.number().nonnegative());
    return [String(articleId), cost] as const;
  }));
  return new Map(entries);
}

export async function getSellableCatalogue(): Promise<CatalogueRow[]> {
  const { data, error } = await getSupabaseClient()
    .from("catalogue")
    .select("id,article,prix_vente,prix_achat,type_article,type_permis,stocks(quantite,stock_max)")
    .gt("prix_vente", 0)
    .eq("actif", true)
    .order("article");
  if (error) throw new Error(error.message);
  return z.array(catalogueRowSchema).parse(data);
}

export async function getPreparedOrders(): Promise<PreparedOrder[]> {
  const { data, error } = await getSupabaseClient()
    .from("commandes")
    .select("id,client_nom,clients(nom_prenom),lignes_commandes(article_id,quantite)")
    .eq("statut_livraison", "Prêt")
    .order("date_pret", { ascending: true });
  if (error) throw new Error(error.message);
  return z.array(preparedOrderSchema).parse(data).map(order => ({
    id: order.id,
    clientName: order.clients?.nom_prenom ?? order.client_nom ?? "Client inconnu",
    lines: order.lignes_commandes
  }));
}

export async function searchClients(term: string, field: "name" | "owl"): Promise<ClientRow[]> {
  const query = getSupabaseClient().from("clients_actifs").select("id,nom_prenom,hibou").limit(8);
  const { data, error } = field === "name"
    ? await query.ilike("nom_prenom", `%${term}%`).order("nom_prenom")
    : await query.ilike("hibou", `${term}%`).order("nom_prenom");
  if (error) throw new Error(error.message);
  return z.array(clientRowSchema).parse(data);
}

export async function getClientPermit(clientId: ClientRow["id"], type: NonNullable<CatalogueRow["type_permis"]>): Promise<PermitRow | null> {
  const permitType = { Balais: "broomstick", Moto: "motorcycle", Voiture: "car" }[type];
  const { data, error } = await getSupabaseClient().from("client_permits").select("*")
    .eq("client_id", clientId).eq("type", permitType).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? permitRowSchema.parse(data) : null;
}

export async function getTicketCount(clientId: ClientRow["id"]): Promise<number> {
  const session = await callRpc("session_jeu", {}, z.string());
  const { data, error } = await getSupabaseClient().from("clients")
    .select("tickets_retires,ticket_session").eq("id", clientId).single();
  if (error) throw new Error(error.message);
  const state = z.object({ tickets_retires: z.coerce.number(), ticket_session: z.string().nullable() }).parse(data);
  return state.ticket_session === session ? state.tickets_retires : 0;
}

export async function checkout(lines: BasketLine[], ticketClientId: ClientRow["id"] | null, withdrawals: PermitWithdrawal[], orderIds: PreparedOrder["id"][] = []): Promise<number> {
  const employee = readEmployeeSession();
  if (!employee) throw new Error("Sélectionnez un employé avant de valider.");
  return callRpc("enregistrer_panier_commandes", {
    p_vendeur_id: employee.employeeId,
    p_lignes: lines,
    p_client_ticket_id: ticketClientId,
    p_retraits_permis: withdrawals,
    p_commande_ids: orderIds
  }, z.coerce.number());
}

export async function checkoutEmployee(lines: BasketLine[], ticketClientId: ClientRow["id"] | null): Promise<number> {
  const employee = readEmployeeSession();
  if (!employee) throw new Error("Sélectionnez un employé avant de valider.");
  return callRpc("enregistrer_panier_employe", {
    p_employe_id: employee.employeeId,
    p_lignes: lines,
    p_client_ticket_id: ticketClientId
  }, z.coerce.number());
}
