# ExampleHR Time-Off Microservice

A backend microservice that manages the full lifecycle of employee time-off requests while maintaining balance integrity with an external Human Capital Management (HCM) system.

## Repository Structure

```
├── TRD.md                      # Technical Requirements Document
├── README.md                   # This file
├── package.json                # Root-level test runner
├── mock-hcm/                   # Mock HCM server (Fastify + Zod)
│   ├── src/
│   │   ├── server.ts           # Fastify setup + buildServer()
│   │   ├── store.ts            # In-memory stateful store
│   │   ├── schemas.ts          # Zod validation schemas
│   │   ├── error-handler.ts    # Shared error simulation logic
│   │   ├── index.ts            # Public exports for test integration
│   │   └── routes/
│   │       ├── balances.ts     # GET balance, GET batch
│   │       ├── time-off.ts     # POST file, DELETE cancel
│   │       └── simulate.ts     # Test helpers (seed, anniversary, errors, reset)
│   └── tests/
│       ├── unit/               # Store, schemas, error-handler tests
│       └── integration/        # Full HTTP endpoint tests
└── time-off-service/           # NestJS microservice
    ├── src/
    │   ├── main.ts             # Bootstrap with Swagger
    │   ├── app.module.ts       # Root module
    │   ├── config/             # Environment-based configuration
    │   ├── hcm/                # HCM adapter (interface + Axios implementation)
    │   ├── balance/            # Balance entity, service, controller, DTOs
    │   ├── request/            # Time-off request lifecycle + state machine
    │   └── sync/               # Batch sync service + cron scheduler
    └── test/
        ├── unit/               # Service + entity unit tests (mocked deps)
        └── integration/        # End-to-end with real mock HCM + SQLite in-memory
```

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9

## Quick Start

### 1. Install dependencies

```bash
# Mock HCM
cd mock-hcm
npm install

# Time-Off Service
cd ../time-off-service
npm install
```

### 2. Run all tests (198 total)

From the repository root:

```bash
npm run test:all
```

Or individually:

```bash
# Mock HCM tests (92 tests)
cd mock-hcm && npx jest --verbose

# Time-Off Service tests (106 tests)
cd time-off-service && npx jest --verbose
```

### 3. Run the service locally

First, start the mock HCM server:

```bash
cd mock-hcm
npm start
# Runs on http://localhost:3001
```

> **Note:** If port 3001 is in use (e.g., by Docker), start on another port:
> ```bash
> HCM_PORT=3002 npm start
> ```

Then in a separate terminal, start the NestJS service:

```bash
cd time-off-service
npm run start:dev
# Runs on http://localhost:3000
# Swagger docs at http://localhost:3000/api/docs
```

> If you changed the HCM port, tell the NestJS service:
> ```bash
> HCM_BASE_URL=http://localhost:3002 npm run start:dev
> ```

### 4. Seed test data and sync

With both servers running, seed the mock HCM with sample balances (adjust port if needed):

```bash
curl -X POST http://localhost:3001/hcm/simulate/seed \
  -H "Content-Type: application/json" \
  -d '[
    {"employeeId":"EMP-001","locationId":"LOC-BR-SP","leaveType":"VACATION","totalBalance":20,"usedBalance":0},
    {"employeeId":"EMP-001","locationId":"LOC-BR-SP","leaveType":"SICK","totalBalance":15,"usedBalance":0},
    {"employeeId":"EMP-002","locationId":"LOC-US-NY","leaveType":"VACATION","totalBalance":10,"usedBalance":2}
  ]'
```

Then trigger a batch sync so the NestJS service pulls the balances from the HCM into its local cache:

```bash
curl -X POST http://localhost:3000/api/v1/sync
```

You should see `"recordsProcessed": 3` in the response.

### 5. Test via Swagger UI

Open **http://localhost:3000/api/docs** in your browser. The Swagger UI shows all endpoints organized by tag (balances, requests, sync).

**Walkthrough — full request lifecycle:**

1. **Check balance** — expand `GET /api/v1/balances/{employeeId}`, click "Try it out", enter `EMP-001`, click "Execute". You should see the balance with `total: 20`.

2. **Create a request** — expand `POST /api/v1/requests`, click "Try it out", paste this body and click "Execute":
   ```json
   {
     "employeeId": "EMP-001",
     "locationId": "LOC-BR-SP",
     "leaveType": "VACATION",
     "startDate": "2026-05-01",
     "endDate": "2026-05-05",
     "days": 3,
     "reason": "Family trip"
   }
   ```
   Copy the `id` from the response (you'll need it next).

3. **Check balance again** — repeat step 1. You should now see `pending: 3` and `available: 17`.

4. **Approve the request** — expand `PATCH /api/v1/requests/{id}/approve`, click "Try it out", paste the request ID, use `{}` as body, click "Execute". The response should show `status: "CONFIRMED"` and a `hcmReferenceId`.

5. **Verify final balance** — repeat step 1. You should see `used: 3`, `pending: 0`, `available: 17`.

6. **Cancel the request** (optional) — expand `PATCH /api/v1/requests/{id}/cancel`, paste the same ID, click "Execute". The balance will be restored to `available: 20`.

## Architecture Overview

### Core Design

The service sits between the client (frontend) and an external HCM system (Workday, SAP, etc). The HCM is the **source of truth** for leave balances, but ExampleHR maintains a **local cache** for fast reads and manages the request lifecycle.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Block requests when HCM is down** | The HCM is the source of truth — allowing requests without validation risks inconsistent balances |
| **Automatic HCM submission after approval** | Manager approval is the primary control gate; no benefit in delaying |
| **SQLite serialized transactions** | SQLite doesn't support row-level locks; its single-writer model provides equivalent consistency for our use case |
| **Retry with exponential backoff** | Handles transient HCM failures (1s → 4s → 16s, max 3 attempts) |
| **Batch sync every 6 hours** | Catches balance drift from external changes (anniversary bonuses, HR corrections) |

### Request Lifecycle

```
PENDING → APPROVED → SUBMITTED_TO_HCM → CONFIRMED → CANCELLED
                                       → HCM_REJECTED
        → REJECTED
        → CANCELLED
```

All transitions are enforced by a state machine — invalid transitions return `400 Bad Request`.

## Mock HCM Server

The mock HCM is a **standalone Fastify server** that simulates a real HCM system. It's used both for local development and as the backend for integration tests.

### Features

- **Stateful in-memory store** — maintains balances and time-off records
- **Zod validation** — all inputs validated at runtime
- **Error injection** — configurable failure modes (500, 400, 422, timeout) with adjustable error rates
- **Event simulation** — trigger anniversary bonuses, annual resets
- **Programmatic API** — `buildServer()` export allows tests to spin up isolated instances

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/hcm/balances/:employeeId/:locationId` | Query balance |
| GET | `/hcm/balances/batch` | Export all balances |
| POST | `/hcm/time-off` | File time-off |
| DELETE | `/hcm/time-off/:referenceId` | Cancel time-off |
| POST | `/hcm/simulate/seed` | Seed balances |
| POST | `/hcm/simulate/anniversary` | Trigger bonus |
| POST | `/hcm/simulate/error-mode` | Toggle failure injection |
| POST | `/hcm/simulate/reset` | Reset all state |
| GET | `/hcm/health` | Health check |

## Time-Off Service (NestJS)

### Modules

- **HCM Module** — Adapter pattern with `IHcmAdapter` interface; Axios-based implementation with custom error types (`HcmUnavailableError`, `HcmValidationError`)
- **Balance Module** — Local balance cache; reserve/release/confirm/restore operations within database transactions; real-time and batch sync with HCM
- **Request Module** — Full request lifecycle with state machine enforcement; retry logic with exponential backoff for HCM submissions
- **Sync Module** — Cron-based batch reconciliation (every 6 hours, configurable); manual trigger endpoint; audit logging via SyncLog entity

### API Documentation

Swagger UI is available at `/api/docs` when the service is running. All endpoints, DTOs, and response schemas are documented.

### Configuration

Environment variables (with defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Service port |
| `HCM_BASE_URL` | `http://localhost:3001` | Mock HCM URL |
| `HCM_TIMEOUT` | `5000` | HCM request timeout (ms) |
| `HCM_RETRY_ATTEMPTS` | `3` | Max retry attempts for HCM submissions |
| `HCM_RETRY_BASE_DELAY` | `1000` | Base delay for exponential backoff (ms) |
| `SYNC_CRON` | `0 */6 * * *` | Batch sync cron expression |
| `SYNC_ENABLED` | `true` | Enable/disable scheduled sync |
| `DB_PATH` | `time-off.sqlite` | SQLite database file path |

## Testing

### Test Summary

| Suite | Tests | Description |
|-------|-------|-------------|
| `mock-hcm` unit | 51 | Store logic, Zod schemas, error handler |
| `mock-hcm` integration | 41 | HTTP endpoints via Fastify inject |
| `time-off-service` unit | 81 | Services, state machine, adapter error handling |
| `time-off-service` integration | 25 | End-to-end with real mock HCM + SQLite in-memory |
| **Total** | **198** | |

### Running Tests

```bash
# All tests from repo root
npm run test:all

# With coverage (per project)
cd mock-hcm && npx jest --coverage
cd time-off-service && npx jest --coverage

# Type checking
cd mock-hcm && npx tsc --noEmit
cd time-off-service && npx tsc --noEmit
```

### Integration Test Architecture

The NestJS integration tests are fully self-contained:

1. `beforeAll` starts the mock HCM server on port 4001 and boots the NestJS app with SQLite `:memory:`
2. `beforeEach` clears all database tables and resets HCM state with fresh seed data
3. Tests exercise the full HTTP flow: create request → approve → verify balances → cancel
4. `afterAll` shuts down both servers

No external services need to be running — just `npx jest`.

### Key Test Scenarios

- **Happy path**: create → approve → HCM confirm → balance updated
- **Balance integrity**: concurrent requests, insufficient balance, exact balance
- **HCM drift**: anniversary bonus applied externally → detected on next request
- **Failure recovery**: HCM down → retry → succeed / exhaust retries → HCM_REJECTED
- **State machine**: reject terminal-state transitions, guard invalid operations
- **Input validation**: missing fields, negative days, unknown fields rejected

## Technical Notes

### SQLite Concurrency

SQLite uses file-level locking, not row-level. `SELECT ... FOR UPDATE` (pessimistic locking) is not supported by the `better-sqlite3` TypeORM driver. Instead, all balance mutations use `DataSource.transaction()` blocks, which SQLite serializes automatically. This provides equivalent consistency for a single-instance deployment. See TRD Section 7.2 for full analysis.

### Fastify DELETE + Axios

Fastify 5 rejects DELETE requests with `Content-Type: application/json` but no body. The HCM adapter explicitly removes this header on DELETE calls to avoid `FST_ERR_CTP_EMPTY_JSON_BODY` errors.