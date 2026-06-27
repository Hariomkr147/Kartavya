# Kartavya Documentation

## Overview

`Kartavya` is a starter monorepo scaffold for a gamified civic grievance platform. The repository currently contains the folder structure for a backend and frontend application plus shared contracts, but no implemented application logic or production code beyond placeholder `.gitkeep` files.

This documentation describes the current state of the codebase and the intended structure going forward.

## Current Repository Structure

- `backend/`
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
    - `controllers/`
    - `models/`
    - `routes/`
    - `services/`
    - `views/`
- `shared/`
  - `contracts/`

## What Exists Today

- The repository contains only the starter scaffold directories and placeholder `.gitkeep` files.
- There are no backend code files, no frontend component files, and no shared contract definitions implemented yet.
- The repository includes a `README.md` describing the scaffold and the intended MVC-style organization.

## Intended Purpose of Each Folder

### `backend/`
The backend is intended to host the server-side application logic.

- `backend/app/config/`
  - Configuration files for the backend application.
- `backend/app/controllers/`
  - Request handlers and controller logic that process incoming API calls.
- `backend/app/middlewares/`
  - Reusable middleware functions for authentication, validation, logging, etc.
- `backend/app/models/`
  - Data models, database schemas, or business entities.
- `backend/app/routes/`
  - API route definitions and route wiring.
- `backend/app/services/`
  - Business logic, service layer abstractions, and backend operations.
- `backend/app/views/`
  - If server-side rendering or view templates are used, they belong here.
- `backend/tests/`
  - Backend unit tests, integration tests, or contract tests.

### `frontend/`
The frontend is intended to contain the web user interface.

- `frontend/public/`
  - Static assets served directly, such as `index.html`, images, and icons.
- `frontend/src/assets/`
  - Application-specific assets like images, fonts, or data files.
- `frontend/src/controllers/`
  - UI controllers or state management logic that coordinate view behavior.
- `frontend/src/models/`
  - Frontend data models, types, or state structures.
- `frontend/src/routes/`
  - Client-side routes (SPA routing definitions).
- `frontend/src/services/`
  - API clients, data fetching services, and interaction with backend services.
- `frontend/src/views/`
  - UI components, pages, and visual views.

### `shared/`
The shared area is intended for cross-cutting code shared between backend and frontend.

- `shared/contracts/`
  - Data contracts, interface definitions, or DTOs shared by both frontend and backend.

## Current Status Summary

The repository is in scaffold stage with no executable application logic yet. It is ready for developers to begin implementing:

- backend API endpoints,
- frontend user interface,
- shared data contracts,
- tests and deployment configuration.

## Notes

- `README.md` already states that the project currently includes only the starter scaffold.
- The `docs/DOCUMENTATION.md` file is intended to complement `README.md` with a clear, structured description of the current codebase and expected folder usage.
