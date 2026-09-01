import { PoolClient } from 'pg';
import * as paymentRepo from '../../database/repositories/paymentRepository';
import { validatePaymentTransition } from './paymentStateMachine';
import { Payment, CreatePaymentInput, PaymentStatus } from './paymentTypes';
import { ValidationError } from '../../shared/errors/ValidationError';
import { logger } from '../../shared/logging/logger';

/**
 * Creates a new original checkout payment record.
 */
export async function createPayment(
  input: CreatePaymentInput,
  client?: PoolClient
): Promise<Payment> {
  // Validate basic inputs
  if (parseFloat(input.amount) <= 0) {
    throw new ValidationError('Payment amount must be greater than 0');
  }
  if (!input.external_reference) {
    throw new ValidationError('External reference is required');
  }

  // Delegate creation to repository
  const dbPayment = await paymentRepo.createPayment({
    merchantId: input.merchant_id,
    customerId: input.customer_id,
    paymentMethodId: input.payment_method_id,
    amount: input.amount,
    currency: input.currency,
    status: input.status,
    externalReference: input.external_reference,
    providerEventId: input.provider_event_id,
    environment: input.environment,
    simulationSessionId: input.simulation_session_id
  }, client);

  return dbPayment as unknown as Payment;
}

/**
 * Retrieves a payment by its ID, enforcing tenant merchant isolation boundaries.
 */
export async function getPayment(
  merchantId: string,
  paymentId: string,
  client?: PoolClient
): Promise<Payment> {
  const dbPayment = await paymentRepo.findPaymentById(merchantId, paymentId, client);
  return dbPayment as unknown as Payment;
}

/**
 * Transitions a payment to a new status, checking transition rules.
 */
export async function transitionPayment(
  merchantId: string,
  paymentId: string,
  targetStatus: PaymentStatus,
  lifecycle: {
    failedAt?: Date;
    successfulAt?: Date;
    failureTypeId?: string;
    failureMessage?: string;
    providerEventId?: string;
  },
  client?: PoolClient
): Promise<Payment> {
  // 1. Fetch active state to evaluate status path
  const payment = await paymentRepo.findPaymentById(merchantId, paymentId, client);
  
  // 2. Validate state machine transition legality
  validatePaymentTransition(payment.status as PaymentStatus, targetStatus);

  // 3. Apply state-specific constraints matching DB check constraints (chk_payment_failure_state)
  if (targetStatus === 'FAILED') {
    if (!lifecycle.failedAt) {
      lifecycle.failedAt = new Date();
    }
    if (!lifecycle.failureTypeId) {
      throw new ValidationError('failureTypeId is required when transitioning to FAILED status');
    }
  } else if (targetStatus === 'SUCCESSFUL') {
    if (!lifecycle.successfulAt) {
      lifecycle.successfulAt = new Date();
    }
  }

  // 4. Update status in database repository
  const updated = await paymentRepo.updatePaymentStatus(merchantId, paymentId, targetStatus as any, lifecycle, client);
  return updated as unknown as Payment;
}

/**
 * Domain-specific wrapper to record a successful payment outcome.
 */
export async function recordPaymentSuccess(
  merchantId: string,
  paymentId: string,
  successfulAt: Date = new Date(),
  providerEventId?: string,
  client?: PoolClient
): Promise<Payment> {
  return transitionPayment(
    merchantId,
    paymentId,
    'SUCCESSFUL',
    { successfulAt, providerEventId },
    client
  );
}

/**
 * Domain-specific wrapper to record a failed payment outcome.
 */
export async function recordPaymentFailure(
  merchantId: string,
  paymentId: string,
  failureTypeId: string,
  failureMessage: string,
  failedAt: Date = new Date(),
  providerEventId?: string,
  client?: PoolClient
): Promise<Payment> {
  return transitionPayment(
    merchantId,
    paymentId,
    'FAILED',
    { failedAt, failureTypeId, failureMessage, providerEventId },
    client
  );
}

/**
 * Queries and filters payments list scoped by merchant.
 */
export async function listPayments(
  merchantId: string,
  filters: {
    customerId?: string;
    status?: string;
    environment?: 'LIVE' | 'TEST' | 'SIMULATION';
    page?: number;
    limit?: number;
  },
  client?: PoolClient
) {
  return paymentRepo.listPayments(merchantId, filters, client);
}
