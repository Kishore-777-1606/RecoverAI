import { Router, Request, Response } from 'express';
import { generateUUID } from '../shared/utils/id';
import * as paymentService from '../modules/payments/paymentService';
import * as recoveryService from '../modules/recovery/recoveryService';
import * as recoveryRepo from '../database/repositories/recoveryRepository';
import * as attemptRepo from '../database/repositories/recoveryAttemptRepository';
import * as linkRepo from '../database/repositories/recoveryLinkRepository';
import * as actionRepo from '../database/repositories/recoveryActionRepository';
import * as customerRepo from '../database/repositories/customerRepository';
import * as simRepo from '../database/repositories/simulationRepository';
import { processWebhook } from '../ingestion/webhookService';
import { getPaymentProvider } from '../providers/payment/ProviderFactory';
import { pool } from '../database/connection';
import { logger } from '../shared/logging/logger';

const router = Router();

/**
 * POST /api/demo/payment-simulator/run
 * Exercises the complete transaction flow (Simulated checkout -> webhook callback -> eligibility analysis -> recovery campaign).
 */
router.post('/payment-simulator/run', async (req: Request, res: Response) => {
  try {
    const { merchantId, customerId, paymentMethodId, amount, simulateOutcome } = req.body;

    if (!merchantId || !customerId || !paymentMethodId || !amount || !simulateOutcome) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PARAMETER', message: 'merchantId, customerId, paymentMethodId, amount, and simulateOutcome are required.' }
      });
      return;
    }

    // 1. Initialize a simulation session record
    const session = await simRepo.createSimulationSession({
      merchantId,
      name: `Simulator checkout run: ${simulateOutcome} - ${new Date().toISOString()}`
    });

    // 2. Insert payment record in SIMULATION state
    const externalReference = `ref_sim_${generateUUID()}`;
    const payment = await paymentService.createPayment({
      merchant_id: merchantId,
      customer_id: customerId,
      payment_method_id: paymentMethodId,
      amount,
      external_reference: externalReference,
      environment: 'SIMULATION',
      simulation_session_id: session.session_id,
      status: 'INITIATED'
    });

    // 3. Dispatch simulated gateway webhook callback
    const isSuccess = simulateOutcome === 'SUCCESS';
    const webhookPayload = {
      event: isSuccess ? 'payment.success' : 'payment.failed',
      eventId: `sim_evt_${generateUUID()}`,
      txnId: `sim_txn_${generateUUID()}`,
      externalReference,
      amount,
      currency: 'INR',
      failureCode: isSuccess ? undefined : simulateOutcome,
      failureMessage: isSuccess ? undefined : `Simulated decline: ${simulateOutcome}`
    };

    const webhookOutcome = await processWebhook('mock', webhookPayload);

    // 4. Load resulting recovery campaign context if created
    const recovery = await recoveryRepo.findRecoveryByPaymentId(merchantId, payment.payment_id);

    res.status(200).json({
      success: true,
      data: {
        sessionId: session.session_id,
        paymentId: payment.payment_id,
        status: isSuccess ? 'SUCCESSFUL' : 'FAILED',
        webhookResult: webhookOutcome.result,
        recoveryId: recovery ? recovery.recovery_id : null,
        recoveryStatus: recovery ? recovery.status : null
      }
    });

  } catch (err: any) {
    logger.error('Error running payment simulator', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Payment simulation run failed.' }
    });
  }
});

/**
 * POST /api/demo/recovery-simulator/run
 * Simulates retry attempts, checkout failures, or expiration sweeps for recovery campaigns.
 */
router.post('/recovery-simulator/run', async (req: Request, res: Response) => {
  try {
    const { recoveryId, simulateAction } = req.body;

    if (!recoveryId || !simulateAction) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PARAMETER', message: 'recoveryId and simulateAction are required.' }
      });
      return;
    }

    const recovery = await recoveryRepo.findRecoveryByIdGlobal(recoveryId);
    if (!recovery) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Recovery campaign not found.' }
      });
      return;
    }

    const merchantId = recovery.merchant_id;

    // Check if recovery is already terminal
    if (['RECOVERED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(recovery.status)) {
      res.status(400).json({
        success: false,
        error: { code: 'CAMPAIGN_TERMINAL', message: `Recovery campaign is already in terminal state: ${recovery.status}` }
      });
      return;
    }

    // Resolve or generate a secure recovery link
    let links = await linkRepo.listLinksByRecovery(recoveryId);
    let activeLink = links.find(l => l.status === 'ACTIVE');
    if (!activeLink) {
      activeLink = await linkRepo.createRecoveryLink({
        recoveryId,
        secureToken: `sim_token_${generateUUID()}`,
        expiresAt: new Date(Date.now() + 86400 * 1000)
      });
    }

    switch (simulateAction) {
      case 'CUSTOMER_PAY_SUCCESS':
        // Simulates the customer checking out successfully via recovery link
        const attempt = await attemptRepo.createRecoveryAttempt({
          recoveryId,
          customerId: recovery.customer_id,
          paymentMethodId: 'CARD',
          amount: recovery.amount,
          idempotencyKey: `sim_idem_${generateUUID()}`
        });

        // Resolve mock provider to complete successfully
        const provider = getPaymentProvider('SIMULATION');
        const payResponse = await provider.createPaymentAttempt({
          amount: recovery.amount,
          currency: 'INR',
          externalReference: attempt.attempt_id,
          customerId: recovery.customer_id,
          paymentMethodId: 'CARD',
          metadata: { simulateOutcome: 'SUCCESS' }
        });

        // Update attempt and campaign states
        await attemptRepo.updateAttemptStatus(attempt.attempt_id, 'SUCCESSFUL', {
          providerTransactionId: payResponse.providerTransactionId,
          providerStatus: 'CHARGED'
        });

        await recoveryService.transitionRecovery(merchantId, recoveryId, {
          status: 'RECOVERED',
          current_stage: 'COMPLETED'
        }, 'CUSTOMER');

        // Consume token link
        await pool.query("UPDATE recovery_links SET status = 'USED', used_at = CURRENT_TIMESTAMP WHERE recovery_link_id = $1", [activeLink.recovery_link_id]);

        res.status(200).json({
          success: true,
          message: 'Simulated customer recovery checkout successfully completed.',
          data: { recoveryStatus: 'RECOVERED', attemptId: attempt.attempt_id }
        });
        break;

      case 'CUSTOMER_PAY_FAILED':
        // Simulates the customer checkout failing
        const failAttempt = await attemptRepo.createRecoveryAttempt({
          recoveryId,
          customerId: recovery.customer_id,
          paymentMethodId: 'CARD',
          amount: recovery.amount,
          idempotencyKey: `sim_idem_fail_${generateUUID()}`
        });

        await attemptRepo.updateAttemptStatus(failAttempt.attempt_id, 'FAILED', {
          providerTransactionId: `mock_failed_${generateUUID()}`,
          providerStatus: 'DECLINED',
          errorCode: 'INSUFFICIENT_FUNDS',
          errorMessage: 'Account balance too low.'
        });

        // Increment attempts count checking limits
        const allAttempts = await attemptRepo.listAttemptsByRecovery(recoveryId);
        // Default max limit to 3
        if (allAttempts.length >= 3) {
          await recoveryService.transitionRecovery(merchantId, recoveryId, {
            status: 'FAILED',
            current_stage: 'COMPLETED'
          }, 'SYSTEM');
        }

        res.status(200).json({
          success: true,
          message: 'Simulated customer recovery payment failed.',
          data: { recoveryStatus: allAttempts.length >= 3 ? 'FAILED' : 'IN_PROGRESS', attemptId: failAttempt.attempt_id }
        });
        break;

      case 'EXPIRE_LINK':
        // Mark link as expired and transition recovery status
        await pool.query("UPDATE recovery_links SET status = 'EXPIRED' WHERE recovery_link_id = $1", [activeLink.recovery_link_id]);
        await recoveryService.transitionRecovery(merchantId, recoveryId, {
          status: 'EXPIRED',
          current_stage: 'COMPLETED'
        }, 'SYSTEM');

        res.status(200).json({
          success: true,
          message: 'Recovery campaign and outreach tokens expired.',
          data: { recoveryStatus: 'EXPIRED' }
        });
        break;

      default:
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_ACTION', message: 'simulateAction must be CUSTOMER_PAY_SUCCESS, CUSTOMER_PAY_FAILED, or EXPIRE_LINK.' }
        });
        break;
    }

  } catch (err: any) {
    logger.error('Error running recovery simulator', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Recovery simulation run failed.' }
    });
  }
});

/**
 * POST /api/demo/recovery-flow/run
 * Single comprehensive demo execution endpoint executing:
 * Failed Payment -> Ingestion -> State Machine -> AI Policy Decision -> Recovery Campaign -> Link & Notification Outreach.
 * Waits for customer retry action without automatically resolving payment.
 */
router.post('/recovery-flow/run', async (req: Request, res: Response) => {
  try {
    const {
      merchantId = 'd9b04245-c1e1-455f-bb54-df25c3453b3f', // Default Acme Tech Solutions
      customerId = 'a1c87a55-27a3-4889-8d7a-7db69b4e3112', // Default Kishore Kumar
      paymentMethodId = 'CARD',
      amount = '1499.00',
      simulateOutcome = 'INSUFFICIENT_FUNDS'
    } = req.body;

    const trace: Array<{ step: number; name: string; status: string; detail: any }> = [];

    // Step 1: Initialize session
    const session = await simRepo.createSimulationSession({
      merchantId,
      name: `Demo Recovery Flow: ${simulateOutcome} - ${new Date().toISOString()}`
    });

    // Step 2: Create payment in SIMULATION state
    const externalReference = `ref_demo_${generateUUID()}`;
    const payment = await paymentService.createPayment({
      merchant_id: merchantId,
      customer_id: customerId,
      payment_method_id: paymentMethodId,
      amount,
      external_reference: externalReference,
      environment: 'SIMULATION',
      simulation_session_id: session.session_id,
      status: 'INITIATED'
    });

    trace.push({
      step: 1,
      name: 'Payment Created',
      status: 'INITIATED',
      detail: { paymentId: payment.payment_id, amount, currency: 'INR', method: paymentMethodId }
    });

    // Step 3: Dispatch simulated gateway webhook (payment.failed)
    const isSuccess = simulateOutcome === 'SUCCESS';
    const webhookPayload = {
      event: isSuccess ? 'payment.success' : 'payment.failed',
      eventId: `sim_evt_${generateUUID()}`,
      txnId: `sim_txn_${generateUUID()}`,
      externalReference,
      amount,
      currency: 'INR',
      failureCode: isSuccess ? undefined : simulateOutcome,
      failureMessage: isSuccess ? undefined : `Simulated decline: ${simulateOutcome}`
    };

    trace.push({
      step: 2,
      name: 'Failure Ingested via Webhook',
      status: 'ACCEPTED',
      detail: { failureCode: simulateOutcome, externalReference }
    });

    await processWebhook('mock', webhookPayload);

    // Step 4: Verify payment transitioned to FAILED
    const updatedPayment = await pool.query('SELECT * FROM payments WHERE payment_id = $1', [payment.payment_id]);
    trace.push({
      step: 3,
      name: 'Payment State Machine Updated',
      status: updatedPayment.rows[0]?.status || 'FAILED',
      detail: { failureTypeId: updatedPayment.rows[0]?.failure_type_id }
    });

    // Step 5: Check recovery campaign created & strategy chosen
    const recovery = await recoveryRepo.findRecoveryByPaymentId(merchantId, payment.payment_id);
    if (!recovery) {
      res.status(200).json({
        success: true,
        mode: 'SIMULATION',
        trace,
        data: {
          paymentId: payment.payment_id,
          paymentStatus: updatedPayment.rows[0]?.status,
          recoveryId: null,
          message: 'No recovery campaign created (e.g. successful payment or fraud block).'
        }
      });
      return;
    }

    trace.push({
      step: 4,
      name: 'Recovery Eligibility & AI Policy Decision',
      status: 'ELIGIBLE',
      detail: {
        strategy: recovery.selected_strategy_id,
        confidence: recovery.ai_confidence_score,
        approvalRequired: recovery.approval_required
      }
    });

    trace.push({
      step: 5,
      name: 'Recovery Campaign Created',
      status: recovery.status,
      detail: { recoveryId: recovery.recovery_id, currentStage: recovery.current_stage }
    });

    // Step 6: Secure recovery link
    const links = await linkRepo.listLinksByRecovery(recovery.recovery_id);
    const activeLink = links.find(l => l.status === 'ACTIVE');
    const recoveryUrl = activeLink
      ? `${process.env.CUSTOMER_PORTAL_BASE_URL || 'http://localhost:3000'}/customer/recovery/${activeLink.secure_token}`
      : null;

    if (activeLink) {
      trace.push({
        step: 6,
        name: 'Secure Recovery Token & Link Generated',
        status: activeLink.status,
        detail: { token: activeLink.secure_token, expiresAt: activeLink.expires_at, recoveryUrl }
      });
    }

    // Step 7: Notification outbox records
    const notifs = await pool.query(
      'SELECT * FROM customer_notifications WHERE recovery_id = $1 ORDER BY created_at ASC',
      [recovery.recovery_id]
    );

    const notificationSummaries = notifs.rows.map(n => ({
      notificationId: n.notification_id,
      channel: n.channel,
      status: n.status,
      template: n.message_template_ref,
      attemptNumber: n.attempt_number
    }));

    trace.push({
      step: 7,
      name: 'Notification Outbox Queued & Dispatched',
      status: 'SIMULATED_SENT',
      detail: { notificationsCount: notifs.rowCount, dispatches: notificationSummaries }
    });

    res.status(200).json({
      success: true,
      mode: 'SIMULATION',
      data: {
        sessionId: session.session_id,
        paymentId: payment.payment_id,
        paymentStatus: updatedPayment.rows[0]?.status,
        failureReason: simulateOutcome,
        strategy: recovery.selected_strategy_id,
        aiConfidenceScore: recovery.ai_confidence_score,
        approvalRequired: recovery.approval_required,
        recoveryId: recovery.recovery_id,
        recoveryStatus: recovery.status,
        currentStage: recovery.current_stage,
        secureToken: activeLink?.secure_token || null,
        recoveryUrl,
        notifications: notificationSummaries
      },
      trace
    });

  } catch (err: any) {
    logger.error('Error running recovery flow demo', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Recovery flow demo run failed: ' + err.message }
    });
  }
});

/**
 * POST /api/demo/recovery/:id/execute-delayed-retry
 * Executes a simulated delayed retry for demo purposes immediately.
 */
router.post('/recovery/:id/execute-delayed-retry', async (req: Request, res: Response) => {
  try {
    const recoveryId = req.params.id;
    const { simulateOutcome = 'SUCCESS' } = req.body;

    const recovery = await recoveryRepo.findRecoveryByIdGlobal(recoveryId);
    if (!recovery) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Recovery campaign not found.' }
      });
      return;
    }

    const merchantId = recovery.merchant_id;

    if (['RECOVERED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(recovery.status)) {
      res.status(400).json({
        success: false,
        error: { code: 'CAMPAIGN_TERMINAL', message: `Recovery campaign is already in terminal state: ${recovery.status}` }
      });
      return;
    }

    const isSuccess = simulateOutcome === 'SUCCESS';

    // 1. Create recovery payment attempt
    const attempt = await attemptRepo.createRecoveryAttempt({
      recoveryId,
      customerId: recovery.customer_id,
      paymentMethodId: 'CARD',
      amount: recovery.amount,
      idempotencyKey: `sim_delayed_retry_${generateUUID()}`
    });

    // 2. Log retry execution action
    const actions = await actionRepo.listActionsByRecovery(recoveryId);
    const attemptNumber = actions.filter(a => a.strategy_id === 'DELAYED_RETRY').length + 1;

    await actionRepo.createRecoveryAction({
      recoveryId,
      strategyId: 'DELAYED_RETRY',
      actionType: 'DELAYED_RETRY_EXECUTED',
      status: isSuccess ? 'SUCCESS' : 'FAILED',
      attemptNumber
    });

    if (isSuccess) {
      await attemptRepo.updateAttemptStatus(attempt.attempt_id, 'SUCCESSFUL', {
        providerTransactionId: `sim_txn_${generateUUID()}`,
        providerStatus: 'CHARGED'
      });

      // Verification
      await pool.query(`
        INSERT INTO payment_verifications (payment_attempt_id, status, verification_attempt, verified_at)
        VALUES ($1, 'VERIFIED', 1, CURRENT_TIMESTAMP)
      `, [attempt.attempt_id]);

      await recoveryService.transitionRecovery(merchantId, recoveryId, {
        status: 'RECOVERED',
        current_stage: 'COMPLETED'
      }, 'SYSTEM');

      res.status(200).json({
        success: true,
        mode: 'SIMULATION',
        message: 'DEMO EXECUTION OF SCHEDULED RETRY: Completed successfully.',
        data: {
          recoveryId,
          recoveryStatus: 'RECOVERED',
          attemptId: attempt.attempt_id,
          verificationStatus: 'VERIFIED'
        }
      });
    } else {
      await attemptRepo.updateAttemptStatus(attempt.attempt_id, 'FAILED', {
        providerTransactionId: `sim_txn_fail_${generateUUID()}`,
        providerStatus: 'DECLINED',
        errorCode: 'RETRY_FAILED',
        errorMessage: 'Simulated delayed retry attempt was declined.'
      });

      res.status(200).json({
        success: true,
        mode: 'SIMULATION',
        message: 'DEMO EXECUTION OF SCHEDULED RETRY: Retry attempt failed.',
        data: {
          recoveryId,
          recoveryStatus: recovery.status,
          attemptId: attempt.attempt_id
        }
      });
    }

  } catch (err: any) {
    logger.error('Error executing delayed retry demo', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Delayed retry execution failed: ' + err.message }
    });
  }
});

/**
 * POST /api/demo/reset
 * Resets simulation and demo test data without deleting core merchant/customer seeds.
 */
router.post('/reset', async (_req: Request, res: Response) => {
  try {
    // Delete simulation sessions and cascaded simulation records
    const simDel = await pool.query('DELETE FROM simulation_sessions');
    
    // Clean up dynamic non-seeded demo payments (payments with simulation_session_id IS NOT NULL or external_reference starting with ref_sim_ or ref_demo_)
    await pool.query(`
      DELETE FROM payments 
      WHERE external_reference LIKE 'ref_sim_%' 
         OR external_reference LIKE 'ref_demo_%'
         OR external_reference LIKE 'ref_test_%'
    `);

    res.status(200).json({
      success: true,
      message: 'Demo test sessions and simulated records have been cleanly reset.',
      data: {
        simulationSessionsDeleted: simDel.rowCount
      }
    });
  } catch (err: any) {
    logger.error('Error resetting demo data', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Demo reset failed: ' + err.message }
    });
  }
});

export default router;
