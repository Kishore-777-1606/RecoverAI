import { Policy, FailureRule } from '../../database/repositories/policyRepository';
import { Payment } from '../payments/paymentTypes';
import { PolicyEvaluation, TimingRecommendation, DecisionContext } from './aiTypes';
import { isWithinQuietHours } from '../../shared/utils/time';
import { toSubunits } from '../../shared/utils/money';
import { logger } from '../../shared/logging/logger';

/**
 * Evaluates whether merchant policy parameters permit automatic recovery for a failed payment.
 */
export function evaluatePolicy(
  payment: Payment,
  policy: Policy | null
): PolicyEvaluation {
  // A. Policy Existence Check
  if (!policy) {
    return {
      allowed: false,
      blockedReason: 'NO_ACTIVE_POLICY',
      activePolicyId: null
    };
  }

  // B. Auto Recovery Toggle Check
  if (!policy.auto_recovery_enabled) {
    return {
      allowed: false,
      blockedReason: 'MERCHANT_DISABLED',
      activePolicyId: policy.policy_id
    };
  }

  // C. Maximum Amount Limit Check (floating-point safe subunit comparison)
  if (policy.max_amount_limit) {
    const paymentSubunits = toSubunits(payment.amount);
    const limitSubunits = toSubunits(policy.max_amount_limit);
    if (paymentSubunits > limitSubunits) {
      logger.info('Payment amount exceeds policy maximum limit', {
        paymentId: payment.payment_id,
        amount: payment.amount,
        limit: policy.max_amount_limit
      });
      return {
        allowed: false,
        blockedReason: 'AMOUNT_LIMIT_EXCEEDED',
        activePolicyId: policy.policy_id
      };
    }
  }

  // D. Failure Type Eligibility Check
  if (policy.failure_rules && payment.failure_type_id) {
    const rule = policy.failure_rules.find(
      r => r.failure_type_id.toUpperCase() === payment.failure_type_id!.toUpperCase()
    );
    // Explicitly blocked if rule.is_eligible is false
    if (rule && !rule.is_eligible) {
      logger.info('Failure type explicitly excluded from recovery by policy rules', {
        paymentId: payment.payment_id,
        failureTypeId: payment.failure_type_id
      });
      return {
        allowed: false,
        blockedReason: 'FAILURE_TYPE_EXCLUDED',
        activePolicyId: policy.policy_id
      };
    }
  }

  return {
    allowed: true,
    blockedReason: null,
    activePolicyId: policy.policy_id
  };
}

/**
 * Calculates recommended execution timing, delaying action if scheduled during quiet hours.
 */
export function evaluateTiming(
  policy: Policy,
  referenceTime: Date = new Date()
): TimingRecommendation {
  if (!policy.quiet_hours_enabled || !policy.quiet_hours_start || !policy.quiet_hours_end) {
    return {
      recommendedExecutionTime: referenceTime,
      isDelayedDueToQuietHours: false,
      reason: 'Quiet hours not enabled or not fully configured.'
    };
  }

  const inQuietHours = isWithinQuietHours(
    policy.quiet_hours_start,
    policy.quiet_hours_end,
    referenceTime
  );

  if (!inQuietHours) {
    return {
      recommendedExecutionTime: referenceTime,
      isDelayedDueToQuietHours: false,
      reason: 'Current execution falls outside configured quiet hours.'
    };
  }

  // Calculate the next execution time (quietEnd + 1 minute)
  const quietEndStr = policy.quiet_hours_end; // "HH:MM:SS"
  const parts = quietEndStr.split(':');
  const endHours = parseInt(parts[0], 10) || 0;
  const endMinutes = parseInt(parts[1], 10) || 0;

  const nextTime = new Date(referenceTime);
  nextTime.setHours(endHours, endMinutes + 1, 0, 0);

  // If the calculated time has already passed today (meaning it spans across midnight and we are in the next day morning),
  // then it's correct. But if nextTime is in the past compared to referenceTime, we push it to tomorrow.
  if (nextTime.getTime() <= referenceTime.getTime()) {
    nextTime.setDate(nextTime.getDate() + 1);
  }

  return {
    recommendedExecutionTime: nextTime,
    isDelayedDueToQuietHours: true,
    reason: `Scheduled execution delayed until ${quietEndStr} to respect merchant quiet hours.`
  };
}
