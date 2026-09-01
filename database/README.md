# RecoverAI Database Module

This directory contains the database design for the **RecoverAI** payment recovery system. It defines a multi-tenant relational schema optimized for PostgreSQL (v13+).

---

## 1. Project Directory Structure

The following database files are located here:
*   [`schema.sql`](schema.sql): PostgreSQL-compliant data definition language (DDL) creating 19 tables, indexes, constraints, and relationships.
*   [`seed.sql`](seed.sql): Idempotent sample script providing realistic Indian payment histories (INR) and simulation runs.
*   [`data-dictionary.md`](data-dictionary.md): Reference details on columns, keys, validation rules, nullability, and lifecycle logic.
*   [`erd.md`](erd.md): Entity-relationship diagram (ERD) using Mermaid.js syntax.

---

## 2. Setup and Execution Instructions

### Prerequisites
*   **PostgreSQL 13 or newer** installed locally or running in a container.
*   No external packages or dependencies are required. `gen_random_uuid()` is supported natively by PostgreSQL 13+. For older versions, the `pgcrypto` extension is loaded automatically in the schema file.

### Step 1: Create Database
Connect to your PostgreSQL server and create a dedicated database:
```bash
createdb -U postgres recoverai
```
*(Or run `CREATE DATABASE recoverai;` within the `psql` interactive terminal).*

### Step 2: Initialize Schema
Compile the tables, references, and indexes in correct dependency-safe order:
```bash
psql -U postgres -d recoverai -f schema.sql
```

### Step 3: Load Demo Seed Data
Populate lookup registers and demo states:
```bash
psql -U postgres -d recoverai -f seed.sql
```

---

## 3. Cleardown and Reset Strategy

### Resetting All Data
The [`seed.sql`](seed.sql) script is written to be fully idempotent and self-contained. Re-running the script automatically cleans all tables using a reverse dependency cascade:
```sql
-- Restores database to fresh, seeded state
psql -U postgres -d recoverai -f seed.sql
```

### Clearing Only Simulator Data
Since simulation data is tracked cleanly, you can purge simulated demo records without touching live transaction tables or merchant setup records:
```sql
-- Delete a specific simulation session and cascading transactions
DELETE FROM simulation_sessions WHERE session_id = 'ee601f01-77d0-4bf6-9611-9e7d959550bb';

-- Delete all simulation sessions
DELETE FROM simulation_sessions;
```
*(Note: Because foreign keys on `payments` and `recoveries` specify `ON DELETE CASCADE` on `simulation_session_id`, this query will instantly clean all simulated payments, attempts, events, verifications, and links).*

---

## 4. Simulation Isolation Architecture

The database keeps real and simulated transaction pipelines strictly isolated within the same database:

1.  **Environment Field:** Primary transactional tables (`payments`, `recoveries`, `recovery_payment_attempts`) carry an `environment` field constrained to `('LIVE', 'TEST', 'SIMULATION')`.
2.  **Session Reference:** The `simulation_session_id` field links transactions to a specific simulation sequence.
3.  **Strict Check Constraints:** Database constraints enforce that `simulation_session_id` is NOT NULL when `environment = 'SIMULATION'` and MUST be NULL when the environment is `'LIVE'` or `'TEST'`.
4.  **Traceability Indexing:** Composite index `idx_payments_env_status` and `idx_recoveries_env_status_stage` ensure that live merchant analytics queries ignore simulator transactions in sub-millisecond execution times.

---

## 5. UI Page Coverage & Analytics Derivation

To prevent discrepancies, this database avoids pre-calculated aggregates. All analytics displayed in the RecoverAI admin panels are generated on-the-fly using queries:

### A. Dashboard Metrics
*   **Total Revenue Recovered:**
    ```sql
    SELECT COALESCE(SUM(amount), 0.00) 
    FROM recovery_payment_attempts 
    WHERE status = 'SUCCESSFUL' AND environment = 'LIVE';
    ```
*   **Overall Recovery Rate:**
    ```sql
    SELECT 
        (COUNT(CASE WHEN status = 'RECOVERED' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0))::NUMERIC(5,2) AS recovery_rate
    FROM recoveries 
    WHERE environment = 'LIVE';
    ```
*   **Failure Breakdown Chart:**
    ```sql
    SELECT ft.name, COUNT(p.payment_id) AS total_failures
    FROM payments p
    JOIN failure_types ft ON p.failure_type_id = ft.failure_type_id
    WHERE p.status = 'FAILED' AND p.environment = 'LIVE'
    GROUP BY ft.name;
    ```

### B. Recovery Strategy Performance Analytics
*   Calculates which AI recovery pathways are yielding the highest conversions:
    ```sql
    SELECT 
        selected_strategy_id AS strategy,
        COUNT(CASE WHEN status = 'RECOVERED' THEN 1 END) AS successful_recoveries,
        COUNT(*) AS total_campaigns,
        (COUNT(CASE WHEN status = 'RECOVERED' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0))::NUMERIC(5,2) AS success_rate
    FROM recoveries
    WHERE environment = 'LIVE' AND selected_strategy_id IS NOT NULL
    GROUP BY selected_strategy_id;
    ```

---

## 6. Model Validation

We verified that the designed PostgreSQL tables map directly to every feature and UI view of the RecoverAI codebase:

| UI View / Feature | Backed By Relational Table Path | Details & Verification |
|---|---|---|
| **Merchant Dashboard** | `payments` + `recoveries` + `recovery_payment_attempts` | Provides totals, timelines, status rates, and volume metrics via filtered group-by queries. |
| **Payment List** | `payments` joined with `customers` and `payment_methods` | Displays customer details, payment channels (UPI, Cards), timestamps, and gateways. |
| **Recovery List** | `recoveries` joined with `payments` | Lists active campaigns, current stages, strategy assignments, and elapsed durations. |
| **Recovery Details Timeline** | `recovery_events` (ordered by `created_at ASC`) | Renders chronological timeline feeds (e.g. Failure, AI Analysis, Link Sent, Customer Open). |
| **Customer Directory** | `customers` | Lists individual names, contact logs, emails, and active CRM statuses. |
| **Merchant Policies** | `merchant_policies` + failure rules & strategy mappings | Backs policies: automatic boundaries, limits, exclusions, quiet hours, retry intervals. A partial unique index guarantees at most one active policy per merchant. |
| **Payment Simulator** | `simulation_sessions` + `payments` (`environment = 'SIMULATION'`) | Creates simulated payments without adding risk or noise to real business ledgers. |
| **Customer Recovery Notice** | `recovery_links` (searched by `secure_token`) | Customer landing page fetches the link token and shows the due amount securely. |
| **Customer Success Page** | `recovery_payment_attempts` + `payment_verifications` | Verifies checkouts with gateway switches, rendering the success page after verification. Allows multiple verification logs in case of transaction retries. |
| **Administrative Changes** | `audit_logs` | Logs administrative settings changes, cancellations, and manual action triggers. |

---

## 7. Production Considerations

When transitioning from local modeling to production scaling, consider the following database recommendations:

1.  **Transactional Read-Write Isolation:** Create read-replica nodes for heavy dashboard analytic queries (such as customer recovery ratios) to prevent lock contention on core write tables (`payments`, `recoveries`).
2.  **Audit Log Compression:** The `audit_logs` table accumulates JSON changes. Enable table partitioning on `created_at` (e.g., monthly partitions) and establish an archival script to move older audit rows into cold cloud storage.
3.  **Soft-Deletes Handling:** While the database blocks physical deletions using `ON DELETE RESTRICT` on historical tables, a soft-delete status column or triggers should be built at the application level to hide deleted entities from users while retaining them for ledger audits.
4.  **Encryption at Rest:** Ensure PostgreSQL's transparent data encryption (TDE) or column-level PGP encryption is activated if storing contact email/phone combinations in high-compliance environments.
