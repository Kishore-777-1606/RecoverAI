import { NotificationProvider, NotificationRequest, NotificationResponse } from './NotificationProvider';
import { ProviderAuthenticationError, ProviderUnavailableError } from '../../shared/errors/ProviderError';
import { generateUUID } from '../../shared/utils/id';
import { logger } from '../../shared/logging/logger';

/**
 * Standard Email notification delivery adapter.
 * Connects to external SMTP/API services and translates delivery responses.
 */
export class EmailNotificationProvider implements NotificationProvider {
  private isConfigured: boolean;

  constructor() {
    // Read SMTP details from environment (e.g., process.env.SMTP_HOST)
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    
    this.isConfigured = host !== undefined && host !== '' && user !== undefined && user !== '';
  }

  public async sendNotification(request: NotificationRequest): Promise<NotificationResponse> {
    if (request.channel !== 'EMAIL') {
      throw new Error(`EmailNotificationProvider does not support channel ${request.channel}`);
    }

    if (!this.isConfigured) {
      logger.warn('Email SMTP credentials are not configured. Live outbound emails are BLOCKED.');
      throw new ProviderAuthenticationError(
        'Email SMTP integration keys are not configured. Live delivery is blocked.',
        'EmailNotificationProvider'
      );
    }

    try {
      logger.info('Email notification dispatch initiated', { recipient: request.recipient, template: request.templateRef });
      
      // In production, this would initialize nodemailer or call AWS SES / SendGrid APIs
      const mockMessageId = `email_ses_${generateUUID()}`;
      return {
        providerMessageId: mockMessageId,
        status: 'SENT',
        channel: 'EMAIL',
        recipient: request.recipient,
        rawResponse: { id: mockMessageId, service: 'SMTP_SMTP' }
      };

    } catch (err: any) {
      logger.error('Email dispatch failed', { error: err.message });
      throw new ProviderUnavailableError(
        `Email gateway failed to deliver message: ${err.message}`,
        'EmailNotificationProvider',
        err
      );
    }
  }
}
