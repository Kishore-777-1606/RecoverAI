import { pool } from '../../database/connection';

async function checkPostgres() {
  console.log('🔄 Attempting connection to configured PostgreSQL instance...');
  const start = Date.now();
  try {
    const res = await pool.query('SELECT version(), current_database(), current_schema()');
    const duration = Date.now() - start;
    console.log('✅ PostgreSQL connection succeeded!');
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log('📊 Connection details:');
    console.log(`   Version:  ${res.rows[0].version}`);
    console.log(`   Database: ${res.rows[0].current_database}`);
    console.log(`   Schema:   ${res.rows[0].current_schema}`);
    
    // Check pool works
    const client = await pool.connect();
    console.log('✅ Pool client acquisition succeeded!');
    client.release();
    
    process.exit(0);
  } catch (err: any) {
    console.error('❌ PostgreSQL connection failed!');
    console.error(`   Error Code:    ${err.code || 'N/A'}`);
    console.error(`   Message:       ${err.message}`);
    process.exit(1);
  }
}

checkPostgres();
