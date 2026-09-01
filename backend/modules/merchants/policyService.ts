import { PoolClient } from 'pg';
import * as policyRepo from '../../database/repositories/policyRepository';
import { Policy } from '../../database/repositories/policyRepository';

/**
 * Service to manage merchant recovery policies.
 */
export async function getActivePolicy(merchantId: string, client?: PoolClient): Promise<Policy | null> {
  return policyRepo.findActivePolicyByMerchant(merchantId, client);
}

export async function getPolicyById(merchantId: string, policyId: string, client?: PoolClient): Promise<Policy> {
  return policyRepo.findPolicyById(merchantId, policyId, client);
}

export async function createPolicy(
  merchantId: string,
  policy: {
    name: string;
    is_active: boolean;
    auto_recovery_enabled: boolean;
    max_amount_limit?: string | number;
    approval_threshold?: string | number;
    quiet_hours_enabled: boolean;
    quiet_hours_start?: string;
    quiet_hours_end?: string;
  },
  failureRules: { failureTypeId: string; isEligible: boolean }[],
  strategies: {
    strategyId: string;
    priority: number;
    isEnabled: boolean;
    maxOutreachAttempts: number;
    minIntervalSeconds: number;
  }[],
  channels: { channel: 'SMS' | 'EMAIL' | 'WHATSAPP'; isEnabled: boolean }[],
  client?: PoolClient
): Promise<Policy> {
  return policyRepo.createPolicy(merchantId, policy, failureRules, strategies, channels, client);
}

export async function activatePolicy(merchantId: string, policyId: string, client?: PoolClient): Promise<void> {
  return policyRepo.activatePolicy(merchantId, policyId, client);
}

export async function deactivatePolicy(merchantId: string, policyId: string, client?: PoolClient): Promise<void> {
  return policyRepo.deactivatePolicy(merchantId, policyId, client);
}
