# Kartavya

Kartavya is a gamified civic grievance platform that turns everyday citizens into active contributors to public infrastructure upkeep.

The repository is currently contract-first: the API surface and database schema are designed, while the backend and frontend application folders are scaffolded for implementation.

## Project Structure

```text
Kartavya/
├── backend/
│   ├── api/
│   │   └── openapi.yaml
│   ├── database/
│   │   └── schema.dbml
│   ├── app/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middlewares/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   └── views/
│   └── tests/
├── frontend/
│   ├── public/
│   └── src/
│       ├── assets/
│       ├── components/
│       ├── hooks/
│       ├── pages/
│       ├── routes/
│       ├── services/
│       └── types/
├── shared/
│   └── contracts/
└── docs/
    ├── start_here.md
    ├── backend/
    │   ├── api.md
    │   └── database.md
    └── frontend/
```

The API contract (`backend/api/openapi.yaml`) and database schema (`backend/database/schema.dbml`) are designed together and are the current source of truth for endpoints, data shapes, and persistence rules. Application code under `backend/app/` and `frontend/src/` is still scaffold-only, ready for implementation against those contracts.

Start with [docs/start_here.md](docs/start_here.md) for the repository overview. Backend reference docs live under [docs/backend/](docs/backend/), and contributor workflow guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md).
