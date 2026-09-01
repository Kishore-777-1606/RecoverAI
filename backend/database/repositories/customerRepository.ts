import { PoolClient } from 'pg';
import { pool } from '../connection';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { PaginatedResult } from '../../shared/types/common';
import { logger } from '../../shared/logging/logger';

export interface Customer {
  customer_id: string;
  merchant_id: string;
  name: string;
  email: string;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  created_at: Date;
  updated_at: Date;
}

export interface CustomerSummary {
  customer_id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  total_payments_count: number;
  failed_payments_count: number;
  recovered_payments_count: number;
  total_recovered_amount: string; // 2-decimal string
}

/**
 * Creates a new customer record under a specific merchant scope.
 */
export async function createCustomer(
  customer: {
    merchantId: string;
    name: string;
    email: string;
    phone?: string;
    status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  },
  client?: PoolClient
): Promise<Customer> {
  const db = client || pool;
  const sql = `
    INSERT INTO customers (merchant_id, name, email, phone, status)
    VALUES ($1, $2, $3, $4, COALESCE($5, 'ACTIVE'))
    RETURNING customer_id, merchant_id, name, email, phone, status, created_at, updated_at
  `;
  const params = [
    customer.merchantId,
    customer.name,
    customer.email,
    customer.phone || null,
    customer.status || null
  ];
  const res = await db.query<Customer>(sql, params);
  logger.info('Customer profile created', { merchantId: customer.merchantId, customerId: res.rows[0].customer_id });
  return res.rows[0];
}

/**
 * Finds a customer by ID under merchant scope to guarantee tenant isolation.
 */
export async function findCustomerById(
  merchantId: string,
  customerId: string,
  client?: PoolClient
): Promise<Customer> {
  const db = client || pool;
  const sql = `
    SELECT customer_id, merchant_id, name, email, phone, status, created_at, updated_at
    FROM customers
    WHERE merchant_id = $1 AND customer_id = $2
  `;
  const res = await db.query<Customer>(sql, [merchantId, customerId]);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Customer with ID ${customerId} not found for this merchant`);
  }
  return res.rows[0];
}

/**
 * Finds a customer by email under merchant scope (enforcing UNIQUE index contract).
 */
export async function findCustomerByEmail(
  merchantId: string,
  email: string,
  client?: PoolClient
): Promise<Customer | null> {
  const db = client || pool;
  const sql = `
    SELECT customer_id, merchant_id, name, email, phone, status, created_at, updated_at
    FROM customers
    WHERE merchant_id = $1 AND email = $2
  `;
  const res = await db.query<Customer>(sql, [merchantId, email]);
  return res.rows[0] || null;
}

/**
 * Lists all customers belonging to a merchant using pagination.
 */
export async function listCustomersByMerchant(
  merchantId: string,
  pagination: { page: number; limit: number },
  client?: PoolClient
): Promise<PaginatedResult<Customer>> {
  const db = client || pool;
  const offset = (pagination.page - 1) * pagination.limit;

  const countSql = `SELECT COUNT(*)::integer FROM customers WHERE merchant_id = $1`;
  const countRes = await db.query(countSql, [merchantId]);
  const total = countRes.rows[0].count;

  const listSql = `
    SELECT customer_id, merchant_id, name, email, phone, status, created_at, updated_at
    FROM customers
    WHERE merchant_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `;
  const listRes = await db.query<Customer>(listSql, [merchantId, pagination.limit, offset]);

  return {
    data: listRes.rows,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages: Math.ceil(total / pagination.limit)
  };
}

/**
 * Searches customer profiles by partial match on name or email (merchant isolated).
 */
export async function searchCustomers(
  merchantId: string,
  queryText: string,
  client?: PoolClient
): Promise<Customer[]> {
  const db = client || pool;
  const sql = `
    SELECT customer_id, merchant_id, name, email, phone, status, created_at, updated_at
    FROM customers
    WHERE merchant_id = $1
      AND (name ILIKE $2 OR email ILIKE $2)
    ORDER BY name ASC
    LIMIT 50
  `;
  const matchPattern = `%${queryText}%`;
  const res = await db.query<Customer>(sql, [merchantId, matchPattern]);
  return res.rows;
}

/**
 * Gathers complete payment, failure, and recovery stats for a customer (Live environment transactions only).
 */
export async function getCustomerSummary(
  merchantId: string,
  customerId: string,
  client?: PoolClient
): Promise<CustomerSummary> {
  const db = client || pool;
  
  // Verify customer exists
  const customer = await findCustomerById(merchantId, customerId, db as any);

  const statsSql = `
    SELECT
      COUNT(p.payment_id)::integer AS total_payments_count,
      COUNT(CASE WHEN p.status = 'FAILED' THEN 1 END)::integer AS failed_payments_count,
      COUNT(CASE WHEN r.status = 'RECOVERED' THEN 1 END)::integer AS recovered_payments_count,
      COALESCE(SUM(CASE WHEN rpa.status = 'SUCCESSFUL' THEN rpa.amount ELSE 0.00 END), 0.00) AS total_recovered_amount
    FROM payments p
    LEFT JOIN recoveries r ON p.payment_id = r.payment_id
    LEFT JOIN recovery_payment_attempts rpa ON r.recovery_id = rpa.recovery_id AND rpa.status = 'SUCCESSFUL'
    WHERE p.merchant_id = $1 
      AND p.customer_id = $2 
      AND p.environment = 'LIVE'
  `;
  const statsRes = await db.query(statsSql, [merchantId, customerId]);
  const stats = statsRes.rows[0];

  return {
    customer_id: customer.customer_id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    status: customer.status,
    total_payments_count: stats.total_payments_count,
    failed_payments_count: stats.failed_payments_count,
    recovered_payments_count: stats.recovered_payments_count,
    total_recovered_amount: stats.total_recovered_amount.toString()
  };
}
