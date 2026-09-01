import { Router, Request, Response } from 'express';
import * as recoveryLinkRepo from '../database/repositories/recoveryLinkRepository';
import * as recoveryRepo from '../database/repositories/recoveryRepository';
import * as merchantRepo from '../database/repositories/merchantRepository';
import * as policyRepo from '../database/repositories/policyRepository';
import * as attemptRepo from '../database/repositories/recoveryAttemptRepository';
import * as verificationRepo from '../database/repositories/verificationRepository';
import { getPaymentProvider } from '../providers/payment/ProviderFactory';
import * as recoveryService from '../modules/recovery/recoveryService';
import { eventBus } from '../ingestion/eventBus';
import { pool } from '../database/connection';
import { logger } from '../shared/logging/logger';

const router = Router();

/**
 * GET /api/customer/recovery/:token
 * Serves secure customer recovery landing details.
 */
router.get('/recovery/:token', async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    const link = await recoveryLinkRepo.findRecoveryLinkByToken(token);
    
    if (!link) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Invalid or missing secure recovery token.' }
      });
      return;
    }

    const isExpired = link.status !== 'ACTIVE' || new Date() > new Date(link.expires_at);

    if (isExpired) {
      res.status(200).json({
        success: true,
        data: {
          status: 'EXPIRED',
          expiresAt: link.expires_at
        }
      });
      return;
    }

    const recovery = await recoveryRepo.findRecoveryByIdGlobal(link.recovery_id);
    if (!recovery) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Recovery campaign not found.' }
      });
      return;
    }

    const merchant = await merchantRepo.findMerchantById(recovery.merchant_id);
    let customerName = 'Valued Customer';
    try {
      const custRes = await pool.query('SELECT name FROM customers WHERE customer_id = $1', [recovery.customer_id]);
      if (custRes.rows[0]?.name) customerName = custRes.rows[0].name;
    } catch {}

    res.status(200).json({
      success: true,
      data: {
        status: link.status,
        merchantName: merchant.name,
        customerName,
        amount: recovery.amount,
        expiresAt: link.expires_at,
        recoveryId: recovery.recovery_id,
        supportedPaymentMethods: ['CARD', 'UPI', 'NET_BANKING', 'WALLET']
      }
    });
  } catch (err: any) {
    logger.error('Error serving customer landing details', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to load recovery information.' }
    });
  }
});

/**
 * POST /api/customer/recovery/:token/payment
 * POST /api/customer/recovery/:token/pay
 * Processes recovery pay attempt dispatches.
 */
const handleCustomerPayment = async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    const { paymentMethod, paymentMethodId, idempotencyKey } = req.body;
    const resolvedMethod = paymentMethod || paymentMethodId;

    if (!resolvedMethod || !idempotencyKey) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PARAMETER', message: 'paymentMethod (or paymentMethodId) and idempotencyKey are required.' }
      });
      return;
    }

    const link = await recoveryLinkRepo.findRecoveryLinkByToken(token);
    if (!link) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Invalid secure token.' }
      });
      return;
    }

    const isExpired = link.status !== 'ACTIVE' || new Date() > new Date(link.expires_at);
    if (isExpired) {
      res.status(400).json({
        success: false,
        error: { code: 'LINK_EXPIRED', message: 'This recovery link has expired.' }
      });
      return;
    }

    const recovery = await recoveryRepo.findRecoveryByIdGlobal(link.recovery_id);
    if (!recovery) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Recovery campaign not found.' }
      });
      return;
    }

    // Verify limit counts from policy rules
    const policy = await policyRepo.findActivePolicyByMerchant(recovery.merchant_id);
    if (policy) {
      const attempts = await attemptRepo.listAttemptsByRecovery(recovery.recovery_id);
      const policyStrat = policy.strategies?.find(s => s.strategy_id === 'RECOVERY_LINK');
      const maxAttempts = policyStrat?.max_outreach_attempts || 3;
      
      if (attempts.length >= maxAttempts) {
        res.status(400).json({
          success: false,
          error: { code: 'RETRY_LIMIT_EXCEEDED', message: 'Maximum recovery attempts limit exceeded.' }
        });
        return;
      }
    }

    // Process payment retry attempt in repositories
    const attempt = await attemptRepo.createRecoveryAttempt({
      recoveryId: recovery.recovery_id,
      customerId: recovery.customer_id,
      paymentMethodId: resolvedMethod,
      amount: recovery.amount,
      idempotencyKey
    });

    const provider = getPaymentProvider(recovery.environment);
    const payResponse = await provider.createPaymentAttempt({
      amount: recovery.amount,
      currency: 'INR',
      externalReference: attempt.attempt_id,
      customerId: recovery.customer_id,
      paymentMethodId: resolvedMethod,
      idempotencyKey
    });

    // Save attempt transaction updates
    await attemptRepo.updateAttemptStatus(attempt.attempt_id, payResponse.normalizedStatus as any, {
      providerTransactionId: payResponse.providerTransactionId,
      providerStatus: payResponse.providerStatus,
      errorCode: payResponse.errorCode,
      errorMessage: payResponse.errorMessage
    });

    // Create verification logs
    await verificationRepo.createVerification({
      paymentAttemptId: attempt.attempt_id,
      status: payResponse.normalizedStatus === 'SUCCESSFUL' ? 'VERIFIED' : (payResponse.normalizedStatus === 'FAILED' ? 'FAILED' : 'PENDING'),
      providerReference: payResponse.providerTransactionId,
      verifiedAt: payResponse.normalizedStatus === 'SUCCESSFUL' ? new Date() : undefined
    });

    // Coordinate campaign transitions (Safety rules)
    if (payResponse.normalizedStatus === 'SUCCESSFUL') {
      await recoveryService.transitionRecovery(recovery.merchant_id, recovery.recovery_id, {
        status: 'RECOVERED',
        current_stage: 'COMPLETED'
      }, 'CUSTOMER');
      
      // Consume link token
      const updateLinkSql = `UPDATE recovery_links SET status = 'USED', used_at = CURRENT_TIMESTAMP WHERE recovery_link_id = $1`;
      await pool.query(updateLinkSql, [link.recovery_link_id]);

      await eventBus.publish('recovery.attempt.successful', {
        merchantId: recovery.merchant_id,
        recoveryId: recovery.recovery_id,
        attemptId: attempt.attempt_id
      });
    } else if (payResponse.normalizedStatus === 'FAILED') {
      const allAttempts = await attemptRepo.listAttemptsByRecovery(recovery.recovery_id);
      const policyStrat = policy?.strategies?.find(s => s.strategy_id === 'RECOVERY_LINK');
      const maxAttempts = policyStrat?.max_outreach_attempts || 3;

      await eventBus.publish('recovery.attempt.failed', {
        merchantId: recovery.merchant_id,
        recoveryId: recovery.recovery_id,
        attemptId: attempt.attempt_id,
        previousAttemptsCount: allAttempts.length,
        maxAttemptsLimit: maxAttempts
      });
    }

    res.status(200).json({
      success: true,
      data: {
        status: payResponse.normalizedStatus,
        transactionId: payResponse.providerTransactionId,
        errorMessage: payResponse.errorMessage
      }
    });

  } catch (err: any) {
    logger.error('Error processing customer payment execution', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to complete payment checkout.' }
    });
  }
};

router.post('/recovery/:token/payment', handleCustomerPayment);
router.post('/recovery/:token/pay', handleCustomerPayment);

/**
 * GET /api/customer/recovery/:token/status
 * Exposes checkout results status checks.
 */
router.get('/recovery/:token/status', async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    const link = await recoveryLinkRepo.findRecoveryLinkByToken(token);
    if (!link) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Token not found.' } });
      return;
    }

    const recovery = await recoveryRepo.findRecoveryByIdGlobal(link.recovery_id);
    if (!recovery) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Recovery campaign not found.' } });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        linkStatus: link.status,
        recoveryStatus: recovery.status,
        amount: recovery.amount,
        completedAt: recovery.completed_at
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve check status.' } });
  }
});

export default router;
