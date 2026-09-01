import app from './app';
import { env } from '../config/env';
import { closeDatabaseConnection } from '../database/connection';
import { logger } from '../shared/logging/logger';

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info('RecoverAI Backend successfully initialized', {
    port: PORT,
    mode: env.APP_MODE,
    paymentProvider: env.PAYMENT_PROVIDER,
    notificationProvider: env.NOTIFICATION_PROVIDER
  });
});

/**
 * Handles graceful application termination sequences.
 */
async function handleGracefulShutdown(signal: string) {
  logger.warn(`Termination signal ${signal} received. Initiating graceful shutdown...`);

  // Stop accepting new network requests
  server.close(async () => {
    logger.info('HTTP server has stopped accepting connections.');
    
    // Close PostgreSQL connections pool
    await closeDatabaseConnection();
    
    logger.warn('Graceful shutdown completed. Exiting process.');
    process.exit(0);
  });

  // Force close after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Shutdown forced after grace timeout expired. Exiting forcefully.');
    process.exit(1);
  }, 10000);
}

// Bind process event hooks for standard Docker / Kubernetes termination signals
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
