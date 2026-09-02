import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Auto-migration helper that executes schema.sql and seed.sql
 * if tables do not exist yet in the target database.
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

    console.log('New database detected. Running schema.sql and seed.sql migrations...');

    // Find schema.sql and seed.sql in database/ or root
    const schemaPath = fs.existsSync(path.join(process.cwd(), 'database/schema.sql'))
      ? path.join(process.cwd(), 'database/schema.sql')
      : path.join(__dirname, '../../database/schema.sql');

    const seedPath = fs.existsSync(path.join(process.cwd(), 'database/seed.sql'))
      ? path.join(process.cwd(), 'database/seed.sql')
      : path.join(__dirname, '../../database/seed.sql');

    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schemaSql);
      console.log('✓ schema.sql executed successfully.');
    }

    if (fs.existsSync(seedPath)) {
      const seedSql = fs.readFileSync(seedPath, 'utf8');
      await pool.query(seedSql);
      console.log('✓ seed.sql executed successfully.');
    }

    console.log('✓ Database initialization complete.');
  } catch (err: any) {
    console.error('Database auto-migration error:', err.message);
  }
}
