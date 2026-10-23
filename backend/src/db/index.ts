import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export let pool = new Pool({
  connectionString: config.databaseUrl,
  max: 25,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

export function reinitPool(connectionString: string) {
  try {
    pool.end().catch(() => {});
  } catch (_) {}

  pool = new Pool({
    connectionString,
    max: 25,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on re-initialized idle PostgreSQL client', err);
  });
  return pool;
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function getClient() {
  const client = await pool.connect();
  return client;
}
