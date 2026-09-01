import assert from 'assert';
import { pool } from '../../database/connection';
import { validatePaymentTransition } from '../../modules/payments/paymentStateMachine';
import * as paymentService from '../../modules/payments/paymentService';
import { validateRecoveryTransition } from '../../modules/recovery/recoveryStateMachine';
import * as recoveryService from '../../modules/recovery/recoveryService';
import { ValidationError } from '../../shared/errors/ValidationError';
import { generateUUID } from '../../shared/utils/id';
import * as attemptRepo from '../../database/repositories/recoveryAttemptRepository';

// Overwrite the pool.query and pool.connect methods to mock database queries and transactions
const mockPayments: Record<string, any> = {};
const mockRecoveries: Record<string, any> = {};
const mockEvents: any[] = [];
const mockAttempts: Record<string, any> = {};

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

  // 1. SELECT FROM merchants
  if (normalizedText.includes('SELECT merchant_id, name, email FROM merchants')) {
    const id = params ? params[0] : 'merchant-123';
    return {
      rowCount: 1,
      rows: [{ merchant_id: id, name: 'Test Merchant', email: 'merchant@test.com' }]
    };
  }

  // 2. SELECT FROM customers
  if (normalizedText.includes('SELECT customer_id, merchant_id, name, email, phone, status')) {
    const mId = params ? params[0] : 'merchant-123';
    const cId = params ? params[1] : 'customer-123';
    
    // Check tenant isolation rules in mock
    if (cId === 'customer-mismatch') {
      return { rowCount: 0, rows: [] };
    }

    return {
      rowCount: 1,
      rows: [{ customer_id: cId, merchant_id: mId, name: 'Test Customer', email: 'cust@test.com', status: 'ACTIVE' }]
    };
  }

  // 3. SELECT FROM payments
  if (normalizedText.includes('FROM payments') && normalizedText.includes('payment_id = $2')) {
    const mId = params ? params[0] : '';
    const pId = params ? params[1] : '';
    const payment = mockPayments[pId];
    if (payment && payment.merchant_id === mId) {
      return { rowCount: 1, rows: [payment] };
    }
    return { rowCount: 0, rows: [] };
  }

  // 4. INSERT INTO payments
  if (normalizedText.includes('INSERT INTO payments')) {
    const newId = generateUUID();
    const newPayment = {
      payment_id: newId,
      merchant_id: params ? params[0] : '',
      customer_id: params ? params[1] : '',
      payment_method_id: params ? params[2] : '',
      amount: params ? params[3] : '',
      currency: params ? params[4] : 'INR',
      status: params ? params[5] : 'INITIATED',
      failure_type_id: params ? params[6] : null,
      failure_message: params ? params[7] : null,
      external_reference: params ? params[8] : '',
      provider_event_id: params ? params[9] : null,
      environment: params ? params[10] : 'LIVE',
      simulation_session_id: params ? params[11] : null,
      failed_at: params ? params[12] : null,
      successful_at: params ? params[13] : null,
      created_at: new Date(),
      updated_at: new Date()
    };
    mockPayments[newId] = newPayment;
    return { rowCount: 1, rows: [newPayment] };
  }

  // 5. UPDATE payments
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

  // 6. SELECT FROM recoveries
  if (normalizedText.includes('FROM recoveries') && normalizedText.includes('payment_id = $2')) {
    const mId = params ? params[0] : '';
    const pId = params ? params[1] : '';
    const rec = Object.values(mockRecoveries).find((r: any) => r.payment_id === pId && r.merchant_id === mId);
    return { rowCount: rec ? 1 : 0, rows: rec ? [rec] : [] };
  }

  if (normalizedText.includes('FROM recoveries') && normalizedText.includes('recovery_id = $2')) {
    const mId = params ? params[0] : '';
    const rId = params ? params[1] : '';
    const rec = mockRecoveries[rId];
    if (rec && rec.merchant_id === mId) {
      return { rowCount: 1, rows: [rec] };
    }
    return { rowCount: 0, rows: [] };
  }

  // 7. INSERT INTO recoveries
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
      approved_at: params ? params[10] : null,
      amount: params ? params[11] : '',
      environment: params ? params[12] : 'LIVE',
      simulation_session_id: params ? params[13] : null,
      expires_at: params ? params[14] : null,
      created_at: new Date(),
      updated_at: new Date(),
      completed_at: null,
      cancelled_at: null,
      cancellation_reason: null
    };
    mockRecoveries[newId] = newRec;
    return { rowCount: 1, rows: [newRec] };
  }

  // 8. UPDATE recoveries
  if (normalizedText.includes('UPDATE recoveries')) {
    const status = params ? params[0] : null;
    const current_stage = params ? params[1] : null;
    const selected_strategy_id = params ? params[2] : null;
    const approved_at = params ? params[3] : null;
    const completed_at = params ? params[4] : null;
    const cancelled_at = params ? params[5] : null;
    const cancellation_reason = params ? params[6] : null;
    const mId = params ? params[7] : '';
    const rId = params ? params[8] : '';

    const r = mockRecoveries[rId];
    if (r && r.merchant_id === mId) {
      r.status = status || r.status;
      r.current_stage = current_stage || r.current_stage;
      r.selected_strategy_id = selected_strategy_id || r.selected_strategy_id;
      r.approved_at = approved_at || r.approved_at;
      r.completed_at = completed_at || r.completed_at;
      r.cancelled_at = cancelled_at || r.cancelled_at;
      r.cancellation_reason = cancellation_reason || r.cancellation_reason;
      return { rowCount: 1, rows: [r] };
    }
    return { rowCount: 0, rows: [] };
  }

  // 9. INSERT INTO recovery_events
  if (normalizedText.includes('INSERT INTO recovery_events')) {
    const newEvent = {
      event_id: generateUUID(),
      recovery_id: params ? params[0] : '',
      event_type: params ? params[1] : '',
      event_status: params ? params[2] : '',
      description: params ? params[3] : '',
      metadata: params ? params[4] : null,
      actor: params ? params[5] : '',
      created_at: new Date()
    };
    mockEvents.push(newEvent);
    return { rowCount: 1, rows: [newEvent] };
  }

  // 10. INSERT INTO recovery_payment_attempts
  if (normalizedText.includes('INSERT INTO recovery_payment_attempts')) {
    const newId = generateUUID();
    const newAttempt = {
      attempt_id: newId,
      recovery_id: params ? params[0] : '',
      customer_id: params ? params[1] : '',
      payment_method_id: params ? params[2] : '',
      amount: params ? params[3] : '',
      currency: (params && params[4] !== null) ? params[4] : 'INR',
      status: (params && params[5] !== null) ? params[5] : 'PENDING',
      provider_name: params ? params[6] : null,
      provider_transaction_id: params ? params[7] : null,
      provider_status: params ? params[8] : null,
      idempotency_key: params ? params[9] : '',
      error_code: params ? params[10] : null,
      error_message: params ? params[11] : null,
      environment: (params && params[12] !== null) ? params[12] : 'LIVE',
      simulation_session_id: params ? params[13] : null,
      created_at: new Date(),
      completed_at: null
    };

    // Check unique idempotency_key constraint
    const dup = Object.values(mockAttempts).find((a: any) => a.idempotency_key === newAttempt.idempotency_key);
    if (dup) {
      const err = new Error('duplicate key value violates unique constraint "uq_attempt_idempotency"');
      (err as any).code = '23505';
      throw err;
    }

    mockAttempts[newId] = newAttempt;
    return { rowCount: 1, rows: [newAttempt] };
  }

  // 11. SELECT FROM recovery_payment_attempts
  if (normalizedText.includes('FROM recovery_payment_attempts') && (normalizedText.includes('recovery_id = $1') || normalizedText.includes('recovery_id = $2'))) {
    const rId = params ? params[0] : '';
    const atts = Object.values(mockAttempts).filter((a: any) => a.recovery_id === rId);
    return { rowCount: atts.length, rows: atts };
  }

  // 12. UPDATE recovery_payment_attempts
  if (normalizedText.includes('UPDATE recovery_payment_attempts')) {
    const status = params ? params[0] : 'PENDING';
    const provider_transaction_id = params ? params[1] : null;
    const provider_status = params ? params[2] : null;
    const error_code = params ? params[3] : null;
    const error_message = params ? params[4] : null;
    const completed_at = params ? params[5] : null;
    const attemptId = params ? params[6] : '';

    const att = mockAttempts[attemptId];
    if (att) {
      att.status = status;
      att.provider_transaction_id = provider_transaction_id || att.provider_transaction_id;
      att.provider_status = provider_status || att.provider_status;
      att.error_code = error_code || att.error_code;
      att.error_message = error_message || att.error_message;
      att.completed_at = completed_at || att.completed_at;
      return { rowCount: 1, rows: [att] };
    }
    return { rowCount: 0, rows: [] };
  }

  return { rowCount: 0, rows: [] };
};

// ============================================================================
// TEST SUITE EXECUTION
// ============================================================================

async function runDomainTests() {
  console.log('🔄 Running Domain Unit Tests...');
  let passedCount = 0;
  let failedCount = 0;

  const test = (name: string, fn: () => void | Promise<void>) => {
    try {
      const res = fn();
      if (res instanceof Promise) {
        res.then(() => {
          console.log(`✅ ${name}`);
          passedCount++;
        }).catch(err => {
          console.error(`❌ ${name}`);
          console.error(err);
          failedCount++;
        });
      } else {
        console.log(`✅ ${name}`);
        passedCount++;
      }
    } catch (err) {
      console.error(`❌ ${name}`);
      console.error(err);
      failedCount++;
    }
  };

  // --- Payments State Machine ---
  test('1. INITIATED -> PROCESSING succeeds', () => {
    assert.doesNotThrow(() => validatePaymentTransition('INITIATED', 'PROCESSING'));
  });

  test('2. PROCESSING -> SUCCESSFUL succeeds', () => {
    assert.doesNotThrow(() => validatePaymentTransition('PROCESSING', 'SUCCESSFUL'));
  });

  test('3. PROCESSING -> FAILED succeeds', () => {
    assert.doesNotThrow(() => validatePaymentTransition('PROCESSING', 'FAILED'));
  });

  test('4. INITIATED -> SUCCESSFUL fails', () => {
    assert.throws(() => validatePaymentTransition('INITIATED', 'SUCCESSFUL'), ValidationError);
  });

  test('5. INITIATED -> FAILED fails', () => {
    assert.throws(() => validatePaymentTransition('INITIATED', 'FAILED'), ValidationError);
  });

  test('6. SUCCESSFUL -> FAILED fails', () => {
    assert.throws(() => validatePaymentTransition('SUCCESSFUL', 'FAILED'), ValidationError);
  });

  test('7. SUCCESSFUL -> PROCESSING fails', () => {
    assert.throws(() => validatePaymentTransition('SUCCESSFUL', 'PROCESSING'), ValidationError);
  });

  test('8. FAILED -> PROCESSING fails', () => {
    assert.throws(() => validatePaymentTransition('FAILED', 'PROCESSING'), ValidationError);
  });

  test('9. FAILED -> SUCCESSFUL fails', () => {
    assert.throws(() => validatePaymentTransition('FAILED', 'SUCCESSFUL'), ValidationError);
  });

  // --- Recoveries State Machine ---
  test('10. Valid initial recovery state', () => {
    assert.doesNotThrow(() => validateRecoveryTransition('IN_PROGRESS', 'AWAITING_CUSTOMER_ACTION'));
  });

  test('11. Every legal transition succeeds', () => {
    assert.doesNotThrow(() => validateRecoveryTransition('IN_PROGRESS', 'AWAITING_CUSTOMER_ACTION'));
    assert.doesNotThrow(() => validateRecoveryTransition('AWAITING_CUSTOMER_ACTION', 'AWAITING_VERIFICATION'));
    assert.doesNotThrow(() => validateRecoveryTransition('AWAITING_VERIFICATION', 'RECOVERED'));
  });

  test('12. Every illegal transition fails', () => {
    assert.throws(() => validateRecoveryTransition('AWAITING_VERIFICATION', 'AWAITING_CUSTOMER_ACTION'), ValidationError);
    assert.throws(() => validateRecoveryTransition('RECOVERED', 'IN_PROGRESS'), ValidationError);
  });

  test('13. Terminal states cannot transition', () => {
    assert.throws(() => validateRecoveryTransition('RECOVERED', 'FAILED'), ValidationError);
    assert.throws(() => validateRecoveryTransition('FAILED', 'IN_PROGRESS'), ValidationError);
    assert.throws(() => validateRecoveryTransition('EXPIRED', 'RECOVERED'), ValidationError);
  });

  // --- Service Eligibility & Constraints (uses our pool.query mocks) ---
  const merchantId = 'merch-abc';
  const customerId = 'cust-abc';

  // Helper setup
  const createFailedPayment = async (externalRef: string) => {
    return paymentService.createPayment({
      merchant_id: merchantId,
      customer_id: customerId,
      payment_method_id: 'CARD',
      amount: '500.00',
      status: 'FAILED',
      external_reference: externalRef
    });
  };

  const createSuccessfulPayment = async (externalRef: string) => {
    return paymentService.createPayment({
      merchant_id: merchantId,
      customer_id: customerId,
      payment_method_id: 'CARD',
      amount: '500.00',
      status: 'SUCCESSFUL',
      external_reference: externalRef
    });
  };

  test('14. Recovery creation requires FAILED payment status', async () => {
    const failedPay = await createFailedPayment('ref_fail_01');
    const rec = await recoveryService.createRecovery(merchantId, {
      payment_id: failedPay.payment_id,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00'
    });
    assert.strictEqual(rec.payment_id, failedPay.payment_id);
    assert.strictEqual(rec.status, 'IN_PROGRESS');
  });

  test('15. Successful payment cannot create recovery campaign', async () => {
    const successPay = await createSuccessfulPayment('ref_success_01');
    await assert.rejects(
      recoveryService.createRecovery(merchantId, {
        payment_id: successPay.payment_id,
        merchant_id: merchantId,
        customer_id: customerId,
        amount: '500.00'
      }),
      ValidationError
    );
  });

  test('16. Processing payment cannot create recovery campaign', async () => {
    const procPay = await paymentService.createPayment({
      merchant_id: merchantId,
      customer_id: customerId,
      payment_method_id: 'UPI',
      amount: '350.00',
      status: 'PROCESSING',
      external_reference: 'ref_proc_01'
    });
    await assert.rejects(
      recoveryService.createRecovery(merchantId, {
        payment_id: procPay.payment_id,
        merchant_id: merchantId,
        customer_id: customerId,
        amount: '350.00'
      }),
      ValidationError
    );
  });

  test('17. Duplicate recovery for same payment fails (One recovery per payment)', async () => {
    const failedPay = await createFailedPayment('ref_dup_01');
    // First creation
    await recoveryService.createRecovery(merchantId, {
      payment_id: failedPay.payment_id,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00'
    });
    // Second creation on same payment_id
    await assert.rejects(
      recoveryService.createRecovery(merchantId, {
        payment_id: failedPay.payment_id,
        merchant_id: merchantId,
        customer_id: customerId,
        amount: '500.00'
      }),
      ValidationError
    );
  });

  // --- Tenancy Bounds ---
  test('22. Merchant A cannot access Merchant B payment', async () => {
    const payment = await createFailedPayment('ref_tenant_01');
    await assert.rejects(
      paymentService.getPayment('merchant-different', payment.payment_id),
      Error
    );
  });

  test('23. Merchant A cannot create recovery for Merchant B payment', async () => {
    const payment = await createFailedPayment('ref_tenant_02');
    await assert.rejects(
      recoveryService.createRecovery('merchant-different', {
        payment_id: payment.payment_id,
        merchant_id: 'merchant-different',
        customer_id: customerId,
        amount: '500.00'
      }),
      Error
    );
  });

  test('24. Merchant A cannot access Merchant B recovery', async () => {
    const payment = await createFailedPayment('ref_tenant_03');
    const rec = await recoveryService.createRecovery(merchantId, {
      payment_id: payment.payment_id,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00'
    });
    await assert.rejects(
      recoveryService.getRecovery('merchant-different', rec.recovery_id),
      Error
    );
  });

  // --- Recovery Payment Attempts (18, 19, 20, 21) ---
  test('18. Recovery attempt remains separate from original payment', async () => {
    const failedPay = await createFailedPayment('ref_sep_01');
    const rec = await recoveryService.createRecovery(merchantId, {
      payment_id: failedPay.payment_id,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00'
    });

    const attempt = await attemptRepo.createRecoveryAttempt({
      recoveryId: rec.recovery_id,
      customerId: customerId,
      paymentMethodId: 'CARD',
      amount: '500.00',
      idempotencyKey: `idem_sep_${generateUUID()}`
    });

    assert.notStrictEqual(attempt.attempt_id, failedPay.payment_id);
    assert.strictEqual(attempt.status, 'PENDING');
  });

  test('19. Recovery attempt does not mutate original payment', async () => {
    const failedPay = await createFailedPayment('ref_mut_01');
    const rec = await recoveryService.createRecovery(merchantId, {
      payment_id: failedPay.payment_id,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00'
    });

    const attempt = await attemptRepo.createRecoveryAttempt({
      recoveryId: rec.recovery_id,
      customerId: customerId,
      paymentMethodId: 'CARD',
      amount: '500.00',
      idempotencyKey: `idem_mut_${generateUUID()}`
    });

    // Update attempt status to SUCCESSFUL
    await attemptRepo.updateAttemptStatus(attempt.attempt_id, 'SUCCESSFUL');

    // original payment must remain FAILED
    const origPay = await paymentService.getPayment(merchantId, failedPay.payment_id);
    assert.strictEqual(origPay.status, 'FAILED');
  });

  test('20. Multiple attempts can belong to one recovery', async () => {
    const failedPay = await createFailedPayment('ref_mult_01');
    const rec = await recoveryService.createRecovery(merchantId, {
      payment_id: failedPay.payment_id,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00'
    });

    await attemptRepo.createRecoveryAttempt({
      recoveryId: rec.recovery_id,
      customerId: customerId,
      paymentMethodId: 'UPI',
      amount: '500.00',
      idempotencyKey: `idem_mult_1_${generateUUID()}`
    });

    await attemptRepo.createRecoveryAttempt({
      recoveryId: rec.recovery_id,
      customerId: customerId,
      paymentMethodId: 'CARD',
      amount: '500.00',
      idempotencyKey: `idem_mult_2_${generateUUID()}`
    });

    const list = await attemptRepo.listAttemptsByRecovery(rec.recovery_id);
    assert.strictEqual(list.length, 2);
  });

  test('21. Idempotency behavior remains compatible with repository constraint', async () => {
    const failedPay = await createFailedPayment('ref_idem_01');
    const rec = await recoveryService.createRecovery(merchantId, {
      payment_id: failedPay.payment_id,
      merchant_id: merchantId,
      customer_id: customerId,
      amount: '500.00'
    });

    const key = `idem_key_dup_${generateUUID()}`;

    await attemptRepo.createRecoveryAttempt({
      recoveryId: rec.recovery_id,
      customerId: customerId,
      paymentMethodId: 'CARD',
      amount: '500.00',
      idempotencyKey: key
    });

    await assert.rejects(
      attemptRepo.createRecoveryAttempt({
        recoveryId: rec.recovery_id,
        customerId: customerId,
        paymentMethodId: 'CARD',
        amount: '500.00',
        idempotencyKey: key
      }),
      Error
    );
  });

  // Wait a small delay to output clean test summary
  setTimeout(() => {
    console.log(`\n📊 Tests Complete. Passed: ${passedCount}, Failed: ${failedCount}`);
    if (failedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }, 100);
}

if (require.main === module) {
  runDomainTests();
}
export { runDomainTests };
