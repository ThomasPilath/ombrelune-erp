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
  { id:"caisse", title:"Caisse & ventes", description:"Enregistrer les encaissements et ventes.", href:"/caisse", icon:"cart", group:"operations", eyebrow:"Opérations" },
  { id:"craft", title:"Fabrication", description:"Saisir et suivre les productions.", href:"/craft", icon:"package", group:"operations", eyebrow:"Opérations" },
  { id:"rachat", title:"Rachat", description:"Acheter les matières premières.", href:"/rachat", icon:"scale", group:"operations", eyebrow:"Opérations" },
  { id:"commandes", title:"Commandes", description:"Gérer les commandes des clients.", href:"/commandes", icon:"ticket", group:"operations", eyebrow:"Opérations" },
  { id:"tresorerie", title:"Coffre & trésorerie", description:"Consulter et saisir les mouvements du coffre.", href:"/tresorerie", icon:"bank", group:"gestion", eyebrow:"Gestion" },
  { id:"permis-balais", title:"Permis balais", description:"Renseigner les passages et suivre la demande de permis balais.", href:"/permis/balais", icon:"sparkles", group:"permis", eyebrow:"Permis" },
  { id:"permis-voiture", title:"Permis voiture", description:"Renseigner les passages et suivre la demande de permis voiture.", href:"/permis/voiture", icon:"car", group:"permis", eyebrow:"Permis" },
  { id:"permis-moto", title:"Permis moto", description:"Renseigner les passages et suivre la demande de permis moto.", href:"/permis/moto", icon:"bike", group:"permis", eyebrow:"Permis" },
  { id:"clients", title:"Fichier client", description:"Consulter l'annuaire et les hiboux.", href:"/clients", icon:"users", group:"gestion", eyebrow:"Gestion" },
  { id:"pilotage", title:"Pilotage", description:"Consulter et filtrer le journal de l’activité.", href:"/pilotage", icon:"pulse", group:"direction", eyebrow:"Direction" },
  { id:"finances", title:"Finances", description:"Suivre les résultats, périodes et frais.", href:"/finances", icon:"chart", group:"direction", eyebrow:"Direction" },
  { id:"equipe-rh", title:"Gestion", description:"Gérer les employés, l’offre, les stocks et les paramètres de l’ERP.", href:"/equipe-rh", icon:"badge", group:"direction", eyebrow:"Direction" }
];

const legacyDirectionPages: Record<string, string> = {
  direction: "pilotage", activite: "pilotage",
  synthese: "finances", frais: "finances",
  employes: "equipe-rh", "historique-rh": "equipe-rh",
  catalogue: "equipe-rh", recettes: "equipe-rh", stocks: "equipe-rh", "offre-stocks": "equipe-rh"
};

export function getPage(id: string): PageDefinition {
  return pages.find(page => page.id === id) ?? pages.find(page => page.id === "caisse")!;
}

export function getPageFromPath(pathname: string): PageDefinition {
  const slug = pathname.replace(/^\/+|\/+$/g, "");
  const permitPages: Record<string, string> = {
    permis: "permis-balais",
    "permis/balais": "permis-balais", "permis-balais": "permis-balais", permis_balais: "permis-balais",
    "permis/voiture": "permis-voiture", "permis-voitures": "permis-voiture", permis_voitures: "permis-voiture",
    "permis/moto": "permis-moto", "permis-motos": "permis-moto", permis_motos: "permis-moto"
  };
  if (permitPages[slug]) return getPage(permitPages[slug]);
  if (legacyDirectionPages[slug]) return getPage(legacyDirectionPages[slug]);
  return getPage(slug || "caisse");
}
