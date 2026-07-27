# `tests/contract/`

Validate real responses against `backend/api/openapi.yaml`, so "we implemented
the contract" is checked rather than asserted.

Two workable approaches:

- **`schemathesis`** — generates cases from the spec and checks every response
  against it. Install with `pip install -e ".[contract]"`.
- **`openapi-core`** — a response validator you call from an ordinary pytest
  test, if you would rather keep control of the request side.

Either way, point it at the app's test client, not a running server.

## The milestone gate that actually proves it

Contract tests check shapes. The finished frontend checks meaning.

```bash
# frontend/.env.local
VITE_USE_MOCKS=false
VITE_API_BASE_URL=http://localhost:5000/api/v1
```

The frontend is complete and its ~52 hooks each exercise a real endpoint. If the
whole app works with mocks off, the contract is genuinely satisfied — which no
amount of unit testing proves on its own.
