import { PoolClient } from 'pg';
import { pool } from '../connection';
import { withTransaction } from '../transaction';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { logger } from '../../shared/logging/logger';

export interface Policy {
  policy_id: string;
  merchant_id: string;
  name: string;
  is_active: boolean;
  auto_recovery_enabled: boolean;
  max_amount_limit: string | null; // NUMERIC
  approval_threshold: string | null; // NUMERIC
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null; // TIME
  quiet_hours_end: string | null; // TIME
  created_at: Date;
  updated_at: Date;
  
  failure_rules?: FailureRule[];
  strategies?: PolicyStrategy[];
  channels?: PolicyChannel[];
}

export interface FailureRule {
  policy_id: string;
  failure_type_id: string;
  is_eligible: boolean;
}

export interface PolicyStrategy {
  policy_id: string;
  strategy_id: string;
  priority: number;
  is_enabled: boolean;
  max_outreach_attempts: number;
  min_interval_seconds: number;
}

export interface PolicyChannel {
  policy_id: string;
  channel: 'SMS' | 'EMAIL' | 'WHATSAPP';
  is_enabled: boolean;
}

/**
 * Creates a new merchant recovery policy and its associated rules/strategies.
 * Wraps operations in a transaction block to ensure atomicity and index compliance.
 */
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
  const execute = async (tx: PoolClient): Promise<Policy> => {
    // 1. If new policy is active, deactivate existing active policies to satisfy the index constraint
    if (policy.is_active) {
      const deactivateSql = `
        UPDATE merchant_policies
        SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE merchant_id = $1 AND is_active = TRUE
      `;
      await tx.query(deactivateSql, [merchantId]);
      logger.debug('Deactivated previous active policies for merchant', { merchantId });
    }

    // 2. Insert into merchant_policies
    const policySql = `
      INSERT INTO merchant_policies (
        merchant_id, name, is_active, auto_recovery_enabled,
        max_amount_limit, approval_threshold, quiet_hours_enabled,
        quiet_hours_start, quiet_hours_end
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING policy_id, merchant_id, name, is_active, auto_recovery_enabled,
                max_amount_limit, approval_threshold, quiet_hours_enabled,
                quiet_hours_start, quiet_hours_end, created_at, updated_at
    `;
    const policyParams = [
      merchantId,
      policy.name,
      policy.is_active,
      policy.auto_recovery_enabled,
      policy.max_amount_limit || null,
      policy.approval_threshold || null,
      policy.quiet_hours_enabled,
      policy.quiet_hours_start || null,
      policy.quiet_hours_end || null
    ];
    const policyRes = await tx.query<Policy>(policySql, policyParams);
    const createdPolicy = policyRes.rows[0];
    const policyId = createdPolicy.policy_id;

    // 3. Insert failure rules
    if (failureRules.length > 0) {
      for (const rule of failureRules) {
        const ruleSql = `
          INSERT INTO policy_failure_rules (policy_id, failure_type_id, is_eligible)
          VALUES ($1, $2, $3)
        `;
        await tx.query(ruleSql, [policyId, rule.failureTypeId, rule.isEligible]);
      }
    }

    // 4. Insert strategies configurations
    if (strategies.length > 0) {
      for (const strat of strategies) {
        const stratSql = `
          INSERT INTO policy_strategies (
            policy_id, strategy_id, priority, is_enabled,
            max_outreach_attempts, min_interval_seconds
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `;
        const stratParams = [
          policyId,
          strat.strategyId,
          strat.priority,
          strat.isEnabled,
          strat.maxOutreachAttempts,
          strat.minIntervalSeconds
        ];
        await tx.query(stratSql, stratParams);
      }
    }

    // 5. Insert channels configurations
    if (channels.length > 0) {
      for (const ch of channels) {
        const chSql = `
          INSERT INTO policy_channels (policy_id, channel, is_enabled)
          VALUES ($1, $2, $3)
        `;
        await tx.query(chSql, [policyId, ch.channel, ch.isEnabled]);
      }
    }

    logger.info('Recovery policy created successfully', { merchantId, policyId });
    
    // Attach child entities to response
    return {
      ...createdPolicy,
      failure_rules: failureRules.map(r => ({ policy_id: policyId, failure_type_id: r.failureTypeId, is_eligible: r.isEligible })),
      strategies: strategies.map(s => ({
        policy_id: policyId,
        strategy_id: s.strategyId,
        priority: s.priority,
        is_enabled: s.isEnabled,
        max_outreach_attempts: s.maxOutreachAttempts,
        min_interval_seconds: s.minIntervalSeconds
      })),
      channels: channels.map(c => ({ policy_id: policyId, channel: c.channel, is_enabled: c.isEnabled }))
    };
  };

  // Run inside provided client transaction or spawn new transaction
  if (client) {
    return execute(client);
  } else {
    return withTransaction<Policy>(execute);
  }
}

/**
 * Retrieves the currently active policy configuration for a merchant, joining child rules.
 */
export async function findActivePolicyByMerchant(
  merchantId: string,
  client?: PoolClient
): Promise<Policy | null> {
  const db = client || pool;
  const policySql = `
    SELECT policy_id, merchant_id, name, is_active, auto_recovery_enabled,
           max_amount_limit, approval_threshold, quiet_hours_enabled,
           quiet_hours_start, quiet_hours_end, created_at, updated_at
    FROM merchant_policies
    WHERE merchant_id = $1 AND is_active = TRUE
  `;
  const policyRes = await db.query<Policy>(policySql, [merchantId]);
  if (policyRes.rowCount === 0) {
    return null;
  }
  
  const policy = policyRes.rows[0];
  return populatePolicyChildRecords(policy, db);
}

/**
 * Finds a specific policy by its ID. Throws NotFoundError if not found.
 */
export async function findPolicyById(
  merchantId: string,
  policyId: string,
  client?: PoolClient
): Promise<Policy> {
  const db = client || pool;
  const policySql = `
    SELECT policy_id, merchant_id, name, is_active, auto_recovery_enabled,
           max_amount_limit, approval_threshold, quiet_hours_enabled,
           quiet_hours_start, quiet_hours_end, created_at, updated_at
    FROM merchant_policies
    WHERE merchant_id = $1 AND policy_id = $2
  `;
  const policyRes = await db.query<Policy>(policySql, [merchantId, policyId]);
  if (policyRes.rowCount === 0) {
    throw new NotFoundError(`Policy with ID ${policyId} not found for this merchant`);
  }

  return populatePolicyChildRecords(policyRes.rows[0], db);
}

/**
 * Lists all historical policies configured by a merchant.
 */
export async function listPolicyVersions(merchantId: string, client?: PoolClient): Promise<Policy[]> {
  const db = client || pool;
  const sql = `
    SELECT policy_id, merchant_id, name, is_active, auto_recovery_enabled,
           max_amount_limit, approval_threshold, quiet_hours_enabled,
           quiet_hours_start, quiet_hours_end, created_at, updated_at
    FROM merchant_policies
    WHERE merchant_id = $1
    ORDER BY created_at DESC
  `;
  const res = await db.query<Policy>(sql, [merchantId]);
  return res.rows;
}

/**
 * Activates a policy version for a merchant, deactivating any active versions.
 */
export async function activatePolicy(
  merchantId: string,
  policyId: string,
  client?: PoolClient
): Promise<void> {
  const execute = async (tx: PoolClient): Promise<void> => {
    // Verify target exists
    const checkSql = `SELECT policy_id FROM merchant_policies WHERE merchant_id = $1 AND policy_id = $2`;
    const checkRes = await tx.query(checkSql, [merchantId, policyId]);
    if (checkRes.rowCount === 0) {
      throw new NotFoundError(`Policy with ID ${policyId} not found`);
    }

    // Deactivate previous
    const deactivateSql = `
      UPDATE merchant_policies
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE merchant_id = $1 AND is_active = TRUE
    `;
    await tx.query(deactivateSql, [merchantId]);

    // Activate target
    const activateSql = `
      UPDATE merchant_policies
      SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE merchant_id = $1 AND policy_id = $2
    `;
    await tx.query(activateSql, [merchantId, policyId]);
    logger.info('Activated recovery policy', { merchantId, policyId });
  };

  if (client) {
    await execute(client);
  } else {
    await withTransaction<void>(execute);
  }
}

/**
 * Deactivates a policy version (soft-disable).
 */
export async function deactivatePolicy(
  merchantId: string,
  policyId: string,
  client?: PoolClient
): Promise<void> {
  const db = client || pool;
  const sql = `
    UPDATE merchant_policies
    SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
    WHERE merchant_id = $1 AND policy_id = $2
  `;
  const res = await db.query(sql, [merchantId, policyId]);
  if (res.rowCount === 0) {
    throw new NotFoundError(`Policy with ID ${policyId} not found`);
  }
  logger.info('Deactivated recovery policy', { merchantId, policyId });
}

/**
 * Internal helper to populate child records (rules, strategies, channels) on a policy.
 */
async function populatePolicyChildRecords(policy: Policy, db: PoolClient | typeof pool): Promise<Policy> {
  const policyId = policy.policy_id;

  const rulesSql = `SELECT policy_id, failure_type_id, is_eligible FROM policy_failure_rules WHERE policy_id = $1`;
  const rulesRes = await db.query<FailureRule>(rulesSql, [policyId]);

  const stratsSql = `
    SELECT policy_id, strategy_id, priority, is_enabled, max_outreach_attempts, min_interval_seconds
    FROM policy_strategies
    WHERE policy_id = $1
    ORDER BY priority ASC
  `;
  const stratsRes = await db.query<PolicyStrategy>(stratsSql, [policyId]);

  const channelsSql = `SELECT policy_id, channel, is_enabled FROM policy_channels WHERE policy_id = $1`;
  const channelsRes = await db.query<PolicyChannel>(channelsSql, [policyId]);

  return {
    ...policy,
    failure_rules: rulesRes.rows,
    strategies: stratsRes.rows,
    channels: channelsRes.rows
  };
}
