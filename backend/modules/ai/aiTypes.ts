import { ID, AmountString } from '../../shared/types/common';
import { Payment } from '../payments/paymentTypes';
import { Policy, FailureRule, PolicyStrategy, PolicyChannel } from '../../database/repositories/policyRepository';
import { RecoveryPaymentAttempt } from '../../database/repositories/recoveryAttemptRepository';
import { RecoveryAction } from '../../database/repositories/recoveryActionRepository';

export interface PolicyEvaluation {
  allowed: boolean;
  blockedReason: 'NO_ACTIVE_POLICY' | 'FAILURE_TYPE_EXCLUDED' | 'AMOUNT_LIMIT_EXCEEDED' | 'CHANNEL_DISABLED' | 'MERCHANT_DISABLED' | null;
  activePolicyId: ID | null;
}

export interface ConfidenceFactor {
  name: string;
  contribution: number; // e.g. +20, -15
}

export interface ConfidenceResult {
  score: number; // clamped between 0.00 and 100.00
  factors: ConfidenceFactor[];
}

export interface TimingRecommendation {
  recommendedExecutionTime: Date;
  isDelayedDueToQuietHours: boolean;
  reason: string;
}

export interface RecoveryDecision {
  eligible: boolean;
  recommendedStrategy: string | null; // e.g. 'RECOVERY_LINK', 'DELAYED_RETRY', 'MANUAL_REVIEW'
  confidenceScore: number;
  recommendedTiming: Date | null;
  failureClassification: string;
  explanation: string;
  reasons: string[];
  policyEvaluation: PolicyEvaluation;
  confidenceBreakdown?: ConfidenceResult;
  timingRecommendation?: TimingRecommendation;
}

export interface DecisionContext {
  payment: Payment;
  activePolicy: Policy | null;
  previousAttempts: RecoveryPaymentAttempt[];
  previousActions: RecoveryAction[];
  currentTime?: Date; // allow injecting time for test determinism
}
