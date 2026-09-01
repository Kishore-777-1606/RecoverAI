-- RecoverAI Idempotent Seed Script
-- Safely re-runnable by clearing existing tables in reverse dependency order.

-- =========================================================================
-- 0. TEARDOWN (Clean slate for seeding)
-- =========================================================================
DELETE FROM audit_logs;
DELETE FROM payment_verifications;
DELETE FROM recovery_payment_attempts;
DELETE FROM customer_notifications;
DELETE FROM recovery_links;
DELETE FROM recovery_actions;
DELETE FROM recovery_events;
DELETE FROM recoveries;
DELETE FROM payments;
DELETE FROM simulation_sessions;
DELETE FROM policy_channels;
DELETE FROM policy_strategies;
DELETE FROM policy_failure_rules;
DELETE FROM merchant_policies;
DELETE FROM customers;
DELETE FROM merchants;
DELETE FROM recovery_strategies;
DELETE FROM failure_types;
DELETE FROM payment_methods;

-- =========================================================================
-- 1. LOOKUP DATA SEEDING
-- =========================================================================

-- Payment Methods
INSERT INTO payment_methods (payment_method_id, name, is_active) VALUES
('UPI', 'Unified Payments Interface (UPI)', TRUE),
('CARD', 'Credit / Debit Card', TRUE),
('NET_BANKING', 'Net Banking', TRUE),
('WALLET', 'Digital Wallet', TRUE);

-- Failure Types
INSERT INTO failure_types (failure_type_id, category, name, description) VALUES
('INSUFFICIENT_FUNDS', 'FUNDING', 'Insufficient Funds', 'The customer account has insufficient balance to complete the transaction.'),
('CARD_DECLINED', 'FUNDING', 'Card Declined', 'The card issuer declined the payment, possibly due to limits or incorrect details.'),
('TEMPORARY_BANK_ISSUE', 'TECHNICAL', 'Temporary Bank Issue', 'The customer bank portal or switch is currently down.'),
('NETWORK_ERROR', 'TECHNICAL', 'Network Error', 'Network timeout between the payment gateway and bank networks.'),
('UPI_TIMEOUT', 'TIMEOUT', 'UPI Timeout', 'The UPI collect request was not approved by the customer within the designated time limit.'),
('AUTHENTICATION_FAILED', 'FRAUD', 'Authentication Failed', 'Incorrect OTP, 3D Secure verification, or UPI PIN.'),
('FRAUD_BLOCK', 'FRAUD', 'Fraud / Risk Block', 'The transaction was blocked by the gateway risk engine due to suspicious activity.'),
('OTHER_UNKNOWN', 'UNKNOWN', 'Other / Unknown', 'Unclassified or generic gateway decline error.');

-- Recovery Strategies
INSERT INTO recovery_strategies (strategy_id, name, description, is_active) VALUES
('RECOVERY_LINK', 'Recovery Link Outreach', 'Generates a secure checkout link and contacts the customer via SMS, Email, or WhatsApp.', TRUE),
('DELAYED_RETRY', 'Smart Delayed Retry', 'Schedule background transactions at a calculated peak success window (e.g. salary days, business hours).', TRUE),
('CUSTOMER_REMINDER', 'Outreach Reminder', 'Send localized push alerts or follow-up messaging without generating new checkout tokens.', TRUE),
('MANUAL_REVIEW', 'Manual Support Review', 'Escalate high-value failures to customer success teams for direct personal handling.', TRUE);

-- =========================================================================
-- 2. MERCHANTS AND CUSTOMERS
-- =========================================================================

-- Merchants
-- Tenant A: Acme Tech Solutions (Main Demo)
-- Tenant B: PayFast India (Secondary)
INSERT INTO merchants (merchant_id, name, email, phone) VALUES
('d9b04245-c1e1-455f-bb54-df25c3453b3f', 'Acme Tech Solutions Private Limited', 'billing@acmetech.in', '+91 98765 43210'),
('e39c4a55-0818-47e2-8959-1e18cfbf44a1', 'PayFast India', 'support@payfast.co.in', '+91 99999 88888');

-- Customers (Belonging to Acme Tech Solutions)
INSERT INTO customers (customer_id, merchant_id, name, email, phone, status) VALUES
('a1c87a55-27a3-4889-8d7a-7db69b4e3112', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'Kishore Kumar', 'kishore@gmail.com', '+91 91234 56789', 'ACTIVE'),
('b38a7ccb-449e-4e4c-8bb2-901d1d8cf4b1', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'Aarav Mehta', 'aarav.mehta@yahoo.com', '+91 98123 45678', 'ACTIVE'),
('c8901aa8-2ef2-4876-96db-a2d989f66718', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'Priya Sharma', 'priya.sharma@outlook.com', '+91 97777 66666', 'ACTIVE'),
('d4567bb8-55cc-44ee-aa88-00a87fbbd512', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'Ananya Sen', 'ananya.sen@gmail.com', '+91 96666 55555', 'ACTIVE'),
('e6789cc9-66dd-44ff-bb99-11b98fccd623', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'Rohan Das', 'rohan.das@hotmail.com', '+91 95555 44444', 'SUSPENDED');

-- =========================================================================
-- 3. MERCHANT POLICIES
-- =========================================================================

-- Acme Tech Solutions Default Policy
INSERT INTO merchant_policies (policy_id, merchant_id, name, is_active, auto_recovery_enabled, max_amount_limit, approval_threshold, quiet_hours_enabled, quiet_hours_start, quiet_hours_end) VALUES
('f5b9d311-6677-4402-990a-a829f0322ba1', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'Standard Enterprise Recovery Policy', TRUE, TRUE, 100000.00, 20000.00, TRUE, '22:00:00', '08:00:00');

-- Acme Policy Failure Rules
-- Exclude Fraud Blocks from Auto Recovery
INSERT INTO policy_failure_rules (policy_id, failure_type_id, is_eligible) VALUES
('f5b9d311-6677-4402-990a-a829f0322ba1', 'INSUFFICIENT_FUNDS', TRUE),
('f5b9d311-6677-4402-990a-a829f0322ba1', 'CARD_DECLINED', TRUE),
('f5b9d311-6677-4402-990a-a829f0322ba1', 'TEMPORARY_BANK_ISSUE', TRUE),
('f5b9d311-6677-4402-990a-a829f0322ba1', 'NETWORK_ERROR', TRUE),
('f5b9d311-6677-4402-990a-a829f0322ba1', 'UPI_TIMEOUT', TRUE),
('f5b9d311-6677-4402-990a-a829f0322ba1', 'AUTHENTICATION_FAILED', TRUE),
('f5b9d311-6677-4402-990a-a829f0322ba1', 'OTHER_UNKNOWN', TRUE),
('f5b9d311-6677-4402-990a-a829f0322ba1', 'FRAUD_BLOCK', FALSE); -- Excluded (Risk/Fraud requires manual intervention)

-- Acme Policy Strategies priorities and settings
INSERT INTO policy_strategies (policy_id, strategy_id, priority, is_enabled, max_outreach_attempts, min_interval_seconds) VALUES
('f5b9d311-6677-4402-990a-a829f0322ba1', 'RECOVERY_LINK', 1, TRUE, 3, 3600),
('f5b9d311-6677-4402-990a-a829f0322ba1', 'DELAYED_RETRY', 2, TRUE, 2, 7200),
('f5b9d311-6677-4402-990a-a829f0322ba1', 'CUSTOMER_REMINDER', 3, TRUE, 3, 10800),
('f5b9d311-6677-4402-990a-a829f0322ba1', 'MANUAL_REVIEW', 4, TRUE, 1, 86400);

-- Acme Policy Outreach Channels
INSERT INTO policy_channels (policy_id, channel, is_enabled) VALUES
('f5b9d311-6677-4402-990a-a829f0322ba1', 'SMS', TRUE),
('f5b9d311-6677-4402-990a-a829f0322ba1', 'EMAIL', TRUE),
('f5b9d311-6677-4402-990a-a829f0322ba1', 'WHATSAPP', TRUE);

-- =========================================================================
-- 4. BASE PAYMENTS (Successes & Historical Failures)
-- =========================================================================

-- Successful Base Payment (Normal transaction audit path)
INSERT INTO payments (payment_id, merchant_id, customer_id, payment_method_id, amount, currency, status, external_reference, provider_event_id, environment, created_at, updated_at, successful_at) VALUES
('10101010-1010-1010-1010-101010101010', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'a1c87a55-27a3-4889-8d7a-7db69b4e3112', 'UPI', 5000.00, 'INR', 'SUCCESSFUL', 'PAY_TXN_SUCCESS_991', 'evt_rzr_100128', 'LIVE', '2026-08-28 09:00:00+05:30', '2026-08-28 09:01:00+05:30', '2026-08-28 09:01:00+05:30');

-- Payment A: Failed due to Insufficient Funds (Recovered Case)
INSERT INTO payments (payment_id, merchant_id, customer_id, payment_method_id, amount, currency, status, failure_type_id, failure_message, external_reference, provider_event_id, environment, created_at, updated_at, failed_at) VALUES
('20202020-2020-2020-2020-202020202020', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'a1c87a55-27a3-4889-8d7a-7db69b4e3112', 'CARD', 12450.00, 'INR', 'FAILED', 'INSUFFICIENT_FUNDS', 'Decline code 51: Insufficient funds in credit account', 'PAY_TXN_FAIL_001', 'evt_rzr_100234', 'LIVE', '2026-08-28 10:00:00+05:30', '2026-08-28 10:00:05+05:30', '2026-08-28 10:00:05+05:30');

-- Payment B: Failed due to UPI Timeout (In-Progress Case)
INSERT INTO payments (payment_id, merchant_id, customer_id, payment_method_id, amount, currency, status, failure_type_id, failure_message, external_reference, provider_event_id, environment, created_at, updated_at, failed_at) VALUES
('30303030-3030-3030-3030-303030303030', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'b38a7ccb-449e-4e4c-8bb2-901d1d8cf4b1', 'UPI', 8500.00, 'INR', 'FAILED', 'UPI_TIMEOUT', 'Expired: Customer failed to accept collect request in 5 mins', 'PAY_TXN_FAIL_002', 'evt_rzr_100345', 'LIVE', '2026-08-28 11:00:00+05:30', '2026-08-28 11:05:00+05:30', '2026-08-28 11:05:00+05:30');

-- Payment C: Failed due to Temporary Bank Issue (Pending Approval Case: High Value > ₹20k)
INSERT INTO payments (payment_id, merchant_id, customer_id, payment_method_id, amount, currency, status, failure_type_id, failure_message, external_reference, provider_event_id, environment, created_at, updated_at, failed_at) VALUES
('40404040-4040-4040-4040-404040404040', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'c8901aa8-2ef2-4876-96db-a2d989f66718', 'NET_BANKING', 25000.00, 'INR', 'FAILED', 'TEMPORARY_BANK_ISSUE', 'Internal gateway communication failure (500)', 'PAY_TXN_FAIL_003', 'evt_rzr_100456', 'LIVE', '2026-08-28 12:00:00+05:30', '2026-08-28 12:00:10+05:30', '2026-08-28 12:00:10+05:30');

-- Payment D: Failed due to Fraud Block (Not Recoverable Case)
INSERT INTO payments (payment_id, merchant_id, customer_id, payment_method_id, amount, currency, status, failure_type_id, failure_message, external_reference, provider_event_id, environment, created_at, updated_at, failed_at) VALUES
('50505050-5050-5050-5050-505050505050', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'd4567bb8-55cc-44ee-aa88-00a87fbbd512', 'CARD', 42000.00, 'INR', 'FAILED', 'FRAUD_BLOCK', 'Blocked: High risk IP-Card discrepancy flagged', 'PAY_TXN_FAIL_004', 'evt_rzr_100567', 'LIVE', '2026-08-28 13:00:00+05:30', '2026-08-28 13:00:02+05:30', '2026-08-28 13:00:02+05:30');

-- Payment E: Failed due to Card Decline (Expired Recovery Case)
INSERT INTO payments (payment_id, merchant_id, customer_id, payment_method_id, amount, currency, status, failure_type_id, failure_message, external_reference, provider_event_id, environment, created_at, updated_at, failed_at) VALUES
('60606060-6060-6060-6060-606060606060', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'e6789cc9-66dd-44ff-bb99-11b98fccd623', 'CARD', 15000.00, 'INR', 'FAILED', 'CARD_DECLINED', 'Decline: Do not honor (stolen card flag)', 'PAY_TXN_FAIL_005', 'evt_rzr_100678', 'LIVE', '2026-08-28 01:00:00+05:30', '2026-08-28 01:00:05+05:30', '2026-08-28 01:00:05+05:30');

-- Payment F: Failed with Unknown Reason
INSERT INTO payments (payment_id, merchant_id, customer_id, payment_method_id, amount, currency, status, failure_type_id, failure_message, external_reference, provider_event_id, environment, created_at, updated_at, failed_at) VALUES
('70707070-7070-7070-7070-707070707070', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'a1c87a55-27a3-4889-8d7a-7db69b4e3112', 'UPI', 2000.00, 'INR', 'FAILED', 'OTHER_UNKNOWN', 'Unknown Gateway Error: contact system support', 'PAY_TXN_FAIL_006', 'evt_rzr_100789', 'LIVE', '2026-08-28 14:00:00+05:30', '2026-08-28 14:00:10+05:30', '2026-08-28 14:00:10+05:30');

-- =========================================================================
-- 5. RECOVERY CAMPAIGNS (payment_status column set to 'FAILED')
-- =========================================================================

-- Recovery A: Recovered (linked to Payment A)
INSERT INTO recoveries (recovery_id, payment_id, customer_id, merchant_id, payment_status, status, current_stage, ai_recommended_strategy_id, ai_confidence_score, ai_recommended_timing, ai_explanation, ai_failure_classification, selected_strategy_id, amount, created_at, updated_at, completed_at) VALUES
('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', '20202020-2020-2020-2020-202020202020', 'a1c87a55-27a3-4889-8d7a-7db69b4e3112', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'FAILED', 'RECOVERED', 'COMPLETED', 'RECOVERY_LINK', 85.50, '2026-08-28 10:05:00+05:30', 'AI predicted high probability of recovery via link since client is active and was insufficient funding.', 'FUNDING_LACK', 'RECOVERY_LINK', 12450.00, '2026-08-28 10:02:00+05:30', '2026-08-28 10:15:30+05:30', '2026-08-28 10:15:30+05:30');

-- Recovery B: In Progress (linked to Payment B)
INSERT INTO recoveries (recovery_id, payment_id, customer_id, merchant_id, payment_status, status, current_stage, ai_recommended_strategy_id, ai_confidence_score, ai_recommended_timing, ai_explanation, ai_failure_classification, selected_strategy_id, amount, created_at, updated_at, expires_at) VALUES
('b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0a0a0', '30303030-3030-3030-3030-303030303030', 'b38a7ccb-449e-4e4c-8bb2-901d1d8cf4b1', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'FAILED', 'IN_PROGRESS', 'OUTREACH', 'RECOVERY_LINK', 62.00, '2026-08-28 11:10:00+05:30', 'AI suggests SMS/WhatsApp recovery link. Client timed out on phone.', 'TIMEOUT_DEVICE', 'RECOVERY_LINK', 8500.00, '2026-08-28 11:06:00+05:30', '2026-08-28 11:07:00+05:30', '2026-08-29 11:06:00+05:30');

-- Recovery C: Awaiting Approval (linked to Payment C: High Value > ₹20k threshold)
INSERT INTO recoveries (recovery_id, payment_id, customer_id, merchant_id, payment_status, status, current_stage, ai_recommended_strategy_id, ai_confidence_score, ai_recommended_timing, ai_explanation, ai_failure_classification, selected_strategy_id, approval_required, amount, created_at, updated_at) VALUES
('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0a0a0', '40404040-4040-4040-4040-404040404040', 'c8901aa8-2ef2-4876-96db-a2d989f66718', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'FAILED', 'IN_PROGRESS', 'ANALYSIS', 'DELAYED_RETRY', 78.00, '2026-08-28 14:00:00+05:30', 'Technical error; retry in 2 hours recommended. Amount requires explicit approval.', 'TECHNICAL_GATEWAY', 'DELAYED_RETRY', TRUE, 25000.00, '2026-08-28 12:05:00+05:30', '2026-08-28 12:05:00+05:30');

-- Recovery D: Cancelled/Not Recoverable due to policy exclusion (linked to Payment D)
INSERT INTO recoveries (recovery_id, payment_id, customer_id, merchant_id, payment_status, status, current_stage, ai_recommended_strategy_id, ai_confidence_score, ai_explanation, ai_failure_classification, amount, created_at, updated_at, cancelled_at, cancellation_reason) VALUES
('d0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0a0a0', '50505050-5050-5050-5050-505050505050', 'd4567bb8-55cc-44ee-aa88-00a87fbbd512', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'FAILED', 'NOT_RECOVERABLE', 'COMPLETED', 'MANUAL_REVIEW', 10.00, 'Risky transaction flagged. Auto-recovery skipped.', 'FRAUD_RISK_SHIELD', 42000.00, '2026-08-28 13:02:00+05:30', '2026-08-28 13:03:00+05:30', '2026-08-28 13:03:00+05:30', 'Excluded by policy rules (FRAUD_BLOCK)');

-- Recovery E: Expired Campaign (linked to Payment E)
INSERT INTO recoveries (recovery_id, payment_id, customer_id, merchant_id, payment_status, status, current_stage, selected_strategy_id, amount, created_at, updated_at, completed_at, expires_at) VALUES
('e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0a0a0', '60606060-6060-6060-6060-606060606060', 'e6789cc9-66dd-44ff-bb99-11b98fccd623', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'FAILED', 'EXPIRED', 'COMPLETED', 'RECOVERY_LINK', 15000.00, '2026-08-27 10:00:00+05:30', '2026-08-28 10:00:00+05:30', '2026-08-28 10:00:00+05:30', '2026-08-28 10:00:00+05:30');

-- Recovery F: Failed Campaign (linked to Payment F)
INSERT INTO recoveries (recovery_id, payment_id, customer_id, merchant_id, payment_status, status, current_stage, selected_strategy_id, amount, created_at, updated_at, completed_at) VALUES
('f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0', '70707070-7070-7070-7070-707070707070', 'a1c87a55-27a3-4889-8d7a-7db69b4e3112', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'FAILED', 'FAILED', 'COMPLETED', 'DELAYED_RETRY', 2000.00, '2026-08-28 14:02:00+05:30', '2026-08-28 14:15:00+05:30', '2026-08-28 14:15:00+05:30');


-- =========================================================================
-- 6. TIMELINE EVENTS AND OPERATIONAL ACTIONS
-- =========================================================================

-- Events for Recovery A (Chronological Timeline)
INSERT INTO recovery_events (event_id, recovery_id, event_type, event_status, description, actor, created_at) VALUES
('e1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'PAYMENT_FAILED', 'COMPLETED', 'Base payment failed due to Insufficient Funds (₹12,450.00)', 'SYSTEM', '2026-08-28 10:00:05+05:30'),
('e2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'RECOVERY_OPPORTUNITY_CREATED', 'COMPLETED', 'Recovery opportunity recognized and initialized.', 'SYSTEM', '2026-08-28 10:02:00+05:30'),
('e3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'ANALYSIS_COMPLETED', 'SUCCESS', 'AI analyzed failure. Recommended RECOVERY_LINK with 85.5% confidence.', 'AI_ENGINE', '2026-08-28 10:02:10+05:30'),
('e4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'RECOVERY_LINK_GENERATED', 'SUCCESS', 'Secure checkout link created.', 'SYSTEM', '2026-08-28 10:03:00+05:30'),
('e5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'LINK_SENT', 'SUCCESS', 'Recovery outreach sent to Kishore Kumar via WhatsApp.', 'SYSTEM', '2026-08-28 10:03:15+05:30'),
('e6a6a6a6-a6a6-a6a6-a6a6-a6a6a6a6a6a6', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'LINK_OPENED', 'SUCCESS', 'Customer opened the recovery link from phone.', 'CUSTOMER', '2026-08-28 10:10:00+05:30'),
('e7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'PAYMENT_ATTEMPTED', 'SUCCESS', 'Recovery payment attempt initiated by customer using UPI.', 'CUSTOMER', '2026-08-28 10:12:00+05:30'),
('e8a8a8a8-a8a8-a8a8-a8a8-a8a8a8a8a8a8', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'VERIFICATION_COMPLETED', 'SUCCESS', 'Payment verified successfully with Razorpay.', 'SYSTEM', '2026-08-28 10:15:30+05:30'),
('e9a9a9a9-a9a9-a9a9-a9a9-a9a9a9a9a9a9', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'RECOVERY_COMPLETED', 'SUCCESS', 'Recovery campaign closed successfully.', 'SYSTEM', '2026-08-28 10:15:35+05:30');

-- Actions for Recovery A
INSERT INTO recovery_actions (action_id, recovery_id, strategy_id, action_type, status, attempt_number, created_at, updated_at) VALUES
('aa11aa11-1111-1111-1111-111111111111', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'RECOVERY_LINK', 'RECOVERY_LINK_GENERATED', 'SUCCESS', 1, '2026-08-28 10:03:00+05:30', '2026-08-28 10:03:00+05:30'),
('aa22aa22-2222-2222-2222-222222222222', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'RECOVERY_LINK', 'RECOVERY_LINK_OUTREACH', 'SUCCESS', 1, '2026-08-28 10:03:15+05:30', '2026-08-28 10:03:30+05:30');

-- Recovery Links (Recovery A)
INSERT INTO recovery_links (recovery_link_id, recovery_id, secure_token, status, created_at, expires_at, opened_at, used_at) VALUES
('a1111111-1111-1111-1111-111111111111', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'tok_acme_secure_9012351', 'USED', '2026-08-28 10:03:00+05:30', '2026-08-29 10:03:00+05:30', '2026-08-28 10:10:00+05:30', '2026-08-28 10:12:00+05:30');

-- Notifications (Recovery A - Multiple attempts demo)
INSERT INTO customer_notifications (notification_id, recovery_id, customer_id, channel, message_template_ref, status, attempt_number, sent_at, delivered_at, opened_at) VALUES
('b1111111-1111-1111-1111-111111111111', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'a1c87a55-27a3-4889-8d7a-7db69b4e3112', 'SMS', 'sms_payment_failed_alert', 'FAILED', 1, '2026-08-28 10:02:15+05:30', NULL, NULL), -- failed due to network provider issue
('b2222222-2222-2222-2222-222222222222', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'a1c87a55-27a3-4889-8d7a-7db69b4e3112', 'WHATSAPP', 'wa_recovery_link_delivery', 'OPENED', 1, '2026-08-28 10:03:15+05:30', '2026-08-28 10:03:20+05:30', '2026-08-28 10:10:00+05:30');

-- Recovery Payment Attempt for A (Customer payment attempt)
INSERT INTO recovery_payment_attempts (attempt_id, recovery_id, customer_id, payment_method_id, amount, currency, status, provider_name, provider_transaction_id, idempotency_key, environment, created_at, completed_at) VALUES
('aa33aa33-3333-3333-3333-333333333333', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'a1c87a55-27a3-4889-8d7a-7db69b4e3112', 'UPI', 12450.00, 'INR', 'SUCCESSFUL', 'Razorpay', 'pay_rzr_998132', 'idem_key_acme_28318_1012', 'LIVE', '2026-08-28 10:12:00+05:30', '2026-08-28 10:15:00+05:30');

-- Verification of Payment Attempt A (Multiple verifications possible - retried demo)
INSERT INTO payment_verifications (verification_id, payment_attempt_id, status, verification_attempt, provider_reference, verified_at, failure_reason) VALUES
('f1111111-1111-1111-1111-111111111111', 'aa33aa33-3333-3333-3333-333333333333', 'FAILED', 1, NULL, NULL, 'Gateway signature verification timeout'),
('f2222222-2222-2222-2222-222222222222', 'aa33aa33-3333-3333-3333-333333333333', 'VERIFIED', 2, 'razorpay_ref_998132_settled', '2026-08-28 10:15:30+05:30', NULL);


-- Events for Recovery B (Active campaign)
INSERT INTO recovery_events (event_id, recovery_id, event_type, event_status, description, actor, created_at) VALUES
('e1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0a0a0', 'PAYMENT_FAILED', 'COMPLETED', 'Base payment failed due to UPI Timeout (₹8,500.00)', 'SYSTEM', '2026-08-28 11:05:00+05:30'),
('e2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0a0a0', 'RECOVERY_OPPORTUNITY_CREATED', 'COMPLETED', 'Recovery opportunity recognized.', 'SYSTEM', '2026-08-28 11:06:00+05:30'),
('e3b3b3b3-b3b3-b3b3-b3b3-b3b3b3b3b3b3', 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0a0a0', 'LINK_SENT', 'SUCCESS', 'Recovery outreach SMS sent to Aarav Mehta.', 'SYSTEM', '2026-08-28 11:07:00+05:30');

-- Notifications for Recovery B
INSERT INTO customer_notifications (notification_id, recovery_id, customer_id, channel, message_template_ref, status, attempt_number, sent_at, delivered_at) VALUES
('b3333333-3333-3333-3333-333333333333', 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0a0a0', 'b38a7ccb-449e-4e4c-8bb2-901d1d8cf4b1', 'SMS', 'sms_payment_retry_direct', 'DELIVERED', 1, '2026-08-28 11:07:00+05:30', '2026-08-28 11:07:15+05:30');


-- =========================================================================
-- 7. SIMULATION SCENARIO RECORDS (Payment & Recovery Simulator Runs)
-- =========================================================================

-- Simulation Session Grouping
INSERT INTO simulation_sessions (session_id, merchant_id, name, status, created_at, updated_at) VALUES
('ee601f01-77d0-4bf6-9611-9e7d959550bb', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'Demo Dashboard UPI Timeout Simulation', 'COMPLETED', '2026-08-28 14:10:00+05:30', '2026-08-28 14:20:00+05:30');

-- Simulated Payment Fail
INSERT INTO payments (payment_id, merchant_id, customer_id, payment_method_id, amount, currency, status, failure_type_id, failure_message, external_reference, provider_event_id, environment, simulation_session_id, created_at, updated_at, failed_at) VALUES
('f1f1f1f1-1111-1111-1111-111111111111', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'b38a7ccb-449e-4e4c-8bb2-901d1d8cf4b1', 'UPI', 1500.00, 'INR', 'FAILED', 'UPI_TIMEOUT', '[SIMULATED] Timeout simulator hook triggered', 'SIM_TXN_REF_8091', 'evt_rzr_sim_0012', 'SIMULATION', 'ee601f01-77d0-4bf6-9611-9e7d959550bb', '2026-08-28 14:11:00+05:30', '2026-08-28 14:11:05+05:30', '2026-08-28 14:11:05+05:30');

-- Simulated Recovery Run (succeeded)
INSERT INTO recoveries (recovery_id, payment_id, customer_id, merchant_id, payment_status, status, current_stage, selected_strategy_id, amount, environment, simulation_session_id, created_at, updated_at, completed_at) VALUES
('f2f2f2f2-2222-2222-2222-222222222222', 'f1f1f1f1-1111-1111-1111-111111111111', 'b38a7ccb-449e-4e4c-8bb2-901d1d8cf4b1', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'FAILED', 'RECOVERED', 'COMPLETED', 'RECOVERY_LINK', 1500.00, 'SIMULATION', 'ee601f01-77d0-4bf6-9611-9e7d959550bb', '2026-08-28 14:11:30+05:30', '2026-08-28 14:20:00+05:30', '2026-08-28 14:20:00+05:30');

-- Simulated Recovery Event
INSERT INTO recovery_events (event_id, recovery_id, event_type, event_status, description, actor, created_at) VALUES
('f3f3f3f3-3333-3333-3333-333333333333', 'f2f2f2f2-2222-2222-2222-222222222222', 'SIMULATION_STARTED', 'SUCCESS', 'Simulation engine started execution', 'SYSTEM', '2026-08-28 14:11:30+05:30'),
('f4f4f4f4-4444-4444-4444-444444444444', 'f2f2f2f2-2222-2222-2222-222222222222', 'PAYMENT_ATTEMPTED', 'SUCCESS', 'Simulated customer recovery payment successfully processed', 'CUSTOMER', '2026-08-28 14:19:00+05:30');

-- Simulated Recovery Payment Attempt
INSERT INTO recovery_payment_attempts (attempt_id, recovery_id, customer_id, payment_method_id, amount, currency, status, provider_name, provider_transaction_id, idempotency_key, environment, simulation_session_id, created_at, completed_at) VALUES
('f5f5f5f5-5555-5555-5555-555555555555', 'f2f2f2f2-2222-2222-2222-222222222222', 'b38a7ccb-449e-4e4c-8bb2-901d1d8cf4b1', 'UPI', 1500.00, 'INR', 'SUCCESSFUL', 'Razorpay', 'sim_pay_rzr_90823', 'idem_key_sim_28390', 'SIMULATION', 'ee601f01-77d0-4bf6-9611-9e7d959550bb', '2026-08-28 14:19:00+05:30', '2026-08-28 14:19:30+05:30');

-- Simulated Verification
INSERT INTO payment_verifications (verification_id, payment_attempt_id, status, verification_attempt, provider_reference, verified_at) VALUES
('f6f6f6f6-6666-6666-6666-666666666666', 'f5f5f5f5-5555-5555-5555-555555555555', 'VERIFIED', 1, 'sim_verify_ref_882', '2026-08-28 14:19:30+05:30');

-- =========================================================================
-- 8. AUDIT LOG RECORDS
-- =========================================================================

-- Logs changes to merchant policies
INSERT INTO audit_logs (audit_log_id, merchant_id, actor, action, entity_name, entity_id, pre_values, post_values, ip_address) VALUES
('a01a01a0-1a01-1a01-1a01-1a01a01a01a0', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'admin_operator@acmetech.in', 'POLICY_UPDATE', 'merchant_policies', 'f5b9d311-6677-4402-990a-a829f0322ba1', '{"approval_threshold": 10000.00}', '{"approval_threshold": 20000.00}', '192.168.1.144'),
('a02a02a0-2a02-2a02-2a02-2a02a02a02a0', 'd9b04245-c1e1-455f-bb54-df25c3453b3f', 'system_scheduler', 'AUTO_EXPIRE_CAMPAIGN', 'recoveries', 'e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0a0a0', '{"status": "IN_PROGRESS"}', '{"status": "EXPIRED"}', '127.0.0.1');
