import { Router, Request, Response } from 'express';
import { pool } from '../database/connection';
import { logger } from '../shared/logging/logger';

const router = Router();

/**
 * Root service status check.
 * Verifies application life and optionally tests database connection pool status.
 */
router.get('/health', async (_req: Request, res: Response) => {
  let databaseStatus = 'healthy';
  
  try {
    // harmlsess query connectivity check
    await pool.query('SELECT 1');
  } catch (err: any) {
    databaseStatus = 'unhealthy';
    logger.warn('Health check database query execution failed', { error: err.message });
  }

  res.status(200).json({
    status: 'ok',
    service: 'recoverai-api',
    dependencies: {
      database: databaseStatus
    }
  });
});

import merchantRoutes from '../api/merchantRoutes';
import customerRoutes from '../api/customerRoutes';
import webhookRoutes from '../api/webhookRoutes';
import demoRoutes from '../api/demoRoutes';

router.use('/merchant', merchantRoutes);
router.use('/api/merchant', merchantRoutes);
router.use('/customer', customerRoutes);
router.use('/api/customer', customerRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/api/webhooks', webhookRoutes);
router.use('/demo', demoRoutes);
router.use('/api/demo', demoRoutes);

export default router;
