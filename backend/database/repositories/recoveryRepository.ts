import { PoolClient } from 'pg';
import { pool } from '../connection';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { PaginatedResult } from '../../shared/types/common';
import { logger } from '../../shared/logging/logger';

export interface Recovery {
  recovery_id: string;
  payment_id: string;
  customer_id: string;
  merchant_id: string;
  payment_status: 'FAILED';
  status: 'RECOVERED' | 'IN_PROGRESS' | 'AWAITING_CUSTOMER_ACTION' | 'AWAITING_VERIFICATION' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | 'NOT_RECOVERABLE';
  current_stage: 'ANALYSIS' | 'OUTREACH' | 'PAYMENT_PENDING' | 'VERIFICATION' | 'COMPLETED';
  
  ai_recommended_strategy_id: string | null;
  ai_confidence_score: string | null; // NUMERIC
  ai_recommended_timing: Date | null;
  ai_explanation: string | null;
  ai_failure_classification: string | null;
  
  selected_strategy_id: string | null;
  approval_required: boolean;
  approved_at: Date | null;
  
  amount: string; // NUMERIC
  environment: 'LIVE' | 'TEST' | 'SIMULATION';
  simulation_session_id: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
}

export interface RecoveryEvent {
  event_id: string;
  recovery_id: string;
  event_type: string;
  event_status: string;
  description: string;
  metadata: any | null;
  actor: 'SYSTEM' | 'AI_ENGINE' | 'MERCHANT' | 'CUSTOMER';
  created_at: Date;
}

export interface RecoveryDashboardMetrics {
  total_revenue_recovered: string;
  recovery_rate: string;
  active_campaigns_count: number;
  total_failed_amount: string;
  recovered_ratio: string;
}

/**
 * Creates a new recovery campaign for a failed payment.
 * Guarantees payment status matches "FAILED" and scopes details.
 */
export async function createRecovery(
  recovery: {
    paymentId: string;
    merchantId: string;
    customerId: string;
    aiRecommendedStrategyId?: string;
    aiConfidenceScore?: number;
    aiRecommendedTiming?: Date;
    aiExplanation?: string;
    aiFailureClassification?: string;
    selectedStrategyId?: string;
    approvalRequired?: boolean;
    approvedAt?: Date;
    amount: string; // Decimal money string
    environment?: 'LIVE' | 'TEST' | 'SIMULATION';
    simulationSessionId?: string;
    expiresAt?: Date;
  },
  client?: PoolClient
): Promise<Recovery> {
  const db = client || pool;
  
  // Explicitly note that payment_status is set to 'FAILED'
  const sql = `
    INSERT INTO recoveries (
      payment_id, merchant_id, customer_id, payment_status,
      status, current_stage, ai_recommended_strategy_id,
      ai_confidence_score, ai_recommended_timing, ai_explanation,
      ai_failure_classification, selected_strategy_id,
      approval_required, approved_at, amount, environment,
      simulation_session_id, expires_at
    )
    VALUES ($1, $2, $3, 'FAILED', 'IN_PROGRESS', 'ANALYSIS', $4, $5, $6, $7, $8, $9, COALESCE($10, FALSE), $11, $12, COALESCE($13, 'LIVE'), $14, $15)
    RETURNING recovery_id, payment_id, customer_id, merchant_id, payment_status,
              status, current_stage, ai_recommended_strategy_id, ai_confidence_score,
              ai_recommended_timing, ai_explanation, ai_failure_classification,
              selected_strategy_id, approval_required, approved_at, amount,
              environment, simulation_session_id, created_at, updated_at,
              completed_at, expires_at, cancelled_at, cancellation_reason
  `;
  const params = [
    recovery.paymentId,
    recovery.merchantId,
    recovery.customerId,
    recovery.aiRecommendedStrategyId || null,
    recovery.aiConfidenceScore || null,
    recovery.aiRecommendedTiming || null,
    recovery.aiExplanation || null,
    recovery.aiFailureClassification || null,
    recovery.selectedStrategyId || null,
    recovery.approvalRequired || null,
    recovery.approvedAt || null,
    recovery.amount,
    recovery.environment || null,
    recovery.simulationSessionId || null,
    recovery.expiresAt || null
  ];

  const res = await db.query<Recovery>(sql, params);
  logger.info('Recovery campaign started', {
    merchantId: recovery.merchantId,
    recoveryId: res.rows[0].recovery_id,
    paymentId: recovery.paymentId
  });
  return res.rows[0];
}

/**
 * Finds a recovery campaign by its unique ID.
 */
export async function findRecoveryById(
  merchantId: string,
  recoveryId: string,
  client?: PoolClient
): Promise<Recovery> {
  const db = client || pool;
  const sql = `
    SELECT recovery_id, payment_id, customer_id, merchant_id, payment_status,
           status, current_stage, ai_recommended_strategy_id, ai_confidence_score,
           ai_recommended_timing, ai_explanation, ai_failure_classification,
           selected_strategy_id, approval_required, approved_at, amount,
           environment, simulation_session_id, created_at, updated_at,
           completed_at, expires_at, cancelled_at, cancellation_reason
    FROM recoveries
    WHERE merchant_id = $1 AND recovery_id = $2
  `;
  const res = await db.query<Recovery>(sql, [merchantId, recoveryId]);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Recovery campaign with ID ${recoveryId} not found`);
  }
  return res.rows[0];
}

/**
 * Finds a recovery campaign using its original payment reference ID.
 */
export async function findRecoveryByPaymentId(
  merchantId: string,
  paymentId: string,
  client?: PoolClient
): Promise<Recovery | null> {
  const db = client || pool;
  const sql = `
    SELECT recovery_id, payment_id, customer_id, merchant_id, payment_status,
           status, current_stage, ai_recommended_strategy_id, ai_confidence_score,
           ai_recommended_timing, ai_explanation, ai_failure_classification,
           selected_strategy_id, approval_required, approved_at, amount,
           environment, simulation_session_id, created_at, updated_at,
           completed_at, expires_at, cancelled_at, cancellation_reason
    FROM recoveries
    WHERE merchant_id = $1 AND payment_id = $2
  `;
  const res = await db.query<Recovery>(sql, [merchantId, paymentId]);
  return res.rows[0] || null;
}

/**
 * Lists and paginates recovery campaigns under merchant scope.
 */
export async function listRecoveries(
  merchantId: string,
  filters: {
    customerId?: string;
    status?: string;
    currentStage?: string;
    environment?: 'LIVE' | 'TEST' | 'SIMULATION';
    simulationSessionId?: string;
    page?: number;
    limit?: number;
  },
  client?: PoolClient
): Promise<PaginatedResult<Recovery>> {
  const db = client || pool;
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const offset = (page - 1) * limit;

  let queryConds = [`merchant_id = $1`];
  let params: any[] = [merchantId];

  if (filters.customerId) {
    params.push(filters.customerId);
    queryConds.push(`customer_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    queryConds.push(`status = $${params.length}`);
  }
  if (filters.currentStage) {
    params.push(filters.currentStage);
    queryConds.push(`current_stage = $${params.length}`);
  }
  if (filters.environment) {
    params.push(filters.environment);
    queryConds.push(`environment = $${params.length}`);
  }
  if (filters.simulationSessionId) {
    params.push(filters.simulationSessionId);
    queryConds.push(`simulation_session_id = $${params.length}`);
  }

  const whereClause = queryConds.join(' AND ');

  const countSql = `SELECT COUNT(*)::integer FROM recoveries WHERE ${whereClause}`;
  const countRes = await db.query(countSql, params);
  const total = countRes.rows[0].count;

  params.push(limit);
  const limitIndex = params.length;
  params.push(offset);
  const offsetIndex = params.length;

  const listSql = `
    SELECT recovery_id, payment_id, customer_id, merchant_id, payment_status,
           status, current_stage, ai_recommended_strategy_id, ai_confidence_score,
           ai_recommended_timing, ai_explanation, ai_failure_classification,
           selected_strategy_id, approval_required, approved_at, amount,
           environment, simulation_session_id, created_at, updated_at,
           completed_at, expires_at, cancelled_at, cancellation_reason
    FROM recoveries
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `;
  const listRes = await db.query<Recovery>(listSql, params);

  return {
    data: listRes.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
}

/**
 * Transitions campaign status, stages, and tracks cancellation details.
 */
export async function updateRecoveryStatus(
  merchantId: string,
  recoveryId: string,
  updates: {
    status?: 'RECOVERED' | 'IN_PROGRESS' | 'AWAITING_CUSTOMER_ACTION' | 'AWAITING_VERIFICATION' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | 'NOT_RECOVERABLE';
    currentStage?: 'ANALYSIS' | 'OUTREACH' | 'PAYMENT_PENDING' | 'VERIFICATION' | 'COMPLETED';
    selectedStrategyId?: string;
    approvedAt?: Date;
    completedAt?: Date;
    cancelledAt?: Date;
    cancellationReason?: string;
  },
  client?: PoolClient
): Promise<Recovery> {
  const db = client || pool;
  const sql = `
    UPDATE recoveries
    SET status = COALESCE($1, status),
        current_stage = COALESCE($2, current_stage),
        selected_strategy_id = COALESCE($3, selected_strategy_id),
        approved_at = COALESCE($4, approved_at),
        completed_at = COALESCE($5, completed_at),
        cancelled_at = COALESCE($6, cancelled_at),
        cancellation_reason = COALESCE($7, cancellation_reason),
        updated_at = CURRENT_TIMESTAMP
    WHERE merchant_id = $8 AND recovery_id = $9
    RETURNING recovery_id, payment_id, customer_id, merchant_id, payment_status,
              status, current_stage, ai_recommended_strategy_id, ai_confidence_score,
              ai_recommended_timing, ai_explanation, ai_failure_classification,
              selected_strategy_id, approval_required, approved_at, amount,
              environment, simulation_session_id, created_at, updated_at,
              completed_at, expires_at, cancelled_at, cancellation_reason
  `;
  const params = [
    updates.status || null,
    updates.currentStage || null,
    updates.selectedStrategyId || null,
    updates.approvedAt || null,
    updates.completedAt || null,
    updates.cancelledAt || null,
    updates.cancellationReason || null,
    merchantId,
    recoveryId
  ];

  const res = await db.query<Recovery>(sql, params);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Recovery campaign with ID ${recoveryId} not found`);
  }
  logger.info('Recovery status transitioned', { recoveryId, status: updates.status, stage: updates.currentStage });
  return res.rows[0];
}

/**
 * Creates a chronological timeline event associated with a recovery campaign.
 */
export async function createRecoveryEvent(
  event: {
    recoveryId: string;
    eventType: string;
    eventStatus: string;
    description: string;
    metadata?: any;
    actor: 'SYSTEM' | 'AI_ENGINE' | 'MERCHANT' | 'CUSTOMER';
  },
  client?: PoolClient
): Promise<RecoveryEvent> {
  const db = client || pool;
  const sql = `
    INSERT INTO recovery_events (recovery_id, event_type, event_status, description, metadata, actor)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING event_id, recovery_id, event_type, event_status, description, metadata, actor, created_at
  `;
  const params = [
    event.recoveryId,
    event.eventType,
    event.eventStatus,
    event.description,
    event.metadata ? JSON.stringify(event.metadata) : null,
    event.actor
  ];
  const res = await db.query<RecoveryEvent>(sql, params);
  return res.rows[0];
}

/**
 * Retrieves full chronological timeline log list for a recovery campaign.
 */
export async function getRecoveryTimeline(
  recoveryId: string,
  client?: PoolClient
): Promise<RecoveryEvent[]> {
  const db = client || pool;
  const sql = `
    SELECT event_id, recovery_id, event_type, event_status, description, metadata, actor, created_at
    FROM recovery_events
    WHERE recovery_id = $1
    ORDER BY created_at ASC
  `;
  const res = await db.query<RecoveryEvent>(sql, [recoveryId]);
  return res.rows;
}

/**
 * Pulls key metrics for the merchant UI dashboard.
 */
export async function getRecoveryDashboardMetrics(
  merchantId: string,
  environment: 'LIVE' | 'TEST' | 'SIMULATION' = 'LIVE',
  client?: PoolClient
): Promise<RecoveryDashboardMetrics> {
  const db = client || pool;
  
  const statsSql = `
    SELECT
      COALESCE(SUM(CASE WHEN status = 'RECOVERED' THEN amount ELSE 0.00 END), 0.00) AS total_revenue_recovered,
      COUNT(CASE WHEN status = 'IN_PROGRESS' THEN 1 END)::integer AS active_campaigns_count,
      COALESCE(SUM(amount), 0.00) AS total_failed_amount,
      (COUNT(CASE WHEN status = 'RECOVERED' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0))::numeric(5,2) AS recovery_rate
    FROM recoveries
    WHERE merchant_id = $1 AND environment = $2
  `;
  const res = await db.query(statsSql, [merchantId, environment]);
  const row = res.rows[0];

  return {
    total_revenue_recovered: row.total_revenue_recovered.toString(),
    recovery_rate: (row.recovery_rate || '0.00').toString(),
    active_campaigns_count: row.active_campaigns_count,
    total_failed_amount: row.total_failed_amount.toString(),
    recovered_ratio: row.total_failed_amount > 0 
      ? (row.total_revenue_recovered * 100.0 / row.total_failed_amount).toFixed(2)
      : '0.00'
  };
}

/**
 * Finds a recovery campaign globally by its unique ID.
 */
export async function findRecoveryByIdGlobal(
  recoveryId: string,
  client?: PoolClient
): Promise<Recovery | null> {
  const db = client || pool;
  const sql = `
    SELECT recovery_id, payment_id, customer_id, merchant_id, payment_status,
           status, current_stage, ai_recommended_strategy_id, ai_confidence_score,
           ai_recommended_timing, ai_explanation, ai_failure_classification,
           selected_strategy_id, approval_required, approved_at, amount,
           environment, simulation_session_id, created_at, updated_at,
           completed_at, expires_at, cancelled_at, cancellation_reason
    FROM recoveries
    WHERE recovery_id = $1
  `;
  const res = await db.query<Recovery>(sql, [recoveryId]);
  return res.rows[0] || null;
}
