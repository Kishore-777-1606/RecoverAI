import { PoolClient } from 'pg';
import { pool } from './connection';
import { logger } from '../shared/logging/logger';

/**
 * Wraps a block of repository/database calls inside a SQL transaction scope.
 * Automatically performs COMMIT on success or ROLLBACK on failure.
 *
 * @param callback Async function executing operations with the checked-out PoolClient.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
      logger.info('Database transaction successfully rolled back.');
    } catch (rollbackErr: any) {
      logger.error('Failed to rollback transaction', { error: rollbackErr.message });
    }
    logger.error('Transaction failed and was rolled back', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}
