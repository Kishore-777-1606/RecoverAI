import { PoolClient } from 'pg';
import { pool } from '../connection';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { logger } from '../../shared/logging/logger';

export interface RecoveryPaymentAttempt {
  attempt_id: string;
  recovery_id: string;
  customer_id: string;
  payment_method_id: string;
  amount: string; // NUMERIC
  currency: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESSFUL' | 'FAILED';
  provider_name: string | null;
  provider_transaction_id: string | null;
  provider_status: string | null;
  idempotency_key: string;
  error_code: string | null;
  error_message: string | null;
  environment: 'LIVE' | 'TEST' | 'SIMULATION';
  simulation_session_id: string | null;
  created_at: Date;
  completed_at: Date | null;
}

/**
 * Creates a new recovery payment attempt record.
 * Leverages composite constraints to ensure the attempt matches the campaign customer.
 */
export async function createRecoveryAttempt(
  attempt: {
    recoveryId: string;
    customerId: string;
    paymentMethodId: string;
    amount: string; // Decimal money string
    currency?: string;
    status?: 'PENDING' | 'PROCESSING' | 'SUCCESSFUL' | 'FAILED';
    providerName?: string;
    providerTransactionId?: string;
    providerStatus?: string;
    idempotencyKey: string;
    errorCode?: string;
    errorMessage?: string;
    environment?: 'LIVE' | 'TEST' | 'SIMULATION';
    simulationSessionId?: string;
  },
  client?: PoolClient
): Promise<RecoveryPaymentAttempt> {
  const db = client || pool;
  const sql = `
    INSERT INTO recovery_payment_attempts (
      recovery_id, customer_id, payment_method_id, amount,
      currency, status, provider_name, provider_transaction_id,
      provider_status, idempotency_key, error_code, error_message,
      environment, simulation_session_id
    )
    VALUES ($1, $2, $3, $4, COALESCE($5, 'INR'), COALESCE($6, 'PENDING'), $7, $8, $9, $10, $11, $12, COALESCE($13, 'LIVE'), $14)
    RETURNING attempt_id, recovery_id, customer_id, payment_method_id, amount,
              currency, status, provider_name, provider_transaction_id,
              provider_status, idempotency_key, error_code, error_message,
              environment, simulation_session_id, created_at, completed_at
  `;
  const params = [
    attempt.recoveryId,
    attempt.customerId,
    attempt.paymentMethodId,
    attempt.amount,
    attempt.currency || null,
    attempt.status || null,
    attempt.providerName || null,
    attempt.providerTransactionId || null,
    attempt.providerStatus || null,
    attempt.idempotencyKey,
    attempt.errorCode || null,
    attempt.errorMessage || null,
    attempt.environment || null,
    attempt.simulationSessionId || null
  ];

  const res = await db.query<RecoveryPaymentAttempt>(sql, params);
  logger.info('Recovery payment attempt created', {
    recoveryId: attempt.recoveryId,
    attemptId: res.rows[0].attempt_id,
    idempotencyKey: attempt.idempotencyKey
  });
  return res.rows[0];
}

/**
 * Finds an attempt record by its unique ID.
 */
export async function findAttemptById(attemptId: string, client?: PoolClient): Promise<RecoveryPaymentAttempt> {
  const db = client || pool;
  const sql = `
    SELECT attempt_id, recovery_id, customer_id, payment_method_id, amount,
           currency, status, provider_name, provider_transaction_id,
           provider_status, idempotency_key, error_code, error_message,
           environment, simulation_session_id, created_at, completed_at
    FROM recovery_payment_attempts
    WHERE attempt_id = $1
  `;
  const res = await db.query<RecoveryPaymentAttempt>(sql, [attemptId]);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Recovery attempt with ID ${attemptId} not found`);
  }
  return res.rows[0];
}

/**
 * Finds an attempt by its client-supplied idempotency key (prevents double charging).
 */
export async function findAttemptByIdempotencyKey(
  idempotencyKey: string,
  client?: PoolClient
): Promise<RecoveryPaymentAttempt | null> {
  const db = client || pool;
  const sql = `
    SELECT attempt_id, recovery_id, customer_id, payment_method_id, amount,
           currency, status, provider_name, provider_transaction_id,
           provider_status, idempotency_key, error_code, error_message,
           environment, simulation_session_id, created_at, completed_at
    FROM recovery_payment_attempts
    WHERE idempotency_key = $1
  `;
  const res = await db.query<RecoveryPaymentAttempt>(sql, [idempotencyKey]);
  return res.rows[0] || null;
}

/**
 * Lists all attempts recorded under a recovery campaign.
 */
export async function listAttemptsByRecovery(
  recoveryId: string,
  client?: PoolClient
): Promise<RecoveryPaymentAttempt[]> {
  const db = client || pool;
  const sql = `
    SELECT attempt_id, recovery_id, customer_id, payment_method_id, amount,
           currency, status, provider_name, provider_transaction_id,
           provider_status, idempotency_key, error_code, error_message,
           environment, simulation_session_id, created_at, completed_at
    FROM recovery_payment_attempts
    WHERE recovery_id = $1
    ORDER BY created_at DESC
  `;
  const res = await db.query<RecoveryPaymentAttempt>(sql, [recoveryId]);
  return res.rows;
}

/**
 * Updates status and third-party gateway references of an attempt transaction.
 */
export async function updateAttemptStatus(
  attemptId: string,
  status: 'PENDING' | 'PROCESSING' | 'SUCCESSFUL' | 'FAILED',
  updates?: {
    providerTransactionId?: string;
    providerStatus?: string;
    errorCode?: string;
    errorMessage?: string;
    completedAt?: Date;
  },
  client?: PoolClient
): Promise<RecoveryPaymentAttempt> {
  const db = client || pool;
  const sql = `
    UPDATE recovery_payment_attempts
    SET status = $1,
        provider_transaction_id = COALESCE($2, provider_transaction_id),
        provider_status = COALESCE($3, provider_status),
        error_code = COALESCE($4, error_code),
        error_message = COALESCE($5, error_message),
        completed_at = COALESCE($6, completed_at),
        created_at = created_at -- enforce immutable created_at
    WHERE attempt_id = $7
    RETURNING attempt_id, recovery_id, customer_id, payment_method_id, amount,
              currency, status, provider_name, provider_transaction_id,
              provider_status, idempotency_key, error_code, error_message,
              environment, simulation_session_id, created_at, completed_at
  `;
  const params = [
    status,
    updates?.providerTransactionId || null,
    updates?.providerStatus || null,
    updates?.errorCode || null,
    updates?.errorMessage || null,
    updates?.completedAt || null,
    attemptId
  ];

  const res = await db.query<RecoveryPaymentAttempt>(sql, params);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Recovery attempt with ID ${attemptId} not found`);
  }
  logger.info('Recovery attempt status updated', { attemptId, status });
  return res.rows[0];
}

/**
 * Lists only successfully cleared attempts for a recovery campaign.
 */
export async function listSuccessfulAttempts(
  recoveryId: string,
  client?: PoolClient
): Promise<RecoveryPaymentAttempt[]> {
  const db = client || pool;
  const sql = `
    SELECT attempt_id, recovery_id, customer_id, payment_method_id, amount,
           currency, status, provider_name, provider_transaction_id,
           provider_status, idempotency_key, error_code, error_message,
           environment, simulation_session_id, created_at, completed_at
    FROM recovery_payment_attempts
    WHERE recovery_id = $1 AND status = 'SUCCESSFUL'
    ORDER BY completed_at DESC
  `;
  const res = await db.query<RecoveryPaymentAttempt>(sql, [recoveryId]);
  return res.rows;
}
