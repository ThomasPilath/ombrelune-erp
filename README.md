# Ombrelune ERP

Application web de gestion pour l’entreprise fictive Ombrelune : caisse, fabrication, commandes, clients, permis, stocks, trésorerie et journal métier.

## Stack

- TypeScript strict, Vite et Tailwind CSS 4 ;
- Supabase/PostgreSQL pour les données et les opérations transactionnelles ;
- Bun pour les dépendances et les scripts ;
- Nginx pour l’image Docker de production.

## Développement

Le frontend doit cibler une instance Supabase accessible. Il n’embarque plus d’instance Supabase locale.

```bash
cp .env.example .env.local
bun install
bun run dev
```

Variables publiques requises :

```dotenv
VITE_SUPABASE_URL=https://supabase.example.com
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

La clé publique est nécessairement visible dans le navigateur. Ne jamais utiliser une clé `secret` ou `service_role` dans le frontend.


## Vérifications

```bash
bun run check
bun test
bun run build
```

La migration unique `supabase/migrations/20260908000000_initial_schema.sql` définit directement le schéma final (tables, contraintes, fonctions, vues, triggers et droits), sans rejouer les évolutions historiques. `supabase/seed.sql` contient les données fictives initiales à importer une seule fois sur une base vide.

## Réinitialiser la base Supabase

Cette procédure efface les données applicatives de la base ciblée et recharge le seed actuel. Arrêter l’utilisation de l’ERP pendant l’opération. Elle s’applique à une base Supabase dédiée à Ombrelune, hébergée ou self-hosted, accessible depuis le terminal.

La migration consolidée remplace les trois anciennes migrations : utiliser un **reset**, pas `db push` sur l’ancien schéma. Le CLI gère aussi l’historique des migrations.

Depuis la racine du dépôt, dans **zsh** (terminal macOS), saisir l’URL de connexion PostgreSQL administrateur lorsqu’elle est demandée. La saisie reste masquée et ne s’inscrit pas dans l’historique du shell :

```zsh
read -rs 'OMBRELUNE_DB_URL?URL PostgreSQL de la base Ombrelune : '
printf '\n'
```

Utiliser l’URL PostgreSQL directe ou le pooler en mode session, au format `postgresql://UTILISATEUR:MOT_DE_PASSE@HOTE:PORT/postgres`, avec les caractères spéciaux du mot de passe encodés pour une URL. Ce n’est pas l’URL HTTPS `VITE_SUPABASE_URL` ni une clé publique. Pour Supabase self-hosted, l’hôte et le port doivent être accessibles depuis la machine exécutant la commande.

Exécuter ensuite :

```zsh
bunx supabase db reset --db-url "$OMBRELUNE_DB_URL"
bunx supabase migration list --db-url "$OMBRELUNE_DB_URL"
unset OMBRELUNE_DB_URL
```

Confirmer la suppression lorsqu’elle est demandée par le CLI. Le reset applique `20260908000000_initial_schema.sql`, puis `supabase/seed.sql` automatiquement grâce à `[db.seed]` dans `supabase/config.toml`. Ne pas importer le seed une deuxième fois. La liste des migrations doit ensuite afficher `20260908000000` localement et à distance.

Le seed restaure 8 employés, 159 clients, 50 articles, 48 lignes de stock et 102 lignes de recettes, sans dossiers de permis préchargés. L’accès Direction utilise `patron123`.

Pour une vérification SQL juste après le reset, avec `psql` installé et avant de supprimer la variable de connexion :

```zsh
psql "$OMBRELUNE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/schema_smoke.sql
```

Ce test exerce les ventes, stocks, fabrications, commandes, permis et clôtures dans une transaction annulée à la fin. Les séquences d’identifiants peuvent néanmoins avancer.

Référence : [Supabase CLI — db reset](https://supabase.com/docs/reference/cli/supabase-db-reset).

## Image Docker

Construire et lancer l’image localement :

```bash
docker build -t ombrelune-erp:local .
docker run --rm -p 8080:80 \
  -e VITE_SUPABASE_URL=https://supabase.example.com \
  -e VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
  ombrelune-erp:local
```

Les variables sont injectées au démarrage du conteneur. Une même image peut donc être utilisée sur plusieurs environnements sans rebuild.

## Publication Docker Hub

Le workflow `.github/workflows/docker-publish.yml` se déclenche à la publication d’un tag sémantique `vX.Y.Z`, comme sur ELIXIR-calc. Il publie dans `DOCKERHUB_USERNAME/ombrelune-erp` les tags `X.Y.Z`, `X.Y`, `X`, `sha-*` et `latest`.

Créer dans GitHub Actions les secrets :

- `DOCKERHUB_USERNAME` : nom du compte Docker Hub ;
- `DOCKERHUB_TOKEN` : jeton d’accès Docker Hub en lecture/écriture.

Puis publier une version :

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Portainer

Le fichier `compose.portainer.yml` déploie l’application. Dans les variables d’environnement de la stack, renseigner :

- `DOCKERHUB_USERNAME` ;
- `OMBRELUNE_VERSION` (par exemple `1.0.0`, ou `latest`) ;
- `OMBRELUNE_PORT` (par défaut `8080`) ;
- `VITE_SUPABASE_URL`, URL publique HTTPS du gateway Supabase ;
- `VITE_SUPABASE_PUBLISHABLE_KEY`, clé publique Supabase.

Supabase self-hosted est une stack multi-conteneurs indépendante. Utiliser la release officielle épinglée et son `.env`, puis l’importer comme seconde stack Portainer. Une machine de 4 Go de RAM et 2 CPU est le minimum officiel ; 8 Go et 4 CPU sont recommandés. Après son démarrage, appliquer `supabase/migrations/20260908000000_initial_schema.sql`, puis éventuellement `supabase/seed.sql` sur une base neuve.

Documentation officielle : [Self-hosting Supabase avec Docker](https://supabase.com/docs/guides/self-hosting/docker).
