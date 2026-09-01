import { Request, Response } from 'express';
import * as policyService from './policyService';
import { logger } from '../../shared/logging/logger';

/**
 * Retrieves the currently active policy configuration for a merchant.
 */
export async function getPolicy(req: Request, res: Response): Promise<void> {
  try {
    const merchantId = (req as any).merchantId;
    const policy = await policyService.getActivePolicy(merchantId);
    res.status(200).json({ success: true, data: policy });
  } catch (err: any) {
    logger.error('Error retrieving active policy', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve recovery policy.' }
    });
  }
}

/**
 * Creates a new policy version with associated rules, strategies, and notification channels.
 */
export async function createPolicy(req: Request, res: Response): Promise<void> {
  try {
    const merchantId = (req as any).merchantId;
    const { name, is_active, auto_recovery_enabled, max_amount_limit, approval_threshold, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, failureRules, strategies, channels } = req.body;

    if (!name || is_active === undefined || auto_recovery_enabled === undefined || quiet_hours_enabled === undefined) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PARAMETER', message: 'name, is_active, auto_recovery_enabled, and quiet_hours_enabled are required fields.' }
      });
      return;
    }

    const created = await policyService.createPolicy(
      merchantId,
      {
        name,
        is_active: !!is_active,
        auto_recovery_enabled: !!auto_recovery_enabled,
        max_amount_limit: max_amount_limit || undefined,
        approval_threshold: approval_threshold || undefined,
        quiet_hours_enabled: !!quiet_hours_enabled,
        quiet_hours_start: quiet_hours_start || undefined,
        quiet_hours_end: quiet_hours_end || undefined
      },
      failureRules || [],
      strategies || [],
      channels || []
    );

    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    logger.error('Error creating policy version', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create recovery policy version.' }
    });
  }
}

/**
 * Activates a specific policy version.
 */
export async function activatePolicy(req: Request, res: Response): Promise<void> {
  try {
    const merchantId = (req as any).merchantId;
    const policyId = req.params.policyId;

    await policyService.activatePolicy(merchantId, policyId);
    res.status(200).json({ success: true, message: 'Policy activated successfully.' });
  } catch (err: any) {
    logger.error('Error activating policy version', { error: err.message, policyId: req.params.policyId });
    if (err.name === 'NotFoundError' || err.statusCode === 404) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: err.message || 'Policy not found.' }
      });
    } else {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to activate policy version.' }
      });
    }
  }
}

/**
 * Deactivates a specific policy version.
 */
export async function deactivatePolicy(req: Request, res: Response): Promise<void> {
  try {
    const merchantId = (req as any).merchantId;
    const policyId = req.params.policyId;

    await policyService.deactivatePolicy(merchantId, policyId);
    res.status(200).json({ success: true, message: 'Policy deactivated successfully.' });
  } catch (err: any) {
    logger.error('Error deactivating policy version', { error: err.message, policyId: req.params.policyId });
    if (err.name === 'NotFoundError' || err.statusCode === 404) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: err.message || 'Policy not found.' }
      });
    } else {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to deactivate policy version.' }
      });
    }
  }
}
export { getPolicy as getPolicyController, createPolicy as createPolicyController, activatePolicy as activatePolicyController, deactivatePolicy as deactivatePolicyController };
