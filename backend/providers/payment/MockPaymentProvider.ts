import { PaymentProvider, PaymentRequest, PaymentResponse, PaymentVerificationResult } from './PaymentProvider';
import { PaymentStatus } from '../../modules/payments/paymentTypes';
import { ProviderTimeoutError, ProviderUnavailableError, ProviderRejectedError } from '../../shared/errors/ProviderError';
import { generateUUID } from '../../shared/utils/id';
import { logger } from '../../shared/logging/logger';

/**
 * Sandbox Mock Payment Provider.
 * Simulates gateway behaviors deterministically without active networks.
 */
export class MockPaymentProvider implements PaymentProvider {
  // Static cache to simulate idempotency across instances during test runs
  private static transactionCache: Map<string, PaymentResponse> = new Map();

  public async createPaymentAttempt(request: PaymentRequest): Promise<PaymentResponse> {
    // 1. Enforce Idempotency constraint checks
    if (request.idempotencyKey) {
      const cached = MockPaymentProvider.transactionCache.get(request.idempotencyKey);
      if (cached) {
        logger.info('Mock provider replaying cached transaction for idempotency key', {
          idempotencyKey: request.idempotencyKey,
          transactionId: cached.providerTransactionId
        });
        return cached;
      }
    }

    const outcome = request.metadata?.simulateOutcome || 'SUCCESS';
    const txnId = `mock_txn_${generateUUID()}`;

    logger.debug('Mock provider processing payment attempt', { outcome, request });

    // 2. Deterministic simulation outcomes
    switch (outcome) {
      case 'NETWORK_ERROR':
      case 'TIMEOUT':
        throw new ProviderTimeoutError('Connection timeout during mock gateway handshake', 'MockPaymentProvider');
      
      case 'PROVIDER_ERROR':
        throw new ProviderUnavailableError('Mock gateway returns internal 500 server error', 'MockPaymentProvider');

      case 'INSUFFICIENT_FUNDS':
        const declineFundRes: PaymentResponse = {
          providerTransactionId: txnId,
          providerStatus: 'DECLINED',
          normalizedStatus: 'FAILED',
          amount: request.amount,
          currency: request.currency,
          errorCode: 'INSUFFICIENT_FUNDS',
          errorMessage: 'Insufficient balance in the customer account.',
          rawResponse: { outcome, code: 'decline_funds' }
        };
        if (request.idempotencyKey) {
          MockPaymentProvider.transactionCache.set(request.idempotencyKey, declineFundRes);
        }
        return declineFundRes;

      case 'CARD_DECLINED':
        const declineCardRes: PaymentResponse = {
          providerTransactionId: txnId,
          providerStatus: 'DECLINED',
          normalizedStatus: 'FAILED',
          amount: request.amount,
          currency: request.currency,
          errorCode: 'CARD_DECLINED',
          errorMessage: 'The credit card was declined by the issuer.',
          rawResponse: { outcome, code: 'decline_card' }
        };
        if (request.idempotencyKey) {
          MockPaymentProvider.transactionCache.set(request.idempotencyKey, declineCardRes);
        }
        return declineCardRes;

      case 'PROCESSING':
        const procRes: PaymentResponse = {
          providerTransactionId: txnId,
          providerStatus: 'PENDING_USER',
          normalizedStatus: 'PROCESSING',
          amount: request.amount,
          currency: request.currency,
          rawResponse: { outcome }
        };
        if (request.idempotencyKey) {
          MockPaymentProvider.transactionCache.set(request.idempotencyKey, procRes);
        }
        return procRes;

      case 'SUCCESS':
      default:
        const successRes: PaymentResponse = {
          providerTransactionId: txnId,
          providerStatus: 'CHARGED',
          normalizedStatus: 'SUCCESSFUL',
          amount: request.amount,
          currency: request.currency,
          rawResponse: { outcome }
        };
        if (request.idempotencyKey) {
          MockPaymentProvider.transactionCache.set(request.idempotencyKey, successRes);
        }
        return successRes;
    }
  }

  public async verifyPayment(
    providerTransactionId: string,
    amount: string
  ): Promise<PaymentVerificationResult> {
    logger.debug('Mock provider verifying payment status', { providerTransactionId, amount });

    // Mock search matching cached transactions
    const cachedTxn = Array.from(MockPaymentProvider.transactionCache.values()).find(
      tx => tx.providerTransactionId === providerTransactionId
    );

    if (cachedTxn) {
      return {
        verified: cachedTxn.normalizedStatus === 'SUCCESSFUL',
        providerTransactionId: cachedTxn.providerTransactionId,
        providerStatus: cachedTxn.providerStatus,
        normalizedStatus: cachedTxn.normalizedStatus,
        errorCode: cachedTxn.errorCode,
        errorMessage: cachedTxn.errorMessage,
        rawResponse: cachedTxn.rawResponse
      };
    }

    // Default to verified if not found in mock cache (e.g. direct verify test cases)
    return {
      verified: true,
      providerTransactionId,
      providerStatus: 'CHARGED',
      normalizedStatus: 'SUCCESSFUL',
      rawResponse: { status: 'mock_verified' }
    };
  }

  public async fetchPaymentStatus(providerTransactionId: string): Promise<PaymentResponse> {
    logger.debug('Mock provider fetching status', { providerTransactionId });
    
    const cachedTxn = Array.from(MockPaymentProvider.transactionCache.values()).find(
      tx => tx.providerTransactionId === providerTransactionId
    );

    if (cachedTxn) {
      return cachedTxn;
    }

    return {
      providerTransactionId,
      providerStatus: 'CHARGED',
      normalizedStatus: 'SUCCESSFUL',
      amount: '0.00',
      currency: 'INR',
      rawResponse: { status: 'mock_fetched' }
    };
  }
}
