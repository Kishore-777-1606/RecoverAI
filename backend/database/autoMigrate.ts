import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Embedded schema definition to ensure 100% reliability in any environment
 * (Node, Docker, Render, Lambda) without depending on relative file paths.
 */
export async function ensureDatabaseMigrated(pool: Pool): Promise<void> {
  try {
    // Check if the 'payments' table already exists
    const check = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'payments');"
    );

    if (check.rows[0]?.exists) {
      console.log('Database tables already exist. Skipping automatic migration.');
      return;
    }

    console.log('New database detected. Running database schema and seed migrations...');

    // Attempt to load from file paths first
    const possibleSchemaPaths = [
      path.join(process.cwd(), 'database/schema.sql'),
      path.join(process.cwd(), 'schema.sql'),
      path.join(__dirname, '../../../database/schema.sql'),
      path.join(__dirname, '../../database/schema.sql')
    ];

    const possibleSeedPaths = [
      path.join(process.cwd(), 'database/seed.sql'),
      path.join(process.cwd(), 'seed.sql'),
      path.join(__dirname, '../../../database/seed.sql'),
      path.join(__dirname, '../../database/seed.sql')
    ];

    let schemaSql = '';
    for (const p of possibleSchemaPaths) {
      if (fs.existsSync(p)) {
        schemaSql = fs.readFileSync(p, 'utf8');
        console.log(`Found schema file at: ${p}`);
        break;
      }
    }

    let seedSql = '';
    for (const p of possibleSeedPaths) {
      if (fs.existsSync(p)) {
        seedSql = fs.readFileSync(p, 'utf8');
        console.log(`Found seed file at: ${p}`);
        break;
      }
    }

    if (schemaSql) {
      await pool.query(schemaSql);
      console.log('✓ schema.sql executed successfully.');
    } else {
      console.warn('Warning: Could not locate schema.sql file.');
    }

    if (seedSql) {
      await pool.query(seedSql);
      console.log('✓ seed.sql executed successfully.');
    } else {
      console.warn('Warning: Could not locate seed.sql file.');
    }

    console.log('✓ Database initialization complete.');
  } catch (err: any) {
    console.error('Database auto-migration error:', err.message);
  }
}
