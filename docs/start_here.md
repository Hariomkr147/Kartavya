# Kartavya Documentation

## Overview

`Kartavya` is a gamified civic grievance platform. The repository is a monorepo containing the backend, frontend, shared contracts, and project documentation.

The backend application code (`backend/app/`) and frontend code (`frontend/src/`) are still scaffold-only: MVC-style starter folders with no implemented logic beyond placeholder `.gitkeep` files. The API contract and database schema are fully designed under `backend/`, and together they form the source of truth that implementation should be built against.

This page describes the current state of the codebase and the intended structure going forward.

## Current Repository Structure

- `backend/`
  - `api/`
    - `openapi.yaml`
  - `database/`
    - `schema.dbml`
  - `app/`
    - `config/`
    - `controllers/`
    - `middlewares/`
    - `models/`
    - `routes/`
    - `services/`
    - `views/`
  - `tests/`
- `frontend/`
  - `public/`
  - `src/`
    - `assets/`
    - `components/`
    - `hooks/`
    - `pages/`
    - `routes/`
    - `services/`
    - `types/`
- `shared/`
  - `contracts/`
- `docs/`
  - `start_here.md`
  - `backend/`
    - `api.md`
    - `database.md`
  - `frontend/`

## What Exists Today

- **API contract**: `backend/api/openapi.yaml` is an OpenAPI 3.0.3 specification (`info.version` 2.0.0) and is the canonical contract for the platform. It defines:
  - Authentication (`/auth/register`, `/auth/login`)
  - Reference data (`/categories`, `/zones`)
  - Citizen complaint flows (create, view, evidence upload, upvote, confirm, dispute)
  - The anonymized public feed (`/feed`)
  - Officer flows (queue, evidence review, status changes, batch status, progress notes, analytics)
  - Admin flows (user management, SLA config, zone officer assignment, analytics, AI zone reports, CSV export, settings)
  - Gamification (`/gamification/points`, `/gamification/badges`, `/leaderboard`)
  - Request and response bodies under `components/schemas`
- **Database schema**: `backend/database/schema.dbml` is a DBML schema designed one-to-one against the API contract, targeting Flask + SQLAlchemy + SQLite. It covers:
  - Accounts and reference data (`users`, `zones`, `complaint_categories`)
  - The complaint domain (`complaints`, `complaint_clusters`, `complaint_evidence`, `status_history`, `complaint_notes`, `complaint_upvotes`)
  - Gamification (`points_ledger`, `badges`, `citizen_badges`)
  - AI reports and system config (`ai_zone_reports`, `app_settings`)
  - Documented design principles: derived fields are computed on read, ledgers are append-only, and FK delete rules are chosen per relationship.
- **Backend reference docs**: `docs/backend/` contains supporting documentation for the API and database contracts.
- **Application code**: there are no backend route/controller/model implementation files and no frontend component files yet. `backend/app/`, `backend/tests/`, `frontend/`, and `shared/contracts/` contain starter scaffold directories and `.gitkeep` placeholders.
- **Contributor guide**: `CONTRIBUTING.md` explains setup, branching, commits, pull requests, and review expectations.

## Intended Purpose of Each Folder

### `backend/`

The backend hosts the server-side application logic, plus the API contract and database schema that define it.

- `backend/api/openapi.yaml`
  - The canonical OpenAPI contract. Implementation of routes/controllers should conform to this spec.
- `backend/database/schema.dbml`
  - The DBML source for the SQLite schema (Flask + SQLAlchemy). Changes to the data model should be made here and kept in sync with the API contract.
- `backend/app/config/`
  - Configuration files for the backend application.
- `backend/app/controllers/`
  - Request handlers and controller logic that process incoming API calls.
- `backend/app/middlewares/`
  - Reusable middleware functions for authentication, validation, logging, etc.
- `backend/app/models/`
  - Data models / ORM entities, expected to mirror `backend/database/schema.dbml`.
- `backend/app/routes/`
  - API route definitions and route wiring, expected to mirror `backend/api/openapi.yaml`.
- `backend/app/services/`
  - Business logic, service layer abstractions, and backend operations.
- `backend/app/views/`
  - If server-side rendering or view templates are used, they belong here.
- `backend/tests/`
  - Backend unit tests, integration tests, or contract tests.

### `frontend/`

The frontend is intended to be a React + Vite SPA.

- `frontend/public/`
  - Static assets served directly, such as `index.html`, images, and icons.
- `frontend/src/assets/`
  - Application-specific assets like images, fonts, or data files.
- `frontend/src/components/`
  - Reusable UI components (buttons, cards, forms, etc.).
- `frontend/src/hooks/`
  - Custom React hooks encapsulating state logic and side effects.
- `frontend/src/pages/`
  - Route-level views, one folder per screen/route.
- `frontend/src/routes/`
  - React Router configuration and route definitions.
- `frontend/src/services/`
  - API client layer built against `backend/api/openapi.yaml`.
- `frontend/src/types/`
  - TypeScript interfaces and type definitions for the frontend.

### `shared/`

The shared area is intended for cross-cutting code shared between backend and frontend.

- `shared/contracts/`
  - Reserved for data contracts, interface definitions, or DTOs shared by both frontend and backend. Currently empty; the API contract and DB schema live under `backend/api/` and `backend/database/`.

### `docs/`

The docs directory holds team-facing project documentation.

- `docs/start_here.md`
  - High-level repository map and current status.
- `docs/backend/`
  - Backend API and database reference documentation.
- `docs/frontend/`
  - Reserved for frontend implementation notes once frontend work begins.

## Current Status Summary

The data model and API surface are fully designed (`backend/api/openapi.yaml` + `backend/database/schema.dbml`), but no application logic has been implemented yet. The repository is ready for developers to begin implementing:

- backend routes, controllers, and models conforming to the API contract and DB schema,
- the frontend user interface and API client layer,
- tests and deployment configuration.

## Notes

- `README.md` provides a concise entry point and links here for details.
- `CONTRIBUTING.md` explains the team workflow for branches, commits, pull requests, and reviews.
