import { PoolClient } from 'pg';
import { pool } from '../connection';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { logger } from '../../shared/logging/logger';

export interface CustomerNotification {
  notification_id: string;
  recovery_id: string;
  customer_id: string;
  channel: 'SMS' | 'EMAIL' | 'WHATSAPP';
  message_template_ref: string | null;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'OPENED' | 'FAILED';
  attempt_number: number;
  sent_at: Date | null;
  delivered_at: Date | null;
  opened_at: Date | null;
  failed_at: Date | null;
  error_message: string | null;
  created_at: Date;
}

/**
 * Creates a new outbound customer notification dispatch log.
 * Enforces customer context matching using composite keys.
 */
export async function createNotification(
  notification: {
    recoveryId: string;
    customerId: string;
    channel: 'SMS' | 'EMAIL' | 'WHATSAPP';
    messageTemplateRef?: string;
    status?: 'PENDING' | 'SENT' | 'DELIVERED' | 'OPENED' | 'FAILED';
    attemptNumber?: number;
    sentAt?: Date;
  },
  client?: PoolClient
): Promise<CustomerNotification> {
  const db = client || pool;
  const sql = `
    INSERT INTO customer_notifications (
      recovery_id, customer_id, channel, message_template_ref,
      status, attempt_number, sent_at
    )
    VALUES ($1, $2, $3, $4, COALESCE($5, 'PENDING'), COALESCE($6, 1), $7)
    RETURNING notification_id, recovery_id, customer_id, channel, message_template_ref,
              status, attempt_number, sent_at, delivered_at, opened_at, failed_at, error_message, created_at
  `;
  const params = [
    notification.recoveryId,
    notification.customerId,
    notification.channel,
    notification.messageTemplateRef || null,
    notification.status || null,
    notification.attemptNumber || null,
    notification.sentAt || null
  ];

  const res = await db.query<CustomerNotification>(sql, params);
  logger.debug('Customer outreach logged', {
    recoveryId: notification.recoveryId,
    channel: notification.channel,
    status: res.rows[0].status
  });
  return res.rows[0];
}

/**
 * Finds a notification log by its ID. Throws NotFoundError if not found.
 */
export async function findNotificationById(
  notificationId: string,
  client?: PoolClient
): Promise<CustomerNotification> {
  const db = client || pool;
  const sql = `
    SELECT notification_id, recovery_id, customer_id, channel, message_template_ref,
           status, attempt_number, sent_at, delivered_at, opened_at, failed_at, error_message, created_at
    FROM customer_notifications
    WHERE notification_id = $1
  `;
  const res = await db.query<CustomerNotification>(sql, [notificationId]);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Notification log with ID ${notificationId} not found`);
  }
  return res.rows[0];
}

/**
 * Lists all notifications dispatched for a recovery campaign.
 */
export async function listNotificationsByRecovery(
  recoveryId: string,
  client?: PoolClient
): Promise<CustomerNotification[]> {
  const db = client || pool;
  const sql = `
    SELECT notification_id, recovery_id, customer_id, channel, message_template_ref,
           status, attempt_number, sent_at, delivered_at, opened_at, failed_at, error_message, created_at
    FROM customer_notifications
    WHERE recovery_id = $1
    ORDER BY created_at DESC
  `;
  const res = await db.query<CustomerNotification>(sql, [recoveryId]);
  return res.rows;
}

/**
 * Lists all notifications dispatched to a customer profile.
 */
export async function listNotificationsByCustomer(
  customerId: string,
  client?: PoolClient
): Promise<CustomerNotification[]> {
  const db = client || pool;
  const sql = `
    SELECT notification_id, recovery_id, customer_id, channel, message_template_ref,
           status, attempt_number, sent_at, delivered_at, opened_at, failed_at, error_message, created_at
    FROM customer_notifications
    WHERE customer_id = $1
    ORDER BY created_at DESC
  `;
  const res = await db.query<CustomerNotification>(sql, [customerId]);
  return res.rows;
}

/**
 * Updates delivery statuses and logs vendor failure details.
 */
export async function updateNotificationStatus(
  notificationId: string,
  status: 'SENT' | 'DELIVERED' | 'OPENED' | 'FAILED',
  updates?: {
    sentAt?: Date;
    deliveredAt?: Date;
    openedAt?: Date;
    failedAt?: Date;
    errorMessage?: string;
  },
  client?: PoolClient
): Promise<CustomerNotification> {
  const db = client || pool;
  const sql = `
    UPDATE customer_notifications
    SET status = $1,
        sent_at = COALESCE($2, sent_at),
        delivered_at = COALESCE($3, delivered_at),
        opened_at = COALESCE($4, opened_at),
        failed_at = COALESCE($5, failed_at),
        error_message = COALESCE($6, error_message)
    WHERE notification_id = $7
    RETURNING notification_id, recovery_id, customer_id, channel, message_template_ref,
              status, attempt_number, sent_at, delivered_at, opened_at, failed_at, error_message, created_at
  `;
  const params = [
    status,
    updates?.sentAt || null,
    updates?.deliveredAt || null,
    updates?.openedAt || null,
    updates?.failedAt || null,
    updates?.errorMessage || null,
    notificationId
  ];

  const res = await db.query<CustomerNotification>(sql, params);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Notification log with ID ${notificationId} not found`);
  }
  logger.debug('Outreach status updated', { notificationId, status });
  return res.rows[0];
}
