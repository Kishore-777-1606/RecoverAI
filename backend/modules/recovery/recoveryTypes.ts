import { ID, AmountString, DateString } from '../../shared/types/common';

export type RecoveryStatus =
  | 'IN_PROGRESS'
  | 'AWAITING_CUSTOMER_ACTION'
  | 'AWAITING_VERIFICATION'
  | 'RECOVERED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'NOT_RECOVERABLE';

export type RecoveryStage =
  | 'ANALYSIS'
  | 'OUTREACH'
  | 'PAYMENT_PENDING'
  | 'VERIFICATION'
  | 'COMPLETED';

export type RecoveryEnvironment = 'LIVE' | 'TEST' | 'SIMULATION';
export type RecoveryActor = 'SYSTEM' | 'AI_ENGINE' | 'MERCHANT' | 'CUSTOMER';

/**
 * Domain-level representation of a Recovery campaign.
 * Declared as readonly to enforce immutability at compile time.
 */
export interface Recovery {
  readonly recovery_id: ID;
  readonly payment_id: ID;
  readonly customer_id: ID;
  readonly merchant_id: ID;
  readonly payment_status: 'FAILED';
  readonly status: RecoveryStatus;
  readonly current_stage: RecoveryStage;
  
  readonly ai_recommended_strategy_id: string | null;
  readonly ai_confidence_score: string | null; // NUMERIC
  readonly ai_recommended_timing: Date | null;
  readonly ai_explanation: string | null;
  readonly ai_failure_classification: string | null;
  
  readonly selected_strategy_id: string | null;
  readonly approval_required: boolean;
  readonly approved_at: Date | null;
  
  readonly amount: AmountString;
  readonly environment: RecoveryEnvironment;
  readonly simulation_session_id: ID | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly completed_at: Date | null;
  readonly expires_at: Date | null;
  readonly cancelled_at: Date | null;
  readonly cancellation_reason: string | null;
}

export interface CreateRecoveryInput {
  payment_id: ID;
  merchant_id: ID;
  customer_id: ID;
  amount: AmountString;
  ai_recommended_strategy_id?: string;
  ai_confidence_score?: number;
  ai_recommended_timing?: Date;
  ai_explanation?: string;
  ai_failure_classification?: string;
  selected_strategy_id?: string;
  approval_required?: boolean;
  environment?: RecoveryEnvironment;
  simulation_session_id?: ID;
  expires_at?: Date;
}

export interface TransitionRecoveryInput {
  status?: RecoveryStatus;
  current_stage?: RecoveryStage;
  selected_strategy_id?: string;
  approved_at?: Date;
  completed_at?: Date;
  cancelled_at?: Date;
  cancellation_reason?: string;
}
