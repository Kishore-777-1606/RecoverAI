import { env } from './env';

export const merchantPolicyDefaults = {
  autoRecoveryEnabled: env.DEFAULT_AUTO_RECOVERY_ENABLED,
  maxAutoRecoveryAmount: env.DEFAULT_MAX_AUTO_RECOVERY_AMOUNT,
  maxRetryAttempts: env.DEFAULT_MAX_RETRY_ATTEMPTS,
  retryDelayMinutes: env.DEFAULT_RETRY_DELAY_MINUTES,
};
