import * as recoveryService from '../../modules/recovery/recoveryService';
import * as recoveryRepo from '../../database/repositories/recoveryRepository';
import { eventBus } from '../eventBus';
import { logger } from '../../shared/logging/logger';

export interface RecoveryAttemptEvent {
  merchantId: string;
  recoveryId: string;
  attemptId: string;
  previousAttemptsCount: number;
  maxAttemptsLimit: number;
}

/**
 * Handles internal campaign creation events.
 */
export async function handleRecoveryCreated(event: { recovery: any; decision: any }): Promise<void> {
  logger.info('Recovery campaign created internal event listener triggered', {
    recoveryId: event.recovery.recovery_id,
    strategy: event.recovery.selected_strategy_id
  });

  if (!event.recovery.approval_required) {
    try {
      await recoveryService.executeRecoveryStrategy(event.recovery.merchant_id, event.recovery.recovery_id);
    } catch (err: any) {
      logger.error('Failed to automatically execute strategy for newly created campaign', {
        recoveryId: event.recovery.recovery_id,
        error: err.message
      });
    }
  }
}

/**
 * Handles campaign retry attempt success events.
 * Automatically marks the recovery campaign as RECOVERED (terminal).
 */
export async function handleAttemptSuccessful(event: { merchantId: string; recoveryId: string; attemptId: string }): Promise<void> {
  logger.info('Recovery attempt success event subscriber triggered', { recoveryId: event.recoveryId });

  await recoveryService.transitionRecovery(
    event.merchantId,
    event.recoveryId,
    {
      status: 'RECOVERED',
      current_stage: 'COMPLETED'
    },
    'SYSTEM'
  );
}

/**
 * Handles campaign retry attempt failure events.
 * Evaluates limits to check if the campaign has reached terminal FAILED status.
 */
export async function handleAttemptFailed(event: RecoveryAttemptEvent): Promise<void> {
  logger.info('Recovery attempt failed event subscriber triggered', {
    recoveryId: event.recoveryId,
    attempts: event.previousAttemptsCount,
    limit: event.maxAttemptsLimit
  });

  if (event.previousAttemptsCount >= event.maxAttemptsLimit) {
    logger.info('Outreach attempt limits reached. Setting campaign status to FAILED', { recoveryId: event.recoveryId });
    await recoveryService.transitionRecovery(
      event.merchantId,
      event.recoveryId,
      {
        status: 'FAILED',
        current_stage: 'COMPLETED'
      },
      'SYSTEM'
    );
  }
}

/**
 * Registers all recovery event bus handler subscriptions on bootstrap.
 */
export function registerRecoveryHandlers(): void {
  eventBus.subscribe('recovery.created', handleRecoveryCreated);
  eventBus.subscribe('recovery.attempt.successful', handleAttemptSuccessful);
  eventBus.subscribe('recovery.attempt.failed', handleAttemptFailed);
}
