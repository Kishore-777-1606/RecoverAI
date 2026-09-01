import { PoolClient } from 'pg';
import * as recoveryRepo from '../../database/repositories/recoveryRepository';
import * as paymentRepo from '../../database/repositories/paymentRepository';
import { validateRecoveryTransition } from './recoveryStateMachine';
import { Recovery, CreateRecoveryInput, TransitionRecoveryInput, RecoveryStatus, RecoveryStage } from './recoveryTypes';
import { ValidationError } from '../../shared/errors/ValidationError';
import { withTransaction } from '../../database/transaction';
import { logger } from '../../shared/logging/logger';
import * as actionRepo from '../../database/repositories/recoveryActionRepository';
import * as attemptRepo from '../../database/repositories/recoveryAttemptRepository';
import { pool } from '../../database/connection';
import crypto from 'crypto';
import * as linkRepo from '../../database/repositories/recoveryLinkRepository';
import * as policyRepo from '../../database/repositories/policyRepository';
import * as customerRepo from '../../database/repositories/customerRepository';
import * as merchantRepo from '../../database/repositories/merchantRepository';
import { sendNotification } from '../notifications/notificationService';

/**
 * Initiates a new recovery campaign for a failed payment.
 * Validates eligibility constraints (payment must be FAILED, and no prior recoveries exist).
 */
export async function createRecovery(
  merchantId: string,
  input: CreateRecoveryInput,
  client?: PoolClient
): Promise<Recovery> {
  const execute = async (tx: PoolClient): Promise<Recovery> => {
    // 1. Fetch parent payment to verify existence and check status eligibility
    const payment = await paymentRepo.findPaymentById(merchantId, input.payment_id, tx);
    
    if (payment.status !== 'FAILED') {
      throw new ValidationError(
        `Payment ${input.payment_id} is ineligible for recovery. Status must be 'FAILED', but is currently '${payment.status}'.`
      );
    }

    // 2. Prevent duplicate recoveries (recoveries.payment_id is UNIQUE)
    const existing = await recoveryRepo.findRecoveryByPaymentId(merchantId, input.payment_id, tx);
    if (existing) {
      throw new ValidationError(`A recovery campaign already exists for payment ${input.payment_id}`);
    }

    // 3. Ensure identity fields match parent payment exactly to prevent mismatched customers/merchants
    if (payment.merchant_id !== merchantId || payment.merchant_id !== input.merchant_id) {
      throw new ValidationError('Merchant ID mismatch between parent payment and recovery input');
    }
    if (payment.customer_id !== input.customer_id) {
      throw new ValidationError('Customer ID mismatch between parent payment and recovery input');
    }

    // 4. Create recovery campaign record
    const created = await recoveryRepo.createRecovery({
      paymentId: input.payment_id,
      merchantId: merchantId,
      customerId: input.customer_id,
      aiRecommendedStrategyId: input.ai_recommended_strategy_id,
      aiConfidenceScore: input.ai_confidence_score,
      aiRecommendedTiming: input.ai_recommended_timing,
      aiExplanation: input.ai_explanation,
      aiFailureClassification: input.ai_failure_classification,
      selectedStrategyId: input.selected_strategy_id,
      approvalRequired: input.approval_required,
      amount: payment.amount, // Enforce amount matches parent payment exactly
      environment: payment.environment as any, // Match checkout sandbox environment
      simulationSessionId: payment.simulation_session_id || undefined,
      expiresAt: input.expires_at
    }, tx);

    // 5. Create initial campaign timeline event log
    await recoveryRepo.createRecoveryEvent({
      recoveryId: created.recovery_id,
      eventType: 'CAMPAIGN_STARTED',
      eventStatus: 'SUCCESS',
      description: `Recovery campaign initialized for failed payment. Amount: ${payment.currency} ${payment.amount}.`,
      actor: 'SYSTEM',
      metadata: { payment_id: payment.payment_id }
    }, tx);

    return created as unknown as Recovery;
  };

  if (client) {
    return execute(client);
  } else {
    return withTransaction<Recovery>(execute);
  }
}

/**
 * Retrieves a recovery campaign by its ID, enforcing tenant merchant isolation boundaries.
 */
export async function getRecovery(
  merchantId: string,
  recoveryId: string,
  client?: PoolClient
): Promise<Recovery> {
  const dbRecovery = await recoveryRepo.findRecoveryById(merchantId, recoveryId, client);
  return dbRecovery as unknown as Recovery;
}

/**
 * Retrieves a recovery campaign associated with a specific payment ID.
 */
export async function getRecoveryByPayment(
  merchantId: string,
  paymentId: string,
  client?: PoolClient
): Promise<Recovery | null> {
  const dbRecovery = await recoveryRepo.findRecoveryByPaymentId(merchantId, paymentId, client);
  return dbRecovery as unknown as Recovery | null;
}

/**
 * Transitions recovery status and stages, logging the transitions to the timeline.
 */
export async function transitionRecovery(
  merchantId: string,
  recoveryId: string,
  updates: TransitionRecoveryInput,
  actor: 'SYSTEM' | 'AI_ENGINE' | 'MERCHANT' | 'CUSTOMER' = 'SYSTEM',
  client?: PoolClient
): Promise<Recovery> {
  const execute = async (tx: PoolClient): Promise<Recovery> => {
    // 1. Fetch active state to validate path legality
    const recovery = await recoveryRepo.findRecoveryById(merchantId, recoveryId, tx);

    // 2. Validate status transition (if changing status)
    if (updates.status) {
      validateRecoveryTransition(recovery.status as RecoveryStatus, updates.status);
    }

    const repoUpdates: any = {
      status: updates.status,
      currentStage: updates.current_stage || (updates as any).currentStage,
      selectedStrategyId: updates.selected_strategy_id || (updates as any).selectedStrategyId,
      approvedAt: (updates as any).approved_at || (updates as any).approvedAt,
      completedAt: updates.completed_at || (updates as any).completedAt,
      cancelledAt: (updates as any).cancelled_at || (updates as any).cancelledAt,
      cancellationReason: updates.cancellation_reason || (updates as any).cancellationReason,
    };

    // 3. Apply terminal lifecycle timestamps
    const now = new Date();
    if (updates.status && ['RECOVERED', 'FAILED', 'EXPIRED', 'CANCELLED', 'NOT_RECOVERABLE'].includes(updates.status)) {
      repoUpdates.completedAt = repoUpdates.completedAt || now;
      repoUpdates.currentStage = 'COMPLETED'; // Terminal status maps to COMPLETED stage
    }

    if (updates.status === 'CANCELLED') {
      repoUpdates.cancelledAt = repoUpdates.cancelledAt || now;
      if (!repoUpdates.cancellationReason) {
        throw new ValidationError('cancellation_reason is required when cancelling a recovery campaign');
      }
    }

    // 4. Update status in database repository
    const updated = await recoveryRepo.updateRecoveryStatus(merchantId, recoveryId, repoUpdates, tx);

    // 5. Append transition event to timeline log
    const statusText = updates.status ? `Status changed to ${updates.status}.` : '';
    const stageText = updates.current_stage ? `Stage changed to ${updates.current_stage}.` : '';
    await recoveryRepo.createRecoveryEvent({
      recoveryId,
      eventType: 'CAMPAIGN_TRANSITION',
      eventStatus: 'SUCCESS',
      description: `Recovery campaign transition. ${statusText} ${stageText}`.trim(),
      actor,
      metadata: { updates }
    }, tx);

    return updated as unknown as Recovery;
  };

  if (client) {
    return execute(client);
  } else {
    return withTransaction<Recovery>(execute);
  }
}

/**
 * Lists and filters recoveries scoped by merchant.
 */
export async function listRecoveries(
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
  return recoveryRepo.listRecoveries(merchantId, filters, client);
}

/**
 * Aggregates all related checkout, campaign history, actions and retries for a recovery detail view.
 */
export async function getRecoveryDetails(
  merchantId: string,
  recoveryId: string,
  client?: PoolClient
) {
  const db = client || pool;
  const recovery = await recoveryRepo.findRecoveryById(merchantId, recoveryId, db as any);
  const payment = await paymentRepo.findPaymentById(merchantId, recovery.payment_id, db as any);
  const actions = await actionRepo.listActionsByRecovery(recoveryId, db as any);
  const attempts = await attemptRepo.listAttemptsByRecovery(recoveryId, db as any);

  const eventsQuery = `
    SELECT event_id, event_type, event_status, description, actor, created_at
    FROM recovery_events
    WHERE recovery_id = $1
    ORDER BY created_at ASC
  `;
  const eventsRes = await db.query(eventsQuery, [recoveryId]);

  return {
    recovery,
    payment,
    actions,
    attempts,
    events: eventsRes.rows
  };
}

/**
 * Executes the outreach or retry strategy assigned to a recovery campaign.
 */
export async function executeRecoveryStrategy(
  merchantId: string,
  recoveryId: string,
  client?: PoolClient
): Promise<void> {
  const execute = async (tx: PoolClient): Promise<void> => {
    // 1. Fetch recovery campaign details
    const recovery = await recoveryRepo.findRecoveryById(merchantId, recoveryId, tx);
    
    // Prevent execution if campaign is already terminal
    if (['RECOVERED', 'FAILED', 'EXPIRED', 'CANCELLED', 'NOT_RECOVERABLE'].includes(recovery.status)) {
      logger.warn('Skipping strategy execution: recovery campaign is in terminal status', { recoveryId, status: recovery.status });
      return;
    }

    const strategy = recovery.selected_strategy_id || 'RECOVERY_LINK';
    const customer = await customerRepo.findCustomerById(merchantId, recovery.customer_id, tx);
    const merchant = await merchantRepo.findMerchantById(merchantId, tx);
    const activePolicy = await policyRepo.findActivePolicyByMerchant(merchantId, tx);

    if (strategy === 'RECOVERY_LINK' || strategy === 'CUSTOMER_REMINDER') {
      // Find or generate a secure recovery link
      let links = await linkRepo.listLinksByRecovery(recoveryId, tx);
      let activeLink = links.find(l => l.status === 'ACTIVE');
      if (!activeLink) {
        const secureToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 86400 * 7 * 1000); // 7 days expiry
        activeLink = await linkRepo.createRecoveryLink({
          recoveryId,
          secureToken,
          expiresAt
        }, tx);
      }

      // Log the recovery action
      const actionType = strategy === 'RECOVERY_LINK' ? 'LINK_DISPATCH' : 'REMINDER_DISPATCH';
      
      const actions = await actionRepo.listActionsByRecovery(recoveryId, tx);
      const strategyActionsCount = actions.filter(a => a.strategy_id === strategy).length;
      const attemptNumber = strategyActionsCount + 1;

      const actionRecord = await actionRepo.createRecoveryAction({
        recoveryId,
        strategyId: strategy,
        actionType,
        status: 'PENDING',
        attemptNumber
      }, tx);

      // Construct customer recovery landing URL
      const recoveryUrl = `${process.env.CUSTOMER_PORTAL_BASE_URL || 'http://localhost:3000'}/customer/recovery/${activeLink.secure_token}`;

      // Resolve communication channels from policy or default to SMS + EMAIL
      let channelsToSend: ('SMS' | 'EMAIL' | 'WHATSAPP')[] = ['SMS', 'EMAIL'];
      if (activePolicy && activePolicy.channels) {
        channelsToSend = activePolicy.channels
          .filter(c => c.is_enabled)
          .map(c => c.channel);
      }

      let dispatchSuccess = false;
      const errors: string[] = [];

      for (const channel of channelsToSend) {
        try {
          await sendNotification(
            merchantId,
            recoveryId,
            recovery.customer_id,
            channel,
            strategy, // templateRef matches strategy name by default
            {
              customerName: customer.name,
              amount: recovery.amount.toString(),
              merchantName: merchant.name,
              recoveryUrl
            },
            tx
          );
          dispatchSuccess = true;
        } catch (err: any) {
          logger.error('Outreach channel dispatch failed', { recoveryId, channel, error: err.message });
          errors.push(`${channel}: ${err.message}`);
        }
      }

      // Update action log status
      await tx.query(`
        UPDATE recovery_actions
        SET status = $1,
            error_message = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE action_id = $3
      `, [
        dispatchSuccess ? 'SUCCESS' : 'FAILED',
        errors.length > 0 ? errors.join('; ') : null,
        actionRecord.action_id
      ]);

      // Transition recovery stage to OUTREACH
      await recoveryRepo.updateRecoveryStatus(merchantId, recoveryId, {
        currentStage: 'OUTREACH'
      }, tx);

    } else if (strategy === 'DELAYED_RETRY') {
      const actions = await actionRepo.listActionsByRecovery(recoveryId, tx);
      const strategyActionsCount = actions.filter(a => a.strategy_id === strategy).length;
      const attemptNumber = strategyActionsCount + 1;

      // Log the retry attempt action
      await actionRepo.createRecoveryAction({
        recoveryId,
        strategyId: strategy,
        actionType: 'AUTO_RETRY_SCHEDULED',
        status: 'SUCCESS',
        attemptNumber
      }, tx);

      await recoveryRepo.updateRecoveryStatus(merchantId, recoveryId, {
        currentStage: 'OUTREACH'
      }, tx);
    } else if (strategy === 'MANUAL_REVIEW') {
      const actions = await actionRepo.listActionsByRecovery(recoveryId, tx);
      const attemptNumber = actions.filter(a => a.strategy_id === strategy).length + 1;

      await actionRepo.createRecoveryAction({
        recoveryId,
        strategyId: strategy,
        actionType: 'MANUAL_ESCALATION',
        status: 'SUCCESS',
        attemptNumber
      }, tx);

      await recoveryRepo.updateRecoveryStatus(merchantId, recoveryId, {
        currentStage: 'ANALYSIS'
      }, tx);
    }
  };

  if (client) {
    await execute(client);
  } else {
    await withTransaction<void>(execute);
  }
}

/**
 * Approves a pending recovery campaign and kicks off its execution.
 */
export async function approveRecovery(
  merchantId: string,
  recoveryId: string,
  client?: PoolClient
): Promise<Recovery> {
  const execute = async (tx: PoolClient): Promise<Recovery> => {
    const recovery = await recoveryRepo.findRecoveryById(merchantId, recoveryId, tx);
    
    if (!recovery.approval_required) {
      throw new ValidationError('Recovery campaign does not require approval or is already approved');
    }

    if (['RECOVERED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(recovery.status)) {
      throw new ValidationError(`Cannot approve terminal campaign with status ${recovery.status}`);
    }

    const now = new Date();
    await tx.query(`
      UPDATE recoveries
      SET approval_required = FALSE,
          approved_at = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE merchant_id = $2 AND recovery_id = $3
    `, [now, merchantId, recoveryId]);

    await recoveryRepo.createRecoveryEvent({
      recoveryId,
      eventType: 'CAMPAIGN_APPROVED',
      eventStatus: 'SUCCESS',
      description: 'Recovery campaign approved by merchant operator.',
      actor: 'MERCHANT'
    }, tx);

    const updated = await recoveryRepo.findRecoveryById(merchantId, recoveryId, tx);
    
    // Auto-trigger outreach execution after approval
    await executeRecoveryStrategy(merchantId, recoveryId, tx);

    return updated as unknown as Recovery;
  };

  if (client) {
    return execute(client);
  } else {
    return withTransaction<Recovery>(execute);
  }
}

/**
 * Manually resolves/overrides an active recovery campaign.
 */
export async function resolveRecovery(
  merchantId: string,
  recoveryId: string,
  resolution: 'RETRY' | 'CLOSE_SUCCESS' | 'CLOSE_FAILED',
  cancellationReason?: string,
  client?: PoolClient
): Promise<Recovery> {
  const execute = async (tx: PoolClient): Promise<Recovery> => {
    const recovery = await recoveryRepo.findRecoveryById(merchantId, recoveryId, tx);

    if (['RECOVERED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(recovery.status)) {
      throw new ValidationError(`Cannot resolve terminal campaign with status ${recovery.status}`);
    }

    const now = new Date();

    if (resolution === 'RETRY') {
      await actionRepo.createRecoveryAction({
        recoveryId,
        strategyId: recovery.selected_strategy_id || 'RECOVERY_LINK',
        actionType: 'MANUAL_RETRY_TRIGGERED',
        status: 'SUCCESS',
        attemptNumber: 1
      }, tx);

      await recoveryRepo.createRecoveryEvent({
        recoveryId,
        eventType: 'MANUAL_RETRY_INITIATED',
        eventStatus: 'SUCCESS',
        description: 'Manual retry outreach triggered by merchant.',
        actor: 'MERCHANT'
      }, tx);

      await executeRecoveryStrategy(merchantId, recoveryId, tx);

    } else if (resolution === 'CLOSE_SUCCESS') {
      await recoveryRepo.updateRecoveryStatus(merchantId, recoveryId, {
        status: 'RECOVERED',
        currentStage: 'COMPLETED',
        completedAt: now
      }, tx);

      await recoveryRepo.createRecoveryEvent({
        recoveryId,
        eventType: 'MANUAL_RESOLUTION_SUCCESS',
        eventStatus: 'SUCCESS',
        description: 'Recovery campaign manually resolved as SUCCESSFUL by merchant.',
        actor: 'MERCHANT'
      }, tx);

    } else if (resolution === 'CLOSE_FAILED') {
      if (!cancellationReason) {
        throw new ValidationError('cancellationReason is required to close campaign as failed.');
      }

      await recoveryRepo.updateRecoveryStatus(merchantId, recoveryId, {
        status: 'FAILED',
        currentStage: 'COMPLETED',
        completedAt: now,
        cancelledAt: now,
        cancellationReason
      }, tx);

      await recoveryRepo.createRecoveryEvent({
        recoveryId,
        eventType: 'MANUAL_RESOLUTION_FAILED',
        eventStatus: 'SUCCESS',
        description: `Recovery campaign manually resolved as FAILED by merchant. Reason: ${cancellationReason}`,
        actor: 'MERCHANT'
      }, tx);
    }

    return recoveryRepo.findRecoveryById(merchantId, recoveryId, tx) as unknown as Recovery;
  };

  if (client) {
    return execute(client);
  } else {
    return withTransaction<Recovery>(execute);
  }
}

