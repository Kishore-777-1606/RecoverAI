import { Pool, QueryResult, QueryResultRow } from 'pg';
import { env } from '../config/env';
import { logger } from '../shared/logging/logger';

// Check if external cloud database connection requires SSL (Render / Supabase / Neon / AWS)
const isLocalhost = env.DATABASE_URL.includes('localhost') || env.DATABASE_URL.includes('127.0.0.1') || env.DATABASE_URL.includes('recoverai-postgres');

// Create a singleton connection pool with automatic SSL support for cloud PostgreSQL
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isLocalhost ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10
});

// Register pool level error handler
pool.on('error', (err) => {
  logger.error('Unexpected database pool error', { error: err.message });
});

/**
 * Executes a raw parameterized query using the pool connection.
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, durationMs: duration, rowsCount: res.rowCount });
    return res;
  } catch (err: any) {
    logger.error('Database query execution failed', {
      text,
      error: err.message,
      code: err.code
    });
    throw err;
  }
}

/**
 * Cleanly closes all active connections in the pool.
 */
export async function closeDatabaseConnection(): Promise<void> {
  logger.info('Closing database pool...');
  try {
    await pool.end();
    logger.info('Database pool successfully ended.');
  } catch (err: any) {
    logger.error('Error during database pool shutdown', { error: err.message });
  }
}
