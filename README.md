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
VITE_UMAMI_SCRIPT_URL=https://cloud.umami.is/script.js
VITE_UMAMI_WEBSITE_ID=00000000-0000-0000-0000-000000000000
```

La clé publique est nécessairement visible dans le navigateur. Ne jamais utiliser une clé `secret` ou `service_role` dans le frontend.

Les deux variables Umami sont optionnelles, mais doivent être renseignées ensemble pour activer les statistiques. Pour une instance auto-hébergée, utiliser l’URL de script fournie par son écran **Tracking code**. Le suivi respecte le réglage « Do Not Track » du navigateur.

## Vérifications

```bash
bun run check
bun test
bun run build
```

La migration initiale dans `supabase/migrations/` constitue le schéma versionné. `supabase/seed.sql` contient les données fictives initiales à importer une seule fois sur une base vide.

## Image Docker

Construire et lancer l’image localement :

```bash
docker build -t ombrelune-erp:local .
docker run --rm -p 8080:80 \
  -e VITE_SUPABASE_URL=https://supabase.example.com \
  -e VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
  -e VITE_UMAMI_SCRIPT_URL=https://cloud.umami.is/script.js \
  -e VITE_UMAMI_WEBSITE_ID=00000000-0000-0000-0000-000000000000 \
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
- `VITE_SUPABASE_PUBLISHABLE_KEY`, clé publique Supabase ;
- `VITE_UMAMI_SCRIPT_URL`, URL `src` du code de suivi Umami (optionnelle) ;
- `VITE_UMAMI_WEBSITE_ID`, identifiant du site Umami (optionnel, à renseigner avec l’URL).

Supabase self-hosted est une stack multi-conteneurs indépendante. Utiliser la release officielle épinglée et son `.env`, puis l’importer comme seconde stack Portainer. Une machine de 4 Go de RAM et 2 CPU est le minimum officiel ; 8 Go et 4 CPU sont recommandés. Après son démarrage, appliquer `supabase/migrations/20260820000000_initial_schema.sql`, puis éventuellement `supabase/seed.sql` sur une base neuve.

Documentation officielle : [Self-hosting Supabase avec Docker](https://supabase.com/docs/guides/self-hosting/docker).
