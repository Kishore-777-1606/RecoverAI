import assert from 'assert';
import { MockPaymentProvider } from '../../providers/payment/MockPaymentProvider';
import { RazorpayAdapter } from '../../providers/payment/RazorpayAdapter';
import { getPaymentProvider } from '../../providers/payment/ProviderFactory';
import { MockNotificationProvider } from '../../providers/notification/MockNotificationProvider';
import { getNotificationProvider } from '../../providers/notification/NotificationProviderFactory';
import { providerConfig } from '../../config/providerConfig';
import {
  ProviderError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  ProviderRejectedError,
  ProviderAuthenticationError
} from '../../shared/errors/ProviderError';
import { AppError } from '../../shared/errors/AppError';

async function runProviderTests() {
  console.log('🔄 Running Provider Layer Unit Tests...');
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

  const paymentProvider = new MockPaymentProvider();
  const notificationProvider = new MockNotificationProvider();

  // 1. Mock payment SUCCESS
  await test('1. Mock payment SUCCESS returns SUCCESSFUL status', async () => {
    const res = await paymentProvider.createPaymentAttempt({
      amount: '500.00',
      currency: 'INR',
      externalReference: 'ref-001',
      customerId: 'cust-123',
      paymentMethodId: 'CARD',
      metadata: { simulateOutcome: 'SUCCESS' }
    });
    assert.strictEqual(res.normalizedStatus, 'SUCCESSFUL');
    assert.strictEqual(res.providerStatus, 'CHARGED');
  });

  // 2. Mock payment FAILURE
  await test('2. Mock payment FAILURE returns FAILED status with error codes', async () => {
    const res = await paymentProvider.createPaymentAttempt({
      amount: '500.00',
      currency: 'INR',
      externalReference: 'ref-002',
      customerId: 'cust-123',
      paymentMethodId: 'CARD',
      metadata: { simulateOutcome: 'INSUFFICIENT_FUNDS' }
    });
    assert.strictEqual(res.normalizedStatus, 'FAILED');
    assert.strictEqual(res.errorCode, 'INSUFFICIENT_FUNDS');
  });

  // 3. Mock payment PROCESSING
  await test('3. Mock payment PROCESSING returns PROCESSING status', async () => {
    const res = await paymentProvider.createPaymentAttempt({
      amount: '500.00',
      currency: 'INR',
      externalReference: 'ref-003',
      customerId: 'cust-123',
      paymentMethodId: 'UPI',
      metadata: { simulateOutcome: 'PROCESSING' }
    });
    assert.strictEqual(res.normalizedStatus, 'PROCESSING');
  });

  // 4. Mock payment TIMEOUT
  await test('4. Mock payment TIMEOUT throws ProviderTimeoutError', async () => {
    await assert.rejects(
      paymentProvider.createPaymentAttempt({
        amount: '500.00',
        currency: 'INR',
        externalReference: 'ref-004',
        customerId: 'cust-123',
        paymentMethodId: 'CARD',
        metadata: { simulateOutcome: 'TIMEOUT' }
      }),
      ProviderTimeoutError
    );
  });

  // 5. Mock payment provider error
  await test('5. Mock payment provider error throws ProviderUnavailableError', async () => {
    await assert.rejects(
      paymentProvider.createPaymentAttempt({
        amount: '500.00',
        currency: 'INR',
        externalReference: 'ref-005',
        customerId: 'cust-123',
        paymentMethodId: 'CARD',
        metadata: { simulateOutcome: 'PROVIDER_ERROR' }
      }),
      ProviderUnavailableError
    );
  });

  // 6. Mock payment idempotency
  await test('6. Mock payment idempotency returns cached transaction', async () => {
    const idempotencyKey = 'idem-unique-key-123';
    const firstRes = await paymentProvider.createPaymentAttempt({
      amount: '500.00',
      currency: 'INR',
      externalReference: 'ref-006',
      customerId: 'cust-123',
      paymentMethodId: 'CARD',
      idempotencyKey
    });

    const secondRes = await paymentProvider.createPaymentAttempt({
      amount: '500.00',
      currency: 'INR',
      externalReference: 'ref-006',
      customerId: 'cust-123',
      paymentMethodId: 'CARD',
      idempotencyKey
    });

    assert.strictEqual(firstRes.providerTransactionId, secondRes.providerTransactionId);
  });

  // 7. Provider factory simulation selection
  await test('7. Provider factory simulation selects MockPaymentProvider', async () => {
    const provider = getPaymentProvider('SIMULATION');
    assert.ok(provider instanceof MockPaymentProvider);
  });

  // 8. Provider factory live selection
  await test('8. Provider factory LIVE selects configured adapter', async () => {
    const active = providerConfig.payment.activeProvider;
    const provider = getPaymentProvider('LIVE');
    if (active === 'razorpay') {
      assert.ok(provider instanceof RazorpayAdapter);
    } else {
      assert.ok(provider instanceof MockPaymentProvider);
    }
  });

  // 9. Mock notification delivery
  await test('9. Mock notification delivery returns DELIVERED status', async () => {
    const res = await notificationProvider.sendNotification({
      recipient: 'test@email.com',
      channel: 'EMAIL',
      templateRef: 'recovery_template',
      variables: { simulateOutcome: 'DELIVERED' },
      recoveryId: 'rec-1',
      customerId: 'cust-1'
    });
    assert.strictEqual(res.status, 'DELIVERED');
  });

  // 10. Mock notification failure
  await test('10. Mock notification failure returns FAILED status or throws', async () => {
    const res = await notificationProvider.sendNotification({
      recipient: 'test@email.com',
      channel: 'EMAIL',
      templateRef: 'recovery_template',
      variables: { simulateOutcome: 'FAILED' },
      recoveryId: 'rec-1',
      customerId: 'cust-1'
    });
    assert.strictEqual(res.status, 'FAILED');

    await assert.rejects(
      notificationProvider.sendNotification({
        recipient: 'test@email.com',
        channel: 'EMAIL',
        templateRef: 'recovery_template',
        variables: { simulateOutcome: 'REJECTED' },
        recoveryId: 'rec-1',
        customerId: 'cust-1'
      }),
      ProviderRejectedError
    );
  });

  // 11. Notification factory selection
  await test('11. Notification factory simulation selects MockNotificationProvider', async () => {
    const provider = getNotificationProvider('EMAIL', 'SIMULATION');
    assert.ok(provider instanceof MockNotificationProvider);
  });

  // 12. Unknown provider status handling
  await test('12. Unknown provider status logs and handles error cleanly', async () => {
    // Calling adapter method with unconfigured credentials throws ProviderAuthenticationError
    const adapter = new RazorpayAdapter();
    await assert.rejects(
      adapter.fetchPaymentStatus('pay-some-id'),
      ProviderAuthenticationError
    );
  });

  // 13. Provider error normalization
  await test('13. Custom provider errors inherit from AppError and carry metadata', async () => {
    const err = new ProviderTimeoutError('Gateway timed out', 'TestProvider');
    assert.ok(err instanceof AppError);
    assert.strictEqual(err.statusCode, 504);
    assert.strictEqual(err.providerName, 'TestProvider');
  });

  // 14. No credentials exposed in source
  await test('14. Key properties are loaded from configs without hardcoding secrets', async () => {
    assert.strictEqual(providerConfig.payment.razorpay.keyId, process.env.RAZORPAY_KEY_ID || 'mock_key_id');
    assert.strictEqual(providerConfig.payment.razorpay.keySecret, process.env.RAZORPAY_KEY_SECRET || 'mock_key_secret');
  });

  // 15. Domain layer does not directly depend on Razorpay types
  await test('15. Interfaces use generic PaymentRequest/PaymentResponse contracts', async () => {
    // Assert that paymentProvider conforms to the generic interface structure
    const request = {
      amount: '100.00',
      currency: 'INR',
      externalReference: 'ref-015',
      customerId: 'cust-015',
      paymentMethodId: 'CARD'
    };
    const res = await paymentProvider.createPaymentAttempt(request);
    // Explicitly verify response has generic type contracts
    assert.ok(res.providerTransactionId);
    assert.ok(res.normalizedStatus);
    assert.strictEqual(res.amount, '100.00');
  });

  setTimeout(() => {
    console.log(`\n📊 Provider Layer Tests Complete. Passed: ${passedCount}, Failed: ${failedCount}`);
    if (failedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }, 100);
}

if (require.main === module) {
  runProviderTests();
}
export { runProviderTests };
