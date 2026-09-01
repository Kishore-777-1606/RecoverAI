import { PaymentProvider } from './PaymentProvider';
import { MockPaymentProvider } from './MockPaymentProvider';
import { RazorpayAdapter } from './RazorpayAdapter';
import { providerConfig } from '../../config/providerConfig';
import { logger } from '../../shared/logging/logger';

/**
 * Factory class to resolve active Payment Provider instances.
 */
export function getPaymentProvider(environment: string = 'LIVE'): PaymentProvider {
  const envUpper = environment.toUpperCase();

  // Test and Simulation environments always use the Mock provider
  if (envUpper === 'SIMULATION' || envUpper === 'TEST') {
    logger.debug('Resolving MockPaymentProvider for sandbox environment', { environment });
    return new MockPaymentProvider();
  }

  const activeProvider = providerConfig.payment.activeProvider.toLowerCase();
  
  if (activeProvider === 'razorpay') {
    logger.debug('Resolving RazorpayAdapter for LIVE environment');
    return new RazorpayAdapter();
  }

  // Fallback to MockPaymentProvider if configured as mock or unrecognized
  logger.debug('Resolving MockPaymentProvider for LIVE environment (mock configuration)');
  return new MockPaymentProvider();
}
