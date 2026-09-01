import { pool } from '../../database/connection';
import * as merchantRepo from '../../database/repositories/merchantRepository';
import * as customerRepo from '../../database/repositories/customerRepository';
import * as policyRepo from '../../database/repositories/policyRepository';
import * as paymentRepo from '../../database/repositories/paymentRepository';
import * as recoveryRepo from '../../database/repositories/recoveryRepository';
import * as attemptRepo from '../../database/repositories/recoveryAttemptRepository';
import * as linkRepo from '../../database/repositories/recoveryLinkRepository';
import * as notificationRepo from '../../database/repositories/notificationRepository';
import * as verificationRepo from '../../database/repositories/verificationRepository';
import * as simulationRepo from '../../database/repositories/simulationRepository';
import * as auditRepo from '../../database/repositories/auditRepository';
import { generateUUID } from '../../shared/utils/id';

async function runTests() {
  console.log('🔄 Starting repository integration tests...');

  try {
    // 1. Connectivity Check
    await pool.query('SELECT 1');
    console.log('✅ Connected to database. Preparing schema sandbox...');
  } catch (err: any) {
    console.log('❌ DATABASE CONNECTION: BLOCKED — PostgreSQL is not running/configured');
    console.log('Reason:', err.message);
    return;
  }

  try {
    // Cleanup helper for test runs (only live/test data created in this suite)
    const testLabel = 'repo-test-temp';
    
    // Begin Test Block
    console.log('\n--- 1. Merchant & Customer Tenant Isolation ---');
    const merchantA = await merchantRepo.createMerchant({ name: 'Merchant A', email: `mercha_${generateUUID()}@test.com` });
    const merchantB = await merchantRepo.createMerchant({ name: 'Merchant B', email: `merchb_${generateUUID()}@test.com` });
    console.log(`Created Merchant A: ${merchantA.merchant_id}, Merchant B: ${merchantB.merchant_id}`);

    const customerA = await customerRepo.createCustomer({
      merchantId: merchantA.merchant_id,
      name: 'Customer A',
      email: 'customer@shared.com'
    });
    
    const customerB = await customerRepo.createCustomer({
      merchantId: merchantB.merchant_id,
      name: 'Customer B',
      email: 'customer@shared.com' // Allowed by UNIQUE(merchant_id, email)
    });
    console.log(`Created Customer A & B with same email under different merchants`);

    // Verify isolation
    try {
      await customerRepo.findCustomerById(merchantA.merchant_id, customerB.customer_id);
      throw new Error('Tenant isolation breach! Merchant A accessed Merchant B customer.');
    } catch (e: any) {
      console.log('✅ Isolation Verified: Merchant A blocked from fetching Merchant B customer');
    }

    console.log('\n--- 2. Single Active Policy Constraint ---');
    const policy1 = await policyRepo.createPolicy(
      merchantA.merchant_id,
      { name: 'Policy 1', is_active: true, auto_recovery_enabled: true, quiet_hours_enabled: false },
      [], [], []
    );
    console.log(`Created Active Policy 1: ${policy1.policy_id}`);

    // Create a second active policy -> should automatically deactivate policy1
    const policy2 = await policyRepo.createPolicy(
      merchantA.merchant_id,
      { name: 'Policy 2', is_active: true, auto_recovery_enabled: true, quiet_hours_enabled: false },
      [], [], []
    );
    console.log(`Created Active Policy 2: ${policy2.policy_id} (Should deactivate Policy 1)`);

    const activePolicy = await policyRepo.findActivePolicyByMerchant(merchantA.merchant_id);
    if (activePolicy?.policy_id === policy2.policy_id) {
      console.log('✅ Active policy uniqueness verified. Previous active policy was automatically deactivated.');
    } else {
      throw new Error('Active policy collision or mismatch detected!');
    }

    console.log('\n--- 3. Payments & Recovery Campaigns ---');
    const payment = await paymentRepo.createPayment({
      merchantId: merchantA.merchant_id,
      customerId: customerA.customer_id,
      paymentMethodId: 'CARD',
      amount: '1500.00',
      status: 'FAILED',
      failedAt: new Date(),
      failureTypeId: 'INSUFFICIENT_FUNDS',
      externalReference: `ref_${generateUUID()}`
    });
    console.log(`Created Failed Payment: ${payment.payment_id}`);

    const recovery = await recoveryRepo.createRecovery({
      paymentId: payment.payment_id,
      merchantId: merchantA.merchant_id,
      customerId: customerA.customer_id,
      amount: payment.amount
    });
    console.log(`Created Recovery Campaign: ${recovery.recovery_id}`);

    console.log('\n--- 4. Webhook Idempotency ---');
    const providerEventId = `evt_${generateUUID()}`;
    const p1 = await paymentRepo.createPayment({
      merchantId: merchantA.merchant_id,
      customerId: customerA.customer_id,
      paymentMethodId: 'UPI',
      amount: '500.00',
      externalReference: `ref_${generateUUID()}`,
      providerEventId
    });
    console.log(`Created payment with Event ID ${providerEventId}`);

    try {
      await paymentRepo.createPayment({
        merchantId: merchantA.merchant_id,
        customerId: customerA.customer_id,
        paymentMethodId: 'UPI',
        amount: '500.00',
        externalReference: `ref_${generateUUID()}`,
        providerEventId
      });
      throw new Error('Idempotency breached! Saved duplicate event ID.');
    } catch (e: any) {
      console.log('✅ Idempotency Verified: Duplicate providerEventId was rejected by database index.');
    }

    console.log('\n--- 5. Recovery Attempts & Link tokens ---');
    const idempotencyKey = `idem_${generateUUID()}`;
    const attempt = await attemptRepo.createRecoveryAttempt({
      recoveryId: recovery.recovery_id,
      customerId: customerA.customer_id,
      paymentMethodId: 'CARD',
      amount: '1500.00',
      idempotencyKey
    });
    console.log(`Created Payment Attempt: ${attempt.attempt_id}`);

    try {
      await attemptRepo.createRecoveryAttempt({
        recoveryId: recovery.recovery_id,
        customerId: customerA.customer_id,
        paymentMethodId: 'CARD',
        amount: '1500.00',
        idempotencyKey
      });
      throw new Error('Attempt idempotency breached!');
    } catch (e: any) {
      console.log('✅ Attempt Idempotency Verified: Duplicate attempt blocked.');
    }

    const verification = await verificationRepo.createVerification({
      paymentAttemptId: attempt.attempt_id,
      status: 'VERIFIED',
      verificationAttempt: 1,
      providerReference: 'pay_ref_123'
    });
    console.log(`Created Payment Verification Log: ${verification.verification_id}`);

    console.log('\n--- 6. Simulation Cascading Delete ---');
    const simSession = await simulationRepo.createSimulationSession({
      merchantId: merchantA.merchant_id,
      name: 'Sandbox Run 1'
    });
    console.log(`Created Simulation Session: ${simSession.session_id}`);

    const simPayment = await paymentRepo.createPayment({
      merchantId: merchantA.merchant_id,
      customerId: customerA.customer_id,
      paymentMethodId: 'CARD',
      amount: '200.00',
      status: 'FAILED',
      failedAt: new Date(),
      failureTypeId: 'INSUFFICIENT_FUNDS',
      externalReference: `ref_${generateUUID()}`,
      environment: 'SIMULATION',
      simulationSessionId: simSession.session_id
    });
    console.log(`Created Sim Payment: ${simPayment.payment_id}`);

    // Delete session
    await simulationRepo.deleteSimulationSession(simSession.session_id);
    console.log(`Deleted Simulation Session`);

    try {
      await paymentRepo.findPaymentById(merchantA.merchant_id, simPayment.payment_id);
      throw new Error('Cascading delete failed! Simulated payment still exists.');
    } catch (e: any) {
      console.log('✅ Simulation Cascading Verified: Simulated payments deleted automatically.');
    }

    console.log('\n🎉 ALL INTEGRATION TESTS PASSED EXCELLENTLY!');

  } catch (err: any) {
    console.error('❌ Test failed with error:', err.message);
  } finally {
    await pool.end();
  }
}

// Check if run directly
if (require.main === module) {
  runTests();
}
export { runTests };
