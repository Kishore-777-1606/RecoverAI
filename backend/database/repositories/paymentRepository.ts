import { PoolClient } from 'pg';
import { pool } from '../connection';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { PaginatedResult } from '../../shared/types/common';
import { logger } from '../../shared/logging/logger';

export interface Payment {
  payment_id: string;
  merchant_id: string;
  customer_id: string;
  payment_method_id: string;
  amount: string; // NUMERIC
  currency: string;
  status: 'INITIATED' | 'PROCESSING' | 'SUCCESSFUL' | 'FAILED';
  failure_type_id: string | null;
  failure_message: string | null;
  external_reference: string;
  provider_event_id: string | null;
  environment: 'LIVE' | 'TEST' | 'SIMULATION';
  simulation_session_id: string | null;
  created_at: Date;
  updated_at: Date;
  failed_at: Date | null;
  successful_at: Date | null;
}

/**
 * Creates an original immutable payment record.
 */
export async function createPayment(
  payment: {
    merchantId: string;
    customerId: string;
    paymentMethodId: string;
    amount: string; // Decimal money string
    currency?: string;
    status?: 'INITIATED' | 'PROCESSING' | 'SUCCESSFUL' | 'FAILED';
    failureTypeId?: string;
    failureMessage?: string;
    externalReference: string;
    providerEventId?: string;
    environment?: 'LIVE' | 'TEST' | 'SIMULATION';
    simulationSessionId?: string;
    failedAt?: Date;
    successfulAt?: Date;
  },
  client?: PoolClient
): Promise<Payment> {
  const db = client || pool;
  const sql = `
    INSERT INTO payments (
      merchant_id, customer_id, payment_method_id, amount,
      currency, status, failure_type_id, failure_message,
      external_reference, provider_event_id, environment,
      simulation_session_id, failed_at, successful_at
    )
    VALUES ($1, $2, $3, $4, COALESCE($5, 'INR'), COALESCE($6, 'INITIATED'), $7, $8, $9, $10, COALESCE($11, 'LIVE'), $12, $13, $14)
    RETURNING payment_id, merchant_id, customer_id, payment_method_id, amount,
              currency, status, failure_type_id, failure_message,
              external_reference, provider_event_id, environment,
              simulation_session_id, created_at, updated_at, failed_at, successful_at
  `;
  const params = [
    payment.merchantId,
    payment.customerId,
    payment.paymentMethodId,
    payment.amount,
    payment.currency || null,
    payment.status || null,
    payment.failureTypeId || null,
    payment.failureMessage || null,
    payment.externalReference,
    payment.providerEventId || null,
    payment.environment || null,
    payment.simulationSessionId || null,
    payment.failedAt || null,
    payment.successfulAt || null
  ];
  
  const res = await db.query<Payment>(sql, params);
  logger.info('Base payment transaction recorded', {
    merchantId: payment.merchantId,
    paymentId: res.rows[0].payment_id,
    status: res.rows[0].status
  });
  return res.rows[0];
}

/**
 * Finds a base payment by its unique ID (scoped by merchant).
 */
export async function findPaymentById(
  merchantId: string,
  paymentId: string,
  client?: PoolClient
): Promise<Payment> {
  const db = client || pool;
  const sql = `
    SELECT payment_id, merchant_id, customer_id, payment_method_id, amount,
           currency, status, failure_type_id, failure_message,
           external_reference, provider_event_id, environment,
           simulation_session_id, created_at, updated_at, failed_at, successful_at
    FROM payments
    WHERE merchant_id = $1 AND payment_id = $2
  `;
  const res = await db.query<Payment>(sql, [merchantId, paymentId]);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Payment with ID ${paymentId} not found`);
  }
  return res.rows[0];
}

/**
 * Finds a payment using merchant scope and external checkout ID.
 */
export async function findPaymentByExternalReference(
  merchantId: string,
  externalReference: string,
  client?: PoolClient
): Promise<Payment | null> {
  const db = client || pool;
  const sql = `
    SELECT payment_id, merchant_id, customer_id, payment_method_id, amount,
           currency, status, failure_type_id, failure_message,
           external_reference, provider_event_id, environment,
           simulation_session_id, created_at, updated_at, failed_at, successful_at
    FROM payments
    WHERE merchant_id = $1 AND external_reference = $2
  `;
  const res = await db.query<Payment>(sql, [merchantId, externalReference]);
  return res.rows[0] || null;
}

/**
 * Finds a payment by the unique provider event webhook ID.
 */
export async function findPaymentByProviderEventId(
  providerEventId: string,
  client?: PoolClient
): Promise<Payment | null> {
  const db = client || pool;
  const sql = `
    SELECT payment_id, merchant_id, customer_id, payment_method_id, amount,
           currency, status, failure_type_id, failure_message,
           external_reference, provider_event_id, environment,
           simulation_session_id, created_at, updated_at, failed_at, successful_at
    FROM payments
    WHERE provider_event_id = $1
  `;
  const res = await db.query<Payment>(sql, [providerEventId]);
  return res.rows[0] || null;
}

/**
 * Lists and filters base payments for a merchant.
 */
export async function listPayments(
  merchantId: string,
  filters: {
    customerId?: string;
    status?: string;
    environment?: 'LIVE' | 'TEST' | 'SIMULATION';
    simulationSessionId?: string;
    page?: number;
    limit?: number;
  },
  client?: PoolClient
): Promise<PaginatedResult<Payment>> {
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
  if (filters.environment) {
    params.push(filters.environment);
    queryConds.push(`environment = $${params.length}`);
  }
  if (filters.simulationSessionId) {
    params.push(filters.simulationSessionId);
    queryConds.push(`simulation_session_id = $${params.length}`);
  }

  const whereClause = queryConds.join(' AND ');

  const countSql = `SELECT COUNT(*)::integer FROM payments WHERE ${whereClause}`;
  const countRes = await db.query(countSql, params);
  const total = countRes.rows[0].count;

  // Append pagination params to list sql
  params.push(limit);
  const limitIndex = params.length;
  params.push(offset);
  const offsetIndex = params.length;

  const listSql = `
    SELECT payment_id, merchant_id, customer_id, payment_method_id, amount,
           currency, status, failure_type_id, failure_message,
           external_reference, provider_event_id, environment,
           simulation_session_id, created_at, updated_at, failed_at, successful_at
    FROM payments
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `;
  const listRes = await db.query<Payment>(listSql, params);

  return {
    data: listRes.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
}

/**
 * Updates status and lifecycle details of a payment.
 * Guarantees that merchant_id, customer_id, and amount are never mutated.
 */
export async function updatePaymentStatus(
  merchantId: string,
  paymentId: string,
  status: 'SUCCESSFUL' | 'FAILED' | 'PROCESSING',
  lifecycle: {
    failedAt?: Date;
    successfulAt?: Date;
    failureTypeId?: string;
    failureMessage?: string;
    providerEventId?: string;
  },
  client?: PoolClient
): Promise<Payment> {
  const db = client || pool;
  
  // Note: chk_payment_failure_state will automatically fail the query if status-timestamps are mismatched
  const sql = `
    UPDATE payments
    SET status = $1,
        failed_at = COALESCE($2, failed_at),
        successful_at = COALESCE($3, successful_at),
        failure_type_id = COALESCE($4, failure_type_id),
        failure_message = COALESCE($5, failure_message),
        provider_event_id = COALESCE($6, provider_event_id),
        updated_at = CURRENT_TIMESTAMP
    WHERE merchant_id = $7 AND payment_id = $8
    RETURNING payment_id, merchant_id, customer_id, payment_method_id, amount,
              currency, status, failure_type_id, failure_message,
              external_reference, provider_event_id, environment,
              simulation_session_id, created_at, updated_at, failed_at, successful_at
  `;
  const params = [
    status,
    lifecycle.failedAt || null,
    lifecycle.successfulAt || null,
    lifecycle.failureTypeId || null,
    lifecycle.failureMessage || null,
    lifecycle.providerEventId || null,
    merchantId,
    paymentId
  ];
  
  const res = await db.query<Payment>(sql, params);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Payment with ID ${paymentId} not found`);
  }
  logger.info('Payment status transitioned', { paymentId, newStatus: status });
  return res.rows[0];
}

/**
 * Finds a base payment across all merchants using only its unique external reference.
 */
export async function findPaymentByExternalReferenceGlobal(
  externalReference: string,
  client?: PoolClient
): Promise<Payment | null> {
  const db = client || pool;
  const sql = `
    SELECT payment_id, merchant_id, customer_id, payment_method_id, amount,
           currency, status, failure_type_id, failure_message,
           external_reference, provider_event_id, environment,
           simulation_session_id, created_at, updated_at, failed_at, successful_at
    FROM payments
    WHERE external_reference = $1
  `;
  const res = await db.query<Payment>(sql, [externalReference]);
  return res.rows[0] || null;
}
