import { Router } from 'express';
import { merchantContext } from '../middleware/merchantContext';
import { getDashboardController } from '../modules/analytics/analyticsController';
import { getPaymentsController, getPaymentDetailController } from '../modules/payments/paymentController';
import { getRecoveriesController, getRecoveryDetailController, approveRecoveryController, resolveRecoveryController } from '../modules/recovery/recoveryController';
import { getCustomersController } from '../modules/merchants/customerController';
import { getPolicyController, createPolicyController, activatePolicyController, deactivatePolicyController } from '../modules/merchants/policyController';

const router = Router();

// Enforce tenant authentication & isolation boundaries
router.use(merchantContext);

// Dashboard and Analytics
router.get('/dashboard', getDashboardController);
router.get('/analytics', getDashboardController);

// Payments
router.get('/payments', getPaymentsController);
router.get('/payments/:paymentId', getPaymentDetailController);

// Recoveries
router.get('/recoveries', getRecoveriesController);
router.get('/recoveries/:recoveryId', getRecoveryDetailController);
router.post('/recoveries/:recoveryId/approve', approveRecoveryController);
router.post('/recoveries/:recoveryId/resolve', resolveRecoveryController);

// Customers
router.get('/customers', getCustomersController);

// Policies
router.get('/policy', getPolicyController);
router.post('/policy', createPolicyController);
router.put('/policy/:policyId', createPolicyController);
router.post('/policy/:policyId/activate', activatePolicyController);
router.post('/policy/:policyId/deactivate', deactivatePolicyController);

export default router;
