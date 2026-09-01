import { FailureClass } from './decisionRules';
import { ConfidenceResult, ConfidenceFactor, DecisionContext } from './aiTypes';

/**
 * Calculates a reproducible, deterministic confidence score based on failure context and history.
 */
export function calculateConfidence(
  strategyId: string,
  failureClass: FailureClass,
  context: DecisionContext
): ConfidenceResult {
  const factors: ConfidenceFactor[] = [];
  let score = 0;

  // 1. Base Failure Suitability (Base Probability)
  let baseContribution = 30;
  switch (failureClass) {
    case 'NETWORK_ERROR':
    case 'TEMPORARY_BANK_ISSUE':
      baseContribution = 60; // Technical glitches resolve easily on retry
      break;
    case 'INSUFFICIENT_FUNDS':
      baseContribution = 50; // Insufficient balance resolves well once customer tops up account
      break;
    case 'UPI_TIMEOUT':
      baseContribution = 45; // Timeout indicates customer was busy; retry outreach works well
      break;
    case 'CARD_DECLINED':
      baseContribution = 40; // Declined cards require customer input/alternative payment methods
      break;
    case 'AUTHENTICATION_FAILED':
      baseContribution = 35; // Customer can re-authenticate
      break;
    case 'FRAUD_BLOCK':
      baseContribution = 5;  // Risk blocks have near-zero chance of successful automatic recovery
      break;
    case 'OTHER_UNKNOWN':
    default:
      baseContribution = 30;
      break;
  }
  factors.push({ name: 'base_suitability', contribution: baseContribution });
  score += baseContribution;

  // 2. Strategy Alignment Factor
  let alignmentContribution = 10;
  const isPreferred = 
    (strategyId === 'DELAYED_RETRY' && ['NETWORK_ERROR', 'TEMPORARY_BANK_ISSUE'].includes(failureClass)) ||
    (strategyId === 'RECOVERY_LINK' && ['INSUFFICIENT_FUNDS', 'UPI_TIMEOUT', 'CARD_DECLINED', 'AUTHENTICATION_FAILED'].includes(failureClass)) ||
    (strategyId === 'MANUAL_REVIEW' && ['FRAUD_BLOCK', 'OTHER_UNKNOWN'].includes(failureClass));

  if (isPreferred) {
    alignmentContribution = 20;
  }
  factors.push({ name: 'strategy_alignment', contribution: alignmentContribution });
  score += alignmentContribution;

  // 3. Strategy Priority Bonus
  if (context.activePolicy && context.activePolicy.strategies) {
    const policyStrat = context.activePolicy.strategies.find(s => s.strategy_id === strategyId);
    if (policyStrat) {
      let priorityBonus = 0;
      if (policyStrat.priority === 1) {
        priorityBonus = 10;
      } else if (policyStrat.priority === 2) {
        priorityBonus = 5;
      }
      if (priorityBonus > 0) {
        factors.push({ name: 'policy_priority_bonus', contribution: priorityBonus });
        score += priorityBonus;
      }
    }
  }

  // 4. Previous Failed Attempts Penalty
  const failedAttemptsCount = context.previousAttempts.filter(a => a.status === 'FAILED').length;
  if (failedAttemptsCount > 0) {
    const penalty = -20 * failedAttemptsCount;
    factors.push({ name: 'previous_failed_attempts_penalty', contribution: penalty });
    score += penalty;
  }

  // 5. Previous Failed Actions Penalty
  const failedActionsCount = context.previousActions.filter(a => a.status === 'FAILED').length;
  if (failedActionsCount > 0) {
    const penalty = -10 * failedActionsCount;
    factors.push({ name: 'previous_failed_actions_penalty', contribution: penalty });
    score += penalty;
  }

  // Clamp the score between 0.00 and 100.00
  const finalScore = Math.max(0.00, Math.min(100.00, score));

  return {
    score: parseFloat(finalScore.toFixed(2)),
    factors
  };
}
