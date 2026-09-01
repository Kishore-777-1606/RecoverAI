import { PoolClient } from 'pg';
import { pool } from '../connection';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { logger } from '../../shared/logging/logger';

export interface Merchant {
  merchant_id: string;
  name: string;
  email: string;
  phone: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MerchantSummary {
  merchant_id: string;
  name: string;
  email: string;
  total_customers: number;
  total_payments: number;
  total_recoveries: number;
}

/**
 * Creates a new merchant profile record.
 */
export async function createMerchant(
  merchant: { name: string; email: string; phone?: string },
  client?: PoolClient
): Promise<Merchant> {
  const db = client || pool;
  const sql = `
    INSERT INTO merchants (name, email, phone)
    VALUES ($1, $2, $3)
    RETURNING merchant_id, name, email, phone, created_at, updated_at
  `;
  const params = [merchant.name, merchant.email, merchant.phone || null];
  const res = await db.query<Merchant>(sql, params);
  logger.info('Merchant successfully registered', { merchantId: res.rows[0].merchant_id });
  return res.rows[0];
}

/**
 * Finds a merchant by their unique ID. Throws NotFoundError if not found.
 */
export async function findMerchantById(merchantId: string, client?: PoolClient): Promise<Merchant> {
  const db = client || pool;
  const sql = `
    SELECT merchant_id, name, email, phone, created_at, updated_at
    FROM merchants
    WHERE merchant_id = $1
  `;
  const res = await db.query<Merchant>(sql, [merchantId]);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Merchant with ID ${merchantId} not found`);
  }
  return res.rows[0];
}

/**
 * Finds a merchant by their unique email. Returns null if not found.
 */
export async function findMerchantByEmail(email: string, client?: PoolClient): Promise<Merchant | null> {
  const db = client || pool;
  const sql = `
    SELECT merchant_id, name, email, phone, created_at, updated_at
    FROM merchants
    WHERE email = $1
  `;
  const res = await db.query<Merchant>(sql, [email]);
  return res.rows[0] || null;
}

/**
 * Updates editable profile fields of an existing merchant.
 */
export async function updateMerchant(
  merchantId: string,
  fields: { name?: string; phone?: string },
  client?: PoolClient
): Promise<Merchant> {
  const db = client || pool;
  const sql = `
    UPDATE merchants
    SET name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        updated_at = CURRENT_TIMESTAMP
    WHERE merchant_id = $3
    RETURNING merchant_id, name, email, phone, created_at, updated_at
  `;
  const params = [fields.name || null, fields.phone || null, merchantId];
  const res = await db.query<Merchant>(sql, params);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Merchant with ID ${merchantId} not found`);
  }
  logger.info('Merchant profile updated', { merchantId });
  return res.rows[0];
}

/**
 * Retrieves aggregate totals for a merchant to render summary dashboards.
 */
export async function getMerchantSummary(merchantId: string, client?: PoolClient): Promise<MerchantSummary> {
  const db = client || pool;
  
  // Verify merchant exists
  const merchantSql = `SELECT merchant_id, name, email FROM merchants WHERE merchant_id = $1`;
  const merchantRes = await db.query(merchantSql, [merchantId]);
  if (merchantRes.rowCount === 0) {
    throw new NotFoundError(`Merchant with ID ${merchantId} not found`);
  }
  const merchantData = merchantRes.rows[0];

  const countsSql = `
    SELECT
      (SELECT COUNT(*)::integer FROM customers WHERE merchant_id = $1) AS total_customers,
      (SELECT COUNT(*)::integer FROM payments WHERE merchant_id = $1 AND environment = 'LIVE') AS total_payments,
      (SELECT COUNT(*)::integer FROM recoveries WHERE merchant_id = $1 AND environment = 'LIVE') AS total_recoveries
  `;
  const countsRes = await db.query(countsSql, [merchantId]);
  const counts = countsRes.rows[0];

  return {
    merchant_id: merchantData.merchant_id,
    name: merchantData.name,
    email: merchantData.email,
    total_customers: counts.total_customers,
    total_payments: counts.total_payments,
    total_recoveries: counts.total_recoveries
  };
}
