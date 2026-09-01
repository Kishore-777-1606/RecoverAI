import { Request, Response } from 'express';
import * as recoveryService from './recoveryService';
import { logger } from '../../shared/logging/logger';

/**
 * Lists and filters recovery campaigns.
 */
export async function getRecoveries(req: Request, res: Response): Promise<void> {
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

    const paginated = await recoveryService.listRecoveries(merchantId, filters);

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
    logger.error('Error fetching recoveries list', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve recovery campaigns.' }
    });
  }
}

/**
 * Fetches campaign timeline details, actions, notification dispatch counts, and payment retry attempts.
 */
export async function getRecoveryDetail(req: Request, res: Response): Promise<void> {
  try {
    const merchantId = (req as any).merchantId;
    const recoveryId = req.params.recoveryId;

    if (!recoveryId) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PARAMETER', message: 'recoveryId is required.' }
      });
      return;
    }

    const details = await recoveryService.getRecoveryDetails(merchantId, recoveryId);
    res.status(200).json({ success: true, data: details });
  } catch (err: any) {
    logger.error('Error fetching campaign details', { error: err.message, recoveryId: req.params.recoveryId });
    if (err.name === 'NotFoundError' || err.statusCode === 404) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: err.message || 'Recovery campaign not found.' }
      });
    } else {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve recovery details.' }
      });
    }
  }
}

/**
 * Approves a pending recovery campaign.
 */
export async function approveRecovery(req: Request, res: Response): Promise<void> {
  try {
    const merchantId = (req as any).merchantId;
    const recoveryId = req.params.recoveryId;

    if (!recoveryId) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PARAMETER', message: 'recoveryId is required.' }
      });
      return;
    }

    const updated = await recoveryService.approveRecovery(merchantId, recoveryId);
    res.status(200).json({ success: true, data: updated });
  } catch (err: any) {
    logger.error('Error approving recovery campaign', { error: err.message, recoveryId: req.params.recoveryId });
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: err.message }
      });
    } else if (err.name === 'NotFoundError' || err.statusCode === 404) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: err.message || 'Recovery campaign not found.' }
      });
    } else {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to approve recovery campaign.' }
      });
    }
  }
}

/**
 * Manually resolves/overrides an active recovery campaign.
 */
export async function resolveRecovery(req: Request, res: Response): Promise<void> {
  try {
    const merchantId = (req as any).merchantId;
    const recoveryId = req.params.recoveryId;
    const { resolution, cancellationReason } = req.body;

    if (!recoveryId || !resolution) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PARAMETER', message: 'recoveryId and resolution are required.' }
      });
      return;
    }

    if (!['RETRY', 'CLOSE_SUCCESS', 'CLOSE_FAILED'].includes(resolution)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PARAMETER', message: 'resolution must be RETRY, CLOSE_SUCCESS, or CLOSE_FAILED.' }
      });
      return;
    }

    const updated = await recoveryService.resolveRecovery(merchantId, recoveryId, resolution, cancellationReason);
    res.status(200).json({ success: true, data: updated });
  } catch (err: any) {
    logger.error('Error resolving recovery campaign', { error: err.message, recoveryId: req.params.recoveryId });
    if (err.name === 'ValidationError' || err.statusCode === 400) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: err.message }
      });
    } else if (err.name === 'NotFoundError' || err.statusCode === 404) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: err.message || 'Recovery campaign not found.' }
      });
    } else {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve recovery campaign.' }
      });
    }
  }
}

export {
  getRecoveries as getRecoveriesController,
  getRecoveryDetail as getRecoveryDetailController,
  approveRecovery as approveRecoveryController,
  resolveRecovery as resolveRecoveryController
};
