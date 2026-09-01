# RecoverAI Database-to-Backend Contract

This document audits the relationship between the locked database schema (`/database/schema.sql`) and the backend architecture layout (`/backend`). It defines our strict boundaries for data mapping, type safety, and relational constraints.

---

## A. Core Database Technology
*   **Database:** PostgreSQL (v13+)
*   **Identifier Format:** UUID v4 (using standard `gen_random_uuid()` defaults) for entities, and `VARCHAR` lookup keys for static config registers.
*   **Monetary Type:** `NUMERIC(15,2)` for amount fields (e.g. max limits, thresholds, transaction amounts).
*   **Timezones:** `TIMESTAMPTZ` for all date/time fields, ensuring application inputs are stored in UTC format.

---

## B. 19-Table Inventory & Repository Mapping

All database operations must go through the respective repository classes. Below is the mapping of tables to backend repositories:

| # | PostgreSQL Table | Primary Key | Key Relationships / FKs | Target Backend Repository | Purpose & Lifecycle Context |
|---|---|---|---|---|---|
| 1 | `payment_methods` | `payment_method_id` (PK) | None | Core Lookup | Configures active checkout channels (UPI, Card, Net Banking, Wallet). |
| 2 | `failure_types` | `failure_type_id` (PK) | None | Core Lookup | Error catalog mapping. Enables policy exclusion filters. |
| 3 | `recovery_strategies` | `strategy_id` (PK) | None | Core Lookup | AI-driven and manual strategy configurations registry. |
| 4 | `merchants` | `merchant_id` (PK) | None | `merchantRepository.ts` | Tenants root registry. Defines multi-tenancy boundaries. |
| 5 | `customers` | `customer_id` (PK) | `merchant_id` -> `merchants` | `customerRepository.ts` | Profiles customer demographics per tenant. |
| 6 | `merchant_policies` | `policy_id` (PK) | `merchant_id` -> `merchants` | `policyRepository.ts` | Core policies (Quiet Hours, Automatic boundaries). |
| 7 | `policy_failure_rules` | `(policy_id, failure_type_id)` | FKs to Policies & Failure types | `policyRepository.ts` | Governs whether a specific failure triggers recovery. |
| 8 | `policy_strategies` | `(policy_id, strategy_id)` | FKs to Policies & Strategies | `policyRepository.ts` | Configures attempt limits and intervals per strategy. |
| 9 | `policy_channels` | `(policy_id, channel)` | FK to Policies | `policyRepository.ts` | Maps SMS, Email, and WhatsApp permission states. |
| 10| `simulation_sessions` | `session_id` (PK) | `merchant_id` -> `merchants` | `simulationRepository.ts` | Grouping container for sandbox demo sequences. |
| 11| `payments` | `payment_id` (PK) | `merchant_id`, `customer_id`, `payment_method_id`, `failure_type_id`, `simulation_session_id` | `paymentRepository.ts` | Base transactions ledger. Original checkout failures. |
| 12| `recoveries` | `recovery_id` (PK) | `payment_id` (Unique), `merchant_id`, `customer_id`, `simulation_session_id`, `selected_strategy_id` | `recoveryRepository.ts` | Orchestrates campaign stages and active strategies. |
| 13| `recovery_events` | `event_id` (PK) | `recovery_id` -> `recoveries` (CASCADE) | `recoveryRepository.ts` | Chronological activity feed for campaign timelines. |
| 14| `recovery_actions` | `action_id` (PK) | `recovery_id` -> `recoveries` (CASCADE), `strategy_id` | `recoveryActionRepository.ts` | Tracks action executions (link generations, retry delays). |
| 15| `recovery_links` | `recovery_link_id` (PK) | `recovery_id` -> `recoveries` (CASCADE) | `recoveryLinkRepository.ts` | Secure tokens mapping customer landings. |
| 16| `customer_notifications` | `notification_id` (PK) | `(recovery_id, customer_id)` -> `recoveries` (CASCADE) | `notificationRepository.ts` | Logs outbound deliveries (SMS, Email, WhatsApp). |
| 17| `recovery_payment_attempts`| `attempt_id` (PK) | `(recovery_id, customer_id)` -> `recoveries` (CASCADE), `payment_method_id`, `simulation_session_id` | `recoveryAttemptRepository.ts` | Records separate checkouts without modifying `payments`. |
| 18| `payment_verifications` | `verification_id` (PK) | `payment_attempt_id` -> `recovery_payment_attempts` (CASCADE) | `verificationRepository.ts` | Double-verifies transactions with provider endpoints. |
| 19| `audit_logs` | `audit_log_id` (PK) | `merchant_id` -> `merchants` (SET NULL) | `auditRepository.ts` | Logs admin edits, overrides, and manual actions. |

---

## C. Relational Integrity and Consistency Constraints

The database schema enforces strict relational boundaries. The backend application must respect these checks:

1.  **Merchant-Customer Consistency:**
    A campaign (`recoveries`) references `payments` via a composite key:
    ```sql
    FOREIGN KEY (payment_id, merchant_id, customer_id, payment_status)
    REFERENCES payments (payment_id, merchant_id, customer_id, status)
    ```
    This constraint guarantees that the campaign cannot reference mismatched tenants or customer combinations. The backend must query and write using the same parent keys.
2.  **Failed Payments Only:**
    The referenced column `payment_status` in `recoveries` is constrained to `'FAILED'` using `CHECK (payment_status = 'FAILED')`. This ensures that a recovery campaign can *only* target failed base payments.
3.  **Active Policy Guard:**
    A partial unique index enforces a single active policy per tenant:
    ```sql
    CREATE UNIQUE INDEX uq_active_policy_per_merchant ON merchant_policies (merchant_id) WHERE (is_active = TRUE)
    ```
    When writing/updating policies, `policyRepository.ts` must use transaction isolation block logic to deactivate previous policy rows before setting a new one to active.
4.  **Sandbox Isolation Rules:**
    For simulation sessions, check constraints enforce:
    ```sql
    CHECK (
      (environment = 'SIMULATION' AND simulation_session_id IS NOT NULL) OR
      (environment IN ('LIVE', 'TEST') AND simulation_session_id IS NULL)
    )
    ```
    Live checkout pipelines must ensure `simulation_session_id` is passed as `NULL` to avoid constraint violations.
5.  **Idempotency Constraints:**
    *   `payments.provider_event_id` is `UNIQUE`. Webhook processing must block duplicate events.
    *   `recovery_payment_attempts.idempotency_key` is `UNIQUE`. Prevent duplicate charging on checkout clicks.

---

## D. Schema Mismatch Audit

A strict audit of `schema.sql` against the `backend/` design was conducted:
*   **Mismatches Found:** **NONE**.
*   **Compatibility:** The backend repository scaffolding matches the table entities exactly. The data types (TIMESTAMPTZ, NUMERIC) map to safe abstractions (`Date` objects, precise String-Paise arithmetic helpers) in the backend utils layer.
