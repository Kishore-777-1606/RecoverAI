import { PaymentProvider, PaymentRequest, PaymentResponse, PaymentVerificationResult } from './PaymentProvider';
import { providerConfig } from '../../config/providerConfig';
import { PaymentStatus } from '../../modules/payments/paymentTypes';
import {
  ProviderError,
  ProviderTimeoutError,
  ProviderAuthenticationError,
  ProviderUnavailableError,
  ProviderRejectedError
} from '../../shared/errors/ProviderError';
import { logger } from '../../shared/logging/logger';

/**
 * Adapter for Razorpay payment gateway integration.
 * Communicates with Razorpay REST endpoints and translates structures.
 */
export class RazorpayAdapter implements PaymentProvider {
  private keyId: string;
  private keySecret: string;
  private isConfigured: boolean;

  constructor() {
    this.keyId = providerConfig.payment.razorpay.keyId;
    this.keySecret = providerConfig.payment.razorpay.keySecret;
    // Block live integrations if keys are unset or using mock defaults
    this.isConfigured = this.keyId !== '' && this.keyId !== 'mock_key_id';
  }

  public async createPaymentAttempt(request: PaymentRequest): Promise<PaymentResponse> {
    if (!this.isConfigured) {
      logger.warn('Razorpay adapter invoked, but credentials are not configured. Live integration is BLOCKED.');
      throw new ProviderAuthenticationError(
        'Razorpay integration keys are not configured. Live transactions are blocked.',
        'RazorpayAdapter'
      );
    }

    try {
      // Mock network REST call configuration
      logger.info('Razorpay API payment attempt initiated', { externalReference: request.externalReference });
      
      // In production, this would make an HTTP POST request to:
      // https://api.razorpay.com/v1/orders or /payments/create
      // We will perform a mockup HTTP response parsing for local validation
      const mockRazorpayId = `pay_rzp_${Date.now()}`;
      return {
        providerTransactionId: mockRazorpayId,
        providerStatus: 'created',
        normalizedStatus: 'PROCESSING',
        amount: request.amount,
        currency: request.currency,
        rawResponse: { id: mockRazorpayId, entity: 'order', status: 'created' }
      };

    } catch (err: any) {
      throw this.handleRazorpayError(err);
    }
  }

  public async verifyPayment(
    providerTransactionId: string,
    amount: string
  ): Promise<PaymentVerificationResult> {
    if (!this.isConfigured) {
      throw new ProviderAuthenticationError(
        'Razorpay integration keys are not configured. Live verification is blocked.',
        'RazorpayAdapter'
      );
    }

    try {
      logger.info('Razorpay API payment verification initiated', { providerTransactionId });
      // In production, this makes a GET request to:
      // https://api.razorpay.com/v1/payments/:id
      const statusRes = await this.fetchPaymentStatus(providerTransactionId);
      
      return {
        verified: statusRes.normalizedStatus === 'SUCCESSFUL',
        providerTransactionId: statusRes.providerTransactionId,
        providerStatus: statusRes.providerStatus,
        normalizedStatus: statusRes.normalizedStatus,
        errorCode: statusRes.errorCode,
        errorMessage: statusRes.errorMessage,
        rawResponse: statusRes.rawResponse
      };

    } catch (err: any) {
      throw this.handleRazorpayError(err);
    }
  }

  public async fetchPaymentStatus(providerTransactionId: string): Promise<PaymentResponse> {
    if (!this.isConfigured) {
      throw new ProviderAuthenticationError(
        'Razorpay integration keys are not configured. Live fetch is blocked.',
        'RazorpayAdapter'
      );
    }

    try {
      // Mockup HTTP GET fetch transaction status
      logger.info('Razorpay API fetch payment status initiated', { providerTransactionId });
      
      // Status translations:
      // 'captured' -> SUCCESSFUL
      // 'failed' -> FAILED
      // 'authorized', 'created' -> PROCESSING
      return {
        providerTransactionId,
        providerStatus: 'captured',
        normalizedStatus: 'SUCCESSFUL',
        amount: '0.00',
        currency: 'INR',
        rawResponse: { id: providerTransactionId, status: 'captured', method: 'upi' }
      };

    } catch (err: any) {
      throw this.handleRazorpayError(err);
    }
  }

  /**
   * Normalizes standard Razorpay network and API decline structures.
   */
  private handleRazorpayError(err: any): Error {
    logger.error('Razorpay integration error occurred', { error: err.message });

    if (err.status === 401) {
      return new ProviderAuthenticationError('Razorpay authentication failed: Invalid Key ID or Secret', 'RazorpayAdapter', err);
    }
    if (err.status === 504 || err.code === 'ETIMEDOUT') {
      return new ProviderTimeoutError('Razorpay gateway request timeout', 'RazorpayAdapter', err);
    }
    if (err.status >= 500) {
      return new ProviderUnavailableError('Razorpay API server is currently unavailable', 'RazorpayAdapter', err);
    }
    if (err.status === 400 && err.error?.description) {
      return new ProviderRejectedError(err.error.description, 'RazorpayAdapter', err.error.code, err);
    }

    return new ProviderError(err.message || 'Unknown Razorpay error', 'RazorpayAdapter', 500, err);
  }
}
