import { PaymentStatus } from '../modules/payments/paymentTypes';
import { ValidationError } from '../shared/errors/ValidationError';
import { logger } from '../shared/logging/logger';

export interface NormalizedPaymentEvent {
  provider: 'razorpay' | 'mock';
  providerEventId: string;
  eventType: string; // original gateway event key
  paymentReference: string; // gateway transaction identifier
  externalReference: string; // merchant reference
  status: PaymentStatus;
  amount: string; // decimal money string
  currency: string;
  customerReference?: string;
  failureCode?: string;
  failureMessage?: string;
  occurredAt: Date;
  metadata: any;
}

/**
 * Normalizes vendor-specific webhook payloads into a standard internal format.
 */
export function normalizePaymentWebhook(
  provider: string,
  payload: any,
  headers: Record<string, string> = {}
): NormalizedPaymentEvent {
  const provLower = provider.toLowerCase();

  logger.debug('Normalizing incoming payment webhook', { provider: provLower, event: payload?.event });

  if (provLower === 'razorpay') {
    // 1. Process Razorpay Event Payload structure
    if (!payload || !payload.event || !payload.payload?.payment?.entity) {
      throw new ValidationError('Malformed Razorpay webhook payload format');
    }

    const eventType = payload.event;
    const paymentEntity = payload.payload.payment.entity;

    // Convert Razorpay integer subunits (paise) back to base decimal string
    const amountSubunits = parseInt(paymentEntity.amount, 10) || 0;
    const decimalAmount = (amountSubunits / 100).toFixed(2);

    // Map status from event type keys
    let status: PaymentStatus = 'PROCESSING';
    if (eventType === 'payment.captured') {
      status = 'SUCCESSFUL';
    } else if (eventType === 'payment.failed') {
      status = 'FAILED';
    } else if (eventType === 'payment.authorized') {
      status = 'PROCESSING';
    } else if (eventType === 'order.created') {
      status = 'INITIATED';
    }

    // Extract internal reference from custom metadata notes
    const externalReference = paymentEntity.notes?.external_reference || '';
    if (!externalReference) {
      throw new ValidationError('Razorpay webhook metadata is missing the required external_reference');
    }

    const occurredAt = paymentEntity.created_at
      ? new Date(paymentEntity.created_at * 1000)
      : new Date();

    return {
      provider: 'razorpay',
      providerEventId: payload.id || `rzp_evt_${Date.now()}`,
      eventType,
      paymentReference: paymentEntity.id || '',
      externalReference,
      status,
      amount: decimalAmount,
      currency: paymentEntity.currency || 'INR',
      failureCode: paymentEntity.error_code || undefined,
      failureMessage: paymentEntity.error_description || undefined,
      occurredAt,
      metadata: payload
    };

  } else if (provLower === 'mock') {
    // 2. Process Mock Simulator Event payload structure
    if (!payload || !payload.event || !payload.externalReference) {
      throw new ValidationError('Malformed mock webhook payload format');
    }

    let status: PaymentStatus = 'PROCESSING';
    const evt = payload.event.toLowerCase();
    if (evt.includes('success')) {
      status = 'SUCCESSFUL';
    } else if (evt.includes('failed')) {
      status = 'FAILED';
    } else if (evt.includes('processing')) {
      status = 'PROCESSING';
    } else if (evt.includes('initiated')) {
      status = 'INITIATED';
    }

    return {
      provider: 'mock',
      providerEventId: payload.eventId || `mock_evt_${Date.now()}`,
      eventType: payload.event,
      paymentReference: payload.txnId || `mock_txn_${Date.now()}`,
      externalReference: payload.externalReference,
      status,
      amount: payload.amount || '0.00',
      currency: payload.currency || 'INR',
      failureCode: payload.failureCode || undefined,
      failureMessage: payload.failureMessage || undefined,
      occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : new Date(),
      metadata: payload
    };
  }

  throw new ValidationError(`Unsupported payment webhook provider: ${provider}`);
}
