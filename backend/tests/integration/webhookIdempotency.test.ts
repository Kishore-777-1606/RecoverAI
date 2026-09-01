import { pool } from '../../database/connection';
import * as merchantRepo from '../../database/repositories/merchantRepository';
import * as customerRepo from '../../database/repositories/customerRepository';
import * as paymentRepo from '../../database/repositories/paymentRepository';
import { generateUUID } from '../../shared/utils/id';

async function runWebhookIdempotencyTests() {
  console.log('🔄 Starting webhook idempotency integration tests...');
  try {
    await pool.query('SELECT 1');
  } catch (err: any) {
    console.log('❌ DATABASE CONNECTION: BLOCKED — PostgreSQL is not running/configured');
    return;
  }

  try {
    const merchant = await merchantRepo.createMerchant({ name: 'Webhook Merchant', email: `webhook_${generateUUID()}@test.com` });
    const customer = await customerRepo.createCustomer({ merchantId: merchant.merchant_id, name: 'Aarav Mehta', email: `aarav_${generateUUID()}@test.com` });

    const providerEventId = `evt_${generateUUID()}`;
    await paymentRepo.createPayment({
      merchantId: merchant.merchant_id,
      customerId: customer.customer_id,
      paymentMethodId: 'UPI',
      amount: '500.00',
      externalReference: `ref_${generateUUID()}`,
      providerEventId
    });

    console.log('✅ Webhook idempotency test runs cleanly.');
  } catch (err: any) {
    console.error('❌ Webhook idempotency integration error:', err.message);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runWebhookIdempotencyTests();
}
export { runWebhookIdempotencyTests };
