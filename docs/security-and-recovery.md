# Sécurité légère et récupération

Ombrelune est un ERP fictif utilisé entre joueurs de confiance. La stratégie retenue privilégie la traçabilité et la récupération sans introduire une authentification lourde.

## Politique navigateur

Nginx applique des en-têtes simples contre le sniffing de contenu, les referrers trop détaillés, l'intégration par un site tiers et l'accès inutile aux périphériques. La CSP autorise uniquement les ressources locales, Supabase et Google Fonts.

La CSP conserve temporairement `unsafe-inline` pour rester compatible avec le script de thème actuel.

## État des rendus HTML

Le frontend contient 66 affectations `innerHTML` ou appels équivalents dans 8 fichiers :

- `src/features/operations/page.ts` : 28 ;
- `src/features/direction/page.ts` : 14 ;
- `src/features/caisse/page.ts` : 12 ;
- `src/features/employee-session/controller.ts` : 6 ;
- `src/features/craft/planner.ts` : 2 ;
- `src/ui/layout.ts` : 2 ;
- les deux dialogues spécialisés : 1 chacun.

Une conversion complète vers `createElement`, `textContent`, `value` et `replaceChildren` représente environ 3 à 5 jours de travail avec les tests de non-régression. L'ordre recommandé est :

1. formulaires et listes contenant des valeurs Supabase ;
2. dialogues contenant des noms de clients ou employés ;
3. tableaux génériques ;
4. structures statiques du layout.

Les valeurs conservées dans des gabarits HTML doivent continuer à passer par `escapeHtml`.

## Journaux et retour arrière

Le journal métier conserve déjà les ventes, fabrications, commandes, permis et opérations sensibles avec leurs états avant/après. Les commandes disposent d'une annulation et d'une restauration métier.

La table `audit_row_changes` complète ce journal. Un trigger y conserve chaque insertion, modification et suppression sur les tables métier, y compris lorsqu'un appel est fait directement à la Data API. Elle mémorise la transaction, la table, l'identifiant, les états avant/après, le rôle et le contexte HTTP disponible. Les rôles frontend peuvent la lire mais pas la modifier ou la supprimer.

Un journal n'est toutefois pas une sauvegarde : une opération complexe peut modifier plusieurs tables et une restauration ligne par ligne peut violer les règles métier. Pour revenir après une dégradation importante, utiliser une sauvegarde PostgreSQL complète.

Le journal métier `journal_actions` est conservé pour les recherches et analyses de la Direction. Le journal technique `audit_row_changes` n'est jamais purgé automatiquement. Lors d'une clôture comptable, la Direction peut demander sa purge ; cette option est désactivée par défaut et exige de confirmer qu'une sauvegarde récente a été effectuée. La clôture, la purge éventuelle et l'enregistrement de cette purge sont exécutés dans une seule transaction.

L'écran Direction charge le journal métier par pages de 25 actions. Les recherches et filtres sont réalisés dans PostgreSQL afin d'éviter de télécharger tout l'historique à chaque consultation.

Le plan Supabase Free ne fournit pas de sauvegarde automatique restaurable. Supabase recommande d'effectuer régulièrement un export logique hors site.

### Sauvegarde manuelle

Depuis le tableau de bord Supabase, récupérer la chaîne `Session pooler` dans `Connect`, puis exécuter dans un répertoire non versionné :

```bash
bunx supabase db dump --db-url 'CONNECTION_STRING' -f roles.sql --role-only
bunx supabase db dump --db-url 'CONNECTION_STRING' -f schema.sql
bunx supabase db dump --db-url 'CONNECTION_STRING' -f data.sql --use-copy --data-only
```

Ne jamais enregistrer la chaîne de connexion ou le mot de passe dans Git. Conserver au moins plusieurs sauvegardes datées sur un stockage distinct du serveur applicatif.

### Fréquence recommandée

- export quotidien pendant les périodes de jeu actives ;
- export avant une migration ou un changement important ;
- conservation des 7 dernières sauvegardes quotidiennes et de 4 sauvegardes hebdomadaires ;
- test ponctuel de restauration dans un projet Supabase séparé.

Pour une restauration, créer de préférence un nouveau projet Supabase, importer le schéma puis les données, vérifier le résultat, et seulement ensuite remplacer l'URL et la clé publique du conteneur ERP. Cette méthode évite d'écraser une base encore récupérable.
