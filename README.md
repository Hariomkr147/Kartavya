# Kartavya

Kartavya is a gamified civic grievance platform that turns everyday citizens into active contributors to public infrastructure upkeep.

## Project structure (MVC monorepo)

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
    └── DOCUMENTATION.md
```

The API contract (`backend/api/openapi.yaml`) and the database schema (`backend/database/schema.dbml`) are designed together and are the current source of truth for the data model and endpoints. Application code under `backend/app/` and `frontend/src/` is still scaffold-only (MVC-style starter folders), ready for implementation against this contract. See [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md) for details.
