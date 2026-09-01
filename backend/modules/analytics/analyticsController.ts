import { Request, Response } from 'express';
import { getDashboardMetrics } from './analyticsService';
import { logger } from '../../shared/logging/logger';

/**
 * Controller to serve merchant dashboard aggregates.
 */
export async function getDashboard(req: Request, res: Response): Promise<void> {
  try {
    const merchantId = (req as any).merchantId;
    const env = req.query.environment as 'LIVE' | 'TEST' | 'SIMULATION' | undefined;

    if (env && !['LIVE', 'TEST', 'SIMULATION'].includes(env)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PARAMETER', message: 'Environment parameter must be LIVE, TEST, or SIMULATION.' }
      });
      return;
    }

    const metrics = await getDashboardMetrics(merchantId, env);
    res.status(200).json({ success: true, data: metrics });
  } catch (err: any) {
    logger.error('Error fetching dashboard aggregates', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Could not calculate dashboard metrics.' }
    });
  }
}
export { getDashboard as getDashboardController };
