import { PoolClient } from 'pg';
import { pool } from '../connection';
import { PaginatedResult } from '../../shared/types/common';
import { logger } from '../../shared/logging/logger';

export interface AuditLog {
  audit_log_id: string;
  merchant_id: string | null;
  actor: string;
  action: string;
  entity_name: string;
  entity_id: string;
  pre_values: any | null;
  post_values: any | null;
  ip_address: string | null;
  created_at: Date;
}

/**
 * Appends a new audit log record.
 * This table is append-only; update/delete methods are not provided.
 */
export async function createAuditLog(
  log: {
    merchantId?: string;
    actor: string;
    action: string;
    entityName: string;
    entityId: string;
    preValues?: any;
    postValues?: any;
    ipAddress?: string;
  },
  client?: PoolClient
): Promise<AuditLog> {
  const db = client || pool;
  const sql = `
    INSERT INTO audit_logs (
      merchant_id, actor, action, entity_name, entity_id,
      pre_values, post_values, ip_address
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING audit_log_id, merchant_id, actor, action, entity_name, entity_id,
              pre_values, post_values, ip_address, created_at
  `;
  const params = [
    log.merchantId || null,
    log.actor,
    log.action,
    log.entityName,
    log.entityId,
    log.preValues ? JSON.stringify(log.preValues) : null,
    log.postValues ? JSON.stringify(log.postValues) : null,
    log.ipAddress || null
  ];

  const res = await db.query<AuditLog>(sql, params);
  logger.debug('Audit log entry created', {
    auditLogId: res.rows[0].audit_log_id,
    action: log.action,
    entityName: log.entityName
  });
  return res.rows[0];
}

/**
 * Lists audit logs for a specific merchant.
 */
export async function listAuditLogs(
  merchantId: string,
  filters: {
    action?: string;
    entityName?: string;
    page?: number;
    limit?: number;
  },
  client?: PoolClient
): Promise<PaginatedResult<AuditLog>> {
  const db = client || pool;
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const offset = (page - 1) * limit;

  let queryConds = [`merchant_id = $1`];
  let params: any[] = [merchantId];

  if (filters.action) {
    params.push(filters.action);
    queryConds.push(`action = $${params.length}`);
  }
  if (filters.entityName) {
    params.push(filters.entityName);
    queryConds.push(`entity_name = $${params.length}`);
  }

  const whereClause = queryConds.join(' AND ');

  const countSql = `SELECT COUNT(*)::integer FROM audit_logs WHERE ${whereClause}`;
  const countRes = await db.query(countSql, params);
  const total = countRes.rows[0].count;

  params.push(limit);
  const limitIndex = params.length;
  params.push(offset);
  const offsetIndex = params.length;

  const listSql = `
    SELECT audit_log_id, merchant_id, actor, action, entity_name, entity_id,
           pre_values, post_values, ip_address, created_at
    FROM audit_logs
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `;
  const listRes = await db.query<AuditLog>(listSql, params);

  return {
    data: listRes.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
}
