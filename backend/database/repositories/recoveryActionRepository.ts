import { PoolClient } from 'pg';
import { pool } from '../connection';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { logger } from '../../shared/logging/logger';

export interface RecoveryAction {
  action_id: string;
  recovery_id: string;
  strategy_id: string;
  action_type: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  attempt_number: number;
  metadata: any | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Creates a new recovery campaign action record.
 */
export async function createRecoveryAction(
  action: {
    recoveryId: string;
    strategyId: string;
    actionType: string;
    status?: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
    attemptNumber?: number;
    metadata?: any;
    errorMessage?: string;
  },
  client?: PoolClient
): Promise<RecoveryAction> {
  const db = client || pool;
  const sql = `
    INSERT INTO recovery_actions (
      recovery_id, strategy_id, action_type, status,
      attempt_number, metadata, error_message
    )
    VALUES ($1, $2, $3, COALESCE($4, 'PENDING'), COALESCE($5, 1), $6, $7)
    RETURNING action_id, recovery_id, strategy_id, action_type, status,
              attempt_number, metadata, error_message, created_at, updated_at
  `;
  const params = [
    action.recoveryId,
    action.strategyId,
    action.actionType,
    action.status || null,
    action.attemptNumber || null,
    action.metadata ? JSON.stringify(action.metadata) : null,
    action.errorMessage || null
  ];
  
  const res = await db.query<RecoveryAction>(sql, params);
  return res.rows[0];
}

/**
 * Finds an action by its ID. Throws NotFoundError if not found.
 */
export async function findRecoveryActionById(actionId: string, client?: PoolClient): Promise<RecoveryAction> {
  const db = client || pool;
  const sql = `
    SELECT action_id, recovery_id, strategy_id, action_type, status,
           attempt_number, metadata, error_message, created_at, updated_at
    FROM recovery_actions
    WHERE action_id = $1
  `;
  const res = await db.query<RecoveryAction>(sql, [actionId]);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Recovery action with ID ${actionId} not found`);
  }
  return res.rows[0];
}

/**
 * Lists all actions executed under a recovery campaign.
 */
export async function listActionsByRecovery(recoveryId: string, client?: PoolClient): Promise<RecoveryAction[]> {
  const db = client || pool;
  const sql = `
    SELECT action_id, recovery_id, strategy_id, action_type, status,
           attempt_number, metadata, error_message, created_at, updated_at
    FROM recovery_actions
    WHERE recovery_id = $1
    ORDER BY created_at ASC
  `;
  const res = await db.query<RecoveryAction>(sql, [recoveryId]);
  return res.rows;
}

/**
 * Updates status, metadata, and error details of an action.
 */
export async function updateActionStatus(
  actionId: string,
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED',
  updates?: {
    errorMessage?: string;
    metadata?: any;
  },
  client?: PoolClient
): Promise<RecoveryAction> {
  const db = client || pool;
  const sql = `
    UPDATE recovery_actions
    SET status = $1,
        error_message = COALESCE($2, error_message),
        metadata = COALESCE($3, metadata),
        updated_at = CURRENT_TIMESTAMP
    WHERE action_id = $4
    RETURNING action_id, recovery_id, strategy_id, action_type, status,
              attempt_number, metadata, error_message, created_at, updated_at
  `;
  const params = [
    status,
    updates?.errorMessage || null,
    updates?.metadata ? JSON.stringify(updates.metadata) : null,
    actionId
  ];
  
  const res = await db.query<RecoveryAction>(sql, params);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Recovery action with ID ${actionId} not found`);
  }
  logger.debug('Recovery action status updated', { actionId, status });
  return res.rows[0];
}
