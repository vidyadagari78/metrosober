import path from 'path';
import fs from 'fs';
import { pool, reinitPool } from './index.js';
import { runMigrations } from './migrate.js';
import { seedDatabase } from './seed.js';

let embeddedPg: any = null;
const embeddedPgDir = path.resolve(process.cwd(), '.pgdata');

export async function ensureDatabaseReady() {
  let connected = false;
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    connected = true;
    console.log('Connected to existing PostgreSQL database.');
  } catch (err: any) {
    console.log('No PostgreSQL server responding at DATABASE_URL.');
    console.log('Automatically launching embedded PostgreSQL...');
  }

  if (!connected) {
    const port = 54320;
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
      console.log(`Embedded PostgreSQL running on port ${port}.`);
    } catch (e: any) {
      console.log('PostgreSQL start note:', e.message || e);
    }

    const connStr = `postgres://postgres:password@localhost:${port}/postgres`;
    process.env.DATABASE_URL = connStr;
    reinitPool(connStr);
  }

  await runMigrations();
  await seedDatabase();

  process.on('exit', () => {
    if (embeddedPg) {
      try {
        embeddedPg.stop();
      } catch (_) {}
    }
  });
}
