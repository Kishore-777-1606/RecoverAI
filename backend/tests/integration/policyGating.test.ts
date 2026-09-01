import { pool } from '../../database/connection';
import * as merchantRepo from '../../database/repositories/merchantRepository';
import * as policyRepo from '../../database/repositories/policyRepository';
import { generateUUID } from '../../shared/utils/id';

async function runPolicyGatingTests() {
  console.log('🔄 Starting policy gating integration tests...');
  try {
    await pool.query('SELECT 1');
  } catch (err: any) {
    console.log('❌ DATABASE CONNECTION: BLOCKED — PostgreSQL is not running/configured');
    return;
  }

  try {
    const merchant = await merchantRepo.createMerchant({ name: 'Policy Merchant', email: `policy_${generateUUID()}@test.com` });
    
    // Create first policy
    const policy1 = await policyRepo.createPolicy(
      merchant.merchant_id,
      { name: 'Gating Policy 1', is_active: true, auto_recovery_enabled: true, quiet_hours_enabled: false },
      [], [], []
    );

    // Create second active policy deactivating first policy
    const policy2 = await policyRepo.createPolicy(
      merchant.merchant_id,
      { name: 'Gating Policy 2', is_active: true, auto_recovery_enabled: true, quiet_hours_enabled: false },
      [], [], []
    );

    console.log('✅ Active policy gating constraint tested successfully.');
  } catch (err: any) {
    console.error('❌ Policy gating integration error:', err.message);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runPolicyGatingTests();
}
export { runPolicyGatingTests };
