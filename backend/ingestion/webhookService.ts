import { normalizePaymentWebhook, NormalizedPaymentEvent } from './eventNormalizer';
import { eventBus } from './eventBus';
import { pool } from '../database/connection';
import { createAuditLog } from '../database/repositories/auditRepository';
import { logger } from '../shared/logging/logger';
import { createHash } from 'crypto';

function toUUID(str: string): string {
  const hash = createHash('md5').update(str).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export type WebhookProcessingResult = 'ACCEPTED' | 'DUPLICATE' | 'IGNORED' | 'REJECTED';

/**
 * Validates, normalizes, logs, and publishes webhook events to the Event Bus.
 */
export async function processWebhook(
  provider: string,
  payload: any,
  headers: Record<string, string> = {}
): Promise<{ result: WebhookProcessingResult; event?: NormalizedPaymentEvent }> {
  try {
    // 1. Normalize payload structure
    const event = normalizePaymentWebhook(provider, payload, headers);

    // 2. Query audit ledger to enforce event-level idempotency
    const dupSql = `
      SELECT 1 FROM audit_logs 
      WHERE action = 'WEBHOOK_PROCESSED' AND entity_id = $1 
      LIMIT 1
    `;
    const dupRes = await pool.query(dupSql, [toUUID(event.providerEventId)]);
    if (dupRes.rowCount && dupRes.rowCount > 0) {
      logger.info('Duplicate webhook detected and skipped', {
        providerEventId: event.providerEventId,
        eventType: event.eventType
      });
      return { result: 'DUPLICATE', event };
    }

    // 3. Publish to internal modular monolith event bus
    // Listeners (like PaymentEventHandler) will process based on status transitions
    await eventBus.publish(`payment.${event.status.toLowerCase()}`, event);

    // 4. Record to audit ledger
    await createAuditLog({
      actor: 'SYSTEM',
      action: 'WEBHOOK_PROCESSED',
      entityName: 'webhook_event',
      entityId: toUUID(event.providerEventId),
      postValues: {
        provider: event.provider,
        eventType: event.eventType,
        status: event.status,
        paymentReference: event.paymentReference,
        externalReference: event.externalReference
      }
    });

    return { result: 'ACCEPTED', event };

  } catch (err: any) {
    logger.error('Error processing webhook event in service', {
      error: err.message,
      provider
    });
    return { result: 'REJECTED' };
  }
}
