# Technical Requirements Document (TRD)
## Time-Off Microservice — ExampleHR

**Author:** Guilherme Canella  
**Date:** April 2026  
**Version:** 1.1  

---

## 1. Executive Summary

This document describes the design of a **Time-Off Microservice** for ExampleHR — a system that manages the full lifecycle of employee time-off requests while maintaining balance integrity with an external Human Capital Management (HCM) system (e.g., Workday, SAP).

The core challenge is **dual-system state synchronization**: ExampleHR must provide a responsive user experience (instant balance visibility, fast request feedback) while the HCM remains the source of truth for employment data. Balances can change independently on the HCM side (e.g., work anniversary bonuses, annual resets), and the HCM's validation is not always guaranteed to catch invalid requests.

Our solution employs a **local cache with optimistic reservation**, **real-time HCM validation on critical operations**, and **periodic batch reconciliation** to ensure eventual consistency while remaining defensive against HCM failures.

---

## 2. Problem Statement

### 2.1 Context

ExampleHR provides a time-off request interface for employees and managers. The HCM system is the authoritative source for leave balances and employment data. Multiple systems — not just ExampleHR — can update the HCM, meaning balances can change without ExampleHR's knowledge.

### 2.2 Core Challenges

| # | Challenge | Impact |
|---|-----------|--------|
| C1 | **Balance drift** — HCM balances change independently (anniversary bonuses, annual resets, corrections by HR) | ExampleHR displays stale data; requests may be approved against incorrect balances |
| C2 | **Concurrent requests** — Multiple time-off requests for the same employee submitted simultaneously | Risk of double-spending the same balance |
| C3 | **Partial failures** — ExampleHR creates a request locally but the HCM call fails (network, timeout, 5xx) | Inconsistent state between systems; employee sees approved request but HCM doesn't know |
| C4 | **Unreliable HCM validation** — HCM *usually* rejects invalid dimension combinations and insufficient balances, but not always | Must implement local defensive validation |
| C5 | **Multi-dimensional balances** — Balances are scoped per employee, per location (and potentially per leave type) | Data model and sync logic must handle composite keys |
| C6 | **Latency expectations** — Employees expect instant feedback | Cannot always wait for synchronous HCM round-trip on every action |

### 2.3 User Personas

**Employee:**
- Wants to see their current, accurate leave balance
- Expects instant feedback when submitting a time-off request
- Needs clear status tracking of their requests

**Manager:**
- Needs to approve/reject requests with confidence that the data is valid
- Wants visibility into team leave balances and upcoming time off

---

## 3. Architecture Overview

### 3.1 High-Level Design

```
┌──────────────┐       ┌──────────────────────┐       ┌──────────────┐
│   Client     │──────▶│  Time-Off Service     │──────▶│  HCM System  │
│  (Frontend)  │◀──────│  (NestJS + SQLite)    │◀──────│  (External)  │
└──────────────┘       └──────────────────────┘       └──────────────┘
                              │                              │
                              │  Local DB (SQLite)           │
                              │  - LeaveBalance cache        │  Real-time API
                              │  - TimeOffRequest records    │  Batch sync endpoint
                              │  - Sync audit log            │
                              └──────────────────────────────┘
```

### 3.2 Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | NestJS | Per requirements; provides modular architecture, DI, and built-in testing support |
| Database | SQLite (via TypeORM + better-sqlite3) | Per requirements; lightweight, zero-config, sufficient for microservice scope |
| Validation (NestJS) | class-validator + class-transformer | Idiomatic NestJS approach; decorator-based DTOs; native integration with NestJS ValidationPipe |
| Mock HCM server | Fastify + Zod | Lightweight, fast setup; Zod provides runtime schema validation with excellent TypeScript inference; isolated in separate package (`mock-hcm/`) |
| Sync strategy | Cache + reconciliation | Balances best effort, with periodic batch sync as safety net |
| Request lifecycle | State machine | Clear, auditable transitions; prevents invalid state changes |
| HCM interaction | Adapter pattern | Abstracts HCM specifics behind interface; enables mock for testing |

### 3.3 Module Structure

```
time-off-service/src/
├── main.ts                          # Bootstrap with Swagger
├── app.module.ts                    # Root module wiring
├── config/
│   └── configuration.ts             # Environment-based config
├── hcm/
│   ├── hcm.module.ts
│   ├── hcm.adapter.interface.ts     # HCM adapter contract (IHcmAdapter)
│   └── hcm.adapter.ts              # Axios-based HCM integration + custom errors
├── balance/
│   ├── balance.module.ts
│   ├── balance.controller.ts        # REST endpoints for balance queries
│   ├── balance.service.ts           # Balance logic, reservation, sync
│   ├── balance.entity.ts            # LeaveBalance entity
│   └── balance.dto.ts               # DTOs with class-validator
├── request/
│   ├── request.module.ts
│   ├── request.controller.ts        # REST endpoints for time-off requests
│   ├── request.service.ts           # Request lifecycle, state machine, retry
│   ├── request.entity.ts            # TimeOffRequest entity + state transitions
│   └── request.dto.ts               # DTOs with class-validator
└── sync/
    ├── sync.module.ts
    ├── sync.controller.ts           # Manual sync trigger + status endpoints
    ├── sync.service.ts              # Batch reconciliation + cron scheduler
    └── sync.entity.ts               # SyncLog entity
```

---

## 4. Data Model

### 4.1 Entities

#### LeaveBalance
| Field | Type | Description |
|-------|------|-------------|
| id | UUID (PK) | Auto-generated |
| employeeId | string | Employee identifier |
| locationId | string | Location identifier |
| leaveType | string | Type of leave (e.g., VACATION, SICK, PERSONAL) |
| totalBalance | decimal | Total entitled days (from HCM) |
| usedBalance | decimal | Days already used/confirmed |
| pendingBalance | decimal | Days reserved by pending requests |
| availableBalance | computed | total - used - pending (getter, not stored) |
| lastSyncedAt | datetime | Last successful HCM sync timestamp |
| hcmVersion | string (nullable) | Reserved for optimistic concurrency |
| createdAt | datetime | Record creation |
| updatedAt | datetime | Last modification |

**Unique constraint:** (employeeId, locationId, leaveType)

#### TimeOffRequest
| Field | Type | Description |
|-------|------|-------------|
| id | UUID (PK) | Auto-generated |
| employeeId | string | Requesting employee |
| locationId | string | Employee's location |
| leaveType | string | Type of leave requested |
| startDate | date | First day of leave |
| endDate | date | Last day of leave |
| days | decimal | Number of leave days (may differ from calendar days) |
| status | enum | Current state (see state machine below) |
| reason | string (nullable) | Employee-provided reason |
| managerNotes | string (nullable) | Manager notes on approval/rejection |
| hcmReferenceId | string (nullable) | HCM's confirmation ID after successful submission |
| hcmSubmissionError | string (nullable) | Error details if HCM rejects |
| retryCount | integer | Number of HCM submission attempts |
| createdAt | datetime | Request creation |
| updatedAt | datetime | Last modification |

#### SyncLog
| Field | Type | Description |
|-------|------|-------------|
| id | UUID (PK) | Auto-generated |
| syncType | enum | BATCH, REALTIME, MANUAL |
| status | enum | STARTED, COMPLETED, FAILED |
| recordsProcessed | integer | Number of balances processed |
| discrepanciesFound | integer | Number of mismatches detected |
| details | text (nullable) | Discrepancy details for audit |
| startedAt | datetime | Sync start time |
| completedAt | datetime (nullable) | Sync completion time |

### 4.2 Request State Machine

```
                    ┌───────────┐
                    │  PENDING   │ ← Employee submits request
                    └─────┬─────┘
                          │
              ┌───────────┼───────────┐
              ▼                       ▼
      ┌──────────────┐       ┌──────────────┐
      │   APPROVED    │       │   REJECTED    │ ← Manager rejects
      │  (by manager) │       │  (by manager) │
      └──────┬───────┘       └──────────────┘
             │
             ▼
    ┌─────────────────┐
    │ SUBMITTED_TO_HCM │ ← System submits to HCM
    └────────┬────────┘
             │
     ┌───────┼───────┐
     ▼               ▼
┌──────────┐  ┌──────────────┐
│ CONFIRMED │  │ HCM_REJECTED  │ ← HCM validation failed
│           │  │               │
└──────────┘  └──────────────┘
     │
     ▼
┌──────────┐
│ CANCELLED │ ← Employee or manager cancels (if policy allows)
└──────────┘
```

**Allowed transitions:**
| From | To | Trigger |
|------|----|---------|
| PENDING | APPROVED | Manager approval |
| PENDING | REJECTED | Manager rejection |
| PENDING | CANCELLED | Employee cancels |
| APPROVED | SUBMITTED_TO_HCM | Automatic after approval |
| SUBMITTED_TO_HCM | CONFIRMED | HCM accepts |
| SUBMITTED_TO_HCM | HCM_REJECTED | HCM rejects |
| CONFIRMED | CANCELLED | Employee/manager cancels (with HCM reversal) |

---

## 5. API Design

### 5.1 REST Endpoints

#### Balance Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/balances/:employeeId` | Get all balances for an employee |
| GET | `/api/v1/balances/:employeeId/:locationId` | Get balances for employee at location |

#### Request Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/requests` | Create a new time-off request |
| GET | `/api/v1/requests/:id` | Get request details |
| GET | `/api/v1/requests?employeeId=X&status=Y` | List requests with filters |
| PATCH | `/api/v1/requests/:id/approve` | Manager approves a request |
| PATCH | `/api/v1/requests/:id/reject` | Manager rejects a request |
| PATCH | `/api/v1/requests/:id/cancel` | Cancel a request |

#### Sync Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/sync` | Trigger manual batch sync |
| GET | `/api/v1/sync/status` | Get last sync status |
| GET | `/api/v1/sync/history?limit=N` | Get sync history |

**Swagger documentation** available at `/api/docs` when the service is running.

### 5.2 Request/Response Examples

**Create Time-Off Request:**
```json
// POST /api/v1/requests
{
  "employeeId": "EMP-001",
  "locationId": "LOC-BR-SP",
  "leaveType": "VACATION",
  "startDate": "2026-05-01",
  "endDate": "2026-05-05",
  "days": 3,
  "reason": "Family trip"
}

// Response 201:
{
  "id": "req-uuid-123",
  "employeeId": "EMP-001",
  "locationId": "LOC-BR-SP",
  "leaveType": "VACATION",
  "startDate": "2026-05-01",
  "endDate": "2026-05-05",
  "days": 3,
  "status": "PENDING",
  "reason": "Family trip",
  "createdAt": "2026-04-16T10:00:00Z",
  "updatedAt": "2026-04-16T10:00:00Z"
}
```

**Get Employee Balances:**
```json
// GET /api/v1/balances/EMP-001
{
  "employeeId": "EMP-001",
  "balances": [
    {
      "locationId": "LOC-BR-SP",
      "leaveType": "VACATION",
      "total": 20,
      "used": 3,
      "pending": 3,
      "available": 14,
      "lastSyncedAt": "2026-04-16T08:00:00Z"
    }
  ]
}
```

---

## 6. Core Flows

### 6.1 Time-Off Request Lifecycle

**Step 1 — Employee Submits Request:**
1. Validate input (dates, leave type, positive days)
2. **Mandatory real-time HCM check:** call HCM API to verify current balance
   - If HCM balance differs from local → update local cache
   - If HCM is unreachable → **block the request** with `503 Service Unavailable`
3. **Defensive local validation:** check `availableBalance >= requestedDays`
4. **Reserve balance:** increment `pendingBalance` within a database transaction
5. Create `TimeOffRequest` with status `PENDING`
6. Return request to employee

**Step 2 — Manager Approves:**
1. Re-validate balance with HCM (block with 503 if unavailable)
2. Transition status: PENDING → APPROVED
3. Immediately attempt HCM submission (APPROVED → SUBMITTED_TO_HCM)

**Step 3 — HCM Submission (with retry):**
1. Call HCM real-time API to file the time-off
2. **On success:** store `hcmReferenceId`, transition to CONFIRMED, move days from pending to used
3. **On HCM rejection (4xx):** no retry, mark HCM_REJECTED, release pending balance
4. **On network failure:** retry with exponential backoff (1s, 4s, 16s), max 3 attempts; after exhaustion mark HCM_REJECTED and release pending balance

### 6.2 Cancellation Flow

1. Validate request is in cancellable state (PENDING or CONFIRMED)
2. If CONFIRMED → call HCM to reverse the time-off entry; restore `usedBalance`
3. If PENDING → release `pendingBalance`
4. Transition to CANCELLED

### 6.3 Balance Synchronization

#### Real-Time Sync (per-request)
- Triggered before request creation and before manager approval
- Calls HCM single-balance endpoint
- Updates local cache if discrepancy detected

#### Batch Sync (periodic)
- Configurable cron schedule (default: every 6 hours, disableable via env)
- Calls HCM batch endpoint to get all balances
- **Conflict resolution:** HCM always wins for `totalBalance` and `usedBalance`; ExampleHR owns `pendingBalance`
- All syncs logged in `SyncLog` for audit

---

## 7. Error Handling & Resilience

### 7.1 HCM Failure Modes

| Failure | Strategy |
|---------|----------|
| HCM timeout during request creation | Block the request; return 503 |
| HCM timeout during approval | Block the approval; return 503; request stays PENDING |
| HCM 5xx during submission | Retry with exponential backoff; max 3 attempts; then HCM_REJECTED |
| HCM 4xx during submission | No retry; HCM_REJECTED with error details |
| HCM 4xx during cancellation | Return error to user; keep request in current state |
| HCM batch sync failure | Log error; retain local data; mark sync as FAILED |

### 7.2 Concurrency Control

**SQLite Concurrency Model:**

SQLite operates as a single-writer database — only one write transaction can execute at a time. This directly impacts our concurrency strategy:

- **Row-level pessimistic locking (`SELECT ... FOR UPDATE`) is not supported** by the `better-sqlite3` driver in TypeORM. Our initial design considered pessimistic write locks for balance modifications, but this was revised during implementation when we discovered the driver limitation.
- **Our approach:** All balance modifications (reserve, release, confirm, restore) are wrapped in `DataSource.transaction()` blocks. SQLite automatically serializes these transactions at the database level, ensuring no two balance modifications can interleave. This provides equivalent consistency guarantees to pessimistic locking for our single-instance deployment.
- **Trade-off:** Under very high concurrent load, write transactions queue rather than execute in parallel. This is acceptable for HR operations (not high-frequency) and is inherent to SQLite's architecture.
- **Migration path:** If the service needs to scale beyond SQLite's write throughput, migration to PostgreSQL (which supports row-level locking natively) is the recommended path.
- **Future-proofing:** The `hcmVersion` field on `LeaveBalance` is reserved for optimistic concurrency checks if needed.

---

## 8. Security Considerations

### 8.1 Authentication & Authorization (Placeholder)

While full auth implementation is outside scope, the architecture supports:
- **JWT-based authentication** via NestJS Guards
- **Role-based access control (RBAC):** EMPLOYEE, MANAGER, HR_ADMIN
- Employees can only view/create/cancel their own requests
- Managers can approve/reject their direct reports' requests
- HR admins can trigger manual syncs and view audit logs

### 8.2 Input Validation

- All DTOs validated with `class-validator` decorators
- Date range validation (startDate <= endDate)
- Positive numeric validation for `days`
- Enum validation for `leaveType` and `status`
- Whitelist mode enabled (`forbidNonWhitelisted: true`) — unknown fields are rejected
- SQL injection prevention via parameterized queries (TypeORM)

---

## 9. Testing Strategy

### 9.1 Test Summary

| Category | Count | Focus | Tools |
|----------|-------|-------|-------|
| Mock HCM unit tests | 51 | Store logic, schema validation, error handler | Jest, ts-jest |
| Mock HCM integration tests | 41 | HTTP endpoints, error injection, lifecycle | Jest, Fastify inject |
| NestJS unit tests | 81 | Service logic, state machine, adapter errors | Jest, @nestjs/testing |
| NestJS integration tests | 25 | End-to-end with real mock HCM + SQLite | Jest, supertest |
| **Total** | **198** | | |

### 9.2 Mock HCM Server

A dedicated mock HCM server (Fastify + Zod) isolated in `mock-hcm/`:
- Stateful in-memory store with seed/reset between tests
- Failure injection (500, 400, 422, timeout with configurable rate)
- Simulation endpoints (anniversary bonus, balance seeding)
- Programmatic `buildServer()` export for test suite integration

### 9.3 Integration Test Architecture

The NestJS integration tests (`test/integration/lifecycle.spec.ts`) spin up both the mock HCM server and the NestJS application in `beforeAll`, using SQLite `:memory:` for complete isolation. Each test clears all database tables and resets HCM state in `beforeEach`, ensuring full test independence.

---

## 10. Alternatives Considered

### 10.1 Sync Strategy

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **A) Always query HCM real-time** | Always fresh data | High latency; single point of failure | Rejected |
| **B) Event-driven (webhooks)** | Real-time updates; low coupling | Not available from HCM | Not available |
| **C) Local cache + batch reconciliation** | Fast reads; resilient; simple | Eventually consistent | **Selected** |
| **D) CQRS with event sourcing** | Full audit trail | Over-engineered for scope | Rejected |

### 10.2 HCM Submission Trigger

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **A) Automatic after approval** | Fastest flow; modern enterprise pattern | HCM downtime delays confirmation (mitigated by retry) | **Selected** |
| **B) Manual by HR** | Extra review checkpoint | Adds friction; doesn't scale | Rejected |
| **C) Batched hourly** | Reduces API calls | Poor UX; complex error handling | Rejected |

### 10.3 HCM Unavailability

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **A) Block request (503)** | Guarantees accuracy; simple | Dependent on HCM uptime | **Selected** |
| **B) Proceed optimistically** | Always available | Risk of inconsistency | Rejected |
| **C) Queue for later** | Available; eventual validation | Complex; confusing UX | Rejected |

### 10.4 Concurrency Handling

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **A) No locking** | Simplest | Race conditions | Rejected |
| **B) SQLite serialized transactions** | Strong consistency; native to SQLite | Queues under load | **Selected** |
| **C) Pessimistic row-level locking** | Fine-grained control | Not supported by better-sqlite3 driver | Incompatible |
| **D) Optimistic locking** | Better throughput | Complex retry logic | Reserved for future |

---

## 11. Future Considerations

- **Migration to PostgreSQL:** Enable row-level locking, connection pooling, concurrent writes
- **Notification system:** Email/Slack on status changes
- **Calendar integration:** Block time-off on company calendars
- **Policy engine:** Min notice period, blackout dates, max consecutive days
- **Multi-currency balances:** Hours vs. days vs. half-days
- **Approval workflows:** Multi-level approval chains
- **Event-driven architecture:** If HCM adds webhook support

---

## 12. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Response time (balance query) | < 100ms (from local cache) |
| Response time (request creation) | < 2s (including HCM real-time check) |
| Batch sync frequency | Every 6 hours (configurable) |
| Data retention | All requests and sync logs retained indefinitely |
| Availability | Request creation blocked when HCM unavailable; reads from local cache |
| Concurrency | Serialized write transactions via SQLite |
| Test coverage | 198 tests (unit + integration) |