import { PaymentStatus } from './paymentTypes';
import { ValidationError } from '../../shared/errors/ValidationError';

/**
 * State Transition Matrix for Original Payments
 */
const ALLOWED_TRANSITIONS: Record<PaymentStatus, Set<PaymentStatus>> = {
  INITIATED: new Set<PaymentStatus>(['PROCESSING']),
  PROCESSING: new Set<PaymentStatus>(['SUCCESSFUL', 'FAILED']),
  SUCCESSFUL: new Set<PaymentStatus>(),
  FAILED: new Set<PaymentStatus>()
};

/**
 * Validates whether a payment status transition from current to target is legally permitted.
 * Throws ValidationError if the transition violates lifecycle rules.
 */
export function validatePaymentTransition(current: PaymentStatus, target: PaymentStatus): void {
  // Safe-guard against redundant self-transitions
  if (current === target) {
    return;
  }

  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed || !allowed.has(target)) {
    throw new ValidationError(
      `Illegal payment status transition: Cannot transition from '${current}' to '${target}'.`
    );
  }
}
