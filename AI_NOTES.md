# AI Notes

## 1. AI Tools Used & Purpose
- **Tool**: Google Antigravity AI Agentic Assistant (powered by Gemini 3.8 Flash High).
- **Purpose**:
  - Architectural design for PostgreSQL row-level locking (`SELECT ... FOR UPDATE`) and deadlock avoidance.
  - Generating TypeScript backend services and Express routes.
  - Designing automated concurrency test suites running against genuine PostgreSQL (vitest + supertest).
  - Building the React client interface with monotonic clock skew immunity.
  - Creating Docker Compose and Dockerfile configurations.

---

## 2. One Prompt That Worked Well

> *"How can we implement the 120-second order hold countdown on the customer kiosk so that it remains 100% accurate even if the counter kiosk's local system clock is several minutes or hours wrong?"*

**Why it worked well:**
This prompt guided the solution to avoid comparing against `Date.now()` or ISO timestamp strings on the browser. Instead, the server calculates `expiresInSeconds` dynamically using PostgreSQL's server clock, and the frontend anchors a high-resolution monotonic timer using `performance.now()`. Because `performance.now()` measures elapsed hardware CPU time with sub-millisecond precision, local OS clock adjustments, timezone anomalies, or clock skews have zero impact on the countdown.

---

## 3. Specific Thing the AI Got Wrong & How It Was Resolved

### What the AI got wrong:
When creating the initial test setup for the three required concurrency test suites (`concurrency-stock.test.ts`, `webhook-idempotency.test.ts`, and `simultaneous-pickup.test.ts`), the AI placed the embedded PostgreSQL initialization in each test file's `beforeAll` hook.

By default, Vitest executes test files concurrently across separate worker threads. As a result, all three test worker processes simultaneously attempted to run `initdb` on the same directory (`.pgdata-test-concurrency`) and bind to port `54399` at the exact same instant.

### How it was noticed:
When running `npm test`, the test suite failed with:
```
Failed to start embedded PostgreSQL: Error: Postgres init script failed (code: 1, signal: null). 
ERROR OUTPUT: initdb: error: could not create directory "C:/metrosober assignment/backend/.pgdata-test-concurrency": File exists
```

### How it was corrected:
1. Updated `vitest.config.ts` to disable file parallelism (`fileParallelism: false`) and use a single fork (`poolOptions: { forks: { singleFork: true } }`).
2. Implemented a shared singleton connection manager in `setup.ts` that checks whether PostgreSQL is already initialized or responding before starting a new instance.
3. Reran the test suite: all 8 concurrency tests executed sequentially and passed in 1.36 seconds.
