import { PoolClient } from 'pg';
import { pool } from '../connection';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { logger } from '../../shared/logging/logger';

export interface PaymentVerification {
  verification_id: string;
  payment_attempt_id: string;
  status: 'PENDING' | 'VERIFIED' | 'FAILED';
  verification_attempt: number;
  provider_reference: string | null;
  verified_at: Date | null;
  failure_reason: string | null;
  created_at: Date;
}

/**
 * Creates a new gateway payment verification check record.
 */
export async function createVerification(
  verification: {
    paymentAttemptId: string;
    status?: 'PENDING' | 'VERIFIED' | 'FAILED';
    verificationAttempt?: number;
    providerReference?: string;
    verifiedAt?: Date;
    failureReason?: string;
  },
  client?: PoolClient
): Promise<PaymentVerification> {
  const db = client || pool;
  const sql = `
    INSERT INTO payment_verifications (
      payment_attempt_id, status, verification_attempt,
      provider_reference, verified_at, failure_reason
    )
    VALUES ($1, COALESCE($2, 'PENDING'), COALESCE($3, 1), $4, $5, $6)
    RETURNING verification_id, payment_attempt_id, status, verification_attempt,
              provider_reference, verified_at, failure_reason, created_at
  `;
  const params = [
    verification.paymentAttemptId,
    verification.status || null,
    verification.verificationAttempt || null,
    verification.providerReference || null,
    verification.verifiedAt || null,
    verification.failureReason || null
  ];

  const res = await db.query<PaymentVerification>(sql, params);
  logger.info('Payment attempt verification logged', {
    attemptId: verification.paymentAttemptId,
    status: res.rows[0].status
  });
  return res.rows[0];
}

/**
 * Finds a verification log by its unique ID.
 */
export async function findVerificationById(verificationId: string, client?: PoolClient): Promise<PaymentVerification> {
  const db = client || pool;
  const sql = `
    SELECT verification_id, payment_attempt_id, status, verification_attempt,
           provider_reference, verified_at, failure_reason, created_at
    FROM payment_verifications
    WHERE verification_id = $1
  `;
  const res = await db.query<PaymentVerification>(sql, [verificationId]);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Verification record with ID ${verificationId} not found`);
  }
  return res.rows[0];
}

/**
 * Lists all verification attempts mapped to a payment retry checkout.
 */
export async function listVerificationsByAttempt(
  paymentAttemptId: string,
  client?: PoolClient
): Promise<PaymentVerification[]> {
  const db = client || pool;
  const sql = `
    SELECT verification_id, payment_attempt_id, status, verification_attempt,
           provider_reference, verified_at, failure_reason, created_at
    FROM payment_verifications
    WHERE payment_attempt_id = $1
    ORDER BY verification_attempt ASC
  `;
  const res = await db.query<PaymentVerification>(sql, [paymentAttemptId]);
  return res.rows;
}

/**
 * Retrieves the latest verification log (highest attempt count) for a payment attempt.
 */
export async function findLatestVerificationByAttempt(
  paymentAttemptId: string,
  client?: PoolClient
): Promise<PaymentVerification | null> {
  const db = client || pool;
  const sql = `
    SELECT verification_id, payment_attempt_id, status, verification_attempt,
           provider_reference, verified_at, failure_reason, created_at
    FROM payment_verifications
    WHERE payment_attempt_id = $1
    ORDER BY verification_attempt DESC, created_at DESC
    LIMIT 1
  `;
  const res = await db.query<PaymentVerification>(sql, [paymentAttemptId]);
  return res.rows[0] || null;
}
