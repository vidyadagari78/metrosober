# Snack Box — Self-Service Pickup Counter & Smart Locker

A robust, concurrency-safe snack counter application where customers select snacks, place orders with real-time inventory holds, pay via UPI, and claim items from self-service lockers.

Built with **TypeScript**, **Node.js (Express)**, **PostgreSQL**, and **React (Vite)**.

---

## Quick Start: Single-Command Launch

### Option A: Using Docker Compose (Recommended)

Starts PostgreSQL, Backend API, and Frontend web application with a single command:

```bash
docker compose up --build
```

- **Frontend**: [http://localhost:5173](http://localhost:5173) (also on [http://localhost](http://localhost))
- **Backend API**: [http://localhost:3000](http://localhost:3000)
- **PostgreSQL**: `localhost:5432`

---

### Option B: Local Development (Zero Docker Requirement)

The codebase includes an embedded PostgreSQL runtime fallback (`embedded-postgres`), so you can run the entire system locally without even having PostgreSQL or Docker installed!

```bash
# 1. Install dependencies
npm install
npm --prefix backend install
npm --prefix frontend install

# 2. Run both backend & frontend
npm run dev:backend
# In another terminal:
npm run dev:frontend
```

---

## Running Automated Tests

The test suite runs against a **real PostgreSQL database** (no mocks or in-memory stubs) and verifies all concurrency invariants:

```bash
npm test
```

### What the Tests Prove:
1. **10 Concurrent Customers Competing for the Last 2 Units (`backend/tests/concurrency-stock.test.ts`)**:
   - 10 customers fire requests simultaneously at the exact same millisecond.
   - Exactly 2 units are held.
   - The other 8 orders fail cleanly with `409 Conflict` (`InsufficientStockError`).
   - Physical stock never goes negative or gets oversold.
2. **Webhook Idempotency & Edge Cases (`backend/tests/webhook-idempotency.test.ts`)**:
   - Same `eventId` sent multiple times: processed exactly once, duplicates safely acknowledged.
   - HMAC-SHA256 signature verification rejects fraudulent payloads with `401 Unauthorized`.
   - Amount mismatch marks order `needs_review`.
   - Late payment after expiry marks order `needs_review`.
3. **Simultaneous Pickup Claims (`backend/tests/simultaneous-pickup.test.ts`)**:
   - Two lockers attempt to claim the same order at the exact same instant.
   - Exactly one call succeeds with `200 OK`; the other receives `409 Conflict`.
   - Physical stock is deducted permanently exactly once.
   - Unpaid or expired orders cannot be claimed.

---

## Simulating the Payment Webhook

We provide a dedicated CLI script to send signed HMAC-SHA256 webhook calls:

```bash
npm run send-webhook -- <orderId> [amountPaise] [eventId]
```

### Features:
- If `amountPaise` is omitted, the script automatically queries the backend for the order's total paise amount!
- Automatically computes the HMAC-SHA256 signature over the raw request body using `WEBHOOK_SECRET`.
- Prints the exact payload, computed signature, HTTP response status, and response JSON.

**Example:**
```bash
npm run send-webhook -- 7da9db77-8e6b-44bc-8d9d-ac155ca1474d
```

*(Note: You can also use the interactive Reviewer Controls directly on the web screen!)*

---

## Key Architecture & Design Decisions

### 1. Money Representation: Whole Paise
All monetary values are strictly stored and computed as whole integers representing paise (e.g., ₹35.00 is stored as `3500`). Floating-point arithmetic is never used in database columns, backend models, or API payloads.

### 2. Concurrency & Inventory Holds
- **Active Hold Calculation**:
  Available stock for any product is:
  $$\text{availableUnits} = \text{physical\_stock} - \text{active\_pending\_holds} - \text{paid\_unclaimed\_units}$$
- **Atomic Order Placement**:
  - `POST /orders` executes inside a database transaction.
  - Product rows are locked using `SELECT ... FOR UPDATE` with product IDs sorted in ascending order to prevent deadlocks under high concurrency.
  - The held quantity is queried within the same transaction. If requested quantity exceeds available stock, the transaction immediately rolls back and returns `409 Conflict`.
- **Automatic Expiration**:
  - Orders are created with `expires_at = NOW() + INTERVAL '120 seconds'`.
  - When the 120-second hold elapses, `o.expires_at > NOW()` evaluates to false immediately. Held units are instantly returned to the available catalog without waiting for background cron jobs.

### 3. The Late-Payment Decision (Payment Arriving After Hold Expired)
**Question**: *What happens when a valid payment arrives after the hold has expired and the units may already be sold to someone else?*

**Decision Made**:
When a payment webhook arrives with `order.expires_at <= NOW()`:
1. The backend **does NOT mark the order paid**.
2. Instead, it marks the order status as **`needs_review`** with reason: `PAYMENT_RECEIVED_AFTER_EXPIRY`.
3. Physical stock is NOT deducted and the locker is NOT unlocked.

**Rationale**:
- **Customer UX & Race Conditions**: In a physical kiosk, once the 120-second countdown reaches zero, the screen displays "Reservation Expired" and the customer may have already walked away. Unlocking a locker 30 seconds later could allow a passerby to steal their items.
- **Inventory Safety**: The moment the hold expired, another customer could have added those units to their tray or placed an order. Re-granting the hold could cause overselling if physical inventory was taken.
- **Auditability**: Marking the transaction `needs_review` flags it for an immediate automated or operator refund, keeping the customer's funds safe while maintaining strict physical inventory invariants.

### 4. Clock Skew Immunity on Customer Screen
- **Problem**: The kiosk device's OS clock may be skewed by several minutes or set to the wrong timezone.
- **Solution**:
  - The server measures and returns `expiresInSeconds` at response time, calculated directly from PostgreSQL's clock.
  - The frontend client never compares against `Date.now()`. Instead, it anchors a high-resolution monotonic timer using `performance.now()`.
  - Monotonic timers only measure physical hardware elapsed time since page load and are completely immune to OS clock alterations or clock skew.
  - Periodic polling re-synchronizes the monotonic anchor every 1.5 seconds.

### 5. Locker Pickup Atomicity
- `POST /orders/:id/pickup-claim` starts a transaction and acquires an exclusive lock: `SELECT * FROM orders WHERE id = $1 FOR UPDATE`.
- If two lockers call simultaneously, the second call waits on the row lock.
- Locker 1 sees `status = 'paid'`, deducts stock, sets `status = 'claimed'`, and commits.
- Locker 2 unblocks, reads the new `status = 'claimed'`, and immediately returns `409 Conflict` ("Order has already been claimed").

---

## Assumptions Made
1. **Locker Identification**: We assume locker hardware communicates with the backend via HTTP API endpoints (`POST /orders/:id/pickup-claim`).
2. **Webhook Provider Format**: Standard JSON payload with `X-Signature` HMAC-SHA256 hex header.
3. **Product Catalog**: Seeded with 5 snack products with varied stock levels (including 1 product with stock = 2 to facilitate concurrency verification).

---

## What We Would Do Next (With More Time)
1. **WebSockets / Server-Sent Events (SSE)**: Replace HTTP polling on the order screen with real-time SSE or WebSocket push notifications for instant status transitions.
2. **Automated UPI Refund Integration**: Hook the `needs_review` states to an automated UPI reverse payout / refund API.
3. **Locker Hardware State Machine**: Model individual locker bays, door sensors (door open, door closed, tray weight sensor) to detect if customer actually retrieved the snack.
4. **Advisory Locks for Multi-Node Scaling**: If scaled horizontally across hundreds of nodes, use PostgreSQL transaction-level advisory locks (`pg_try_advisory_xact_lock`) for partitioned inventory buckets.
