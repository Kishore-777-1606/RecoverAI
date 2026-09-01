import assert from 'assert';
import { pool } from '../../database/connection';
import { evaluateRecovery } from '../../modules/ai/decisionEngine';
import { ValidationError } from '../../shared/errors/ValidationError';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { generateUUID } from '../../shared/utils/id';

// ============================================================================
// DATABASE QUERY AND CONNECTION MOCKS
// ============================================================================

// Mock states
const mockPayments: Record<string, any> = {};
const mockPolicies: Record<string, any> = {};
const mockRecoveries: Record<string, any> = {};
const mockAttempts: any[] = [];
const mockActions: any[] = [];

// Override pool connection client queries for transactions
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

  // SELECT FROM payments
  if (normalizedText.includes('FROM payments') && normalizedText.includes('payment_id = $2')) {
    const mId = params ? params[0] : '';
    const pId = params ? params[1] : '';
    const payment = mockPayments[pId];
    if (payment && payment.merchant_id === mId) {
      return { rowCount: 1, rows: [payment] };
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

  // SELECT FROM recoveries (By payment_id)
  if (normalizedText.includes('FROM recoveries') && normalizedText.includes('payment_id = $2')) {
    const mId = params ? params[0] : '';
    const pId = params ? params[1] : '';
    const rec = Object.values(mockRecoveries).find((r: any) => r.payment_id === pId && r.merchant_id === mId);
    return { rowCount: rec ? 1 : 0, rows: rec ? [rec] : [] };
  }

  // SELECT FROM recovery_payment_attempts
  if (normalizedText.includes('FROM recovery_payment_attempts') && normalizedText.includes('recovery_id = $1')) {
    const rId = params ? params[0] : '';
    const atts = mockAttempts.filter((a: any) => a.recovery_id === rId);
    return { rowCount: atts.length, rows: atts };
  }

  // SELECT FROM recovery_actions
  if (normalizedText.includes('FROM recovery_actions') && normalizedText.includes('recovery_id = $1')) {
    const rId = params ? params[0] : '';
    const acts = mockActions.filter((a: any) => a.recovery_id === rId);
    return { rowCount: acts.length, rows: acts };
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

  return { rowCount: 0, rows: [] };
};

// ============================================================================
// TEST SCENARIOS EXECUTION
// ============================================================================

async function runAIEngineTests() {
  console.log('🔄 Running AI Decision Engine Unit Tests...');
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

  const merchantId = 'merch-111';
  const customerId = 'cust-111';

  // Seed standard active policy for merchant
  const standardPolicy = {
    policy_id: 'policy-std-111',
    merchant_id: merchantId,
    name: 'Standard Recovery Policy',
    is_active: true,
    auto_recovery_enabled: true,
    max_amount_limit: '10000.00',
    approval_threshold: '2000.00',
    quiet_hours_enabled: true,
    quiet_hours_start: '22:00:00',
    quiet_hours_end: '08:00:00',
    created_at: new Date(),
    updated_at: new Date(),
    failure_rules: [
      { policy_id: 'policy-std-111', failure_type_id: 'INSUFFICIENT_FUNDS', is_eligible: true },
      { policy_id: 'policy-std-111', failure_type_id: 'NETWORK_ERROR', is_eligible: true },
      { policy_id: 'policy-std-111', failure_type_id: 'FRAUD_BLOCK', is_eligible: false } // Explicitly excluded
    ],
    strategies: [
      { policy_id: 'policy-std-111', strategy_id: 'RECOVERY_LINK', priority: 1, is_enabled: true, max_outreach_attempts: 3, min_interval_seconds: 3600 },
      { policy_id: 'policy-std-111', strategy_id: 'DELAYED_RETRY', priority: 2, is_enabled: true, max_outreach_attempts: 2, min_interval_seconds: 7200 }
    ],
    channels: [
      { policy_id: 'policy-std-111', channel: 'SMS', is_enabled: true },
      { policy_id: 'policy-std-111', channel: 'EMAIL', is_enabled: true }
    ]
  };
  mockPolicies[merchantId] = standardPolicy;

  // TEST 1: Eligible FAILED payment -> recovery allowed
  await test('TEST 1: Eligible FAILED payment allows recovery', async () => {
    const paymentId = 'pay-fail-01';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      payment_method_id: 'CARD',
      amount: '1500.00',
      currency: 'INR',
      status: 'FAILED',
      failure_type_id: 'INSUFFICIENT_FUNDS',
      external_reference: 'ref-fail-01',
      environment: 'LIVE',
      created_at: new Date(),
      updated_at: new Date()
    };

    const decision = await evaluateRecovery(merchantId, paymentId, new Date('2026-08-29T12:00:00Z')); // Outside quiet hours
    assert.strictEqual(decision.eligible, true);
    assert.strictEqual(decision.recommendedStrategy, 'RECOVERY_LINK');
    assert.strictEqual(decision.failureClassification, 'INSUFFICIENT_FUNDS');
  });

  // TEST 2: SUCCESSFUL payment -> recovery rejected
  await test('TEST 2: SUCCESSFUL payment blocks recovery evaluation', async () => {
    const paymentId = 'pay-success-01';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'SUCCESSFUL',
      external_reference: 'ref-succ-01',
      environment: 'LIVE'
    };

    const decision = await evaluateRecovery(merchantId, paymentId);
    assert.strictEqual(decision.eligible, false);
    assert.strictEqual(decision.recommendedStrategy, null);
    assert.match(decision.explanation, /Only FAILED payments can be processed/);
  });

  // TEST 3: PROCESSING payment -> recovery rejected
  await test('TEST 3: PROCESSING payment blocks recovery evaluation', async () => {
    const paymentId = 'pay-proc-01';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'PROCESSING',
      external_reference: 'ref-proc-01',
      environment: 'LIVE'
    };

    const decision = await evaluateRecovery(merchantId, paymentId);
    assert.strictEqual(decision.eligible, false);
    assert.match(decision.explanation, /Only FAILED payments can be processed/);
  });

  // TEST 4: Failure type explicitly excluded by policy -> recovery rejected
  await test('TEST 4: Failure type excluded by policy rules blocks recovery', async () => {
    const paymentId = 'pay-fraud-01';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'FAILED',
      failure_type_id: 'FRAUD_BLOCK',
      external_reference: 'ref-fraud-01',
      environment: 'LIVE'
    };

    const decision = await evaluateRecovery(merchantId, paymentId);
    assert.strictEqual(decision.eligible, false);
    assert.strictEqual(decision.policyEvaluation.blockedReason, 'FAILURE_TYPE_EXCLUDED');
  });

  // TEST 5: No active merchant policy -> automatic recovery rejected
  await test('TEST 5: Missing active merchant policy rejects recovery', async () => {
    const paymentId = 'pay-fail-02';
    const otherMerchantId = 'merch-no-policy';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: otherMerchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'FAILED',
      failure_type_id: 'INSUFFICIENT_FUNDS',
      external_reference: 'ref-fail-02',
      environment: 'LIVE'
    };

    const decision = await evaluateRecovery(otherMerchantId, paymentId);
    assert.strictEqual(decision.eligible, false);
    assert.strictEqual(decision.policyEvaluation.blockedReason, 'NO_ACTIVE_POLICY');
  });

  // TEST 6: Strategy disabled -> strategy cannot be selected
  await test('TEST 6: Disabled strategies cannot be selected by engine', async () => {
    const paymentId = 'pay-fail-03';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'FAILED',
      failure_type_id: 'NETWORK_ERROR',
      external_reference: 'ref-fail-03',
      environment: 'LIVE'
    };

    // Temporarily disable DELAYED_RETRY (preferred for network errors) in policy mock
    standardPolicy.strategies[1].is_enabled = false;

    const decision = await evaluateRecovery(merchantId, paymentId, new Date('2026-08-29T12:00:00Z'));
    assert.strictEqual(decision.eligible, true);
    // Should fallback to RECOVERY_LINK since DELAYED_RETRY is disabled
    assert.strictEqual(decision.recommendedStrategy, 'RECOVERY_LINK');

    // Restore strategy state
    standardPolicy.strategies[1].is_enabled = true;
  });

  // TEST 7: Multiple strategies enabled -> highest-priority valid strategy selected
  await test('TEST 7: Highest priority strategy selected from active policy', async () => {
    const paymentId = 'pay-fail-04';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'FAILED',
      failure_type_id: 'NETWORK_ERROR', // Suggests DELAYED_RETRY ordinarily
      external_reference: 'ref-fail-04',
      environment: 'LIVE'
    };

    // RECOVERY_LINK has priority 1, DELAYED_RETRY has priority 2
    // The policy priorities should govern strategy recommendation rather than heuristics
    const decision = await evaluateRecovery(merchantId, paymentId, new Date('2026-08-29T12:00:00Z'));
    assert.strictEqual(decision.eligible, true);
    assert.strictEqual(decision.recommendedStrategy, 'RECOVERY_LINK'); // Priority 1 wins
  });

  // TEST 8: Quiet hours active -> decision execution delayed
  await test('TEST 8: Execution delayed when current time is inside quiet hours', async () => {
    const paymentId = 'pay-fail-05';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'FAILED',
      failure_type_id: 'INSUFFICIENT_FUNDS',
      external_reference: 'ref-fail-05',
      environment: 'LIVE'
    };

    // Evaluate at 23:00 (Quiet hours: 22:00:00 - 08:00:00)
    const referenceTime = new Date('2026-08-29T23:00:00Z');
    referenceTime.setHours(23, 0, 0, 0);

    const decision = await evaluateRecovery(merchantId, paymentId, referenceTime);
    assert.strictEqual(decision.eligible, true);
    assert.strictEqual(decision.timingRecommendation?.isDelayedDueToQuietHours, true);
    
    // Check that execution is scheduled for 08:01:00 on the following day
    const expectedTime = new Date(referenceTime);
    expectedTime.setHours(8, 1, 0, 0);
    if (expectedTime <= referenceTime) {
      expectedTime.setDate(expectedTime.getDate() + 1);
    }
    assert.strictEqual(decision.recommendedTiming?.getTime(), expectedTime.getTime());
  });

  // TEST 9: Outside quiet hours -> action executes immediately
  await test('TEST 9: Action executes immediately outside quiet hours', async () => {
    const paymentId = 'pay-fail-06';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'FAILED',
      failure_type_id: 'INSUFFICIENT_FUNDS',
      external_reference: 'ref-fail-06',
      environment: 'LIVE'
    };

    // Evaluate at 14:00 (Outside quiet hours)
    const referenceTime = new Date('2026-08-29T14:00:00Z');
    referenceTime.setHours(14, 0, 0, 0);

    const decision = await evaluateRecovery(merchantId, paymentId, referenceTime);
    assert.strictEqual(decision.eligible, true);
    assert.strictEqual(decision.timingRecommendation?.isDelayedDueToQuietHours, false);
    assert.strictEqual(decision.recommendedTiming?.getTime(), referenceTime.getTime());
  });

  // TEST 10: Repeated previous failures -> confidence appropriately reduced
  await test('TEST 10: Repeated failed attempts decrease recovery confidence', async () => {
    const paymentId = 'pay-fail-07';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'FAILED',
      failure_type_id: 'INSUFFICIENT_FUNDS',
      external_reference: 'ref-fail-07',
      environment: 'LIVE'
    };

    // Map a mock campaign and insert failed attempts
    const recoveryId = 'rec-fail-07';
    mockRecoveries[recoveryId] = {
      recovery_id: recoveryId,
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      status: 'IN_PROGRESS'
    };

    // Clear and push failed attempts
    mockAttempts.length = 0;
    mockAttempts.push(
      { recovery_id: recoveryId, attempt_id: 'att-1', status: 'FAILED' },
      { recovery_id: recoveryId, attempt_id: 'att-2', status: 'FAILED' }
    );

    const decision = await evaluateRecovery(merchantId, paymentId, new Date('2026-08-29T12:00:00Z'));
    
    // Base: 50 (INSUFFICIENT_FUNDS) + 20 (alignment RECOVERY_LINK) + 10 (priority 1) - 40 (two failed attempts penalty) = 40
    assert.strictEqual(decision.confidenceScore, 40.00);

    // Clean up
    delete mockRecoveries[recoveryId];
    mockAttempts.length = 0;
  });

  // TEST 11: Strong recovery conditions -> high deterministic confidence score
  await test('TEST 11: Strong recovery parameters yield high confidence', async () => {
    const paymentId = 'pay-fail-08';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'FAILED',
      failure_type_id: 'NETWORK_ERROR',
      external_reference: 'ref-fail-08',
      environment: 'LIVE'
    };

    // Standard Policy priorities: RECOVERY_LINK (1), DELAYED_RETRY (2)
    // DELAYED_RETRY has priority 2, base: 60 (NETWORK_ERROR base) + 10 (fallback alignment DELAYED_RETRY) + 5 (priority 2) = 75
    // Set DELAYED_RETRY to priority 1 and RECOVERY_LINK to priority 2 to recommend DELAYED_RETRY:
    standardPolicy.strategies[0].priority = 2;
    standardPolicy.strategies[1].priority = 1;

    const decision = await evaluateRecovery(merchantId, paymentId, new Date('2026-08-29T12:00:00Z'));
    // DELAYED_RETRY base: 60 + 20 (preferred alignment) + 10 (priority 1) = 90
    assert.strictEqual(decision.confidenceScore, 90.00);

    // Restore strategy priorities
    standardPolicy.strategies[0].priority = 1;
    standardPolicy.strategies[1].priority = 2;
  });

  // TEST 12: Same input executed twice -> exactly same decision and confidence
  await test('TEST 12: Decision outcomes are strictly deterministic', async () => {
    const paymentId = 'pay-fail-09';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'FAILED',
      failure_type_id: 'INSUFFICIENT_FUNDS',
      external_reference: 'ref-fail-09',
      environment: 'LIVE'
    };

    const dec1 = await evaluateRecovery(merchantId, paymentId, new Date('2026-08-29T12:00:00Z'));
    const dec2 = await evaluateRecovery(merchantId, paymentId, new Date('2026-08-29T12:00:00Z'));

    assert.deepStrictEqual(dec1, dec2);
  });

  // TEST 13: Recovery already terminal -> no new automatic decision
  await test('TEST 13: Terminal campaigns block new automatic recovery evaluations', async () => {
    const paymentId = 'pay-fail-10';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'FAILED',
      failure_type_id: 'INSUFFICIENT_FUNDS',
      external_reference: 'ref-fail-10',
      environment: 'LIVE'
    };

    const recoveryId = 'rec-fail-10';
    mockRecoveries[recoveryId] = {
      recovery_id: recoveryId,
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      status: 'RECOVERED' // Terminal State
    };

    const decision = await evaluateRecovery(merchantId, paymentId);
    assert.strictEqual(decision.eligible, false);
    assert.match(decision.explanation, /campaign is already in a terminal state/);

    // Clean up
    delete mockRecoveries[recoveryId];
  });

  // TEST 14: Merchant/customer mismatch -> rejected (throws NotFoundError as scopes differ)
  await test('TEST 14: Scoping mismatch throws NotFoundError', async () => {
    const paymentId = 'pay-fail-11';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'FAILED',
      failure_type_id: 'INSUFFICIENT_FUNDS',
      external_reference: 'ref-fail-11',
      environment: 'LIVE'
    };

    // Query using mismatching merchant ID -> should throw NotFoundError
    await assert.rejects(
      evaluateRecovery('merch-mismatch-123', paymentId),
      NotFoundError
    );
  });

  // TEST 15: No eligible strategy -> blocked decision
  await test('TEST 15: Blocked decision if no strategies are enabled in policy', async () => {
    const paymentId = 'pay-fail-12';
    mockPayments[paymentId] = {
      payment_id: paymentId,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '1500.00',
      status: 'FAILED',
      failure_type_id: 'INSUFFICIENT_FUNDS',
      external_reference: 'ref-fail-12',
      environment: 'LIVE'
    };

    // Disable all policy strategies
    standardPolicy.strategies.forEach((s: any) => s.is_enabled = false);

    const decision = await evaluateRecovery(merchantId, paymentId);
    assert.strictEqual(decision.eligible, false);
    assert.match(decision.explanation, /no strategies are enabled/);

    // Restore strategy states
    standardPolicy.strategies.forEach((s: any) => s.is_enabled = true);
  });

  // Wait a small delay to output clean test summary
  setTimeout(() => {
    console.log(`\n📊 AI Engine Tests Complete. Passed: ${passedCount}, Failed: ${failedCount}`);
    if (failedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }, 100);
}

if (require.main === module) {
  runAIEngineTests();
}
export { runAIEngineTests };
