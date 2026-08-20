import { z } from "zod";

export const identifierSchema = z.union([z.string(), z.number()]);

export const catalogueRowSchema = z.object({
  id: identifierSchema,
  article: z.string(),
  prix_vente: z.coerce.number().nullable().optional(),
  prix_achat: z.coerce.number().nullable().optional(),
  type_article: z.enum(["objet", "ingredient", "ticket", "document_permis"]).default("objet"),
  type_permis: z.enum(["Balais", "Voiture", "Moto"]).nullable().optional(),
  stocks: z.union([
    z.object({ quantite: z.coerce.number().int(), stock_max: z.coerce.number().int().nullable().optional() }),
    z.array(z.object({ quantite: z.coerce.number().int(), stock_max: z.coerce.number().int().nullable().optional() }))
  ]).nullable().optional()
}).passthrough();

export type CatalogueRow = z.infer<typeof catalogueRowSchema>;

export const employeeRowSchema = z.object({
  id: identifierSchema,
  nom_prenom: z.string(),
  grade: z.enum(["Patron", "Co-Patron", "Adulte", "Étudiant"])
}).passthrough();

export type EmployeeRow = z.infer<typeof employeeRowSchema>;

export const clientRowSchema = z.object({
  id: identifierSchema,
  nom_prenom: z.string(),
  hibou: z.string().nullable(),
  tickets_retires: z.coerce.number().int().min(0).max(2).optional(),
  ticket_session: z.string().nullable().optional()
}).passthrough();
export type ClientRow = z.infer<typeof clientRowSchema>;

export const permitRowSchema = z.object({
  id: identifierSchema,
  client_id: identifierSchema,
  type: z.enum(["broomstick", "motorcycle", "car"]),
  status: z.enum(["pending", "accepted", "refused", "cancelled", "sold"])
}).passthrough();
export type PermitRow = z.infer<typeof permitRowSchema>;
