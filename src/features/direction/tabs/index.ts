import { mountTabs, type TabDefinition } from "../../../ui/components/tabs";

type Renderer = (outlet: HTMLElement) => Promise<void>;

export interface DirectionRenderers {
  activities: Renderer;
  logs: Renderer;
  summary: Renderer;
  expenses: Renderer;
  employees: Renderer;
  settings: Renderer;
  catalogue: Renderer;
  recipes: Renderer;
  stocks: Renderer;
}

const groups: Record<string, TabDefinition[]> = {
  pilotage: [{ id: "activities", label: "Activités" }, { id: "logs", label: "Journal d’activité" }],
  finances: [{ id: "summary", label: "Synthèse financière" }, { id: "expenses", label: "Frais" }],
  "equipe-rh": [
    { id: "employees", label: "Employés" },
    { id: "catalogue", label: "Catalogue" },
    { id: "recipes", label: "Recettes" },
    { id: "stocks", label: "Stocks" },
    { id: "settings", label: "Paramètres" }
  ]
};

export function mountDirectionTabs(outlet: HTMLElement, pageId: string, renderers: DirectionRenderers): void {
  const items = groups[pageId] ?? groups["equipe-rh"]!;
  mountTabs(outlet, items, (id, content) => renderers[id as keyof DirectionRenderers](content));
}
