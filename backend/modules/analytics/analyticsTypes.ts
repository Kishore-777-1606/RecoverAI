export interface StrategyPerformance {
  strategyId: string;
  totalCampaigns: number;
  recoveredCampaigns: number;
  successRate: number;
}

export interface DashboardMetrics {
  totalPayments: number;
  successfulPayments: number;
  failedPayments: number;
  paymentSuccessRate: number;
  totalRecoveredAmount: string;
  recoveryRate: number;
  activeRecoveries: number;
  recoveryFailures: number;
  strategyPerformance: StrategyPerformance[];
  recentActivity: any[];
}
