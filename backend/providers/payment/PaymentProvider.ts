import { PaymentStatus } from '../../modules/payments/paymentTypes';

export interface PaymentRequest {
  amount: string; // decimal string (NUMERIC)
  currency: string;
  externalReference: string;
  customerId: string;
  paymentMethodId: string;
  metadata?: Record<string, any>;
  idempotencyKey?: string;
}

export interface PaymentResponse {
  providerTransactionId: string;
  providerStatus: string;
  normalizedStatus: PaymentStatus;
  amount: string;
  currency: string;
  rawResponse: any;
  errorCode?: string;
  errorMessage?: string;
}

export interface PaymentVerificationResult {
  verified: boolean;
  providerTransactionId: string;
  providerStatus: string;
  normalizedStatus: PaymentStatus;
  rawResponse: any;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Standard Payment Provider interface.
 * Decouples the application layer from external gateway APIs.
 */
export interface PaymentProvider {
  /**
   * Initializes a payment attempt on the gateway.
   */
  createPaymentAttempt(request: PaymentRequest): Promise<PaymentResponse>;

  /**
   * Verifies the payment transaction status with the gateway.
   */
  verifyPayment(providerTransactionId: string, amount: string): Promise<PaymentVerificationResult>;

  /**
   * Fetches the current payment transaction status from the gateway.
   */
  fetchPaymentStatus(providerTransactionId: string): Promise<PaymentResponse>;
}
