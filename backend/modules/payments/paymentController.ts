import { Request, Response } from 'express';
import * as paymentService from './paymentService';
import * as recoveryRepo from '../../database/repositories/recoveryRepository';
import { logger } from '../../shared/logging/logger';

/**
 * Lists and filters base payments.
 */
export async function getPayments(req: Request, res: Response): Promise<void> {
  try {
    const merchantId = (req as any).merchantId;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;

    const filters = {
      customerId: req.query.customerId as string || undefined,
      status: req.query.status as string || undefined,
      environment: req.query.environment as 'LIVE' | 'TEST' | 'SIMULATION' || undefined,
      page,
      limit
    };

    const paginated = await paymentService.listPayments(merchantId, filters);

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
    logger.error('Error fetching payments list', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve payments.' }
    });
  }
}

/**
 * Fetches a single payment by ID and attaches related recovery campaign reference if exists.
 */
export async function getPaymentDetail(req: Request, res: Response): Promise<void> {
  try {
    const merchantId = (req as any).merchantId;
    const paymentId = req.params.paymentId;

    if (!paymentId) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PARAMETER', message: 'paymentId is required.' }
      });
      return;
    }

    const payment = await paymentService.getPayment(merchantId, paymentId);
    const recovery = await recoveryRepo.findRecoveryByPaymentId(merchantId, paymentId);

    res.status(200).json({
      success: true,
      data: {
        ...payment,
        recovery: recovery ? {
          recovery_id: recovery.recovery_id,
          status: recovery.status,
          current_stage: recovery.current_stage
        } : null
      }
    });
  } catch (err: any) {
    logger.error('Error fetching payment detail', { error: err.message, paymentId: req.params.paymentId });
    if (err.name === 'NotFoundError' || err.statusCode === 404) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: err.message || 'Payment not found.' }
      });
    } else {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve payment details.' }
      });
    }
  }
}
export { getPayments as getPaymentsController, getPaymentDetail as getPaymentDetailController };
