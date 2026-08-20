export type PageGroup = "operations" | "gestion" | "permis" | "direction";

export interface PageDefinition {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: string;
  group: PageGroup;
  eyebrow: string;
}

export const pages: PageDefinition[] = [
  { id:"craft", title:"Fabrication", description:"Saisir et suivre les productions.", href:"/craft", icon:"package", group:"operations", eyebrow:"Opérations" },
  { id:"caisse", title:"Caisse & ventes", description:"Enregistrer les encaissements et ventes.", href:"/caisse", icon:"cart", group:"operations", eyebrow:"Opérations" },
  { id:"rachat", title:"Rachat", description:"Acheter les matières premières.", href:"/rachat", icon:"scale", group:"operations", eyebrow:"Opérations" },
  { id:"commandes", title:"Commandes", description:"Gérer les commandes des clients.", href:"/commandes", icon:"ticket", group:"operations", eyebrow:"Opérations" },
  { id:"tresorerie", title:"Coffre & trésorerie", description:"Consulter et saisir les mouvements du coffre.", href:"/tresorerie", icon:"bank", group:"gestion", eyebrow:"Gestion" },
  { id:"permis", title:"Permis", description:"Gérer les préinscriptions, passages et retraits.", href:"/permis", icon:"car", group:"permis", eyebrow:"Permis" },
  { id:"clients", title:"Fichier client", description:"Consulter l'annuaire et les hiboux.", href:"/clients", icon:"users", group:"gestion", eyebrow:"Gestion" },
  { id:"pilotage", title:"Pilotage", description:"Consulter et filtrer le journal de l’activité.", href:"/pilotage", icon:"pulse", group:"direction", eyebrow:"Direction" },
  { id:"finances", title:"Finances", description:"Suivre les résultats, périodes et frais.", href:"/finances", icon:"chart", group:"direction", eyebrow:"Direction" },
  { id:"equipe-rh", title:"Équipe & RH", description:"Gérer l’équipe et consulter les archives individuelles.", href:"/equipe-rh", icon:"badge", group:"direction", eyebrow:"Direction" },
  { id:"offre-stocks", title:"Offre & stocks", description:"Administrer le catalogue, les recettes et les stocks.", href:"/offre-stocks", icon:"boxes", group:"direction", eyebrow:"Direction" }
];

const legacyDirectionPages: Record<string, string> = {
  direction: "pilotage", activite: "pilotage",
  synthese: "finances", frais: "finances",
  employes: "equipe-rh", "historique-rh": "equipe-rh",
  catalogue: "offre-stocks", recettes: "offre-stocks", stocks: "offre-stocks"
};

export function getPage(id: string): PageDefinition {
  return pages.find(page => page.id === id) ?? pages.find(page => page.id === "caisse")!;
}

export function getPageFromPath(pathname: string): PageDefinition {
  const slug = pathname.replace(/^\/+|\/+$/g, "");
  if (["permis-balais", "permis-voitures", "permis-motos", "permis_balais", "permis_voitures", "permis_motos"].includes(slug)) return getPage("permis");
  if (legacyDirectionPages[slug]) return getPage(legacyDirectionPages[slug]);
  return getPage(slug || "caisse");
}
