import { NotificationProvider } from './NotificationProvider';
import { MockNotificationProvider } from './MockNotificationProvider';
import { SimulationNotificationProvider } from './SimulationNotificationProvider';
import { EmailNotificationProvider } from './EmailNotificationProvider';
import { TwilioNotificationProvider } from './TwilioNotificationProvider';
import { providerConfig } from '../../config/providerConfig';
import { logger } from '../../shared/logging/logger';

/**
 * Factory class to resolve active Notification Provider instances.
 */
export function getNotificationProvider(
  channel: 'SMS' | 'EMAIL' | 'WHATSAPP',
  environment: string = 'LIVE'
): NotificationProvider {
  const envUpper = environment.toUpperCase();
  const notifMode = providerConfig.notification.mode;
  const activeProvider = providerConfig.notification.activeProvider.toLowerCase();

  // In SIMULATION mode (default for demo/hackathon), resolve SimulationNotificationProvider
  if (notifMode === 'simulation' || activeProvider === 'simulation' || envUpper === 'SIMULATION') {
    logger.debug('Resolving SimulationNotificationProvider for simulation mode', { channel, mode: notifMode });
    return new SimulationNotificationProvider();
  }

  // Test environment uses Mock provider
  if (envUpper === 'TEST' || activeProvider === 'mock') {
    logger.debug('Resolving MockNotificationProvider for sandbox/mock environment', { environment, channel });
    return new MockNotificationProvider();
  }

  if (channel === 'EMAIL' && activeProvider === 'email') {
    logger.debug('Resolving EmailNotificationProvider for LIVE email delivery');
    return new EmailNotificationProvider();
  }

  if ((channel === 'SMS' || channel === 'WHATSAPP') && activeProvider === 'twilio') {
    logger.debug('Resolving TwilioNotificationProvider for LIVE SMS/WhatsApp delivery', { channel });
    return new TwilioNotificationProvider();
  }

  // Default fallback to SimulationNotificationProvider
  logger.debug('Resolving SimulationNotificationProvider as safe fallback', { channel });
  return new SimulationNotificationProvider();
}
