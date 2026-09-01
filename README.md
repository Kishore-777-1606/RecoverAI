# RecoverAI — Intelligent Autonomous Payment Recovery Platform

RecoverAI is a production-grade, state-machine driven payment recovery engine designed to intercept declined checkout transactions, evaluate intelligent recovery policies, select high-converting recovery strategies, and coordinate multi-channel customer outreach backed by an immutable PostgreSQL ledger.

---

## 1. Project Overview & Value Proposition

When a payment checkout fails (e.g. card declined, insufficient balance, bank timeout), merchants typically lose both the customer and the transaction. Traditional tools blindly re-attempt cards without understanding the root cause, leading to high issuer decline rates and customer churn.

**RecoverAI solves this through an autonomous 5-stage pipeline:**
1. **Decline Ingestion & Taxonomy Classification**: Decodes failure codes into actionable categories (Customer-Actionable, Bank Glitch, or Hard Failure).
2. **AI & Policy Decision Engine**: Matches transaction parameters against merchant-configured rules, quiet hours, and calculate dynamic recovery confidence.
3. **Strategy Orchestration**: Automatically assigns the optimal recovery path:
   - **`RECOVERY_LINK`**: Generates a single-use, 256-bit encrypted checkout portal link.
   - **`DELAYED_RETRY`**: Schedules an intelligent delayed gateway re-attempt for temporary bank network outages.
   - **`MANUAL_REVIEW`**: Escalates high-value transactions (> ₹5,000 threshold) to manager authorization.
   - **`CUSTOMER_REMINDER`**: Dispatches multi-channel notification reminders.
4. **Multi-Channel Notification Dispatch**: Queues and dispatches SMS, WhatsApp, and Email outreach (Honest **Simulation Mode** active by default for hackathon demonstration).
5. **Verified Settlement**: Re-attempts settled via the Customer Recovery Portal verify the new transaction hash, mark the recovery campaign `RECOVERED`, while preserving the original payment attempt as an immutable audit record.

---

## 2. System Architecture

```
Customer Payment Attempt (e.g. ₹1,499.00 Card Checkout)
        ↓
Payment Failure Triggered (e.g. INSUFFICIENT_FUNDS)
        ↓
Failure Ingestion Webhook (Idempotent Event Ingestion)
        ↓
Payment State Machine (Original Payment marked FAILED)
        ↓
Recovery Eligibility Evaluator (Threshold & Blacklist checks)
        ↓
AI Policy Engine (Confidence Scoring Heuristic)
        ↓
Recovery Strategy Selection (e.g. RECOVERY_LINK, 80% Match)
        ↓
Recovery Campaign Created (IN_PROGRESS / OUTREACH in PostgreSQL)
        ↓
Single-Use Token & Link Generation (SHA-256 Tokenized Portal URL)
        ↓
Notification Outbox (SMS / WhatsApp / Email Dispatches)
        ↓
Simulation Notification Provider (Honest SIMULATED Outbox Tracking)
        ↓
Customer Recovery Portal (/customer-portal?token=<token>)
        ↓
Customer Retries Payment (Method switching: UPI, Card, NetBanking)
        ↓
Payment Verification & Settlement (New Transaction Created)
        ↓
Recovery Campaign Completed (status = RECOVERED, completed_at logged)
        ↓
Original Failed Payment Remains Immutable (Full Audit Trace)
```

---

## 3. Recovery Strategies Explained

| Strategy | When Selected | Backend Behavior | Merchant Visibility | Customer Experience | Demo Execution |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`RECOVERY_LINK`** | Customer-recoverable failures (e.g. `INSUFFICIENT_FUNDS`, `CARD_DECLINED`). | Generates a single-use cryptographic token and customer portal link; queues SMS/WhatsApp outbox. | Campaign in `OUTREACH` stage with token URL in recoveries ledger. | Receives SMS/WhatsApp link; opens mobile-first recovery page and selects alternate method (UPI/Card). | Run **Scenario A** in Simulator (`₹1,499.00`). |
| **`DELAYED_RETRY`** | Temporary bank outages (e.g. `TEMPORARY_BANK_ISSUE`, `UPI_TIMEOUT`). | Schedules automated backend gateway retry without requiring customer friction. | Campaign scheduled with attempt counter. | No friction; notified upon successful background settlement. | Run **Scenario B** in Simulator (`₹899.00`). |
| **`MANUAL_REVIEW`** | Transactions exceeding auto-recovery policy limits (e.g. > ₹5,000.00). | Pauses outreach; holds campaign in `ANALYSIS` stage until merchant manager approves or dismisses. | Displayed in **Manual Review Queue** with amber alert border and 1-click Approve/Dismiss. | Outreach held until merchant approves. | Run **Scenario C** in Simulator (`₹25,000.00`). |
| **`CUSTOMER_REMINDER`** | Pending unpaid campaigns nearing expiration. | Schedules follow-up notifications across alternate communication channels. | Logged in campaign actions timeline. | Receives friendly reminder checkout prompt. | Automatically scheduled for active campaigns. |

---

## 4. Simulation Mode Disclosure

For the hackathon demonstration, the platform runs with:
```ini
NOTIFICATION_MODE=simulation
NOTIFICATION_PROVIDER=simulation
```

*   **What is REAL**:
    - **100% Real PostgreSQL Database**: 19 tables running on PostgreSQL 15 via Docker.
    - **Real State Machine & Ledger**: All payments, campaigns, single-use tokens, retry attempts, and settlement logs are permanently written to PostgreSQL.
    - **Real Customer Recovery Portal**: The tokenized checkout page (`/customer-portal?token=...`) validates tokens against PostgreSQL and settles retries through backend routes.
*   **What is SIMULATED**:
    - Notification gateway dispatch calls (SMS, WhatsApp, Email) are stored in the `customer_notifications` table and labeled with honest `SIMULATED` status badges (`SIM-MSG-<uuid>`).
    - *No live carrier charges or unverified SMS dispatches are incurred during evaluation.*

---

## 5. System Requirements

*   **Docker Desktop** (v20.10+) with Docker Compose
*   **Node.js** (v20+) — *Optional: Only required for local test scripts outside Docker*
*   **Modern Web Browser** (Chrome, Edge, Firefox, Safari)

---

## 6. Environment Configuration

Copy the sample environment file before starting:
```bash
cp .env.example .env
```

### Configuration Parameters
```ini
APP_MODE=demo
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/recoverai
PAYMENT_PROVIDER=mock
NOTIFICATION_PROVIDER=simulation
NOTIFICATION_MODE=simulation
CUSTOMER_PORTAL_BASE_URL=http://localhost:3000
DEFAULT_AUTO_RECOVERY_ENABLED=true
DEFAULT_MAX_AUTO_RECOVERY_AMOUNT=5000
DEFAULT_MAX_RETRY_ATTEMPTS=2
DEFAULT_RETRY_DELAY_MINUTES=60
```

---

## 7. How to Start the Project

### Start Docker Stack
```bash
docker compose up --build -d
```

### Verify Service Health
```bash
curl http://localhost:3000/health
```
Expected output:
```json
{"status":"ok","service":"recoverai-api","dependencies":{"database":"healthy"}}
```

### Stop Docker Stack
```bash
docker compose down
```

---

## 8. Frontend URLs & Navigation

| Route / URL | Page Name | Purpose & Demonstrations | Backend Data |
| :--- | :--- | :--- | :--- |
| `http://localhost:3000/` | **Public Landing Page** | Public entrypoint with value proposition, interactive tech cursor particle trail, scroll reveals, and conversion CTAs. | Static & Heuristics |
| `http://localhost:3000/#/dashboard` | **Recovery Dashboard** | Real-time aggregate KPIs (Revenue Recovered, Recovery Rate %, Strategy Performance, Activity Stream). | `GET /merchant/dashboard` |
| `http://localhost:3000/#/payments` | **Payments Ledger** | Immutable log of all checkout transactions, failure reason descriptions, and detail inspector drawer. | `GET /merchant/payments` |
| `http://localhost:3000/#/recoveries` | **Recovery Campaigns** | 5-stage campaign lifecycle progression timeline, AI confidence metrics, and audit records. | `GET /merchant/recoveries` |
| `http://localhost:3000/#/manual-review` | **Manual Review Queue** | Manager approval inbox for high-value transactions (> ₹5,000) with 1-click Approve and Dismiss. | `POST /merchant/recoveries/:id/approve` |
| `http://localhost:3000/#/policies` | **Policy Rules** | Configurable auto-recovery thresholds, quiet hours constraints (22:00–08:00), and strategy priority ordering. | `GET /merchant/policy` |
| `http://localhost:3000/#/simulator` | **Payment Simulator** | Interactive tool to trigger simulated checkout declines, view the 7-step pipeline trace, and inspect generated customer links. | `POST /demo/recovery-flow/run` |
| `http://localhost:3000/#/recovery-studio`| **AI Intelligence Studio**| Heuristic decision model explainer, probability confidence formula, and multi-channel routing rules. | Heuristic Models |
| `http://localhost:3000/customer-portal?token=<token>` | **Customer Checkout Portal** | Bank-grade, mobile-first checkout page where customers complete retries with method switching. | `GET & POST /api/customer/recovery/*` |

---

## 9. Complete Hackathon Demo — Step by Step

### Step 1: Launch Application
Open `http://localhost:3000/` in your browser. Move your cursor to observe the **Tech Cursor Particle Trail** and click **"Try RecoverAI Live"** to enter `#/dashboard`.

### Step 2: Open Payment Failure Simulator
Navigate to **Simulator** (`#/simulator`) or click **"Simulator Studio"** in the top navigation.

### Step 3: Execute Scenario A (Primary Recovery Link Demo)
1. Click the **"Scenario A: Recovery Link"** preset card (`₹1,499.00`, `Card`, `Insufficient Funds`).
2. Click **"Trigger Simulated Payment"**.
3. **Observe Internal Pipeline Execution**:
   - **Step 1**: Payment initialized and declined (`FAILED`).
   - **Step 2**: Webhook ingested & classified as *Insufficient Balance (Customer Recoverable)*.
   - **Step 3**: Payment State Machine updated.
   - **Step 4**: AI Policy Engine selects `RECOVERY_LINK` with **80% Confidence**.
   - **Step 5**: Recovery campaign created in PostgreSQL.
   - **Step 6**: Secure single-use token generated.
   - **Step 7**: Simulated SMS/WhatsApp outreach dispatched.
4. Click **`[ Open Recovery Page ↗ ]`** to open the Customer Recovery Portal.

### Step 4: Complete Customer Checkout Retry
1. On the Customer Recovery Portal (`/customer-portal?token=...`), select payment method (**UPI** or **Card**).
2. Click **"Pay ₹1,499.00 Securely"**.
3. Observe the celebratory verified settlement confirmation receipt.

### Step 5: Verify Live PostgreSQL Updates
1. Return to the **Dashboard** (`#/dashboard`).
2. Notice the **Recovered Revenue** counter increases by **₹1,499.00** and the **Recovery Rate %** updates immediately from PostgreSQL.
3. Check **Recovery Campaigns** (`#/recoveries`) to see the campaign status transitioned to `RECOVERED`.

### Step 6: Execute Scenario C (Manual Review Escalation)
1. In the Simulator, select **"Scenario C: Manual Review"** (`₹25,000.00`).
2. Click **"Trigger Simulated Payment"**.
3. Notice that because the transaction exceeds the ₹5,000 auto-recovery limit, outreach is paused and the campaign requires manager review.
4. Navigate to **Manual Review** (`#/manual-review`).
5. Click **"Approve & Launch Outreach"** — observe instant confirmation toast and outreach dispatch in PostgreSQL.

---

## 10. Database Schema & Inspection

Connect to PostgreSQL running inside the Docker container:
```bash
docker exec -it recoverai-postgres psql -U postgres -d recoverai
```

### Core Ledger Tables
- `payments`: Immutable ledger of initial checkout transactions (`status: FAILED / SUCCESSFUL`).
- `recoveries`: Recovery campaign lifecycle records (`status: IN_PROGRESS / RECOVERED / FAILED`).
- `recovery_links`: Cryptographic tokens (`token_hash`, `status: ACTIVE / USED / EXPIRED`).
- `customer_notifications`: Outbox records for SMS, WhatsApp, and Email (`status: SENT / SIMULATED`).
- `recovery_payment_attempts`: Subsequent customer retry transactions.
- `payment_verifications`: Cryptographic transaction hashes and settlement proofs.
- `recovery_policies`: Merchant threshold settings, quiet hours, and auto-recovery toggles.
- `audit_logs`: Append-only event history.

---

## 11. API Reference

### Health
- `GET /health` — Returns system health and database connectivity.

### Merchant Endpoints
- `GET /merchant/dashboard` — Returns aggregate recovery revenue, rates, and recent activity.
- `GET /merchant/payments` — Lists ingested payment records (supports `?status=` filter).
- `GET /merchant/payments/:id` — Returns single payment breakdown and linked recovery data.
- `GET /merchant/recoveries` — Lists recovery campaigns.
- `GET /merchant/recoveries/:id` — Returns campaign timeline, actions, and attempts.
- `POST /merchant/recoveries/:id/approve` — Approves a campaign held in manual review.
- `POST /merchant/recoveries/:id/resolve` — Resolves/dismisses a manual review campaign.
- `GET /merchant/policy` — Returns active recovery policy rules.

### Customer Endpoints
- `GET /api/customer/recovery/:token` — Validates single-use recovery token.
- `POST /api/customer/recovery/:token/pay` — Executes customer checkout retry and settles payment.

### Demo Endpoints
- `POST /api/demo/recovery-flow/run` — Executes full end-to-end recovery simulation pipeline.
- `POST /api/demo/recovery/:id/execute-delayed-retry` — Executes scheduled delayed retry.
- `POST /api/demo/reset` — Cleanly resets simulation demo records while preserving merchant seed data.

---

## 12. Automated Testing

### Run TypeScript Typecheck
```bash
npx tsc --noEmit
```
*Result: 0 Errors (PASS)*

### Run E2E Test Suite
```bash
powershell -ExecutionPolicy Bypass -Command "npx ts-node --transpile-only backend/tests/e2e/e2e_workflow.js"
```
*Result: 67 PASS / 0 FAIL / 2 NOT_IMPL*

---

## 13. Security & Data Integrity

1. **Zero Hardcoded Secrets**: All credentials utilize environment variables.
2. **Single-Use Tokens**: Recovery tokens are SHA-256 hashed with 7-day expiration and marked `USED` immediately upon settlement.
3. **Payment Immutability**: Initial declined payments remain permanently marked `FAILED` in the `payments` table; successful retries are recorded as linked `recovery_payment_attempts`.
4. **Idempotency Protection**: Unique `idempotency_key` constraints prevent duplicate payment processing.
5. **Multi-Tenant Isolation**: Merchant queries are strictly partitioned by `x-merchant-id`.

---

## 14. Troubleshooting

*   **Port 3000 or 5432 in use**: Stop conflicting services or run `docker compose down`.
*   **Database connection refused**: Ensure Docker container `recoverai-postgres` is healthy (`docker compose ps`).
*   **Reset Demo Records**: Click the **Reset** button (counter-clockwise arrow) in the top-right navbar or call `POST /api/demo/reset`.

---

## 15. Hackathon 5-Minute Presentation Guide

1. **Show Landing Page (0:00 – 1:00)**: Explain the problem of silent checkout revenue leaks and how RecoverAI recovers lost funds.
2. **Run Simulator Scenario A (1:00 – 2:30)**: Demonstrate the 7-step pipeline from payment decline $\rightarrow$ AI decision $\rightarrow$ simulated outreach.
3. **Customer Recovery Experience (2:30 – 3:30)**: Open the generated link, switch payment method to UPI, and complete recovery retry.
4. **Live Dashboard & Audit Proof (3:30 – 4:30)**: Show instant revenue recovery KPIs on the Merchant Dashboard and explain immutable PostgreSQL records.
5. **Manual Review & Policy (4:30 – 5:00)**: Demonstrate high-value threshold safeguards in the Manual Review queue.
