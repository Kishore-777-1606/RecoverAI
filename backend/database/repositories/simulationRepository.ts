import { PoolClient } from 'pg';
import { pool } from '../connection';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { logger } from '../../shared/logging/logger';

export interface SimulationSession {
  session_id: string;
  merchant_id: string;
  name: string;
  status: 'RUNNING' | 'COMPLETED';
  created_at: Date;
  updated_at: Date;
}

export interface SimulationSessionStats {
  session_id: string;
  name: string;
  status: string;
  total_simulated_payments: number;
  recovered_payments_count: number;
  total_recovered_amount: string; // decimal money string
}

/**
 * Creates a new simulation session container.
 */
export async function createSimulationSession(
  session: {
    merchantId: string;
    name: string;
    status?: 'RUNNING' | 'COMPLETED';
  },
  client?: PoolClient
): Promise<SimulationSession> {
  const db = client || pool;
  const sql = `
    INSERT INTO simulation_sessions (merchant_id, name, status)
    VALUES ($1, $2, COALESCE($3, 'RUNNING'))
    RETURNING session_id, merchant_id, name, status, created_at, updated_at
  `;
  const params = [session.merchantId, session.name, session.status || null];
  const res = await db.query<SimulationSession>(sql, params);
  logger.info('Simulation session initialized', { merchantId: session.merchantId, sessionId: res.rows[0].session_id });
  return res.rows[0];
}

/**
 * Finds a simulation session by its unique ID.
 */
export async function findSessionById(sessionId: string, client?: PoolClient): Promise<SimulationSession> {
  const db = client || pool;
  const sql = `
    SELECT session_id, merchant_id, name, status, created_at, updated_at
    FROM simulation_sessions
    WHERE session_id = $1
  `;
  const res = await db.query<SimulationSession>(sql, [sessionId]);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Simulation session with ID ${sessionId} not found`);
  }
  return res.rows[0];
}

/**
 * Lists all simulation session runs performed by a merchant.
 */
export async function listSessionsByMerchant(merchantId: string, client?: PoolClient): Promise<SimulationSession[]> {
  const db = client || pool;
  const sql = `
    SELECT session_id, merchant_id, name, status, created_at, updated_at
    FROM simulation_sessions
    WHERE merchant_id = $1
    ORDER BY created_at DESC
  `;
  const res = await db.query<SimulationSession>(sql, [merchantId]);
  return res.rows;
}

/**
 * Retrieves aggregate statistics for a specific simulation session.
 */
export async function getSimulationSessionStats(
  sessionId: string,
  client?: PoolClient
): Promise<SimulationSessionStats> {
  const db = client || pool;
  
  // Verify session exists
  const session = await findSessionById(sessionId, db as any);

  const statsSql = `
    SELECT
      COUNT(p.payment_id)::integer AS total_simulated_payments,
      COUNT(CASE WHEN r.status = 'RECOVERED' THEN 1 END)::integer AS recovered_payments_count,
      COALESCE(SUM(CASE WHEN rpa.status = 'SUCCESSFUL' THEN rpa.amount ELSE 0.00 END), 0.00) AS total_recovered_amount
    FROM payments p
    LEFT JOIN recoveries r ON p.payment_id = r.payment_id
    LEFT JOIN recovery_payment_attempts rpa ON r.recovery_id = rpa.recovery_id AND rpa.status = 'SUCCESSFUL'
    WHERE p.simulation_session_id = $1
  `;
  const statsRes = await db.query(statsSql, [sessionId]);
  const stats = statsRes.rows[0];

  return {
    session_id: session.session_id,
    name: session.name,
    status: session.status,
    total_simulated_payments: stats.total_simulated_payments,
    recovered_payments_count: stats.recovered_payments_count,
    total_recovered_amount: stats.total_recovered_amount.toString()
  };
}

/**
 * Deletes a simulation session.
 * Leverages PostgreSQL CASCADE constraints to clean up all related simulated payments,
 * recoveries, timeline events, attempts, notifications, and links.
 */
export async function deleteSimulationSession(sessionId: string, client?: PoolClient): Promise<void> {
  const db = client || pool;
  
  // Verify session exists
  const checkSql = `SELECT session_id FROM simulation_sessions WHERE session_id = $1`;
  const checkRes = await db.query(checkSql, [sessionId]);
  if (checkRes.rowCount === 0) {
    throw new NotFoundError(`Simulation session with ID ${sessionId} not found`);
  }

  const deleteSql = `DELETE FROM simulation_sessions WHERE session_id = $1`;
  await db.query(deleteSql, [sessionId]);
  logger.warn('Simulation session and all cascading records successfully deleted', { sessionId });
}
