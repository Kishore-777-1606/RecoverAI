# RecoverAI Data Dictionary

This document details the database dictionary for the RecoverAI database model. It describes all 19 tables, their columns, relationships, constraints, and business logic.

---

## 1. System Config & Lookup Tables

### 1.1 `payment_methods`
*   **Purpose:** Configurable lookup table of supported customer checkout mechanisms.
*   **Ownership:** System-level configuration.
*   **Columns:**
    *   `payment_method_id` (VARCHAR(50), PRIMARY KEY): The programmatic identifier (e.g., `'UPI'`, `'CARD'`, `'NET_BANKING'`, `'WALLET'`).
    *   `name` (VARCHAR(100), NOT NULL): Customer-facing descriptive name.
    *   `is_active` (BOOLEAN, NOT NULL, DEFAULT `TRUE`): Flag to toggle system availability.
    *   `created_at` (TIMESTAMPTZ, NOT NULL): Record creation timestamp.
*   **Relationships:** Referenced by `payments` and `recovery_payment_attempts`.
*   **What should NOT be stored here:** Gateway credentials, bank routing tables, or transaction-specific details.

### 1.2 `failure_types`
*   **Purpose:** Classifies transaction declines dynamically to support policy eligibility and AI matching.
*   **Ownership:** System-level configuration.
*   **Columns:**
    *   `failure_type_id` (VARCHAR(50), PRIMARY KEY): Programmatic lookup code (e.g., `'INSUFFICIENT_FUNDS'`, `'UPI_TIMEOUT'`).
    *   `category` (VARCHAR(50), NOT NULL): Grouping categories (`'FUNDING'`, `'TECHNICAL'`, `'FRAUD'`, `'TIMEOUT'`, `'UNKNOWN'`). Checked.
    *   `name` (VARCHAR(100), NOT NULL): Human-readable name.
    *   `description` (TEXT, NULL): Explanatory documentation of the decline.
    *   `created_at` (TIMESTAMPTZ, NOT NULL): Creation time.
*   **Relationships:** Referenced by `payments` and `policy_failure_rules`.
*   **What should NOT be stored here:** Specific customer or merchant-facing error messages (store those in `payments`).

### 1.3 `recovery_strategies`
*   **Purpose:** Defines configurable recovery mechanisms available to the system.
*   **Ownership:** System-level configuration.
*   **Columns:**
    *   `strategy_id` (VARCHAR(50), PRIMARY KEY): Lookups (e.g., `'RECOVERY_LINK'`, `'DELAYED_RETRY'`).
    *   `name` (VARCHAR(100), NOT NULL): Strategy name.
    *   `description` (TEXT, NULL): Details on how the recovery strategy works.
    *   `is_active` (BOOLEAN, NOT NULL): Switch to enable/disable strategy globally.
*   **Relationships:** Referenced by `recoveries.selected_strategy_id`, `recoveries.ai_recommended_strategy_id`, `policy_strategies`, and `recovery_actions`.
*   **What should NOT be stored here:** Strategy execution logs or campaign records.

---

## 2. Tenant Core Tables

### 2.1 `merchants`
*   **Purpose:** Registers merchant business profile details (Multi-tenant root).
*   **Ownership:** Merchant Administration.
*   **Columns:**
    *   `merchant_id` (UUID, PRIMARY KEY): Unique system key (`gen_random_uuid()`).
    *   `name` (VARCHAR(255), NOT NULL): Business legal name.
    *   `email` (VARCHAR(255), NOT NULL, UNIQUE): Core merchant contact and billing email.
    *   `phone` (VARCHAR(50), NULL): Contact phone number.
*   **Relationships:** Root parent of `customers`, `merchant_policies`, `payments`, `recoveries`, and `audit_logs`.
*   **What should NOT be stored here:** API keys, payment provider access secrets, or bank payout details.

### 2.2 `customers`
*   **Purpose:** Profiles of customers performing transactions on merchant portals.
*   **Ownership:** Merchant CRM.
*   **Columns:**
    *   `customer_id` (UUID, PRIMARY KEY): Unique identifier.
    *   `merchant_id` (UUID, NOT NULL): References `merchants`.
    *   `name` (VARCHAR(255), NOT NULL): Customer name.
    *   `email` (VARCHAR(255), NOT NULL): Contact email address.
    *   `phone` (VARCHAR(50), NULL): Mobile contact.
    *   `status` (VARCHAR(50), NOT NULL): Lifecycle state (`'ACTIVE'`, `'INACTIVE'`, `'SUSPENDED'`).
*   **Relationships:** Owned by `merchants`. Parent of `payments`, `recoveries`, and `customer_notifications`.
*   **Constraints:** `UNIQUE (merchant_id, email)` enforces customer email uniqueness per merchant tenant.
*   **What should NOT be stored here:** Credit card details, raw passwords, or calculated analytics values (e.g. lifetime value, recovery rate, which are calculated dynamically).

---

## 3. Merchant Policy Configuration

### 3.1 `merchant_policies`
*   **Purpose:** Stores rules governing automatic recovery limits and quiet hours for a merchant.
*   **Ownership:** Merchant configuration.
*   **Columns:**
    *   `policy_id` (UUID, PRIMARY KEY): Unique ID.
    *   `merchant_id` (UUID, NOT NULL): References `merchants`.
    *   `name` (VARCHAR(255), NOT NULL): Policy label.
    *   `is_active` (BOOLEAN, NOT NULL): Global toggle.
    *   `auto_recovery_enabled` (BOOLEAN, NOT NULL): If false, recoveries require manual approval or are skipped.
    *   `max_amount_limit` (NUMERIC(15,2), NULL): Maximum transaction value eligible for auto-recovery.
    *   `approval_threshold` (NUMERIC(15,2), NULL): Limit above which a recovery campaign requires merchant manual approval.
    *   `quiet_hours_enabled` (BOOLEAN, NOT NULL): Toggles messaging restrictions.
    *   `quiet_hours_start` (TIME, NULL): Outreach quiet hours start time (local timezone-offset matched).
    *   `quiet_hours_end` (TIME, NULL): Outreach quiet hours end time.
*   **Relationships:** Owned by `merchants`. Parent of child rules tables.
*   **Constraints:**
    *   `uq_active_policy_per_merchant` (Partial Unique Index): Enforces that a merchant can have **at most one** policy where `is_active = TRUE`. This supports multiple historical or draft policies, but ensures that only a single active policy directs the recovery engine workflow at any given time.
*   **What should NOT be stored here:** Temporary policy draft flags or general app preferences.

### 3.2 `policy_failure_rules`
*   **Purpose:** Maps failure types that are eligible or excluded for recovery under a policy.
*   **Columns:**
    *   `policy_id` (UUID, FK, PK): Link to `merchant_policies`.
    *   `failure_type_id` (VARCHAR(50), FK, PK): Link to `failure_types`.
    *   `is_eligible` (BOOLEAN, NOT NULL): `TRUE` = included failure; `FALSE` = excluded failure type (override).
*   **What should NOT be stored here:** Raw gateway errors or transaction records.

### 3.3 `policy_strategies`
*   **Purpose:** Configures strategy priorities, attempt limits, and intervals.
*   **Columns:**
    *   `policy_id` (UUID, FK, PK): Link to `merchant_policies`.
    *   `strategy_id` (VARCHAR(50), FK, PK): Link to `recovery_strategies`.
    *   `priority` (INTEGER, NOT NULL): Relative ranking order (lower number = higher priority).
    *   `is_enabled` (BOOLEAN, NOT NULL): Enables/disables strategy for this policy.
    *   `max_outreach_attempts` (INTEGER, NOT NULL, DEFAULT 3): Maximum outreach count.
    *   `min_interval_seconds` (INTEGER, NOT NULL, DEFAULT 3600): Sleep spacing between recovery actions.
*   **What should NOT be stored here:** Active retry timers or queue tracking.

### 3.4 `policy_channels`
*   **Purpose:** Lists messaging channels enabled for outreach under the policy.
*   **Columns:**
    *   `policy_id` (UUID, FK, PK): Link to `merchant_policies`.
    *   `channel` (VARCHAR(50), PK): Messaging platform (`'SMS'`, `'EMAIL'`, `'WHATSAPP'`).
    *   `is_enabled` (BOOLEAN, NOT NULL): Toggle switch.
*   **What should NOT be stored here:** SMS templates, SMTP passwords, or WhatsApp tokens.

---

## 4. Simulation Sessions

### 4.1 `simulation_sessions`
*   **Purpose:** Groups simulated payment and recovery events for testing and demo execution.
*   **Ownership:** System Sandbox.
*   **Columns:**
    *   `session_id` (UUID, PRIMARY KEY): Identifier.
    *   `merchant_id` (UUID, NOT NULL): References `merchants`.
    *   `name` (VARCHAR(255), NOT NULL): Name of the simulator run.
    *   `status` (VARCHAR(50), NOT NULL): Lifecycle state (`'RUNNING'`, `'COMPLETED'`).
*   **Relationships:** References `merchants`. Cascades down to `payments`, `recoveries`, and attempts.
*   **What should NOT be stored here:** Real transaction records or production configurations.

---

## 5. Core Transactions

### 5.1 `payments`
*   **Purpose:** Immutable record of initial customer checkout transactions.
*   **Ownership:** Core Ledger (Immutable once terminal).
*   **Columns:**
    *   `payment_id` (UUID, PRIMARY KEY): System ID.
    *   `merchant_id` (UUID, NOT NULL): References `merchants` (RESTRICT deletes).
    *   `customer_id` (UUID, NOT NULL): References `customers` (RESTRICT deletes).
    *   `payment_method_id` (VARCHAR(50), NOT NULL): References `payment_methods`.
    *   `amount` (NUMERIC(15,2), NOT NULL): Total transaction value.
    *   `currency` (VARCHAR(3), NOT NULL, DEFAULT `'INR'`): ISO currency code.
    *   `status` (VARCHAR(50), NOT NULL): Lifecycle state (`'INITIATED'`, `'PROCESSING'`, `'SUCCESSFUL'`, `'FAILED'`).
    *   `failure_type_id` (VARCHAR(50), NULL): FK referencing `failure_types` when transaction fails.
    *   `failure_message` (TEXT, NULL): Raw gateway response text.
    *   `external_reference` (VARCHAR(255), NOT NULL): External checkout gateway transaction ID.
    *   `provider_event_id` (VARCHAR(255), UNIQUE, NULL): The unique event ID sent by the provider webhook, used for webhook idempotency checks.
    *   `environment` (VARCHAR(20), NOT NULL): Environment classification (`'LIVE'`, `'TEST'`, `'SIMULATION'`).
    *   `simulation_session_id` (UUID, NULL): References `simulation_sessions` (must be present if environment is SIMULATION, and must be NULL otherwise).
    *   `created_at`/`updated_at`/`failed_at`/`successful_at`: Timestamps.
*   **Relationships:** Parent of `recoveries` (1-to-1).
*   **Constraints:**
    *   `UNIQUE (merchant_id, external_reference)` prevents duplicate checkouts.
    *   `UNIQUE (payment_id, status)` and `UNIQUE (payment_id, merchant_id, customer_id, status)` serve as composite target keys to enforce relational consistency.
    *   `chk_payment_simulation_session` enforces that `simulation_session_id` is present if and only if environment is `'SIMULATION'`.
    *   `chk_payment_failure_state` guarantees status-timestamp consistency.
*   **What should NOT be stored here:** Cardholder data, bank PINs, or recovery link urls.

### 5.2 `recoveries`
*   **Purpose:** Tracks the lifecycle of recovery campaigns triggered by payment failures.
*   **Ownership:** Recovery Engine.
*   **Columns:**
    *   `recovery_id` (UUID, PRIMARY KEY): Campaign identifier.
    *   `payment_id` (UUID, NOT NULL, UNIQUE): Link to the original `payments` record.
    *   `customer_id`/`merchant_id` (UUID, NOT NULL): References.
    *   `payment_status` (VARCHAR(50), NOT NULL): Holds the status value of the referenced payment (enforced to be `'FAILED'`).
    *   `status` (VARCHAR(50), NOT NULL): State (`'RECOVERED'`, `'IN_PROGRESS'`, `'AWAITING_CUSTOMER_ACTION'`, `'FAILED'`, etc.).
    *   `current_stage` (VARCHAR(50), NOT NULL): Phase (`'ANALYSIS'`, `'OUTREACH'`, `'PAYMENT_PENDING'`, `'VERIFICATION'`, `'COMPLETED'`).
    *   `ai_recommended_strategy_id` (VARCHAR(50), NULL): Strategy generated by the AI model.
    *   `ai_confidence_score` (NUMERIC(5,2), NULL): Expected success likelihood (0 to 100).
    *   `ai_recommended_timing` (TIMESTAMPTZ, NULL): Calculated best contact time.
    *   `ai_explanation` (TEXT, NULL): Logic trace description of the suggestion.
    *   `ai_failure_classification` (VARCHAR(100), NULL): Structured categorization.
    *   `selected_strategy_id` (VARCHAR(50), NULL): Strategy actually executed (respecting policy overrides).
    *   `approval_required` (BOOLEAN, NOT NULL): If true, requires manual merchant approval.
    *   `approved_at` (TIMESTAMPTZ, NULL): Time merchant approved execution.
    *   `amount` (NUMERIC(15,2), NOT NULL): Value targeted for recovery.
    *   `environment` (VARCHAR(20), NOT NULL): Sandbox or live indicator.
    *   `simulation_session_id` (UUID, NULL): Simulation trace link.
    *   `created_at`/`updated_at`/`completed_at`/`expires_at`/`cancelled_at`/`cancellation_reason`: Timestamps.
*   **Relationships:** Owned by failed `payments`. Parent of events, actions, notifications, and attempts.
*   **Constraints:**
    *   `UNIQUE (recovery_id, customer_id)` serves as a composite target key for validating child entities.
    *   Foreign key constraint on `(payment_id, merchant_id, customer_id, payment_status)` referencing `payments(payment_id, merchant_id, customer_id, status)` prevents any tenant/customer relationship mismatch and guarantees that recovery can *only* be created for an original failed payment (since `payment_status` has a CHECK constraint of `= 'FAILED'`).
    *   `chk_recovery_simulation_session` enforces that `simulation_session_id` is present if and only if environment is `'SIMULATION'`.
*   **What should NOT be stored here:** Raw SMS/Email outreach contents (store in `customer_notifications` metadata).

---

## 6. Campaign Actions & Timeline

### 6.1 `recovery_events`
*   **Purpose:** Chronological log/activity trail of campaign status transitions.
*   **Ownership:** System Audit Trail.
*   **Columns:**
    *   `event_id` (UUID, PRIMARY KEY): Event key.
    *   `recovery_id` (UUID, NOT NULL): References `recoveries` (CASCADE on delete).
    *   `event_type` (VARCHAR(100), NOT NULL): Action classification (e.g. `'LINK_SENT'`, `'LINK_OPENED'`).
    *   `event_status` (VARCHAR(50), NOT NULL): Status of event operation.
    *   `description` (TEXT, NOT NULL): Summary text displayed on merchant dashboard.
    *   `metadata` (JSONB, NULL): Flexible contextual parameters.
    *   `actor` (VARCHAR(100), NOT NULL): Trigger source (`'SYSTEM'`, `'AI_ENGINE'`, `'MERCHANT'`, `'CUSTOMER'`).
    *   `created_at` (TIMESTAMPTZ, NOT NULL): Event timestamp.
*   **What should NOT be stored here:** Core transactional statuses or flags.

### 6.2 `recovery_actions`
*   **Purpose:** Records discrete actions taken by the recovery engine (e.g., sending link, scheduling retry).
*   **Columns:**
    *   `action_id` (UUID, PRIMARY KEY): Action key.
    *   `recovery_id` (UUID, NOT NULL): Link to parent recovery.
    *   `strategy_id` (VARCHAR(50), NOT NULL): Link to executed strategy.
    *   `action_type` (VARCHAR(100), NOT NULL): e.g. `'RECOVERY_LINK_GENERATED'`, `'DELAYED_RETRY_SCHEDULED'`.
    *   `status` (VARCHAR(50), NOT NULL): Operational state (`'PENDING'`, `'SUCCESS'`, `'FAILED'`, `'CANCELLED'`).
    *   `attempt_number` (INTEGER, NOT NULL): Spacing indicator count.
    *   `metadata` (JSONB, NULL): Details (e.g., retry timestamps).
*   **What should NOT be stored here:** Outreach logs (stored in `customer_notifications`).

### 6.3 `recovery_links`
*   **Purpose:** Manages secure validation tokens for customer-facing checkout recovery pages.
*   **Ownership:** Outreach engine.
*   **Columns:**
    *   `recovery_link_id` (UUID, PRIMARY KEY): Key.
    *   `recovery_id` (UUID, NOT NULL): References `recoveries`.
    *   `secure_token` (VARCHAR(255), NOT NULL, UNIQUE): Unique, non-guessable URL slug.
    *   `status` (VARCHAR(50), NOT NULL): State (`'ACTIVE'`, `'EXPIRED'`, `'USED'`, `'INVALIDATED'`).
    *   `created_at`/`expires_at`/`opened_at`/`used_at`/`invalidated_at`: Timestamps.
    *   `invalidation_reason` (TEXT, NULL): Reason link was terminated.
*   **What should NOT be stored here:** Raw parameters like merchant keys or user details.

### 6.4 `customer_notifications`
*   **Purpose:** Multi-channel outreach (SMS, EMAIL, WHATSAPP) tracking customer communications.
*   **Columns:**
    *   `notification_id` (UUID, PRIMARY KEY): Notification key.
    *   `recovery_id` (UUID, NOT NULL): References `recoveries`.
    *   `customer_id` (UUID, NOT NULL): References `customers`.
    *   `channel` (VARCHAR(50), NOT NULL): Channel (`'SMS'`, `'EMAIL'`, `'WHATSAPP'`).
    *   `message_template_ref` (VARCHAR(100), NULL): Identifier of content templates used.
    *   `status` (VARCHAR(50), NOT NULL): Delivery state (`'PENDING'`, `'SENT'`, `'DELIVERED'`, `'OPENED'`, `'FAILED'`).
    *   `attempt_number` (INTEGER, NOT NULL): Number tracking channel retries.
    *   `sent_at`/`delivered_at`/`opened_at`/`failed_at`: Action timestamps.
    *   `error_message` (TEXT, NULL): Gateway delivery failure reason.
*   **Constraints:**
    *   Composite foreign key `(recovery_id, customer_id)` referencing `recoveries(recovery_id, customer_id)` guarantees that the customer_id of the notification matches the customer_id of the recovery campaign.
*   **What should NOT be stored here:** Rich HTML text bodies or raw message blocks (message templates should be maintained in code; logs hold variables in JSON if needed).

---

## 7. Recovery Checkout & Verification

### 7.1 `recovery_payment_attempts`
*   **Purpose:** Records separate payment attempts initiated during the recovery process.
*   **Ownership:** Transaction Ledger.
*   **Columns:**
    *   `attempt_id` (UUID, PRIMARY KEY): Unique attempt identifier.
    *   `recovery_id` (UUID, NOT NULL): References parent `recoveries`.
    *   `customer_id` (UUID, NOT NULL): References `customers`.
    *   `payment_method_id` (VARCHAR(50), NOT NULL): References `payment_methods`.
    *   `amount` (NUMERIC(15,2), NOT NULL): Total transaction value.
    *   `currency` (VARCHAR(3), NOT NULL, DEFAULT `'INR'`): Base code.
    *   `status` (VARCHAR(50), NOT NULL): State (`'PENDING'`, `'PROCESSING'`, `'SUCCESSFUL'`, `'FAILED'`).
    *   `provider_name` (VARCHAR(100), NULL): Third-party payment gateway (e.g. `'Razorpay'`, `'Stripe'`).
    *   `provider_transaction_id` (VARCHAR(255), NULL): External payment ID.
    *   `provider_status` (VARCHAR(100), NULL): Raw API status returned by provider.
    *   `idempotency_key` (VARCHAR(255), NOT NULL, UNIQUE): Unique identifier preventing double charges.
    *   `error_code`/`error_message` (TEXT, NULL): Decline context details.
    *   `environment` (VARCHAR(20), NOT NULL): Live/simulated flag.
    *   `simulation_session_id` (UUID, NULL): Simulation trace link.
    *   `created_at`/`completed_at`: Timestamps.
*   **Constraints:**
    *   Composite foreign key `(recovery_id, customer_id)` referencing `recoveries(recovery_id, customer_id)` guarantees that the customer_id of the attempt matches the customer_id of the recovery campaign.
    *   `chk_attempt_simulation_session` enforces that `simulation_session_id` is present if and only if environment is `'SIMULATION'`.
*   **What should NOT be stored here:** Raw payment cards, tokens, CVV, or authentication details.

### 7.2 `payment_verifications`
*   **Purpose:** Documents double-verification checks performed with gateways.
*   **Ownership:** Verification ledger. Allows multiple verification logs per payment attempt in case verification is retried.
*   **Columns:**
    *   `verification_id` (UUID, PRIMARY KEY): Key.
    *   `payment_attempt_id` (UUID, NOT NULL): References `recovery_payment_attempts` (CASCADE deletes on sandbox).
    *   `status` (VARCHAR(50), NOT NULL): State (`'PENDING'`, `'VERIFIED'`, `'FAILED'`).
    *   `verification_attempt` (INTEGER, NOT NULL): Retry counter.
    *   `provider_reference` (VARCHAR(255), NULL): Gateway settlement batch transaction.
    *   `verified_at` (TIMESTAMPTZ, NULL): Time verification succeeded.
    *   `failure_reason` (TEXT, NULL): Reconciliation mismatch reason.
*   **What should NOT be stored here:** Internal verification logs or polling telemetry.

---

## 8. Audit logs

### 8.1 `audit_logs`
*   **Purpose:** Chronologically logs admin activities, policy edits, manual approvals, and cancellations.
*   **Columns:**
    *   `audit_log_id` (UUID, PRIMARY KEY): Unique log key.
    *   `merchant_id` (UUID, NULL): References merchant (SET NULL on delete).
    *   `actor` (VARCHAR(255), NOT NULL): Operator identity.
    *   `action` (VARCHAR(100), NOT NULL): Admin action identifier.
    *   `entity_name` (VARCHAR(100), NOT NULL): Target database table.
    *   `entity_id` (UUID, NOT NULL): Key of targeted record.
    *   `pre_values` (JSONB, NULL): Snapshot of record state *before* change.
    *   `post_values` (JSONB, NULL): Snapshot of record state *after* change.
    *   `ip_address` (VARCHAR(50), NULL): Source IP address.
    *   `created_at` (TIMESTAMPTZ, NOT NULL): Transaction timestamp.
*   **What should NOT be stored here:** High-frequency API logs, system debugging stacks, or read requests.
