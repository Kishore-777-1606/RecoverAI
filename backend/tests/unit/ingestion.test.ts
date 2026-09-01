import assert from 'assert';
import { pool } from '../../database/connection';
import { processWebhook } from '../../ingestion/webhookService';
import { registerPaymentHandlers } from '../../ingestion/eventHandlers/paymentEventHandler';
import { registerRecoveryHandlers } from '../../ingestion/eventHandlers/recoveryEventHandler';
import { eventBus } from '../../ingestion/eventBus';
import * as paymentRepo from '../../database/repositories/paymentRepository';
import * as recoveryRepo from '../../database/repositories/recoveryRepository';
import * as policyRepo from '../../database/repositories/policyRepository';
import { generateUUID } from '../../shared/utils/id';
import * as recoveryService from '../../modules/recovery/recoveryService';
import { ValidationError } from '../../shared/errors/ValidationError';

// ============================================================================
// DATABASE AND EVENT BUS MOCK STATE
// ============================================================================

const mockPayments: Record<string, any> = {};
const mockPolicies: Record<string, any> = {};
const mockRecoveries: Record<string, any> = {};
const mockEvents: any[] = [];
const mockActions: any[] = [];
const mockAttempts: any[] = [];
const mockAuditLogs: any[] = [];

// Override pool connection client queries
const mockClient = {
  query: async (text: string, params?: any[]) => {
    return (pool as any).query(text, params);
  },
  release: () => {}
};

(pool as any).connect = async () => {
  return mockClient;
};

(pool as any).query = async (text: string, params?: any[]): Promise<any> => {
  const normalizedText = text.replace(/\s+/g, ' ').trim();

  // SELECT FROM audit_logs (idempotency check)
  if (normalizedText.includes("FROM audit_logs WHERE action = 'WEBHOOK_PROCESSED' AND entity_id = $1")) {
    const id = params ? params[0] : '';
    const exists = mockAuditLogs.some(log => log.action === 'WEBHOOK_PROCESSED' && log.entity_id === id);
    return { rowCount: exists ? 1 : 0, rows: exists ? [{}] : [] };
  }

  // INSERT INTO audit_logs
  if (normalizedText.includes('INSERT INTO audit_logs')) {
    const newLog = {
      audit_log_id: generateUUID(),
      merchant_id: params ? params[0] : null,
      actor: params ? params[1] : '',
      action: params ? params[2] : '',
      entity_name: params ? params[3] : '',
      entity_id: params ? params[4] : '',
      pre_values: params ? params[5] : null,
      post_values: params ? params[6] : null,
      ip_address: params ? params[7] : null,
      created_at: new Date()
    };
    mockAuditLogs.push(newLog);
    return { rowCount: 1, rows: [newLog] };
  }

  // SELECT FROM payments (find globally)
  if (normalizedText.includes('FROM payments WHERE external_reference = $1')) {
    const ref = params ? params[0] : '';
    const p = Object.values(mockPayments).find((x: any) => x.external_reference === ref);
    return { rowCount: p ? 1 : 0, rows: p ? [p] : [] };
  }

  // SELECT FROM payments (find by ID scoped)
  if (normalizedText.includes('FROM payments WHERE merchant_id = $1 AND payment_id = $2')) {
    const mId = params ? params[0] : '';
    const pId = params ? params[1] : '';
    const p = mockPayments[pId];
    if (p && p.merchant_id === mId) {
      return { rowCount: 1, rows: [p] };
    }
    return { rowCount: 0, rows: [] };
  }

  // UPDATE payments
  if (normalizedText.includes('UPDATE payments')) {
    const status = params ? params[0] : '';
    const failed_at = params ? params[1] : null;
    const successful_at = params ? params[2] : null;
    const failure_type_id = params ? params[3] : null;
    const failure_message = params ? params[4] : null;
    const provider_event_id = params ? params[5] : null;
    const mId = params ? params[6] : '';
    const pId = params ? params[7] : '';

    const p = mockPayments[pId];
    if (p && p.merchant_id === mId) {
      p.status = status;
      p.failed_at = failed_at || p.failed_at;
      p.successful_at = successful_at || p.successful_at;
      p.failure_type_id = failure_type_id || p.failure_type_id;
      p.failure_message = failure_message || p.failure_message;
      p.provider_event_id = provider_event_id || p.provider_event_id;
      return { rowCount: 1, rows: [p] };
    }
    return { rowCount: 0, rows: [] };
  }

  // SELECT FROM merchant_policies (Active policy query)
  if (normalizedText.includes('FROM merchant_policies') && normalizedText.includes('is_active = TRUE')) {
    const mId = params ? params[0] : '';
    const policy = mockPolicies[mId];
    if (policy && policy.is_active) {
      return { rowCount: 1, rows: [policy] };
    }
    return { rowCount: 0, rows: [] };
  }

  // SELECT rules/strategies/channels for active policy population
  if (normalizedText.includes('FROM policy_failure_rules') && normalizedText.includes('policy_id = $1')) {
    const policyId = params ? params[0] : '';
    const matchingPolicy = Object.values(mockPolicies).find((p: any) => p.policy_id === policyId);
    return { rowCount: matchingPolicy ? matchingPolicy.failure_rules.length : 0, rows: matchingPolicy ? matchingPolicy.failure_rules : [] };
  }

  if (normalizedText.includes('FROM policy_strategies') && normalizedText.includes('policy_id = $1')) {
    const policyId = params ? params[0] : '';
    const matchingPolicy = Object.values(mockPolicies).find((p: any) => p.policy_id === policyId);
    return { rowCount: matchingPolicy ? matchingPolicy.strategies.length : 0, rows: matchingPolicy ? matchingPolicy.strategies : [] };
  }

  if (normalizedText.includes('FROM policy_channels') && normalizedText.includes('policy_id = $1')) {
    const policyId = params ? params[0] : '';
    const matchingPolicy = Object.values(mockPolicies).find((p: any) => p.policy_id === policyId);
    return { rowCount: matchingPolicy ? matchingPolicy.channels.length : 0, rows: matchingPolicy ? matchingPolicy.channels : [] };
  }

  // SELECT FROM recoveries (By payment_id)
  if (normalizedText.includes('FROM recoveries') && normalizedText.includes('payment_id = $2')) {
    const mId = params ? params[0] : '';
    const pId = params ? params[1] : '';
    const rec = Object.values(mockRecoveries).find((r: any) => r.payment_id === pId && r.merchant_id === mId);
    return { rowCount: rec ? 1 : 0, rows: rec ? [rec] : [] };
  }

  // SELECT FROM recoveries (By ID)
  if (normalizedText.includes('FROM recoveries WHERE merchant_id = $1 AND recovery_id = $2')) {
    const mId = params ? params[0] : '';
    const rId = params ? params[1] : '';
    const rec = mockRecoveries[rId];
    if (rec && rec.merchant_id === mId) {
      return { rowCount: 1, rows: [rec] };
    }
    return { rowCount: 0, rows: [] };
  }

  // INSERT INTO recoveries
  if (normalizedText.includes('INSERT INTO recoveries')) {
    const newId = generateUUID();
    const newRec = {
      recovery_id: newId,
      payment_id: params ? params[0] : '',
      merchant_id: params ? params[1] : '',
      customer_id: params ? params[2] : '',
      payment_status: 'FAILED',
      status: 'IN_PROGRESS',
      current_stage: 'ANALYSIS',
      ai_recommended_strategy_id: params ? params[3] : null,
      ai_confidence_score: params ? params[4] : null,
      ai_recommended_timing: params ? params[5] : null,
      ai_explanation: params ? params[6] : null,
      ai_failure_classification: params ? params[7] : null,
      selected_strategy_id: params ? params[8] : null,
      approval_required: params ? params[9] : false,
      amount: params ? params[11] : '',
      environment: params ? params[12] : 'LIVE',
      created_at: new Date(),
      updated_at: new Date()
    };
    mockRecoveries[newId] = newRec;
    return { rowCount: 1, rows: [newRec] };
  }

  // UPDATE recoveries
  if (normalizedText.includes('UPDATE recoveries')) {
    const status = params ? params[0] : null;
    const current_stage = params ? params[1] : null;
    const mId = params ? params[7] : '';
    const rId = params ? params[8] : '';
    const rec = mockRecoveries[rId];
    if (rec && rec.merchant_id === mId) {
      rec.status = status || rec.status;
      rec.current_stage = current_stage || rec.current_stage;
      return { rowCount: 1, rows: [rec] };
    }
    return { rowCount: 0, rows: [] };
  }

  // INSERT INTO recovery_events
  if (normalizedText.includes('INSERT INTO recovery_events')) {
    const newEvent = {
      event_id: generateUUID(),
      recovery_id: params ? params[0] : '',
      event_type: params ? params[1] : '',
      event_status: params ? params[2] : '',
      description: params ? params[3] : '',
      actor: params ? params[5] : '',
      created_at: new Date()
    };
    mockEvents.push(newEvent);
    return { rowCount: 1, rows: [newEvent] };
  }

  // INSERT INTO recovery_actions
  if (normalizedText.includes('INSERT INTO recovery_actions')) {
    const newAction = {
      action_id: generateUUID(),
      recovery_id: params ? params[0] : '',
      strategy_id: params ? params[1] : '',
      action_type: params ? params[2] : '',
      status: params ? params[3] : 'PENDING',
      attempt_number: params ? params[4] : 1,
      metadata: params ? params[5] : null,
      error_message: params ? params[6] : null,
      created_at: new Date(),
      updated_at: new Date()
    };
    mockActions.push(newAction);
    return { rowCount: 1, rows: [newAction] };
  }

  // SELECT FROM recovery_payment_attempts
  if (normalizedText.includes('FROM recovery_payment_attempts WHERE recovery_id = $1')) {
    const rId = params ? params[0] : '';
    const atts = mockAttempts.filter((a: any) => a.recovery_id === rId);
    return { rowCount: atts.length, rows: atts };
  }

  // SELECT FROM recovery_actions
  if (normalizedText.includes('FROM recovery_actions WHERE recovery_id = $1')) {
    const rId = params ? params[0] : '';
    const acts = mockActions.filter((a: any) => a.recovery_id === rId);
    return { rowCount: acts.length, rows: acts };
  }

  return { rowCount: 0, rows: [] };
};

// ============================================================================
// TEST SUITE DEFINITIONS
// ============================================================================

async function runIngestionTests() {
  console.log('🔄 Running Webhook Ingestion & Orchestration Unit Tests...');
  let passedCount = 0;
  let failedCount = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`❌ ${name}`);
      console.error(err);
      failedCount++;
    }
  };

  // Setup handlers and clean eventBus registers
  eventBus.clear();
  registerPaymentHandlers();
  registerRecoveryHandlers();

  const merchantId = 'merch-acme';
  const customerId = 'cust-aarav';

  // Seed standard active policy
  const standardPolicy = {
    policy_id: 'policy-acme-01',
    merchant_id: merchantId,
    name: 'Acme Recovery Policy',
    is_active: true,
    auto_recovery_enabled: true,
    max_amount_limit: '10000.00',
    approval_threshold: '2000.00',
    quiet_hours_enabled: false,
    created_at: new Date(),
    updated_at: new Date(),
    failure_rules: [
      { policy_id: 'policy-acme-01', failure_type_id: 'INSUFFICIENT_FUNDS', is_eligible: true },
      { policy_id: 'policy-acme-01', failure_type_id: 'NETWORK_ERROR', is_eligible: true }
    ],
    strategies: [
      { policy_id: 'policy-acme-01', strategy_id: 'RECOVERY_LINK', priority: 1, is_enabled: true, max_outreach_attempts: 3, min_interval_seconds: 3600 }
    ],
    channels: [
      { policy_id: 'policy-acme-01', channel: 'SMS', is_enabled: true }
    ]
  };
  mockPolicies[merchantId] = standardPolicy;

  // Cleanup helper
  const cleanMocks = () => {
    Object.keys(mockPayments).forEach(k => delete mockPayments[k]);
    Object.keys(mockRecoveries).forEach(k => delete mockRecoveries[k]);
    mockEvents.length = 0;
    mockActions.length = 0;
    mockAttempts.length = 0;
    mockAuditLogs.length = 0;
  };

  // 1. New successful payment event
  await test('1. New successful payment event transitions payment to SUCCESSful', async () => {
    cleanMocks();
    const pId = 'pay-001';
    const extRef = 'ref-chk-001';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    const webhookBody = {
      event: 'payment.success',
      eventId: 'evt-succ-1',
      txnId: 'txn-gate-1',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR'
    };

    const res = await processWebhook('mock', webhookBody);
    assert.strictEqual(res.result, 'ACCEPTED');
    assert.strictEqual(mockPayments[pId].status, 'SUCCESSFUL');
  });

  // 2. New failed payment event
  await test('2. New failed payment event transitions payment status', async () => {
    cleanMocks();
    const pId = 'pay-002';
    const extRef = 'ref-chk-002';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    const webhookBody = {
      event: 'payment.failed',
      eventId: 'evt-fail-2',
      txnId: 'txn-gate-2',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR',
      failureCode: 'INSUFFICIENT_FUNDS',
      failureMessage: 'Card declined'
    };

    const res = await processWebhook('mock', webhookBody);
    assert.strictEqual(res.result, 'ACCEPTED');
    assert.strictEqual(mockPayments[pId].status, 'FAILED');
  });

  // 3. Failed payment triggers eligible recovery
  await test('3. Failed payment triggers eligible recovery creation and initialization action', async () => {
    cleanMocks();
    const pId = 'pay-003';
    const extRef = 'ref-chk-003';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    const webhookBody = {
      event: 'payment.failed',
      eventId: 'evt-fail-3',
      txnId: 'txn-gate-3',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR',
      failureCode: 'INSUFFICIENT_FUNDS'
    };

    await processWebhook('mock', webhookBody);

    // Verify recovery was created
    const createdRec = Object.values(mockRecoveries)[0] as any;
    assert.ok(createdRec);
    assert.strictEqual(createdRec.payment_id, pId);
    assert.strictEqual(createdRec.status, 'IN_PROGRESS');

    // Verify initial action was logged
    const initAction = mockActions.find(a => a.recovery_id === createdRec.recovery_id);
    assert.ok(initAction);
    assert.strictEqual(initAction.action_type, 'INITIALIZATION');
  });

  // 4. Failed payment blocked by policy
  await test('4. Failed payment blocked by policy max limits does not create campaign', async () => {
    cleanMocks();
    const pId = 'pay-004';
    const extRef = 'ref-chk-004';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      // Amount exceeds standardPolicy max limit of 10000
      amount: '15000.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    const webhookBody = {
      event: 'payment.failed',
      eventId: 'evt-fail-4',
      txnId: 'txn-gate-4',
      externalReference: extRef,
      amount: '15000.00',
      currency: 'INR',
      failureCode: 'INSUFFICIENT_FUNDS'
    };

    await processWebhook('mock', webhookBody);
    
    // Campaign should not be created
    assert.strictEqual(Object.keys(mockRecoveries).length, 0);
  });

  // 5. Successful payment never triggers recovery
  await test('5. Successful payment event never triggers recovery campaigns', async () => {
    cleanMocks();
    const pId = 'pay-005';
    const extRef = 'ref-chk-005';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    const webhookBody = {
      event: 'payment.success',
      eventId: 'evt-succ-5',
      txnId: 'txn-gate-5',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR'
    };

    await processWebhook('mock', webhookBody);
    assert.strictEqual(Object.keys(mockRecoveries).length, 0);
  });

  // 6. Duplicate webhook event
  await test('6. Duplicate webhook event id returns DUPLICATE processing status', async () => {
    cleanMocks();
    const pId = 'pay-006';
    const extRef = 'ref-chk-006';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    const webhookBody = {
      event: 'payment.success',
      eventId: 'evt-dup-6',
      txnId: 'txn-gate-6',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR'
    };

    // First call
    const firstRes = await processWebhook('mock', webhookBody);
    assert.strictEqual(firstRes.result, 'ACCEPTED');

    // Second call with same eventId
    const secondRes = await processWebhook('mock', webhookBody);
    assert.strictEqual(secondRes.result, 'DUPLICATE');
  });

  // 7. Duplicate failed event
  await test('7. Second failed event for already FAILED payment does not create second campaign', async () => {
    cleanMocks();
    const pId = 'pay-007';
    const extRef = 'ref-chk-007';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    const call1 = {
      event: 'payment.failed',
      eventId: 'evt-f-1',
      txnId: 'txn-g-1',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR',
      failureCode: 'INSUFFICIENT_FUNDS'
    };

    const call2 = {
      event: 'payment.failed',
      eventId: 'evt-f-2', // Different eventId to bypass audit_logs deduplication
      txnId: 'txn-g-2',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR',
      failureCode: 'INSUFFICIENT_FUNDS'
    };

    await processWebhook('mock', call1);
    const count1 = Object.keys(mockRecoveries).length;

    await processWebhook('mock', call2);
    const count2 = Object.keys(mockRecoveries).length;

    assert.strictEqual(count1, 1);
    assert.strictEqual(count2, 1); // Remains exactly one recovery campaign
  });

  // 8. Invalid state transition
  await test('8. Attempting illegal transition (SUCCESSFUL -> FAILED) fails state check', async () => {
    cleanMocks();
    const pId = 'pay-008';
    const extRef = 'ref-chk-008';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00',
      status: 'SUCCESSFUL',
      external_reference: extRef
    };

    const webhookBody = {
      event: 'payment.failed',
      eventId: 'evt-fail-8',
      txnId: 'txn-gate-8',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR',
      failureCode: 'INSUFFICIENT_FUNDS'
    };

    // Transition should be rejected safely; payment status must remain SUCCESSFUL
    await processWebhook('mock', webhookBody);
    assert.strictEqual(mockPayments[pId].status, 'SUCCESSFUL');
  });

  // 9. Out-of-order terminal event
  await test('9. Out-of-order webhook delivery keeps terminal status intact', async () => {
    cleanMocks();
    const pId = 'pay-009';
    const extRef = 'ref-chk-009';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    const successEvent = {
      event: 'payment.success',
      eventId: 'evt-order-1',
      txnId: 'txn-gate-9',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR'
    };

    const processingEvent = {
      event: 'payment.processing',
      eventId: 'evt-order-2',
      txnId: 'txn-gate-9',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR'
    };

    // 1. Success arrives first (terminal)
    await processWebhook('mock', successEvent);
    assert.strictEqual(mockPayments[pId].status, 'SUCCESSFUL');

    // 2. Delayed processing event arrives later
    await processWebhook('mock', processingEvent);
    assert.strictEqual(mockPayments[pId].status, 'SUCCESSFUL'); // Keeps terminal state SUCCESSFUL
  });

  // 10. Multiple webhook events for same payment
  await test('10. Processing -> Success webhook sequence progresses state correctly', async () => {
    cleanMocks();
    const pId = 'pay-010';
    const extRef = 'ref-chk-010';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    // Step A: INITIATED -> PROCESSING
    await processWebhook('mock', {
      event: 'payment.processing',
      eventId: 'evt-step-a',
      txnId: 'txn-g',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR'
    });
    assert.strictEqual(mockPayments[pId].status, 'PROCESSING');

    // Step B: PROCESSING -> SUCCESSFUL
    await processWebhook('mock', {
      event: 'payment.success',
      eventId: 'evt-step-b',
      txnId: 'txn-g',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR'
    });
    assert.strictEqual(mockPayments[pId].status, 'SUCCESSFUL');
  });

  // 11. Merchant/customer mismatch
  await test('11. Mismatching merchant scopes ignore webhook processing', async () => {
    cleanMocks();
    // Payment belongs to merch-acme, but webhook notes contain different merchant contexts
    // Our handler findPaymentByExternalReferenceGlobal resolves the payment correctly,
    // and carries the valid merchant_id scope, matching standardPolicy lookup scoping.
    const pId = 'pay-011';
    const extRef = 'ref-chk-011';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: 'merchant-different',
      customer_id: customerId,
      amount: '500.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    const webhookBody = {
      event: 'payment.failed',
      eventId: 'evt-mismatch',
      txnId: 'txn-g',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR',
      failureCode: 'INSUFFICIENT_FUNDS'
    };

    // Will attempt to transition using the payment's actual merchant ID 'merchant-different'.
    // Since 'merchant-different' doesn't have an active policy in mockPolicies,
    // evaluateRecovery will return policy blocked, and recovery campaign will not be created.
    await processWebhook('mock', webhookBody);
    assert.strictEqual(mockPayments[pId].status, 'FAILED');
    assert.strictEqual(Object.keys(mockRecoveries).length, 0); // Excluded due to no active policy
  });

  // 12. Existing recovery prevents duplicate recovery
  await test('12. Preexisting recovery campaign blocks duplicate campaign runs', async () => {
    cleanMocks();
    const pId = 'pay-012';
    const extRef = 'ref-chk-012';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    const call1 = {
      event: 'payment.failed',
      eventId: 'evt-r-1',
      txnId: 'txn-gate-12',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR',
      failureCode: 'INSUFFICIENT_FUNDS'
    };

    // Create the first campaign via webhook processing
    await processWebhook('mock', call1);
    assert.strictEqual(Object.keys(mockRecoveries).length, 1);

    // Call service layer directly to attempt creating another campaign
    await assert.rejects(
      recoveryService.createRecovery(merchantId, {
        payment_id: pId,
        merchant_id: merchantId,
        customer_id: customerId,
        amount: '500.00',
        selected_strategy_id: 'RECOVERY_LINK'
      }),
      ValidationError
    );
  });

  // 13. Recovery creation invokes AI/policy evaluation
  await test('13. Recovery creation triggers active policy evaluations', async () => {
    cleanMocks();
    const pId = 'pay-013';
    const extRef = 'ref-chk-013';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    // Disable auto recovery on policy
    standardPolicy.auto_recovery_enabled = false;

    const call = {
      event: 'payment.failed',
      eventId: 'evt-ai-13',
      txnId: 'txn-gate-13',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR',
      failureCode: 'INSUFFICIENT_FUNDS'
    };

    await processWebhook('mock', call);
    // Campaign should not be created as policy blocked auto-recovery
    assert.strictEqual(Object.keys(mockRecoveries).length, 0);

    // Restore policy
    standardPolicy.auto_recovery_enabled = true;
  });

  // 14. Recovery attempt remains separate from original payment
  await test('14. Recovery attempt events transition campaign without altering base payment status', async () => {
    cleanMocks();
    const pId = 'pay-014';
    const extRef = 'ref-chk-014';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    const call = {
      event: 'payment.failed',
      eventId: 'evt-r-14',
      txnId: 'txn-gate-14',
      externalReference: extRef,
      amount: '500.00',
      currency: 'INR',
      failureCode: 'INSUFFICIENT_FUNDS'
    };

    await processWebhook('mock', call);
    const createdRec = Object.values(mockRecoveries)[0] as any;

    // Simulate recovery attempt success trigger
    await eventBus.publish('recovery.attempt.successful', {
      merchantId,
      recoveryId: createdRec.recovery_id,
      attemptId: 'attempt-xyz'
    });

    // Recovery status transitions to RECOVERED (terminal)
    assert.strictEqual(createdRec.status, 'RECOVERED');
    // Original failed payment status remains FAILED (immutable)
    assert.strictEqual(mockPayments[pId].status, 'FAILED');
  });

  // 15. Provider-specific payload is normalized before domain processing
  await test('15. Razorpay format webhook payload is normalized correctly', async () => {
    cleanMocks();
    const pId = 'pay-015';
    const extRef = 'ref-chk-015';
    mockPayments[pId] = {
      payment_id: pId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '350.00',
      status: 'INITIATED',
      external_reference: extRef
    };

    const razorpayWebhook = {
      entity: 'event',
      account_id: 'acc_123',
      event: 'payment.captured',
      id: 'rzp_event_999',
      payload: {
        payment: {
          entity: {
            id: 'pay_rzp_999',
            amount: 35000, // 350 INR in subunits (paise)
            currency: 'INR',
            status: 'captured',
            notes: {
              external_reference: extRef
            },
            created_at: Math.floor(Date.now() / 1000)
          }
        }
      }
    };

    const res = await processWebhook('razorpay', razorpayWebhook);
    assert.strictEqual(res.result, 'ACCEPTED');
    assert.strictEqual(res.event?.amount, '350.00');
    assert.strictEqual(res.event?.status, 'SUCCESSFUL');
    assert.strictEqual(mockPayments[pId].status, 'SUCCESSFUL');
  });

  setTimeout(() => {
    console.log(`\n📊 Ingestion Tests Complete. Passed: ${passedCount}, Failed: ${failedCount}`);
    if (failedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }, 100);
}

if (require.main === module) {
  runIngestionTests();
}
export { runIngestionTests };
