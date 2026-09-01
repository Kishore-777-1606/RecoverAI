# RecoverAI Step 12 — Simulation End-to-End Verification Report

## 1. Executive Summary
RecoverAI is an intelligent payment recovery platform that handles failed checkout transactions, evaluates merchant risk policies, selects optimal AI recovery strategies, and coordinates retry workflows. External notification dispatch has been frozen into an honest, zero-network **Simulation Mode** (`NOTIFICATION_MODE=simulation`) for hackathon presentation, while preserving the complete real application-side workflow, state machine orchestration, and PostgreSQL database persistence.

---

## 2. What We Are Demonstrating
1. **Real State Transitions**: Failed checkouts are automatically ingested, classified, and escalated into recovery campaigns.
2. **AI & Policy Decisioning**: Dynamic strategy selection (`RECOVERY_LINK`, `DELAYED_RETRY`, `MANUAL_REVIEW`) based on decline reason and amount.
3. **Pluggable Notification Architecture**: Dispatches pass through a clean `NotificationProvider` interface, returning realistic deterministic simulation records without external network dependencies.
4. **Customer Recovery Portal**: Secure, time-limited token links allow customers to re-attempt payment with full payment method support.
5. **Accounting Immutability**: The original failed transaction remains permanently `FAILED` in `payments`, while retry transactions in `recovery_payment_attempts` succeed and settle `recoveries` to `RECOVERED`.

---

## 3. Why External SMS/WhatsApp/Email Is Simulated
*   Carrier and telecom regulations (e.g. DLT template whitelisting in India, Twilio trial constraints) restrict dynamic custom message text and sandbox testing without upgraded commercial accounts.
*   **Simulation Mode** guarantees 100% deterministic, offline-reliable demonstrations without risking network drops, gateway rate limits, or carrier delays.
*   All simulation records are explicitly tagged as `SIMULATED` with IDs formatted as `SIM-MSG-<uuid>`, ensuring transparent reporting.

---

## 4. Architecture

```
[Customer Checkout Attempt]
            │
            ▼
[Payment Failure (e.g. INSUFFICIENT_FUNDS)]
            │
            ▼
[Webhook / Ingestion Pipeline]
            │
            ▼
[Event Bus (payment.failed)]
            │
            ▼
[Payment State Machine: FAILED]
            │
            ▼
[Recovery Eligibility & AI Policy Engine]
            │
            ▼
[Recovery Campaign Created: IN_PROGRESS]
            │
            ▼
[Secure Cryptographic Token & Recovery Link]
            │
            ▼
[Notification Outbox Queued: PENDING]
            │
            ▼
[SimulationNotificationProvider (SIM-MSG-...)]
            │
            ▼
[Customer Opens Recovery Link (/customer/recovery/:token)]
            │
            ▼
[Customer Checkout Retry (/customer/recovery/:token/pay)]
            │
            ▼
[Payment Attempt Recorded: SUCCESSFUL]
            │
            ▼
[Payment Verification Settled: VERIFIED]
            │
            ▼
[Campaign Resolved: RECOVERED]
            │
            ▼
[Original Payment Immutability Preserved: FAILED]
```

---

## 5. Step-by-Step Execution

### Step 1: Payment Creation
*   **What Happens**: Payment initialized with amount and customer/merchant context.
*   **Service**: [paymentService.ts](file:///e:/DataBase_RecoveAI/backend/modules/payments/paymentService.ts)
*   **Database Record**: Inserted into `payments` (`status = INITIATED`).

### Step 2: Gateway Failure Ingestion
*   **What Happens**: Webhook normalizes decline code (`INSUFFICIENT_FUNDS`), records audit log for deduplication, and publishes event.
*   **Service**: [webhookService.ts](file:///e:/DataBase_RecoveAI/backend/ingestion/webhookService.ts) → [eventBus.ts](file:///e:/DataBase_RecoveAI/backend/ingestion/eventBus.ts)
*   **Database Record**: `payments.status` transitioned to `FAILED`, `audit_logs` record created.

### Step 3: AI Policy Engine Decision
*   **What Happens**: [aiPolicyEngine.ts](file:///e:/DataBase_RecoveAI/backend/modules/ai/aiPolicyEngine.ts) evaluates decline reason, customer status, and merchant policy thresholds.
*   **Result**: Chooses strategy (`RECOVERY_LINK`, `DELAYED_RETRY`, or `MANUAL_REVIEW`) with confidence score.

### Step 4: Campaign & Link Provisioning
*   **What Happens**: [recoveryService.ts](file:///e:/DataBase_RecoveAI/backend/modules/recovery/recoveryService.ts) creates a recovery campaign, generates a 256-bit token in `recovery_links`, and records strategic action.
*   **Database Record**: `recoveries` (`status = IN_PROGRESS`), `recovery_links` (`status = ACTIVE`).

### Step 5: Simulated Notification Dispatch
*   **What Happens**: [notificationService.ts](file:///e:/DataBase_RecoveAI/backend/modules/notifications/notificationService.ts) delegates to [SimulationNotificationProvider.ts](file:///e:/DataBase_RecoveAI/backend/providers/notification/SimulationNotificationProvider.ts).
*   **Database Record**: `customer_notifications` updated with `status = SENT`, `attempt_number = 1`, and audit log linking `SIM-MSG-<uuid>`.

### Step 6: Customer Checkout Retry
*   **What Happens**: Customer opens recovery URL and submits payment retry via `POST /customer/recovery/:token/pay`.
*   **Service**: [customerRoutes.ts](file:///e:/DataBase_RecoveAI/backend/api/customerRoutes.ts)
*   **Database Record**: `recovery_payment_attempts` (`status = SUCCESSFUL`), `payment_verifications` (`status = VERIFIED`), `recovery_links` (`status = USED`), `recoveries` (`status = RECOVERED`).

---

## 6. Detailed Recovery Strategy Executions

### Recovery Strategy 1 — `RECOVERY_LINK`
- **Scenario**: Failed payment due to `INSUFFICIENT_FUNDS`.
- **Flow**: Checkout fails → AI selects `RECOVERY_LINK` (80% confidence) → Customer receives simulated link → Customer retries checkout → Campaign becomes `RECOVERED`.
- **Database Outcome**:
  - `payments`: `FAILED` (unchanged)
  - `recoveries`: `RECOVERED` (`completed_at` populated)
  - `recovery_links`: `USED`
  - `recovery_payment_attempts`: `SUCCESSFUL`

### Recovery Strategy 2 — `DELAYED_RETRY`
- **Scenario**: Failed payment due to `TEMPORARY_BANK_ISSUE`.
- **Flow**: Checkout fails → AI selects `DELAYED_RETRY` → Scheduled retry action recorded → Operator/system invokes `POST /demo/recovery/:id/execute-delayed-retry` → Simulated auto-retry succeeds → Campaign becomes `RECOVERED`.
- **Database Outcome**:
  - `recovery_actions`: `AUTO_RETRY_SCHEDULED` + `DELAYED_RETRY_EXECUTED`
  - `recoveries`: `RECOVERED`

### Recovery Strategy 3 — `MANUAL_REVIEW`
- **Scenario**: High-value failure exceeding threshold (e.g. ₹25,000 > ₹20,000 policy limit).
- **Flow**: Checkout fails → `approval_required = true` → Merchant reviews and hits `POST /merchant/recoveries/:id/approve` → Merchant manually resolves via `POST /merchant/recoveries/:id/resolve` (`resolution: CLOSE_SUCCESS`) → Campaign becomes `RECOVERED`.
- **Database Outcome**:
  - `recoveries.approved_at`: Populated
  - `recoveries.status`: `RECOVERED`

---

## 7. Database Tables Involved

| Table Name | Role in Recovery Workflow |
| :--- | :--- |
| `merchants` | Tenant boundaries & configuration scoping |
| `customers` | Customer contact profiles (Email/Phone) |
| `payments` | Original checkout record (Immutably `FAILED`) |
| `recoveries` | Campaign lifecycle state machine |
| `recovery_links` | Cryptographic access tokens & expiry |
| `recovery_actions` | Execution timeline & strategic milestones |
| `customer_notifications`| Outbox logs tracking dispatch channels & simulation IDs |
| `recovery_payment_attempts`| Subsequent retry transactions |
| `payment_verifications`| Settlement confirmation records |
| `audit_logs` | Tamper-evident ledger & event deduplication |
| `simulation_sessions` | Demo test grouping & isolated reset tracking |

---

## 8. Exact API Endpoints Inventory

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Container & database connectivity verification |
| `POST`| `/demo/recovery-flow/run` | Single demo runner executing failed payment to outreach |
| `GET` | `/customer/recovery/:token` | Customer recovery landing page info |
| `POST`| `/customer/recovery/:token/pay` | Customer payment retry checkout |
| `POST`| `/demo/recovery/:id/execute-delayed-retry` | Demo execution of scheduled delayed retries |
| `POST`| `/merchant/recoveries/:id/approve` | Merchant manager manual approval |
| `POST`| `/merchant/recoveries/:id/resolve` | Merchant manual campaign resolution |
| `POST`| `/demo/reset` | Clean reset of demo sessions and simulation records |

---

## 9. Security, Idempotency & Tenant Isolation Tests

| Test Scenario | Expected Result | Actual Result |
| :--- | :--- | :--- |
| **Invalid Recovery Token** | HTTP 404 NOT_FOUND | **PASS** |
| **Expired Recovery Token** | HTTP 200 with status `EXPIRED` | **PASS** |
| **Duplicate Retry Submission** | Rejected by DB `idempotency_key` constraint | **PASS** |
| **Duplicate Webhook Delivery**| Idempotently skipped via `audit_logs` | **PASS** |
| **Missing Merchant Context** | HTTP 401 Unauthorized | **PASS** |
| **Cross-Tenant Access** | HTTP 404 Isolation Enforced | **PASS** |
| **Accounting Immutability** | Original payment remains `FAILED` forever | **PASS** |

---

## 10. Pluggable Notification Provider Configuration

### Simulation Mode (Active)
```ini
NOTIFICATION_MODE=simulation
NOTIFICATION_PROVIDER=simulation
```

### Transitioning to Production Real Gateway
To switch to real delivery when production credentials and approved templates are available:
```ini
NOTIFICATION_MODE=real
NOTIFICATION_PROVIDER=twilio
TWILIO_ACCOUNT_SID=your_production_sid
TWILIO_AUTH_TOKEN=your_production_auth_token
TWILIO_FROM_SMS=+19500617780
TWILIO_FROM_WHATSAPP=whatsapp:+17372508034
```

---

## 11. Final Verification Status

$$\mathbf{READY\ FOR\ FRONTEND\ (SIMULATION\ MODE\ VERIFIED)}$$

*(All 3 recovery strategies, state machines, Docker PostgreSQL persistence, customer retry APIs, and demo execution suites are 100% verified and operational).*
