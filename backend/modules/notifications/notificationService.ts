import * as notificationRepo from '../../database/repositories/notificationRepository';
import * as customerRepo from '../../database/repositories/customerRepository';
import * as recoveryRepo from '../../database/repositories/recoveryRepository';
import { createAuditLog } from '../../database/repositories/auditRepository';
import { getNotificationProvider } from '../../providers/notification/NotificationProviderFactory';
import { logger } from '../../shared/logging/logger';
import { ValidationError } from '../../shared/errors/ValidationError';
import { PoolClient } from 'pg';

/**
 * Orchestrates customer notifications dispatching and logs them to the database ledger.
 */
export async function sendNotification(
  merchantId: string,
  recoveryId: string,
  customerId: string,
  channel: 'SMS' | 'EMAIL' | 'WHATSAPP',
  templateRef: string,
  variables: Record<string, string>,
  client?: PoolClient
): Promise<any> {
  const db = client;

  // 1. Fetch recovery campaign context
  const recovery = await recoveryRepo.findRecoveryById(merchantId, recoveryId, db);
  if (['RECOVERED', 'CANCELLED', 'FAILED'].includes(recovery.status)) {
    logger.warn('Skipping notification dispatch: recovery campaign is in terminal status', { recoveryId, status: recovery.status });
    return;
  }

  // 2. Fetch customer recipient details
  const customer = await customerRepo.findCustomerById(merchantId, customerId, db);
  let recipient = '';
  if (channel === 'EMAIL') {
    recipient = customer.email;
  } else {
    if (!customer.phone) {
      throw new ValidationError(`Customer profile is missing phone number for channel ${channel}`);
    }
    recipient = customer.phone;
  }

  // 3. Resolve attempt number based on existing notifications
  const existing = await notificationRepo.listNotificationsByRecovery(recoveryId, db);
  const channelTemplateExist = existing.filter(n => n.channel === channel && n.message_template_ref === templateRef);
  const nextAttemptNumber = channelTemplateExist.length + 1;

  // 4. Enforce idempotency protection to prevent duplicate sends
  const isDuplicate = channelTemplateExist.some(
    n => n.attempt_number === nextAttemptNumber && ['PENDING', 'SENT', 'DELIVERED'].includes(n.status)
  );
  if (isDuplicate) {
    logger.info('Duplicate notification dispatch prevented', { recoveryId, channel, templateRef, attemptNumber: nextAttemptNumber });
    return;
  }

  // 5. Log initial pending notification record
  const notificationRecord = await notificationRepo.createNotification({
    recoveryId,
    customerId,
    channel,
    messageTemplateRef: templateRef,
    status: 'PENDING',
    attemptNumber: nextAttemptNumber
  }, db);

  // 6. Get notification provider from factory
  const provider = getNotificationProvider(channel, recovery.environment);

  try {
    // 7. Dispatch the notification using the mapped variables
    const response = await provider.sendNotification({
      recipient,
      channel,
      templateRef,
      variables: {
        ...variables,
        amount: recovery.amount.toString(),
        customerName: customer.name,
      },
      recoveryId,
      customerId
    });

    // 8. Update status in database based on response
    await notificationRepo.updateNotificationStatus(notificationRecord.notification_id, response.status, {
      sentAt: response.status === 'SENT' || response.status === 'DELIVERED' ? new Date() : undefined,
      deliveredAt: response.status === 'DELIVERED' ? new Date() : undefined,
      failedAt: response.status === 'FAILED' ? new Date() : undefined,
      errorMessage: response.errorMessage
    }, db);

    // Save mapping to audit logs so delivery status callbacks can find this notification record
    await createAuditLog({
      actor: 'SYSTEM',
      action: 'NOTIFICATION_DISPATCHED',
      entityName: 'customer_notification',
      entityId: notificationRecord.notification_id,
      postValues: {
        providerMessageId: response.providerMessageId,
        channel,
        recipient
      }
    }, db);

    logger.info('Notification successfully sent and tracked', {
      notificationId: notificationRecord.notification_id,
      providerMessageId: response.providerMessageId,
      status: response.status
    });

    return response;
  } catch (err: any) {
    logger.error('Failed to send notification via provider', {
      notificationId: notificationRecord.notification_id,
      error: err.message
    });

    // 9. Update database status to FAILED
    await notificationRepo.updateNotificationStatus(notificationRecord.notification_id, 'FAILED', {
      failedAt: new Date(),
      errorMessage: err.message
    }, db);

    throw err;
  }
}
