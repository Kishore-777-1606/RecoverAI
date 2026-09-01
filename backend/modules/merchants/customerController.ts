import { Request, Response } from 'express';
import * as customerService from './customerService';
import { logger } from '../../shared/logging/logger';

/**
 * Controller endpoint to retrieve paginated customer lists.
 */
export async function getCustomers(req: Request, res: Response): Promise<void> {
  try {
    const merchantId = (req as any).merchantId;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;

    const paginated = await customerService.listCustomers(merchantId, { page, limit });

    res.status(200).json({
      success: true,
      data: paginated.data,
      pagination: {
        page,
        pageSize: limit,
        total: paginated.total,
        hasNext: page * limit < paginated.total
      }
    });
  } catch (err: any) {
    logger.error('Error fetching merchant customers', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve customers.' }
    });
  }
}
export { getCustomers as getCustomersController };
