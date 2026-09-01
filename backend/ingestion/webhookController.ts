import { Request, Response } from 'express';
import { processWebhook } from './webhookService';
import { logger } from '../shared/logging/logger';
import { pool } from '../database/connection';
import { updateNotificationStatus } from '../database/repositories/notificationRepository';

/**
 * Express Webhook Controller for incoming third-party callbacks.
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const provider = req.params.provider || 'mock';
  const payload = req.body;
  const headers = (req.headers as Record<string, string>) || {};

  logger.info('Incoming webhook received', { provider, eventId: payload?.id || payload?.eventId });

  if (!payload || Object.keys(payload).length === 0) {
    res.status(400).json({ message: 'Empty or malformed payload request body' });
    return;
  }

  try {
    const outcome = await processWebhook(provider, payload, headers);

    switch (outcome.result) {
      case 'ACCEPTED':
        res.status(202).json({
          status: 'ACCEPTED',
          message: 'Event accepted and internal dispatches started.',
          providerEventId: outcome.event?.providerEventId
        });
        break;

      case 'DUPLICATE':
        res.status(200).json({
          status: 'DUPLICATE',
          message: 'Webhook duplicate skipped.',
          providerEventId: outcome.event?.providerEventId
        });
        break;

      case 'REJECTED':
      default:
        res.status(400).json({
          status: 'REJECTED',
          message: 'Processing failed. Webhook body malformed or validation failed.'
        });
        break;
    }
  } catch (err: any) {
    logger.error('Unexpected controller error during webhook processing', { error: err.message });
    res.status(500).json({ message: 'Internal Server Error' });
  }
}

/**
 * Handles incoming delivery status callbacks from Twilio gateway.
 */
export async function handleTwilioCallback(req: Request, res: Response): Promise<void> {
  const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;

  logger.info('Incoming Twilio delivery callback received', { MessageSid, MessageStatus });

  if (!MessageSid || !MessageStatus) {
    res.status(400).json({ message: 'Missing MessageSid or MessageStatus parameter' });
    return;
  }

  try {
    // 1. Resolve notification_id using audit log post_values mapping
    const logSql = `
      SELECT entity_id FROM audit_logs
      WHERE action = 'NOTIFICATION_DISPATCHED' AND post_values->>'providerMessageId' = $1
      LIMIT 1
    `;
    const logRes = await pool.query(logSql, [MessageSid]);

    if (logRes.rowCount === 0) {
      logger.warn('Twilio callback received but no matching notification audit record found', { MessageSid });
      res.status(200).json({ success: true, message: 'MessageSid not found, skipping update.' });
      return;
    }

    const notificationId = logRes.rows[0].entity_id;

    // 2. Map status to customer_notifications status schema
    const statusMap: Record<string, 'SENT' | 'DELIVERED' | 'FAILED'> = {
      'queued': 'SENT',
      'sending': 'SENT',
      'sent': 'SENT',
      'delivered': 'DELIVERED',
      'undelivered': 'FAILED',
      'failed': 'FAILED'
    };
    const mappedStatus = statusMap[MessageStatus.toLowerCase()] || 'SENT';

    // 3. Perform database record status update
    const updates: any = {};
    if (mappedStatus === 'SENT' || mappedStatus === 'DELIVERED') {
      updates.sentAt = new Date();
    }
    if (mappedStatus === 'DELIVERED') {
      updates.deliveredAt = new Date();
    }
    if (mappedStatus === 'FAILED') {
      updates.failedAt = new Date();
      updates.errorMessage = ErrorMessage || (ErrorCode ? `Twilio Error Code: ${ErrorCode}` : 'Twilio delivery failed');
    }

    await updateNotificationStatus(notificationId, mappedStatus, updates);

    logger.info('Notification delivery status updated via Twilio callback', {
      notificationId,
      MessageSid,
      status: mappedStatus
    });

    res.status(200).json({ success: true, message: 'Delivery status updated successfully.' });
  } catch (err: any) {
    logger.error('Error handling Twilio delivery status callback', { error: err.message, MessageSid });
    res.status(500).json({ message: 'Internal Server Error' });
  }
}
