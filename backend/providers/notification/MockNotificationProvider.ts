import { NotificationProvider, NotificationRequest, NotificationResponse } from './NotificationProvider';
import { ProviderRejectedError } from '../../shared/errors/ProviderError';
import { generateUUID } from '../../shared/utils/id';
import { logger } from '../../shared/logging/logger';

/**
 * Sandbox Mock Notification Provider.
 * Simulates outbound dispatches deterministically.
 */
export class MockNotificationProvider implements NotificationProvider {
  public async sendNotification(request: NotificationRequest): Promise<NotificationResponse> {
    const outcome = request.variables?.simulateOutcome || 'DELIVERED';
    const messageId = `mock_msg_${generateUUID()}`;

    logger.debug('Mock notification provider dispatching outreach', { channel: request.channel, outcome });

    switch (outcome) {
      case 'FAILED':
        return {
          providerMessageId: messageId,
          status: 'FAILED',
          channel: request.channel,
          recipient: request.recipient,
          rawResponse: { outcome },
          errorMessage: 'Outbound dispatch failed due to mock network drop.'
        };

      case 'REJECTED':
        throw new ProviderRejectedError(
          'Target recipient number/email was rejected by mock vendor blacklist.',
          'MockNotificationProvider',
          'RECIPIENT_BLACKLISTED'
        );

      case 'DELIVERED':
      default:
        return {
          providerMessageId: messageId,
          status: 'DELIVERED',
          channel: request.channel,
          recipient: request.recipient,
          rawResponse: { outcome }
        };
    }
  }
}
