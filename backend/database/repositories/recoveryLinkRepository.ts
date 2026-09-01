import { PoolClient } from 'pg';
import { pool } from '../connection';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { logger } from '../../shared/logging/logger';

export interface RecoveryLink {
  recovery_link_id: string;
  recovery_id: string;
  secure_token: string;
  status: 'ACTIVE' | 'EXPIRED' | 'USED' | 'INVALIDATED';
  created_at: Date;
  expires_at: Date;
  opened_at: Date | null;
  used_at: Date | null;
  invalidated_at: Date | null;
  invalidation_reason: string | null;
}

/**
 * Creates a new secure recovery link record.
 */
export async function createRecoveryLink(
  link: {
    recoveryId: string;
    secureToken: string;
    expiresAt: Date;
    status?: 'ACTIVE' | 'EXPIRED' | 'USED' | 'INVALIDATED';
  },
  client?: PoolClient
): Promise<RecoveryLink> {
  const db = client || pool;
  const sql = `
    INSERT INTO recovery_links (recovery_id, secure_token, expires_at, status)
    VALUES ($1, $2, $3, COALESCE($4, 'ACTIVE'))
    RETURNING recovery_link_id, recovery_id, secure_token, status,
              created_at, expires_at, opened_at, used_at, invalidated_at, invalidation_reason
  `;
  const params = [link.recoveryId, link.secureToken, link.expiresAt, link.status || null];
  const res = await db.query<RecoveryLink>(sql, params);
  
  // Note: Avoid logging the secure token itself to maintain compliance
  logger.info('Recovery payment link generated', {
    recoveryId: link.recoveryId,
    linkId: res.rows[0].recovery_link_id
  });
  return res.rows[0];
}

/**
 * Finds a link record by its unique ID.
 */
export async function findRecoveryLinkById(linkId: string, client?: PoolClient): Promise<RecoveryLink> {
  const db = client || pool;
  const sql = `
    SELECT recovery_link_id, recovery_id, secure_token, status,
           created_at, expires_at, opened_at, used_at, invalidated_at, invalidation_reason
    FROM recovery_links
    WHERE recovery_link_id = $1
  `;
  const res = await db.query<RecoveryLink>(sql, [linkId]);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Recovery link with ID ${linkId} not found`);
  }
  return res.rows[0];
}

/**
 * Finds a link by its globally unique secure token.
 */
export async function findRecoveryLinkByToken(
  secureToken: string,
  client?: PoolClient
): Promise<RecoveryLink | null> {
  const db = client || pool;
  const sql = `
    SELECT recovery_link_id, recovery_id, secure_token, status,
           created_at, expires_at, opened_at, used_at, invalidated_at, invalidation_reason
    FROM recovery_links
    WHERE secure_token = $1
  `;
  const res = await db.query<RecoveryLink>(sql, [secureToken]);
  return res.rows[0] || null;
}

/**
 * Lists all links generated for a recovery campaign.
 */
export async function listLinksByRecovery(recoveryId: string, client?: PoolClient): Promise<RecoveryLink[]> {
  const db = client || pool;
  const sql = `
    SELECT recovery_link_id, recovery_id, secure_token, status,
           created_at, expires_at, opened_at, used_at, invalidated_at, invalidation_reason
    FROM recovery_links
    WHERE recovery_id = $1
    ORDER BY created_at DESC
  `;
  const res = await db.query<RecoveryLink>(sql, [recoveryId]);
  return res.rows;
}

/**
 * Updates status, open times, use times, or invalidation details of a link.
 */
export async function updateLinkStatus(
  linkId: string,
  status: 'ACTIVE' | 'EXPIRED' | 'USED' | 'INVALIDATED',
  updates?: {
    openedAt?: Date;
    usedAt?: Date;
    invalidatedAt?: Date;
    invalidationReason?: string;
  },
  client?: PoolClient
): Promise<RecoveryLink> {
  const db = client || pool;
  const sql = `
    UPDATE recovery_links
    SET status = $1,
        opened_at = COALESCE($2, opened_at),
        used_at = COALESCE($3, used_at),
        invalidated_at = COALESCE($4, invalidated_at),
        invalidation_reason = COALESCE($5, invalidation_reason)
    WHERE recovery_link_id = $6
    RETURNING recovery_link_id, recovery_id, secure_token, status,
              created_at, expires_at, opened_at, used_at, invalidated_at, invalidation_reason
  `;
  const params = [
    status,
    updates?.openedAt || null,
    updates?.usedAt || null,
    updates?.invalidatedAt || null,
    updates?.invalidationReason || null,
    linkId
  ];

  const res = await db.query<RecoveryLink>(sql, params);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Recovery link with ID ${linkId} not found`);
  }
  logger.info('Recovery link status updated', { linkId, status });
  return res.rows[0];
}
