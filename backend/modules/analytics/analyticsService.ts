import { pool } from '../../database/connection';
import { DashboardMetrics, StrategyPerformance } from './analyticsTypes';
import { logger } from '../../shared/logging/logger';

/**
 * Derives real-time dashboard aggregates directly from transaction records.
 */
export async function getDashboardMetrics(
  merchantId: string,
  environment?: 'LIVE' | 'TEST' | 'SIMULATION'
): Promise<DashboardMetrics> {
  logger.info('Calculating real-time analytics for merchant dashboard', { merchantId, environment });

  const envFilter = environment ? `AND environment = $2` : '';
  const params: any[] = [merchantId];
  if (environment) {
    params.push(environment);
  }

  // 1. Payments summary
  const paymentsQuery = `
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'SUCCESSFUL') as successful,
      COUNT(*) FILTER (WHERE status = 'FAILED') as failed
    FROM payments
    WHERE merchant_id = $1 ${envFilter}
  `;
  const paymentsRes = await pool.query(paymentsQuery, params);
  const pData = paymentsRes.rows[0] || { total: 0, successful: 0, failed: 0 };
  const totalPayments = parseInt(pData.total, 10) || 0;
  const successfulPayments = parseInt(pData.successful, 10) || 0;
  const failedPayments = parseInt(pData.failed, 10) || 0;
  const paymentSuccessRate = totalPayments > 0 ? parseFloat(((successfulPayments / totalPayments) * 100).toFixed(2)) : 0.00;

  // 2. Recoveries summary
  const recoveriesQuery = `
    SELECT
      COUNT(*) as total_rec,
      COUNT(*) FILTER (WHERE status = 'RECOVERED') as recovered_rec,
      COUNT(*) FILTER (WHERE status IN ('IN_PROGRESS', 'AWAITING_CUSTOMER_ACTION', 'AWAITING_VERIFICATION')) as active_rec,
      COUNT(*) FILTER (WHERE status IN ('FAILED', 'NOT_RECOVERABLE')) as failed_rec,
      COALESCE(SUM(amount) FILTER (WHERE status = 'RECOVERED'), 0.00) as recovered_sum
    FROM recoveries
    WHERE merchant_id = $1 ${envFilter}
  `;
  const recoveriesRes = await pool.query(recoveriesQuery, params);
  const rData = recoveriesRes.rows[0] || { total_rec: 0, recovered_rec: 0, active_rec: 0, failed_rec: 0, recovered_sum: '0.00' };
  
  const totalRec = parseInt(rData.total_rec, 10) || 0;
  const recoveredRec = parseInt(rData.recovered_rec, 10) || 0;
  const activeRecoveries = parseInt(rData.active_rec, 10) || 0;
  const recoveryFailures = parseInt(rData.failed_rec, 10) || 0;
  const totalRecoveredAmount = parseFloat(rData.recovered_sum).toFixed(2);
  const recoveryRate = totalRec > 0 ? parseFloat(((recoveredRec / totalRec) * 100).toFixed(2)) : 0.00;

  // 3. Strategy performance breakdown
  const strategyQuery = `
    SELECT
      selected_strategy_id as strategy_id,
      COUNT(*) as total_strat,
      COUNT(*) FILTER (WHERE status = 'RECOVERED') as recovered_strat
    FROM recoveries
    WHERE merchant_id = $1 ${envFilter} AND selected_strategy_id IS NOT NULL
    GROUP BY selected_strategy_id
  `;
  const strategyRes = await pool.query(strategyQuery, params);
  const strategyPerformance: StrategyPerformance[] = strategyRes.rows.map(row => {
    const totalS = parseInt(row.total_strat, 10) || 0;
    const recS = parseInt(row.recovered_strat, 10) || 0;
    return {
      strategyId: row.strategy_id,
      totalCampaigns: totalS,
      recoveredCampaigns: recS,
      successRate: totalS > 0 ? parseFloat(((recS / totalS) * 100).toFixed(2)) : 0.00
    };
  });

  // 4. Recent campaign activities
  const recentQuery = `
    SELECT 
      recovery_id, customer_id, payment_id, status, amount, environment, created_at
    FROM recoveries
    WHERE merchant_id = $1 ${envFilter}
    ORDER BY created_at DESC
    LIMIT 5
  `;
  const recentRes = await pool.query(recentQuery, params);
  const recentActivity = recentRes.rows;

  return {
    totalPayments,
    successfulPayments,
    failedPayments,
    paymentSuccessRate,
    totalRecoveredAmount,
    recoveryRate,
    activeRecoveries,
    recoveryFailures,
    strategyPerformance,
    recentActivity
  };
}
