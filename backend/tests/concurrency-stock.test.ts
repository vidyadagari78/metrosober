import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { ensureDatabaseReady, cleanupDatabase } from './setup.js';
import { createApp } from '../src/app.js';
import { query } from '../src/db/index.js';

describe('Concurrency Test: 10 customers ordering the last 2 units simultaneously', () => {
  const app = createApp();
  const testProductId = 'snack-last-2-units';

  beforeAll(async () => {
    await ensureDatabaseReady();

    // Clean up past test data
    await query('DELETE FROM order_items WHERE product_id = $1', [testProductId]);
    await query('DELETE FROM products WHERE id = $1', [testProductId]);

    // Insert product with exactly 2 units in stock
    await query(
      `
      INSERT INTO products (id, name, price_paise, stock, created_at, updated_at)
      VALUES ($1, 'Rare Limited Chips', 2500, 2, NOW(), NOW())
    `,
      [testProductId]
    );
  });

  afterAll(async () => {
    await cleanupDatabase();
  });

  it('exactly two units are held, and all other 8 orders fail cleanly with 409', async () => {
    // 10 concurrent customers ordering 1 unit each of the product that has 2 units left
    const customerRequests = Array.from({ length: 10 }).map((_, index) =>
      request(app)
        .post('/orders')
        .send({
          items: [{ productId: testProductId, quantity: 1 }],
        })
    );

    const responses = await Promise.all(customerRequests);

    const successfulOrders = responses.filter((res) => res.status === 201);
    const failedOrders = responses.filter((res) => res.status === 409);

    // EXACTLY two orders must succeed
    expect(successfulOrders.length).toBe(2);

    // EXACTLY eight orders must fail cleanly
    expect(failedOrders.length).toBe(8);

    // Verify response structure of successful orders
    for (const res of successfulOrders) {
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('pending');
      expect(res.body.totalPaise).toBe(2500);
      expect(res.body.expiresInSeconds).toBeGreaterThan(0);
      expect(res.body.expiresInSeconds).toBeLessThanOrEqual(120);
    }

    // Verify response of failed orders
    for (const res of failedOrders) {
      expect(res.body.error).toBe('InsufficientStockError');
      expect(res.body.message).toMatch(/insufficient stock/i);
    }

    // Verify database state:
    // Available units for this product must now be 0
    const catalogRes = await request(app).get('/products');
    const productInCatalog = catalogRes.body.find((p: any) => p.id === testProductId);
    expect(productInCatalog).toBeDefined();
    expect(productInCatalog.stock).toBe(2);
    expect(productInCatalog.availableUnits).toBe(0);

    // Exactly 2 active orders exist for this product
    const heldRes = await query(
      `
      SELECT COUNT(*)::int as count, SUM(oi.quantity)::int as held_quantity
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = $1 AND o.status = 'pending' AND o.expires_at > NOW();
    `,
      [testProductId]
    );

    expect(heldRes.rows[0].count).toBe(2);
    expect(heldRes.rows[0].held_quantity).toBe(2);
  });
});
