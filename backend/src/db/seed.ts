import { pool } from './index.js';

export const SEED_PRODUCTS = [
  {
    id: 'chips-classic',
    name: 'Classic Salted Potato Chips',
    pricePaise: 3500, // ₹35.00
    stock: 10,
  },
  {
    id: 'chocolate-dark',
    name: 'Artisan Dark Chocolate Bar',
    pricePaise: 6000, // ₹60.00
    stock: 8,
  },
  {
    id: 'roasted-almonds',
    name: 'Roasted & Salted Almonds',
    pricePaise: 9500, // ₹95.00
    stock: 5,
  },
  {
    id: 'lemon-fizz',
    name: 'Sparkling Lemon Cooler',
    pricePaise: 4000, // ₹40.00
    stock: 12,
  },
  {
    id: 'masala-peanuts',
    name: 'Crunchy Masala Peanuts',
    pricePaise: 2500, // ₹25.00
    stock: 2, // specifically 2 units for testing concurrency on the last 2 units
  },
];

export async function seedDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const prod of SEED_PRODUCTS) {
      await client.query(
        `
        INSERT INTO products (id, name, price_paise, stock, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          price_paise = EXCLUDED.price_paise,
          stock = EXCLUDED.stock,
          updated_at = NOW();
      `,
        [prod.id, prod.name, prod.pricePaise, prod.stock]
      );
    }

    await client.query('COMMIT');
    console.log('Database seeded with snack catalog successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Allow direct execution
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
