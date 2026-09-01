import * as paymentService from '../../modules/payments/paymentService';
import * as paymentRepo from '../../database/repositories/paymentRepository';
import * as policyRepo from '../../database/repositories/policyRepository';
import * as recoveryService from '../../modules/recovery/recoveryService';
import * as recoveryRepo from '../../database/repositories/recoveryRepository';
import * as actionRepo from '../../database/repositories/recoveryActionRepository';
import { evaluateRecovery } from '../../modules/ai/decisionEngine';
import { eventBus } from '../eventBus';
import { NormalizedPaymentEvent } from '../eventNormalizer';
import { ValidationError } from '../../shared/errors/ValidationError';
import { logger } from '../../shared/logging/logger';

export type PaymentEventProcessingResult =
  | 'PAYMENT_UPDATED'
  | 'PAYMENT_ALREADY_TERMINAL'
  | 'RECOVERY_CREATED'
  | 'RECOVERY_ALREADY_EXISTS'
  | 'IGNORED';

/**
 * Handles internal internal failed payment events.
 * Executes transitions, calls the AI/Policy engine, and kicks off recovery campaigns.
 */
export async function handlePaymentFailed(event: NormalizedPaymentEvent): Promise<PaymentEventProcessingResult> {
  logger.info('Payment failed event subscriber invoked', { externalReference: event.externalReference });

  // 1. Resolve payment globally by external checkout reference
  const payment = await paymentRepo.findPaymentByExternalReferenceGlobal(event.externalReference);
  if (!payment) {
    logger.warn('Payment event ignored: payment reference not found in database', { externalReference: event.externalReference });
    return 'IGNORED';
  }

  // 2. Reject out-of-order or duplicate terminal transitions (Safety rules)
  if (payment.status === 'SUCCESSFUL' || payment.status === 'FAILED') {
    logger.info('Ignoring event because payment status is already terminal', {
      paymentId: payment.payment_id,
      currentStatus: payment.status
    });
    return 'PAYMENT_ALREADY_TERMINAL';
  }

  // 3. Transition base payment status to FAILED in the repository
  // If current status is INITIATED, transition through PROCESSING first to satisfy state machine validation rules
  if (payment.status === 'INITIATED') {
    await paymentService.transitionPayment(
      payment.merchant_id,
      payment.payment_id,
      'PROCESSING',
      { providerEventId: event.providerEventId }
    );
  }

  await paymentService.transitionPayment(
    payment.merchant_id,
    payment.payment_id,
    'FAILED',
    {
      failedAt: event.occurredAt || new Date(),
      failureTypeId: event.failureCode || 'OTHER_UNKNOWN',
      failureMessage: event.failureMessage || 'Transaction declined by gateway',
      providerEventId: event.providerEventId
    }
  );

  // 4. Double check if recovery campaign already exists to prevent duplicate creation
  const existingRecovery = await recoveryRepo.findRecoveryByPaymentId(
    payment.merchant_id,
    payment.payment_id
  );
  if (existingRecovery) {
    logger.info('Recovery campaign already exists for payment. Skipping duplicates.', { paymentId: payment.payment_id });
    return 'RECOVERY_ALREADY_EXISTS';
  }

  // 5. Evaluate recovery campaign eligibility using AI Decision + Policy Engine
  const decision = await evaluateRecovery(payment.merchant_id, payment.payment_id, event.occurredAt);
  if (!decision.eligible) {
    logger.info('Recovery campaign evaluation ineligible for failed payment', {
      paymentId: payment.payment_id,
      reason: decision.explanation
    });
    return 'PAYMENT_UPDATED';
  }

  // 6. Inspect merchant policy threshold to check if manual manager approval is required
  let approvalRequired = false;
  if (decision.policyEvaluation.activePolicyId) {
    const policy = await policyRepo.findActivePolicyByMerchant(payment.merchant_id);
    if (policy && policy.approval_threshold) {
      const paymentAmt = parseFloat(payment.amount);
      const thresholdAmt = parseFloat(policy.approval_threshold);
      if (paymentAmt > thresholdAmt) {
        approvalRequired = true;
        logger.info('Manual manager approval required for recovery campaign (amount exceeds policy threshold)', {
          paymentId: payment.payment_id,
          amount: payment.amount,
          threshold: policy.approval_threshold
        });
      }
    }
  }

  // 7. Initialize Recovery Campaign
  const recovery = await recoveryService.createRecovery(payment.merchant_id, {
    payment_id: payment.payment_id,
    merchant_id: payment.merchant_id,
    customer_id: payment.customer_id,
    amount: payment.amount,
    ai_recommended_strategy_id: decision.recommendedStrategy || undefined,
    ai_confidence_score: decision.confidenceScore,
    ai_recommended_timing: decision.recommendedTiming || undefined,
    ai_explanation: decision.explanation,
    ai_failure_classification: decision.failureClassification,
    selected_strategy_id: decision.recommendedStrategy || undefined,
    approval_required: approvalRequired
  });

  // 8. Log Initial Recovery Action record
  await actionRepo.createRecoveryAction({
    recoveryId: recovery.recovery_id,
    strategyId: decision.recommendedStrategy || 'RECOVERY_LINK',
    actionType: 'INITIALIZATION',
    status: 'SUCCESS',
    attemptNumber: 1,
    metadata: {
      explanation: decision.explanation,
      confidenceScore: decision.confidenceScore
    }
  });

  // 9. Dispatch internal event to alert timeline logs
  await eventBus.publish('recovery.created', { recovery, decision });

  return 'RECOVERY_CREATED';
}

/**
 * Handles successful payment webhook events.
 */
export async function handlePaymentSuccessful(event: NormalizedPaymentEvent): Promise<PaymentEventProcessingResult> {
  logger.info('Payment successful event subscriber invoked', { externalReference: event.externalReference });

  const payment = await paymentRepo.findPaymentByExternalReferenceGlobal(event.externalReference);
  if (!payment) {
    logger.warn('Payment reference not found', { externalReference: event.externalReference });
    return 'IGNORED';
  }

  if (payment.status === 'SUCCESSFUL' || payment.status === 'FAILED') {
    logger.info('Ignoring success event: payment is already terminal', { paymentId: payment.payment_id });
    return 'PAYMENT_ALREADY_TERMINAL';
  }

  // Transition base payment status to SUCCESSFUL
  // If status is INITIATED, transition through PROCESSING first to satisfy state machine validation rules
  if (payment.status === 'INITIATED') {
    await paymentService.transitionPayment(
      payment.merchant_id,
      payment.payment_id,
      'PROCESSING',
      { providerEventId: event.providerEventId }
    );
  }

  await paymentService.recordPaymentSuccess(
    payment.merchant_id,
    payment.payment_id,
    event.occurredAt || new Date(),
    event.providerEventId
  );

  return 'PAYMENT_UPDATED';
}

/**
 * Handles processing payment webhook events.
 */
export async function handlePaymentProcessing(event: NormalizedPaymentEvent): Promise<PaymentEventProcessingResult> {
  logger.info('Payment processing event subscriber invoked', { externalReference: event.externalReference });

  const payment = await paymentRepo.findPaymentByExternalReferenceGlobal(event.externalReference);
  if (!payment) {
    return 'IGNORED';
  }

  if (payment.status === 'SUCCESSFUL' || payment.status === 'FAILED') {
    return 'PAYMENT_ALREADY_TERMINAL';
  }

  await paymentService.transitionPayment(
    payment.merchant_id,
    payment.payment_id,
    'PROCESSING',
    { providerEventId: event.providerEventId }
  );

  return 'PAYMENT_UPDATED';
}

/**
 * Registers all payment event bus handler subscriptions on bootstrap.
 */
export function registerPaymentHandlers(): void {
  eventBus.subscribe('payment.failed', async (evt) => { await handlePaymentFailed(evt); });
  eventBus.subscribe('payment.successful', async (evt) => { await handlePaymentSuccessful(evt); });
  eventBus.subscribe('payment.processing', async (evt) => { await handlePaymentProcessing(evt); });
}
