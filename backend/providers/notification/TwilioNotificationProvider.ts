import { NotificationProvider, NotificationRequest, NotificationResponse } from './NotificationProvider';
import { ProviderAuthenticationError, ProviderUnavailableError, ProviderRejectedError } from '../../shared/errors/ProviderError';
import { providerConfig } from '../../config/providerConfig';
import { logger } from '../../shared/logging/logger';
import https from 'https';

/**
 * Real production Twilio Notification Provider.
 * Integrates directly with Twilio API to deliver SMS and WhatsApp alerts.
 */
export class TwilioNotificationProvider implements NotificationProvider {
  private accountSid: string;
  private authToken: string;
  private apiKeySid: string;
  private apiKeySecret: string;
  private fromSms: string;
  private fromWhatsapp: string;
  private isConfigured: boolean;

  constructor() {
    const config = providerConfig.notification.twilio;
    this.accountSid = config.accountSid;
    this.authToken = config.authToken;
    this.apiKeySid = (config as any).apiKeySid || '';
    this.apiKeySecret = (config as any).apiKeySecret || '';
    this.fromSms = config.fromSms;
    this.fromWhatsapp = config.fromWhatsapp;

    const hasAuthToken = !!this.authToken;
    const hasApiKey = !!(this.apiKeySid && this.apiKeySecret);

    this.isConfigured = !!(this.accountSid && (hasAuthToken || hasApiKey) && this.fromSms && this.fromWhatsapp);
  }

  public async sendNotification(request: NotificationRequest): Promise<NotificationResponse> {
    if (request.channel !== 'SMS' && request.channel !== 'WHATSAPP') {
      throw new Error(`TwilioNotificationProvider does not support channel ${request.channel}`);
    }

    if (!this.isConfigured) {
      logger.warn('Twilio credentials are not fully configured. Outbound alerts are BLOCKED.');
      throw new ProviderAuthenticationError(
        'Twilio SMTP/API integration keys are not configured. Live delivery is blocked.',
        'TwilioNotificationProvider'
      );
    }

    const isWhatsApp = request.channel === 'WHATSAPP';
    const formatWhatsApp = (num: string) => num.startsWith('whatsapp:') ? num : `whatsapp:${num}`;
    
    const from = isWhatsApp ? formatWhatsApp(this.fromWhatsapp) : this.fromSms;
    const to = isWhatsApp ? formatWhatsApp(request.recipient) : request.recipient;
    
    // Compile template body
    const bodyText = this.compileTemplate(request.templateRef, request.variables);

    logger.info('Twilio notification dispatch initiated', {
      channel: request.channel,
      recipient: request.recipient,
      from
    });

    const statusCallback = `${process.env.CUSTOMER_PORTAL_BASE_URL || 'http://localhost:3000'}/webhooks/twilio/status`;
    const postData = new URLSearchParams({
      From: from,
      To: to,
      Body: bodyText,
      StatusCallback: statusCallback
    }).toString();

    // Use API Key basic auth if SID/Secret are configured, otherwise fall back to Account SID + Auth Token
    const authUsername = this.apiKeySid || this.accountSid;
    const authPassword = this.apiKeySecret || this.authToken;
    const authHeader = 'Basic ' + Buffer.from(`${authUsername}:${authPassword}`).toString('base64');
    
    const options = {
      hostname: 'api.twilio.com',
      port: 443,
      path: `/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    return new Promise<NotificationResponse>((resolve, reject) => {
      const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          let parsedResponse: any;
          try {
            parsedResponse = JSON.parse(responseBody);
          } catch (e) {
            parsedResponse = { message: responseBody };
          }

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            const sid = parsedResponse.sid || '';
            const statusMap: Record<string, 'SENT' | 'DELIVERED' | 'FAILED'> = {
              'queued': 'SENT',
              'sending': 'SENT',
              'sent': 'SENT',
              'delivered': 'DELIVERED',
              'undelivered': 'FAILED',
              'failed': 'FAILED'
            };
            const mappedStatus = statusMap[parsedResponse.status] || 'SENT';

            resolve({
              providerMessageId: sid,
              status: mappedStatus,
              channel: request.channel,
              recipient: request.recipient,
              rawResponse: parsedResponse
            });
          } else {
            const twilioErrorMsg = parsedResponse.message || 'Unknown Twilio error';
            const twilioErrorCode = parsedResponse.code || 'TWILIO_ERROR';

            logger.error('Twilio request failed', { statusCode: res.statusCode, error: parsedResponse });
            
            // Rejections (e.g. invalid numbers, blacklists) vs general network/gateway unavailability
            if (res.statusCode === 400 || res.statusCode === 404) {
              reject(new ProviderRejectedError(
                `Recipient number rejected by Twilio: ${twilioErrorMsg}`,
                'TwilioNotificationProvider',
                twilioErrorCode
              ));
            } else {
              reject(new ProviderUnavailableError(
                `Twilio gateway failed with status ${res.statusCode}: ${twilioErrorMsg}`,
                'TwilioNotificationProvider',
                parsedResponse
              ));
            }
          }
        });
      });

      req.on('error', (err) => {
        logger.error('Connection error with Twilio gateway', { error: err.message });
        reject(new ProviderUnavailableError(
          `Twilio gateway is unreachable: ${err.message}`,
          'TwilioNotificationProvider',
          err
        ));
      });

      req.write(postData);
      req.end();
    });
  }

  private compileTemplate(templateRef: string, variables: Record<string, string>): string {
    const customerName = variables.customerName || 'Customer';
    const amount = variables.amount || '0.00';
    const merchantName = variables.merchantName || 'Merchant';
    const recoveryUrl = variables.recoveryUrl || '';

    if (templateRef === 'RECOVERY_LINK') {
      return `Hi ${customerName}, your payment of INR ${amount} to ${merchantName} failed. Complete your payment safely here: ${recoveryUrl}`;
    } else if (templateRef === 'CUSTOMER_REMINDER') {
      return `Reminder: Complete your pending payment of INR ${amount} to ${merchantName} here: ${recoveryUrl}`;
    }
    return `Payment of INR ${amount} to ${merchantName} failed. Complete it here: ${recoveryUrl}`;
  }
}
