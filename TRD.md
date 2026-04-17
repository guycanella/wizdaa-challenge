# Technical Requirements Document (TRD)
## Time-Off Microservice — ExampleHR

**Author:** [Seu Nome]  
**Date:** April 2026  
**Version:** 1.0  

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
| Database | SQLite (via TypeORM) | Per requirements; lightweight, zero-config, sufficient for microservice scope |
| Validation (NestJS) | class-validator + class-transformer | Idiomatic NestJS approach; decorator-based DTOs; native integration with NestJS ValidationPipe |
| Mock HCM server | Fastify + Zod | Lightweight, fast setup; Zod provides runtime schema validation with excellent TypeScript inference; isolated in separate package (`mock-hcm/`) |
| Sync strategy | Cache + reconciliation | Balances best effort, with periodic batch sync as safety net |
| Request lifecycle | State machine | Clear, auditable transitions; prevents invalid state changes |
| HCM interaction | Adapter pattern | Abstracts HCM specifics behind interface; enables mock for testing |

### 3.3 Module Structure

```
src/
├── app.module.ts
├── balance/
│   ├── balance.module.ts
│   ├── balance.controller.ts        # REST endpoints for balance queries
│   ├── balance.service.ts           # Balance logic, reservation, validation
│   ├── balance.entity.ts            # LeaveBalance entity
│   └── balance.repository.ts        # Custom repository queries
├── request/
│   ├── request.module.ts
│   ├── request.controller.ts        # REST endpoints for time-off requests
│   ├── request.service.ts           # Request lifecycle, state machine
│   ├── request.entity.ts            # TimeOffRequest entity
│   └── request.subscriber.ts        # Entity event listeners
├── hcm/
│   ├── hcm.module.ts
│   ├── hcm.adapter.interface.ts     # HCM adapter contract
│   ├── hcm.adapter.ts              # Real HCM integration
│   └── hcm.mock-adapter.ts         # Mock for testing
├── sync/
│   ├── sync.module.ts
│   ├── sync.service.ts             # Batch reconciliation logic
│   └── sync.scheduler.ts           # Cron-based sync triggers
├── common/
│   ├── exceptions/                 # Custom exception filters
│   ├── guards/                     # Auth guards (placeholder)
│   ├── interceptors/               # Logging, timeout interceptors
│   └── dto/                        # Shared DTOs
└── config/
    └── configuration.ts            # Environment-based config
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
| availableBalance | decimal | Computed: total - used - pending |
| lastSyncedAt | datetime | Last successful HCM sync timestamp |
| hcmVersion | string (nullable) | HCM's version/etag for optimistic concurrency |
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
| details | JSON (nullable) | Discrepancy details for audit |
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
| POST | `/api/v1/balances/sync` | Trigger manual batch sync |
| GET | `/api/v1/balances/sync/status` | Get last sync status |

#### Request Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/requests` | Create a new time-off request |
| GET | `/api/v1/requests/:id` | Get request details |
| GET | `/api/v1/requests?employeeId=X` | List requests for an employee |
| PATCH | `/api/v1/requests/:id/approve` | Manager approves a request |
| PATCH | `/api/v1/requests/:id/reject` | Manager rejects a request |
| PATCH | `/api/v1/requests/:id/cancel` | Cancel a request |
| GET | `/api/v1/requests/team/:managerId` | List requests for a manager's team |

### 5.2 Request/Response Examples

**Create Time-Off Request:**
```json
// POST /api/v1/requests
// Request Body:
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
  "currentBalance": {
    "total": 10,
    "used": 3,
    "pending": 3,
    "available": 4
  },
  "createdAt": "2026-04-16T10:00:00Z"
}
```

**Get Employee Balances:**
```json
// GET /api/v1/balances/EMP-001
// Response 200:
{
  "employeeId": "EMP-001",
  "balances": [
    {
      "locationId": "LOC-BR-SP",
      "leaveType": "VACATION",
      "total": 10,
      "used": 3,
      "pending": 3,
      "available": 4,
      "lastSyncedAt": "2026-04-16T08:00:00Z"
    },
    {
      "locationId": "LOC-BR-SP",
      "leaveType": "SICK",
      "total": 15,
      "used": 1,
      "pending": 0,
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
2. Fetch current balance from local cache for (employeeId, locationId, leaveType)
3. **Defensive local validation:** check `availableBalance >= requestedDays`
4. **Mandatory real-time check:** call HCM real-time API to verify current balance
   - If HCM balance differs from local → update local cache, re-validate
   - If HCM is unreachable → **block the request** and return a `503 Service Unavailable` error with message: `"Unable to process time-off request: the HCM system is currently unavailable. Please try again later."`
   - **Rationale:** Since the HCM is the source of truth, allowing requests without HCM validation risks creating inconsistent state that is costly to reconcile. A brief wait is preferable to a corrupted balance.
5. Create `TimeOffRequest` with status `PENDING`
6. **Reserve balance:** increment `pendingBalance` by requested days (within a transaction)
7. Return request to employee with current balance snapshot

**Step 2 — Manager Approves:**
1. Validate manager has authority (placeholder for auth)
2. Re-validate balance (may have changed since request was created)
3. Transition status: PENDING → APPROVED
4. Immediately attempt HCM submission (APPROVED → SUBMITTED_TO_HCM)

**Step 3 — HCM Submission:**
1. Call HCM real-time API to file the time-off
2. **On success:**
   - Store `hcmReferenceId`
   - Transition: SUBMITTED_TO_HCM → CONFIRMED
   - Move days from `pendingBalance` to `usedBalance`
3. **On failure (HCM rejects):**
   - Store error in `hcmSubmissionError`
   - Transition: SUBMITTED_TO_HCM → HCM_REJECTED
   - Release `pendingBalance` reservation
4. **On network failure:**
   - Keep as SUBMITTED_TO_HCM
   - Queue for retry (exponential backoff, max 3 attempts)
   - After max retries → transition to HCM_REJECTED, release reservation, notify

### 6.2 Cancellation Flow

1. Validate request is in cancellable state (PENDING, APPROVED, CONFIRMED)
2. If CONFIRMED → call HCM to reverse the time-off entry
   - On HCM success: release `usedBalance`, transition to CANCELLED
   - On HCM failure: keep as CONFIRMED, return error to user
3. If PENDING or APPROVED → release `pendingBalance`, transition to CANCELLED

### 6.3 Balance Synchronization

#### Real-Time Sync (per-request)
- Triggered before request creation and before manager approval
- Calls HCM single-balance endpoint: `GET /hcm/balances/{employeeId}/{locationId}`
- Updates local cache if discrepancy detected
- **Stale threshold:** if `lastSyncedAt` is within the last 5 minutes, skip real-time check (configurable)

#### Batch Sync (periodic)
- Runs on a configurable cron schedule (default: every 6 hours)
- Calls HCM batch endpoint to get all balances
- For each balance received:
  1. Compare with local record
  2. If discrepancy found → update local `totalBalance` and `usedBalance`
  3. Preserve `pendingBalance` (these are ExampleHR-managed reservations)
  4. Log discrepancy in `SyncLog`
- **Conflict resolution:** HCM always wins for `totalBalance` and `usedBalance`; ExampleHR owns `pendingBalance`

#### Sync Conflict Handling
| Scenario | Action |
|----------|--------|
| HCM total > local total | Update local (likely anniversary bonus or correction) |
| HCM total < local total | Update local (likely HR correction); flag if pending requests now exceed available |
| HCM used ≠ local used | Update local; investigate if divergence is large |
| Pending requests exceed new available balance | Flag for manual review; do NOT auto-cancel requests |

---

## 7. Error Handling & Resilience

### 7.1 HCM Failure Modes

| Failure | Strategy |
|---------|----------|
| HCM timeout (real-time, during request creation) | Block the request; return 503 with clear error message; do not create request or reserve balance |
| HCM timeout (real-time, during approval re-validation) | Block the approval; return 503; request stays in PENDING state |
| HCM 5xx (submission) | Retry with exponential backoff (1s, 4s, 16s); max 3 retries; then mark HCM_REJECTED |
| HCM 4xx (validation) | Do not retry; mark HCM_REJECTED with error details |
| HCM batch sync failure | Log error; retain current local data; alert for manual intervention |
| HCM returns inconsistent data | Log discrepancy; use HCM values; flag for review |

### 7.2 Concurrency Control

- **Database-level:** Use SQLite transactions with `SERIALIZABLE` isolation for balance modifications
- **Application-level:** Optimistic locking via `hcmVersion` field; reject update if version mismatch
- **Request-level:** When modifying a balance, lock the row using `SELECT ... FOR UPDATE` (or SQLite equivalent: exclusive transaction)

### 7.3 Idempotency

- All POST endpoints accept an optional `idempotencyKey` header
- If a duplicate key is received within a 24-hour window, return the original response
- Prevents duplicate requests from network retries

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
- Date range validation (startDate <= endDate, no past dates)
- Positive numeric validation for `days`
- Enum validation for `leaveType` and `status`
- SQL injection prevention via parameterized queries (TypeORM)

### 8.3 Rate Limiting

- Applied to all public endpoints via NestJS `@Throttle()` decorator
- Manual sync endpoint has stricter limits (1 request per 5 minutes)

---

## 9. Testing Strategy

### 9.1 Test Categories

| Category | Focus | Tools |
|----------|-------|-------|
| Unit tests | Service logic, state machine transitions, validation | Jest, mocked dependencies |
| Integration tests | Full request flows, DB interactions, HCM adapter | Jest, SQLite in-memory, Mock HCM server |
| Edge case tests | Concurrency, network failures, data inconsistencies | Jest, custom test helpers |

### 9.2 Mock HCM Server

A dedicated mock HCM server (Fastify + Zod) simulates realistic HCM behavior, isolated in a separate `mock-hcm/` package at the repository root:
- **Stack:** Fastify for HTTP, Zod for request/response schema validation
- **Stateful in-memory store:** balances held in a Map, reset between test suites
- **Configurable balances:** seed with known data per test scenario
- **Simulated events:** trigger anniversary bonuses, annual resets
- **Failure injection:** configurable error rates, timeouts, and validation failures
- **Endpoints:**
  - `GET /hcm/balances/:employeeId/:locationId` — real-time balance query
  - `POST /hcm/time-off` — file a time-off entry
  - `DELETE /hcm/time-off/:referenceId` — cancel a time-off entry
  - `GET /hcm/balances/batch` — batch export all balances
  - `POST /hcm/simulate/anniversary` — trigger anniversary bonus (test helper)
  - `POST /hcm/simulate/error-mode` — enable/disable error injection (test helper)
  - `POST /hcm/simulate/reset` — reset all state to initial (test helper)

### 9.3 Key Test Scenarios

**Happy Path:**
- Employee creates request → manager approves → HCM confirms → balance updated
- Employee views balances → reflects pending and confirmed

**Balance Integrity:**
- Concurrent requests exhaust balance → second request rejected
- HCM balance changes between request creation and approval → re-validation catches it
- Batch sync detects drift → local balance updated correctly

**Failure Recovery:**
- HCM down during submission → retry succeeds on attempt 2
- HCM down during submission → all retries fail → request marked HCM_REJECTED, balance released
- HCM rejects with 4xx → no retry, error propagated
- Network timeout → fallback to local validation
- HCM unavailable during request creation → request blocked with 503, balance unchanged

**Edge Cases:**
- Request exactly equal to available balance → allowed
- Request for 0 days → rejected by validation
- Cancel a CONFIRMED request → HCM reversal triggered
- Cancel a PENDING request → balance reservation released, no HCM call
- Batch sync runs while requests are in SUBMITTED_TO_HCM state → pending balance preserved

---

## 10. Alternatives Considered

### 10.1 Sync Strategy

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **A) Always query HCM real-time** | Always fresh data | High latency; HCM becomes single point of failure; rate limits | Rejected |
| **B) Event-driven (webhooks from HCM)** | Real-time updates; low coupling | Requires HCM webhook support (not specified); complex delivery guarantees | Not available |
| **C) Local cache + batch reconciliation** (chosen) | Fast reads; resilient to HCM outages; simple | Eventually consistent; brief staleness window | **Selected** |
| **D) CQRS with event sourcing** | Full audit trail; replay capability | Over-engineered for scope; SQLite not ideal for event store | Rejected for scope |

### 10.2 State Machine Approach

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **A) Simple status field with no enforcement** | Easy to implement | No guarantees on valid transitions; bug-prone | Rejected |
| **B) State machine with transition validation** (chosen) | Clear rules; auditable; prevents invalid states | Slightly more complex | **Selected** |
| **C) Event sourcing for request lifecycle** | Complete history; time-travel debugging | Overkill for this scope | Rejected |

### 10.3 HCM Submission Trigger (Post-Approval)

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **A) Automatic (immediate after approval)** (chosen) | Fastest end-to-end flow; aligns with enterprise automation trends; no manual intervention needed; employees get confirmation sooner | If HCM is down at approval time, request gets stuck in SUBMITTED_TO_HCM state (mitigated by retry mechanism) | **Selected** |
| **B) Manual trigger by HR/admin** | Gives HR a review checkpoint before HCM submission; useful for highly regulated environments | Adds friction and delay; requires dedicated HR staff to monitor a queue; doesn't scale | Rejected — adds unnecessary bottleneck for most organizations |
| **C) Batched submission (e.g., every hour)** | Reduces HCM API call volume; groups submissions efficiently | Employees wait up to an hour for confirmation; poor UX; complicates error handling per-request | Rejected — unacceptable latency for employee experience |

**Rationale for automatic submission:** In modern enterprise HR workflows, approval by a manager is the primary control gate. Once that gate is passed, there is no practical benefit in delaying HCM submission. The retry mechanism (exponential backoff, max 3 attempts) handles transient HCM failures, and the state machine ensures no request is left in an ambiguous state.

### 10.4 HCM Unavailability During Request Creation

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **A) Block request, return 503** (chosen) | Guarantees balance accuracy; no risk of inconsistent state; simple mental model for users | Employees cannot submit requests during HCM outages; dependent on HCM uptime | **Selected** |
| **B) Proceed with local cache (optimistic)** | Employees can always submit; resilient to HCM downtime | Risk of approving requests against stale/incorrect balances; complex reconciliation if HCM later disagrees | Rejected — the cost of inconsistency outweighs the convenience |
| **C) Queue request for later validation** | Employees can submit; validated when HCM returns | Complex queue management; confusing UX (request in limbo); still risks inconsistency | Rejected — over-complex for the benefit |

**Rationale for blocking:** The HCM is the source of truth. Allowing requests without HCM validation creates a category of problems (over-spending balances, phantom approvals) that are expensive to fix and erode user trust. A clear error message ("HCM is currently unavailable, please try again later") sets correct expectations and keeps the system honest.

### 10.5 Concurrency Handling

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **A) No locking (last write wins)** | Simplest | Race conditions on balance | Rejected |
| **B) Pessimistic locking (DB transactions)** (chosen) | Strong consistency for balance ops | Can cause contention under load | **Selected** (acceptable for SQLite single-writer) |
| **C) Optimistic locking with version field** | Better throughput; no locks | Requires retry logic on conflict | Used as secondary mechanism |

---

## 11. Future Considerations

- **Notification system:** Email/Slack notifications on status changes
- **Calendar integration:** Block time-off on company calendars
- **Policy engine:** Configurable rules (min notice period, blackout dates, max consecutive days)
- **Multi-currency balances:** Hours vs. days vs. half-days
- **Approval workflows:** Multi-level approval chains
- **Migration to PostgreSQL:** If scale demands exceed SQLite capabilities
- **Event-driven architecture:** If HCM adds webhook support

---

## 12. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Response time (balance query) | < 100ms (from local cache) |
| Response time (request creation) | < 2s (including HCM real-time check) |
| Batch sync frequency | Every 6 hours (configurable) |
| Data retention | All requests and sync logs retained indefinitely |
| Availability | Request creation blocked when HCM unavailable; balance reads served from local cache; batch sync retries on failure |
| Concurrency | Handle up to 100 concurrent requests per employee (via SQLite serialization) |