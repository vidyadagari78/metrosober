import { pool } from './index.js';

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
        stock INTEGER NOT NULL CHECK (stock >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
        status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'paid', 'expired', 'claimed', 'needs_review')),
        review_reason VARCHAR(255),
        expires_at TIMESTAMPTZ NOT NULL,
        paid_at TIMESTAMPTZ,
        claimed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id VARCHAR(50) NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0)
      );

      CREATE TABLE IF NOT EXISTS payment_events (
        event_id VARCHAR(100) PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES orders(id),
        amount_paise INTEGER NOT NULL,
        status VARCHAR(50) NOT NULL,
        raw_payload JSONB,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_orders_status_expires ON orders(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_order_items_product_order ON order_items(product_id, order_id);
      CREATE INDEX IF NOT EXISTS idx_payment_events_order_id ON payment_events(order_id);
    `);

    await client.query('COMMIT');
    console.log('Database migrations executed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Allow direct execution
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
