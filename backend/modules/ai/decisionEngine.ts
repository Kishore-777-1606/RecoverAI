import { PoolClient } from 'pg';
import * as paymentRepo from '../../database/repositories/paymentRepository';
import * as policyRepo from '../../database/repositories/policyRepository';
import * as recoveryRepo from '../../database/repositories/recoveryRepository';
import * as attemptRepo from '../../database/repositories/recoveryAttemptRepository';
import * as actionRepo from '../../database/repositories/recoveryActionRepository';

import { classifyFailure, getPreferredStrategy, FailureClass } from './decisionRules';
import { evaluatePolicy, evaluateTiming } from './policyEngine';
import { calculateConfidence } from './confidenceScorer';
import { RecoveryDecision, DecisionContext } from './aiTypes';
import { ValidationError } from '../../shared/errors/ValidationError';
import { logger } from '../../shared/logging/logger';

/**
 * Evaluates a failed payment and determines the optimal recovery strategy and execution timing.
 * Exposes evaluateRecovery to verify eligibility, confidence, and quiet-hours adjustments.
 */
export async function evaluateRecovery(
  merchantId: string,
  paymentId: string,
  currentTime: Date = new Date(),
  client?: PoolClient
): Promise<RecoveryDecision> {
  // 1. Load payment details from repository
  const payment = await paymentRepo.findPaymentById(merchantId, paymentId, client);

  // 2. Reject non-FAILED payments (Safety Rules 1, 2, 3)
  if (payment.status !== 'FAILED') {
    return {
      eligible: false,
      recommendedStrategy: null,
      confidenceScore: 0.00,
      recommendedTiming: null,
      failureClassification: classifyFailure(payment.failure_type_id),
      explanation: `Recovery is not recommended because the payment status is '${payment.status}'. Only FAILED payments can be processed.`,
      reasons: [`Payment status is '${payment.status}'`],
      policyEvaluation: { allowed: false, blockedReason: 'FAILURE_TYPE_EXCLUDED', activePolicyId: null }
    };
  }

  // 3. Load active policy for merchant (Isolation rule)
  const policy = await policyRepo.findActivePolicyByMerchant(merchantId, client);
  
  // 4. Evaluate base policy exclusions and limits
  const policyEvaluation = evaluatePolicy(payment as any, policy);
  if (!policyEvaluation.allowed) {
    let explanation = 'Recovery is not recommended because the merchant policy blocks it.';
    if (policyEvaluation.blockedReason === 'NO_ACTIVE_POLICY') {
      explanation = 'Recovery is not recommended because no active recovery policy was found for the merchant.';
    } else if (policyEvaluation.blockedReason === 'FAILURE_TYPE_EXCLUDED') {
      explanation = 'Recovery is not recommended because this specific failure type is excluded by policy.';
    } else if (policyEvaluation.blockedReason === 'AMOUNT_LIMIT_EXCEEDED') {
      explanation = `Recovery is not recommended because the transaction amount exceeds the policy maximum limit.`;
    } else if (policyEvaluation.blockedReason === 'MERCHANT_DISABLED') {
      explanation = 'Recovery is not recommended because automatic recovery is disabled in the merchant policy settings.';
    }

    return {
      eligible: false,
      recommendedStrategy: null,
      confidenceScore: 0.00,
      recommendedTiming: null,
      failureClassification: classifyFailure(payment.failure_type_id),
      explanation,
      reasons: [policyEvaluation.blockedReason || 'Blocked by policy'],
      policyEvaluation
    };
  }

  // 5. Load historical recovery campaign if one exists
  const existingRecovery = await recoveryRepo.findRecoveryByPaymentId(merchantId, paymentId, client);
  
  // Check if campaign is already terminal (Safety Rule 4)
  if (existingRecovery) {
    const terminalStates = ['RECOVERED', 'FAILED', 'EXPIRED', 'CANCELLED', 'NOT_RECOVERABLE'];
    if (terminalStates.includes(existingRecovery.status)) {
      return {
        eligible: false,
        recommendedStrategy: null,
        confidenceScore: 0.00,
        recommendedTiming: null,
        failureClassification: classifyFailure(payment.failure_type_id),
        explanation: `Recovery campaign is already in a terminal state: '${existingRecovery.status}'. No further automatic actions are allowed.`,
        reasons: [`Campaign is terminal: ${existingRecovery.status}`],
        policyEvaluation
      };
    }
  }

  // 6. Gather attempts and action histories
  let previousAttempts: any[] = [];
  let previousActions: any[] = [];
  if (existingRecovery) {
    previousAttempts = await attemptRepo.listAttemptsByRecovery(existingRecovery.recovery_id, client);
    previousActions = await actionRepo.listActionsByRecovery(existingRecovery.recovery_id, client);
  }

  const context: DecisionContext = {
    payment: payment as any,
    activePolicy: policy,
    previousAttempts,
    previousActions,
    currentTime
  };

  // 7. Classify failure and resolve preferred strategies
  const failureClass = classifyFailure(payment.failure_type_id);
  const preferredStrategy = getPreferredStrategy(failureClass);

  // 8. Select optimal strategy based on priority and retry limits
  const enabledStrategies = (policy!.strategies || []).filter(s => s.is_enabled);
  if (enabledStrategies.length === 0) {
    return {
      eligible: false,
      recommendedStrategy: null,
      confidenceScore: 0.00,
      recommendedTiming: null,
      failureClassification: failureClass,
      explanation: 'Recovery is blocked because no strategies are enabled in the merchant policy.',
      reasons: ['No enabled strategies in policy'],
      policyEvaluation
    };
  }

  // Sort strategies by priority (lower number = higher priority)
  const sortedStrats = [...enabledStrategies].sort((a, b) => a.priority - b.priority);

  // Prioritize preferredStrategy if enabled, otherwise fall back to sorted order
  const preferredStratObj = sortedStrats.find(s => s.strategy_id === preferredStrategy);
  let selectedStrat = preferredStratObj || sortedStrats[0];
  let strategyToRecommend = selectedStrat.strategy_id;

  // Pick the first strategy that hasn't exceeded its max_outreach_attempts limit
  let executedAttempts = previousAttempts.filter(
    a => a.payment_method_id === strategyToRecommend || (strategyToRecommend === 'RECOVERY_LINK' && a.attempt_id)
  ).length;

  if (executedAttempts >= selectedStrat.max_outreach_attempts) {
    for (const strat of sortedStrats) {
      const attemptsCount = previousAttempts.filter(
        a => a.payment_method_id === strat.strategy_id || (strat.strategy_id === 'RECOVERY_LINK' && a.attempt_id)
      ).length;

      if (attemptsCount < strat.max_outreach_attempts) {
        selectedStrat = strat;
        strategyToRecommend = strat.strategy_id;
        break;
      }
    }
  }

  // 9. Calculate Recommended Timing (incorporating quiet hours offsets)
  const timingRec = evaluateTiming(policy!, currentTime);

  // 10. Calculate confidence score
  const confidence = calculateConfidence(strategyToRecommend, failureClass, context);

  // 11. Generate explaining reasons
  const reasons: string[] = [];
  reasons.push(`Failure category classified as ${failureClass}`);
  reasons.push(`Selected strategy ${strategyToRecommend} based on priority and attempts limit`);
  if (timingRec.isDelayedDueToQuietHours) {
    reasons.push('Execution scheduled outside merchant quiet hours');
  }

  const explanation = `Recovery is recommended because this payment failed due to ${failureClass.replace(/_/g, ' ').toLowerCase()}. The merchant policy allows automatic recovery and ${strategyToRecommend.replace(/_/g, ' ').toLowerCase()} has been selected as the optimal strategy. ${timingRec.isDelayedDueToQuietHours ? 'The retry will be scheduled outside the merchant\'s quiet hours.' : 'The action can execute immediately.'}`;

  return {
    eligible: true,
    recommendedStrategy: strategyToRecommend,
    confidenceScore: confidence.score,
    recommendedTiming: timingRec.recommendedExecutionTime,
    failureClassification: failureClass,
    explanation,
    reasons,
    policyEvaluation,
    confidenceBreakdown: confidence,
    timingRecommendation: timingRec
  };
}
