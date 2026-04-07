# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**QA Hub** is a full-stack test management tool that centralizes QA workflows — from OpenProject user stories to AI-generated test cases (via Google Gemini) and test execution. It is a monorepo with three services orchestrated by Docker Compose.

## Running the Project

```bash
# Full rebuild (recommended after any change)
docker compose up --build

# Rebuild a single service
docker compose up --build backend
docker compose up --build frontend

# View logs
docker compose logs -f backend
docker compose logs -f frontend
```

The frontend is available at `http://localhost:4200`, backend at `http://localhost:3000`.

## Development Without Docker

**Backend** (`/backend`):
```bash
npm install
npm run dev        # nodemon + ts-node, hot-reload
npm run build      # tsc → dist/
npm start          # run compiled dist/index.js
```

**Frontend** (`/frontend`):
```bash
npm install
ng serve           # dev server on port 4200
ng build           # production build to dist/
ng test            # Karma/Jasmine unit tests
```

## Architecture

### Monorepo Layout

```
qa-hub/
├── frontend/       # Angular 18 SPA (Nginx in Docker)
├── backend/        # Express 5 + TypeScript API
├── db/             # PostgreSQL 16 init scripts (init.sql)
├── docker-compose.yml
├── nginx.conf      # Proxies /api/ → backend:3000
└── .env            # Credentials (never commit)
```

### Request Flow

```
Browser → Nginx (:4200) → /api/* → Backend (:3000) → PostgreSQL / OpenProject API / Gemini API
```

The frontend does **not** call external APIs directly. All OpenProject and AI calls go through the backend.

### Frontend (Angular 18, standalone components)

- Entry: `frontend/src/main.ts` → `AppComponent` → `ProjectsComponent`
- `app.config.ts`: DI setup (HttpClient, Router)
- `core/services/`: singletons (`OpenprojectService`, `AiService`)
- `features/projects/`: main UI — project list, user story browser, test case generation panel
- No NgRx; state is local to components + `localStorage` for OpenProject credentials (`op_url`, `op_token`)
- API base URL: `environment.ts` (`http://localhost:3000` in dev)

### Backend (Express 5, TypeScript, ts-node)

- Entry: `backend/src/index.ts` — registers middleware and routes
- `src/db.ts` — PostgreSQL connection pool (`pg`)
- `src/routes/` — route definitions (`openproject.routes.ts`, `ai.routes.ts`)
- `src/services/` — business logic (`openproject.service.ts`, `ai.service.ts`)
- OpenProject credentials are passed from the frontend via `x-op-url` and `x-op-token` request headers (not stored server-side per request)

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | API liveness |
| GET | `/health/db` | DB connectivity |
| GET | `/api/openproject/projects` | List OpenProject projects |
| GET | `/api/openproject/projects/:id/user-stories` | User stories for a project |
| POST | `/api/ai/generate` | Generate test cases via Gemini |
| GET | `/api/ai/test-cases/:usId` | Retrieve saved test cases |

### Database Schema (PostgreSQL 16)

Tables: `workspaces`, `test_cases`, `test_steps`, `executions`, `execution_steps`

- UUID primary keys (pgcrypto extension)
- All FKs use `ON DELETE CASCADE`
- Schema initialized from `db/init.sql` on first container run

## Critical Technical Points

- **OpenProject API uses HAL format** — links and embedded resources are under `_links` and `_embedded`. Never assume flat JSON.
- **Gemini returns JSON wrapped in markdown code fences** (`\`\`\`json ... \`\`\``). The AI service strips these before `JSON.parse`. If adding new AI parsing, handle this.
- **node-fetch is pinned to v2.7.0** (CommonJS). Do not upgrade to v3+ (ESM-only) or backend imports will break.
- **CORS** is set to `http://localhost:4200` only. Changing the frontend origin requires updating `backend/src/index.ts`.
- **Docker DB port**: the PostgreSQL container exposes port `5432` (not `5433` as some earlier docs state).
- **Backend runs via ts-node directly** in Docker (no compile step). The `npm run build` / `dist/` path is for local non-Docker use only.

## Environment Variables

Defined in `.env` at the project root (loaded by Docker Compose and `dotenv` in the backend):

```
DATABASE_URL=postgresql://qauser:qapass@db:5432/qahub
POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD
OPENPROJECT_URL / OPENPROJECT_TOKEN   # fallback if not passed via headers
GEMINI_API_KEY
SQUASH_URL / SQUASH_TOKEN             # Sprint 3 (not yet implemented)
```
