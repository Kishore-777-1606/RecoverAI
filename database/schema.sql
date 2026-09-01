-- RecoverAI Database Schema
-- Target Database: PostgreSQL (v13+)
-- All timestamps are stored with time zones (UTC).
-- Monetary values use NUMERIC(15,2) to prevent precision loss.

-- Enable pgcrypto for backward compatibility on older PG versions (v9.4 - v12)
-- PostgreSQL 13+ has gen_random_uuid() natively built-in.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================================
-- 1. LOOKUP TABLES (Static metadata, extensible via database records)
-- =========================================================================

-- Supported payment channels
CREATE TABLE payment_methods (
    payment_method_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE payment_methods IS 'Lookup table for supported customer payment types (e.g. UPI, Card, Net Banking, Wallet).';

-- Classification of transaction failures
CREATE TABLE failure_types (
    failure_type_id VARCHAR(50) PRIMARY KEY,
    category VARCHAR(50) NOT NULL CHECK (category IN ('FUNDING', 'TECHNICAL', 'FRAUD', 'TIMEOUT', 'UNKNOWN')),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE failure_types IS 'Extensible classification of payment gateway failures.';

-- Supported strategies for recovery campaigns
CREATE TABLE recovery_strategies (
    strategy_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE recovery_strategies IS 'Lookup table for active and future AI recovery methods.';

-- =========================================================================
-- 2. CORE SYSTEM ENTITIES
-- =========================================================================

-- Merchants using the system
CREATE TABLE merchants (
    merchant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE merchants IS 'Tenants of the RecoverAI system.';

-- Profiles of customers associated with merchants
CREATE TABLE customers (
    customer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(merchant_id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (merchant_id, email)
);

COMMENT ON TABLE customers IS 'Customer profiles belonging to a specific merchant. Unique per email/merchant.';

-- =========================================================================
-- 3. POLICIES (Configurable rules)
-- =========================================================================

-- Central merchant recovery configuration
CREATE TABLE merchant_policies (
    policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(merchant_id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    auto_recovery_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    max_amount_limit NUMERIC(15, 2) CHECK (max_amount_limit > 0),
    approval_threshold NUMERIC(15, 2) CHECK (approval_threshold >= 0),
    quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE merchant_policies IS 'Core merchant rules governing automatic recovery eligibility thresholds and quiet hours.';

-- Enforce no more than one active policy per merchant to keep versioning history valid while avoiding policy configuration overlap.
CREATE UNIQUE INDEX uq_active_policy_per_merchant 
ON merchant_policies (merchant_id) 
WHERE (is_active = TRUE);

-- Associates payment failure reasons with recovery policies
CREATE TABLE policy_failure_rules (
    policy_id UUID NOT NULL REFERENCES merchant_policies(policy_id) ON DELETE CASCADE,
    failure_type_id VARCHAR(50) NOT NULL REFERENCES failure_types(failure_type_id) ON DELETE RESTRICT,
    is_eligible BOOLEAN NOT NULL DEFAULT TRUE, -- TRUE = Included failure type; FALSE = Excluded type
    PRIMARY KEY (policy_id, failure_type_id)
);

COMMENT ON TABLE policy_failure_rules IS 'Specifies which failure categories are eligible or excluded for recovery under a policy.';

-- Specific configuration parameters per recovery strategy
CREATE TABLE policy_strategies (
    policy_id UUID NOT NULL REFERENCES merchant_policies(policy_id) ON DELETE CASCADE,
    strategy_id VARCHAR(50) NOT NULL REFERENCES recovery_strategies(strategy_id) ON DELETE RESTRICT,
    priority INTEGER NOT NULL CHECK (priority > 0),
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    max_outreach_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_outreach_attempts > 0),
    min_interval_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (min_interval_seconds >= 0),
    PRIMARY KEY (policy_id, strategy_id)
);

COMMENT ON TABLE policy_strategies IS 'Prioritizes and configures parameters like outreach attempts and delay spacing for each strategy.';

-- Allowed channels of communication per policy
CREATE TABLE policy_channels (
    policy_id UUID NOT NULL REFERENCES merchant_policies(policy_id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('SMS', 'EMAIL', 'WHATSAPP')),
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (policy_id, channel)
);

COMMENT ON TABLE policy_channels IS 'Maps messaging outreach channels allowed under a merchant policy.';

-- =========================================================================
-- 4. SIMULATION AND SESSION MANAGEMENT
-- =========================================================================

-- Organizes demo and simulation runs
CREATE TABLE simulation_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(merchant_id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE simulation_sessions IS 'Tracks active and historical simulated workflows run in the Payment and Recovery Simulators.';

-- =========================================================================
-- 5. TRANSACTIONAL ENTITIES (Core checkout & recovery)
-- =========================================================================

-- Checkout transactions (Original payments)
CREATE TABLE payments (
    payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(merchant_id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
    payment_method_id VARCHAR(50) NOT NULL REFERENCES payment_methods(payment_method_id) ON DELETE RESTRICT,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(50) NOT NULL DEFAULT 'INITIATED' CHECK (status IN ('INITIATED', 'PROCESSING', 'SUCCESSFUL', 'FAILED')),
    failure_type_id VARCHAR(50) REFERENCES failure_types(failure_type_id) ON DELETE RESTRICT,
    failure_message TEXT,
    external_reference VARCHAR(255) NOT NULL, -- gateway checkout reference ID
    provider_event_id VARCHAR(255) UNIQUE, -- added for webhook idempotency (e.g. event token from gateway callback)
    environment VARCHAR(20) NOT NULL DEFAULT 'LIVE' CHECK (environment IN ('LIVE', 'TEST', 'SIMULATION')),
    simulation_session_id UUID REFERENCES simulation_sessions(session_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    failed_at TIMESTAMPTZ,
    successful_at TIMESTAMPTZ,
    UNIQUE (merchant_id, external_reference),
    UNIQUE (payment_id, status), -- composite key target for enforcing recovery status integrity
    UNIQUE (payment_id, merchant_id, customer_id, status), -- composite key target for overall client consistency
    CONSTRAINT chk_payment_simulation_session CHECK (
        (environment = 'SIMULATION' AND simulation_session_id IS NOT NULL) OR
        (environment IN ('LIVE', 'TEST') AND simulation_session_id IS NULL)
    ),
    CONSTRAINT chk_payment_failure_state CHECK (
        (status = 'FAILED' AND failure_type_id IS NOT NULL AND failed_at IS NOT NULL) OR
        (status = 'SUCCESSFUL' AND failure_type_id IS NULL AND successful_at IS NOT NULL) OR
        (status IN ('INITIATED', 'PROCESSING') AND failure_type_id IS NULL AND failed_at IS NULL AND successful_at IS NULL)
    )
);

COMMENT ON TABLE payments IS 'Immutable records representing base checkout transactions. Original payments never overwrite.';

-- Active recovery campaigns linked to failures
CREATE TABLE recoveries (
    recovery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
    merchant_id UUID NOT NULL REFERENCES merchants(merchant_id) ON DELETE RESTRICT,
    payment_status VARCHAR(50) NOT NULL CHECK (payment_status = 'FAILED'), -- Enforce that a recovery can only be created for a FAILED payment
    status VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('RECOVERED', 'IN_PROGRESS', 'AWAITING_CUSTOMER_ACTION', 'AWAITING_VERIFICATION', 'FAILED', 'EXPIRED', 'CANCELLED', 'NOT_RECOVERABLE')),
    current_stage VARCHAR(50) NOT NULL DEFAULT 'ANALYSIS' CHECK (current_stage IN ('ANALYSIS', 'OUTREACH', 'PAYMENT_PENDING', 'VERIFICATION', 'COMPLETED')),
    
    -- AI Engine recommendation outputs (for auditing and policy comparison)
    ai_recommended_strategy_id VARCHAR(50) REFERENCES recovery_strategies(strategy_id) ON DELETE RESTRICT,
    ai_confidence_score NUMERIC(5, 2) CHECK (ai_confidence_score >= 0.00 AND ai_confidence_score <= 100.00),
    ai_recommended_timing TIMESTAMPTZ,
    ai_explanation TEXT,
    ai_failure_classification VARCHAR(100),
    
    -- Applied strategy matching merchant overrides or policies
    selected_strategy_id VARCHAR(50) REFERENCES recovery_strategies(strategy_id) ON DELETE RESTRICT,
    approval_required BOOLEAN NOT NULL DEFAULT FALSE,
    approved_at TIMESTAMPTZ,
    
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    environment VARCHAR(20) NOT NULL DEFAULT 'LIVE' CHECK (environment IN ('LIVE', 'TEST', 'SIMULATION')),
    simulation_session_id UUID REFERENCES simulation_sessions(session_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    
    UNIQUE (recovery_id, customer_id), -- Enforce relational contract for child notifications and checkouts
    -- Composite foreign key guarantees that payment_id, merchant_id, customer_id, and FAILED status match exactly
    FOREIGN KEY (payment_id, merchant_id, customer_id, payment_status) REFERENCES payments(payment_id, merchant_id, customer_id, status) ON DELETE RESTRICT,
    CONSTRAINT chk_recovery_simulation_session CHECK (
        (environment = 'SIMULATION' AND simulation_session_id IS NOT NULL) OR
        (environment IN ('LIVE', 'TEST') AND simulation_session_id IS NULL)
    ),
    CONSTRAINT chk_recovery_approval CHECK (
        (approval_required = FALSE) OR (approval_required = TRUE AND (approved_at IS NOT NULL OR status = 'IN_PROGRESS'))
    )
);

COMMENT ON TABLE recoveries IS 'Direct recovery orchestration records tracking state transitions independently of payments.';

-- =========================================================================
-- 6. RECOVERY ACTIVITIES AND CAMPAIGN ACTIONS
-- =========================================================================

-- Detailed operational activity history
CREATE TABLE recovery_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recovery_id UUID NOT NULL REFERENCES recoveries(recovery_id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL, -- e.g., PAYMENT_FAILED, ANALYSIS_COMPLETED, LINK_SENT, LINK_OPENED
    event_status VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    metadata JSONB,
    actor VARCHAR(100) NOT NULL CHECK (actor IN ('SYSTEM', 'AI_ENGINE', 'MERCHANT', 'CUSTOMER')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE recovery_events IS 'Event/activity system mapping the recovery chronological lifecycle.';

-- Strategic milestones executed under the campaign
CREATE TABLE recovery_actions (
    action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recovery_id UUID NOT NULL REFERENCES recoveries(recovery_id) ON DELETE CASCADE,
    strategy_id VARCHAR(50) NOT NULL REFERENCES recovery_strategies(strategy_id) ON DELETE RESTRICT,
    action_type VARCHAR(100) NOT NULL, -- e.g. RECOVERY_LINK_GENERATED, DELAYED_RETRY_SCHEDULED
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED')),
    attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
    metadata JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE recovery_actions IS 'Log of strategic steps attempted by the workflow engine (e.g. retries, manual reviews).';

-- Secure, temporary customer-facing links
CREATE TABLE recovery_links (
    recovery_link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recovery_id UUID NOT NULL REFERENCES recoveries(recovery_id) ON DELETE CASCADE,
    secure_token VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'USED', 'INVALIDATED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    opened_at TIMESTAMPTZ,
    used_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,
    invalidation_reason TEXT,
    CONSTRAINT chk_link_expiry CHECK (expires_at > created_at)
);

COMMENT ON TABLE recovery_links IS 'Customer recovery page URLs holding cryptographically secure validation tokens.';

-- Multi-channel outreach history
CREATE TABLE customer_notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recovery_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('SMS', 'EMAIL', 'WHATSAPP')),
    message_template_ref VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'OPENED', 'FAILED')),
    attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Composite foreign key guarantees that customer_id matches the customer_id of the linked recovery campaign
    FOREIGN KEY (recovery_id, customer_id) REFERENCES recoveries(recovery_id, customer_id) ON DELETE CASCADE
);

COMMENT ON TABLE customer_notifications IS 'Record of notifications sent via communication providers to customers.';

-- Transaction attempts initiated specifically during recovery campaigns
CREATE TABLE recovery_payment_attempts (
    attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recovery_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    payment_method_id VARCHAR(50) NOT NULL REFERENCES payment_methods(payment_method_id) ON DELETE RESTRICT,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED')),
    provider_name VARCHAR(100), -- e.g. Razorpay, Stripe, Paytm
    provider_transaction_id VARCHAR(255),
    provider_status VARCHAR(100),
    idempotency_key VARCHAR(255) NOT NULL UNIQUE, -- prevents double billing
    error_code VARCHAR(100),
    error_message TEXT,
    environment VARCHAR(20) NOT NULL DEFAULT 'LIVE' CHECK (environment IN ('LIVE', 'TEST', 'SIMULATION')),
    simulation_session_id UUID REFERENCES simulation_sessions(session_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    -- Composite foreign key guarantees that customer_id matches the customer_id of the linked recovery campaign
    FOREIGN KEY (recovery_id, customer_id) REFERENCES recoveries(recovery_id, customer_id) ON DELETE CASCADE,
    CONSTRAINT chk_attempt_simulation_session CHECK (
        (environment = 'SIMULATION' AND simulation_session_id IS NOT NULL) OR
        (environment IN ('LIVE', 'TEST') AND simulation_session_id IS NULL)
    )
);

COMMENT ON TABLE recovery_payment_attempts IS 'Details payment retry actions. Never overwrites the original failed payment.';

-- Final verification check validating gateway state (One attempt can have multiple verifications)
CREATE TABLE payment_verifications (
    verification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_attempt_id UUID NOT NULL REFERENCES recovery_payment_attempts(attempt_id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'FAILED')),
    verification_attempt INTEGER NOT NULL DEFAULT 1 CHECK (verification_attempt > 0),
    provider_reference VARCHAR(255),
    verified_at TIMESTAMPTZ,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE payment_verifications IS 'Verifies the final settlement of recovery payment attempts with gateway providers.';

-- =========================================================================
-- 7. AUDITING AND LOGGING
-- =========================================================================

-- Complete audit history of administrative changes
CREATE TABLE audit_logs (
    audit_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID REFERENCES merchants(merchant_id) ON DELETE SET NULL,
    actor VARCHAR(255) NOT NULL, -- e.g. system email, cron name, merchant operator
    action VARCHAR(100) NOT NULL, -- e.g. POLICY_UPDATE, MANUAL_RETRY, CANCEL_RECOVERY
    entity_name VARCHAR(100) NOT NULL, -- e.g. merchant_policies, recoveries
    entity_id UUID NOT NULL,
    pre_values JSONB, -- state before edit
    post_values JSONB, -- state after edit
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE audit_logs IS 'Traceability log tracking administrative actions and system recovery settings adjustments.';

-- =========================================================================
-- 8. INDEXES FOR PERFORMANCE AND FAST LOOKUP
-- =========================================================================

-- Foreign keys and joins lookup efficiency
CREATE INDEX idx_customers_merchant ON customers(merchant_id);
CREATE INDEX idx_merchant_policies_merchant ON merchant_policies(merchant_id);
CREATE INDEX idx_simulation_sessions_merchant ON simulation_sessions(merchant_id);
CREATE INDEX idx_payments_merchant_customer ON payments(merchant_id, customer_id);
CREATE INDEX idx_recoveries_payment ON recoveries(payment_id);
CREATE INDEX idx_recoveries_merchant_customer ON recoveries(merchant_id, customer_id);
CREATE INDEX idx_recovery_events_recovery ON recovery_events(recovery_id);
CREATE INDEX idx_recovery_actions_recovery ON recovery_actions(recovery_id);
CREATE INDEX idx_recovery_links_recovery ON recovery_links(recovery_id);
CREATE INDEX idx_customer_notifications_recovery ON customer_notifications(recovery_id);
CREATE INDEX idx_recovery_payment_attempts_recovery ON recovery_payment_attempts(recovery_id);
CREATE INDEX idx_payment_verifications_attempt ON payment_verifications(payment_attempt_id);
CREATE INDEX idx_audit_logs_merchant ON audit_logs(merchant_id);

-- Dashboard aggregations and analytical search
CREATE INDEX idx_payments_env_status ON payments(environment, status);
CREATE INDEX idx_recoveries_env_status_stage ON recoveries(environment, status, current_stage);
CREATE INDEX idx_recovery_payment_attempts_env_status ON recovery_payment_attempts(environment, status);
CREATE INDEX idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX idx_recoveries_created_at ON recoveries(created_at DESC);
CREATE INDEX idx_recovery_events_created_at ON recovery_events(created_at ASC);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
