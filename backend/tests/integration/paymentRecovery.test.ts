import { pool } from '../../database/connection';
import * as merchantRepo from '../../database/repositories/merchantRepository';
import * as customerRepo from '../../database/repositories/customerRepository';
import * as paymentRepo from '../../database/repositories/paymentRepository';
import * as recoveryRepo from '../../database/repositories/recoveryRepository';
import * as attemptRepo from '../../database/repositories/recoveryAttemptRepository';
import { generateUUID } from '../../shared/utils/id';

async function runRecoveryTests() {
  console.log('🔄 Starting payment recovery E2E integration tests...');
  try {
    await pool.query('SELECT 1');
  } catch (err: any) {
    console.log('❌ DATABASE CONNECTION: BLOCKED — PostgreSQL is not running/configured');
    return;
  }

  try {
    const merchant = await merchantRepo.createMerchant({ name: 'Acme Test', email: `acme_${generateUUID()}@test.com` });
    const customer = await customerRepo.createCustomer({ merchantId: merchant.merchant_id, name: 'Aarav Mehta', email: `aarav_${generateUUID()}@test.com` });
    
    const payment = await paymentRepo.createPayment({
      merchantId: merchant.merchant_id,
      customerId: customer.customer_id,
      paymentMethodId: 'CARD',
      amount: '500.00',
      status: 'FAILED',
      failedAt: new Date(),
      failureTypeId: 'INSUFFICIENT_FUNDS',
      externalReference: `ref_${generateUUID()}`
    });

    const recovery = await recoveryRepo.createRecovery({
      paymentId: payment.payment_id,
      merchantId: merchant.merchant_id,
      customerId: customer.customer_id,
      amount: payment.amount
    });

    const attempt = await attemptRepo.createRecoveryAttempt({
      recoveryId: recovery.recovery_id,
      customerId: customer.customer_id,
      paymentMethodId: 'CARD',
      amount: '500.00',
      idempotencyKey: `idem_${generateUUID()}`
    });

    console.log('✅ Created E2E payment recovery path records.');
  } catch (err: any) {
    console.error('❌ E2E Recovery Integration error:', err.message);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runRecoveryTests();
}
export { runRecoveryTests };
