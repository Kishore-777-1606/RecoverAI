import { RecoveryStatus } from './recoveryTypes';
import { ValidationError } from '../../shared/errors/ValidationError';

/**
 * State Transition Matrix for Recovery Campaigns
 */
const ALLOWED_TRANSITIONS: Record<RecoveryStatus, Set<RecoveryStatus>> = {
  IN_PROGRESS: new Set<RecoveryStatus>([
    'AWAITING_CUSTOMER_ACTION',
    'AWAITING_VERIFICATION',
    'RECOVERED',
    'FAILED',
    'EXPIRED',
    'CANCELLED',
    'NOT_RECOVERABLE'
  ]),
  AWAITING_CUSTOMER_ACTION: new Set<RecoveryStatus>([
    'AWAITING_VERIFICATION',
    'RECOVERED',
    'FAILED',
    'EXPIRED',
    'CANCELLED'
  ]),
  AWAITING_VERIFICATION: new Set<RecoveryStatus>([
    'RECOVERED',
    'FAILED',
    'CANCELLED'
  ]),
  // Terminal states cannot transition to another state
  RECOVERED: new Set<RecoveryStatus>(),
  FAILED: new Set<RecoveryStatus>(),
  EXPIRED: new Set<RecoveryStatus>(),
  CANCELLED: new Set<RecoveryStatus>(),
  NOT_RECOVERABLE: new Set<RecoveryStatus>()
};

/**
 * Validates a recovery status transition.
 * Throws ValidationError if the transition violates campaign lifecycle rules.
 */
export function validateRecoveryTransition(current: RecoveryStatus, target: RecoveryStatus): void {
  if (current === target) {
    return;
  }

  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed || !allowed.has(target)) {
    throw new ValidationError(
      `Illegal recovery status transition: Cannot transition campaign from '${current}' to '${target}'.`
    );
  }
}
