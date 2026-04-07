# QA Hub — Contexte projet pour Claude Code

## Vision produit

Application web dédiée aux testeurs QA pour centraliser et automatiser la gestion des tests.

**Tagline** : *"De la User Story au test exécuté, en un seul endroit."*

```
OpenProject (US) → IA Grok (génération) → Squash TM (sync) → Exécution guidée
```

---

## Stack technique

| Couche | Techno |
|---|---|
| Frontend | Angular 17+ (standalone components) |
| Backend | Express + TypeScript (Node 20) |
| Base de données | PostgreSQL 16 |
| IA | Grok API (xAI) — modèle `grok-3-mini` |
| Gestion de projet | OpenProject (API v3) |
| Gestion de tests | Squash TM (API REST) |
| Infrastructure | Docker Compose (3 containers) |

---

## Architecture Docker

```
docker-compose.yml
├── frontend   (Angular → Nginx, port 4200)
├── backend    (Express + ts-node, port 3000)
└── db         (PostgreSQL 16, port 5433)
```

Réseau interne Docker : les services communiquent via leurs noms (`backend`, `db`).

---

## Structure du projet

```
qa-hub/
├── docker-compose.yml
├── .env                          # Secrets (ne pas commiter)
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/app/
│       ├── app.component.ts/html
│       ├── app.config.ts         # provideHttpClient, provideRouter
│       ├── app.routes.ts
│       ├── core/
│       │   └── services/
│       │       ├── openproject.service.ts
│       │       └── ai.service.ts
│       └── features/
│           └── projects/
│               ├── projects.component.ts
│               ├── projects.component.html
│               └── projects.component.scss
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts              # Entry point Express
│       ├── db.ts                 # Pool PostgreSQL
│       ├── routes/
│       │   ├── openproject.routes.ts
│       │   └── ai.routes.ts
│       └── services/
│           ├── openproject.service.ts
│           └── ai.service.ts
└── db/
    └── init.sql                  # Schéma initial
```

---

## Variables d'environnement (`.env`)

```env
POSTGRES_DB=qahub
POSTGRES_USER=qauser
POSTGRES_PASSWORD=qapass
DATABASE_URL=postgresql://qauser:qapass@db:5432/qahub

OPENPROJECT_URL=https://ton-instance.openproject.com
OPENPROJECT_TOKEN=xxx

GROK_API_KEY=xai-xxx

SQUASH_URL=https://ton-squash.com
SQUASH_TOKEN=xxx
```

---

## Schéma base de données

```sql
workspaces        -- configurations de connexion (OpenProject + Squash)
test_cases        -- cas de test générés ou importés
  └── test_steps  -- étapes d'un cas de test
executions        -- résultats d'exécution
  └── execution_steps -- résultat par étape (pass/fail/skip)
```

---

## API Backend — endpoints existants

### Health
```
GET  /health          → status API
GET  /health/db       → status PostgreSQL
```

### OpenProject
```
GET  /api/openproject/test                          → tester la connexion
GET  /api/openproject/projects                      → liste des projets
GET  /api/openproject/projects/:id/user-stories     → US d'un projet
```

> Auth : headers `x-op-url` et `x-op-token`
> L'API OpenProject utilise la structure HAL — les champs status/priority/type/assignee sont dans `_links`, pas à la racine.
> Filtre côté Node : `_links.type.title === 'User story'`

### IA (Grok)
```
POST /api/ai/generate           → générer des cas de test depuis une US
GET  /api/ai/test-cases/:usId   → récupérer les cas d'une US depuis la DB
```

Payload POST `/api/ai/generate` :
```json
{
  "usId": 44,
  "usTitle": "Titre de la US",
  "usDescription": "Description markdown de la US"
}
```

Réponse :
```json
{
  "success": true,
  "testCases": [
    {
      "id": "uuid",
      "title": "Titre du cas",
      "preconditions": "...",
      "priority": "high|medium|low",
      "steps": [
        { "action": "...", "expected_result": "..." }
      ]
    }
  ]
}
```

---

## Frontend — composants existants

### `ProjectsComponent` (feature principale)
- Connexion OpenProject (formulaire URL + token, stocké en localStorage)
- Sidebar avec liste des projets
- Liste des US paginée (8 par page) avec recherche
- Panel latéral (slide-in) sur sélection d'une US
- Bouton "Générer avec Grok" dans le panel → appel API → affichage des cas de test

### Services Angular
- `OpenprojectService` : `testConnection()`, `getProjects()`, `getUserStories()`
- `AiService` : `generate()`, `getTestCases()`

---

## Sprints

### ✅ Sprint 1 — Fondations (TERMINÉ)
- [x] Docker Compose : Angular + Express + PostgreSQL
- [x] Schéma base de données + init.sql
- [x] Connexion Express ↔ PostgreSQL
- [x] Endpoint OpenProject : test connexion, projets, US

### ✅ Sprint 2 — Génération IA (TERMINÉ)
- [x] Service Grok (xAI) — génération cas de test depuis une US
- [x] Sauvegarde des cas de test en DB (test_cases + test_steps)
- [x] Récupération des cas existants par US
- [x] UI : panel latéral avec bouton génération + affichage des cas

### 🔜 Sprint 3 — Sync Squash TM
- [ ] Service backend Squash TM (connexion API REST)
- [ ] Endpoint POST `/api/squash/push` — envoyer les cas vers Squash
- [ ] Endpoint GET `/api/squash/test-cases` — récupérer les cas depuis Squash
- [ ] UI : bouton "Envoyer vers Squash" dans le panel latéral
- [ ] UI : page de visualisation des cas Squash

### 🔜 Sprint 4 — Exécution guidée
- [ ] Mode exécution : layout split-screen (navigateur intégré | steps)
- [ ] Navigation step by step (Pass / Fail / Skip)
- [ ] Sauvegarde des résultats en DB (executions + execution_steps)
- [ ] Envoi des résultats vers Squash TM

### 🔜 Sprint 5 — Polish & Settings
- [ ] Page Settings : gestion des workspaces (OpenProject + Squash)
- [ ] Historique des exécutions
- [ ] Édition manuelle des cas de test
- [ ] Régénération d'un cas individuel

---

## Conventions de code

### Backend (TypeScript/Express)
- `require()` interdit — utiliser `import/export` ES modules
- `tsconfig.json` : `"module": "commonjs"`, `"esModuleInterop": true`, `"strict": false`
- Toujours utiliser `node-fetch@2` (compatible CommonJS)
- Les routes retournent toujours `res.json()` — pas de `res.send()`
- Gestion d'erreur : `try/catch` sur tous les handlers async

### Frontend (Angular)
- Standalone components uniquement (pas de NgModule)
- `HttpClient` via `provideHttpClient()` dans `app.config.ts`
- Variables d'environnement dans `src/environments/environment.ts`
- `localStorage` pour stocker `op_url` et `op_token`
- SCSS par composant — pas de styles globaux sauf `styles.scss`

### Docker
- Rebuild complet : `docker compose up --build`
- Rebuild un service : `docker compose up --build backend`
- Logs : `docker compose logs -f backend`
- Le volume `postgres_data` persiste les données entre les restarts

---

## Points de vigilance connus

| Sujet | Détail |
|---|---|
| OpenProject HAL | Les champs `status`, `priority`, `type`, `assignee` sont dans `_links` |
| Filtre US | Filtre côté Node : `_links.type.title === 'User story'` |
| Grok JSON | Parfois des backticks dans la réponse → nettoyage avec replace |
| Port Postgres | Exposé sur `5433` (conflit avec Postgres local sur `5432`) |
| CORS | Backend configuré pour `http://localhost:4200` uniquement |
| nginx | Proxy `/api/` → `http://backend:3000/` |
