# Kartavya Documentation

## Overview

`Kartavya` is a gamified civic grievance platform. The repository is a monorepo containing the backend, frontend, shared contracts, and design artifacts.

The backend application code (`backend/app/`) and frontend code (`frontend/src/`) are still scaffold-only — MVC-style starter folders with no implemented logic beyond placeholder `.gitkeep` files. However, the **data layer is no longer a placeholder**: the API contract and database schema are fully designed and live under `backend/`, and together they form the source of truth that implementation should be built against.

This documentation describes the current state of the codebase and the intended structure going forward.

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

## What Exists Today

- **API contract**: `backend/api/openapi.yaml` is an OpenAPI 3.0.3 specification (v2.0.0) and is the canonical contract for the platform. It fully defines:
  - Authentication (`/auth/register`, `/auth/login`)
  - Reference data (`/categories`, `/zones`)
  - Citizen complaint flows (create, view, evidence upload, upvote, confirm, dispute)
  - The anonymized public feed (`/feed`)
  - Officer flows (queue, evidence review, status changes, batch status, progress notes, analytics)
  - Admin flows (user management, SLA config, zone officer assignment, analytics, AI zone reports, CSV export, settings)
  - Gamification (`/gamification/points`, `/gamification/badges`, `/leaderboard`)
  - AI category suggestion (`/ai/suggest-category`)
  - All request/response bodies under `components/schemas` (e.g. `User`, `Complaint`, `ComplaintDetail`, `Evidence`, `StatusHistoryEntry`, `PointsLedgerEntry`, `Badge`, `ZoneAnalytics`, `OfficerPerformance`, `AiZoneReport`)
- **Earlier draft**: `backend/api/openapi_riddhim.yaml` is an earlier, leaner OpenAPI skeleton (v1.0.0) covering the same general surface but without response schemas. It is retained for reference only; new work should target `openapi.yaml`.
- **Database schema**: `backend/database/schema.dbml` is a DBML schema designed one-to-one against the API contract, targeting Flask + SQLAlchemy + SQLite. It covers:
  - Accounts and reference data (`users`, `zones`, `complaint_categories`)
  - The complaint domain (`complaints`, `complaint_clusters`, `complaint_evidence`, `status_history`, `complaint_notes`, `complaint_upvotes`)
  - Gamification (`points_ledger`, `badges`, `citizen_badges`)
  - AI reports and system config (`ai_zone_reports`, `app_settings`)
  - Documented design principles: derived fields (severity/SLA labels) are computed on read rather than stored, ledgers are append-only, and FK delete rules are chosen per relationship (restrict/set null/cascade).
- **Application code**: there are no backend route/controller/model implementation files and no frontend component files yet — `backend/app/` and `frontend/src/` contain only the starter scaffold directories and `.gitkeep` placeholders.
- `README.md` describes the scaffold and the intended MVC-style organization.

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
The frontend is a React + Vite SPA.

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
  - Reserved for data contracts, interface definitions, or DTOs shared by both frontend and backend. Currently empty — the API contract and DB schema now live under `backend/api/` and `backend/database/` respectively.

## Current Status Summary

The data model and API surface are fully designed (`backend/api/openapi.yaml` + `backend/database/schema.dbml`), but no application logic has been implemented yet. The repository is ready for developers to begin implementing:

- backend routes, controllers, and models conforming to the API contract and DB schema,
- the frontend user interface and API client layer,
- tests and deployment configuration.

## Notes

- `README.md` reflects the current repository structure, including the API contract and database schema locations.
- `docs/DOCUMENTATION.md` complements `README.md` with a structured description of the current codebase and expected folder usage.
