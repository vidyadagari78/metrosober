import path from 'path';
import fs from 'fs';
import { pool, reinitPool } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';

let isReady = false;
let embeddedPg: any = null;
const embeddedPgDir = path.resolve(process.cwd(), '.pgdata-test-concurrency');

export async function ensureDatabaseReady() {
  if (isReady) return;

  let connected = false;
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    connected = true;
    console.log('Connected to existing PostgreSQL server.');
  } catch (err) {
    console.log('Connecting to existing PostgreSQL failed. Launching embedded PostgreSQL on port 54399...');
  }

  if (!connected) {
    const port = 54399;
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    embeddedPg = new EmbeddedPostgres({
      port,
      databaseDir: embeddedPgDir,
      user: 'postgres',
      password: 'password',
    });

    if (!fs.existsSync(embeddedPgDir)) {
      await embeddedPg.initialise();
    }

    try {
      await embeddedPg.start();
      console.log(`Embedded PostgreSQL started on port ${port}.`);
    } catch (e: any) {
      // If already started on port, proceed
      console.log('PostgreSQL start note:', e.message || e);
    }

    const connStr = `postgres://postgres:password@localhost:${port}/postgres`;
    process.env.DATABASE_URL = connStr;
    reinitPool(connStr);
  }

  await runMigrations();
  isReady = true;

  // Register clean shutdown on process exit
  process.on('exit', () => {
    if (embeddedPg) {
      try {
        embeddedPg.stop();
      } catch (_) {}
    }
  });
}

export async function cleanupDatabase() {
  // Kept open between test files for speed and stability
}
