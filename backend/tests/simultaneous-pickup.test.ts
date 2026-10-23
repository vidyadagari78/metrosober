import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { ensureDatabaseReady, cleanupDatabase } from './setup.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { query } from '../src/db/index.js';

function signPayload(body: any, secret: string = config.webhookSecret): string {
  const jsonStr = typeof body === 'string' ? body : JSON.stringify(body);
  return crypto.createHmac('sha256', secret).update(jsonStr).digest('hex');
}

describe('Pickup Claim: Simultaneous Lockers & Stock Reduction', () => {
  const app = createApp();
  const testProductId = 'snack-pickup-test';

  beforeAll(async () => {
    await ensureDatabaseReady();

    await query('DELETE FROM order_items WHERE product_id = $1', [testProductId]);
    await query('DELETE FROM products WHERE id = $1', [testProductId]);

    await query(
      `
      INSERT INTO products (id, name, price_paise, stock, created_at, updated_at)
      VALUES ($1, 'Pickup Protein Bar', 5000, 5, NOW(), NOW())
    `,
      [testProductId]
    );
  });

  afterAll(async () => {
    await cleanupDatabase();
  });

  it('rejects pickup claim if the order is unpaid or pending', async () => {
    // 1. Create order
    const orderRes = await request(app)
      .post('/orders')
      .send({ items: [{ productId: testProductId, quantity: 1 }] });

    const orderId = orderRes.body.id;

    // 2. Try claiming unpaid order
    const claimRes = await request(app).post(`/orders/${orderId}/pickup-claim`);
    expect(claimRes.status).toBe(409);
    expect(claimRes.body.error).toBe('ConflictError');
    expect(claimRes.body.message).toMatch(/paid/i);
  });

  it('two lockers calling pickup-claim at the exact same moment: exactly one succeeds with 200, one fails with 409', async () => {
    // 1. Create order for 2 units
    const orderRes = await request(app)
      .post('/orders')
      .send({ items: [{ productId: testProductId, quantity: 2 }] });

    const orderId = orderRes.body.id;

    // 2. Pay for the order via webhook
    const eventId = `evt_pickup_${Date.now()}`;
    const payloadStr = JSON.stringify({
      eventId,
      orderId,
      amountPaise: 10000, // 2 units * 5000 paise
      status: 'captured',
    });

    const payRes = await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signPayload(payloadStr))
      .send(payloadStr);

    expect(payRes.status).toBe(200);
    expect(payRes.body.status).toBe('paid');

    // Initial stock is 5
    const initialProduct = await query('SELECT stock FROM products WHERE id = $1', [testProductId]);
    expect(initialProduct.rows[0].stock).toBe(5);

    // 3. Two lockers call pickup-claim for the same order at the exact same moment
    const [locker1Res, locker2Res] = await Promise.all([
      request(app).post(`/orders/${orderId}/pickup-claim`),
      request(app).post(`/orders/${orderId}/pickup-claim`),
    ]);

    const statuses = [locker1Res.status, locker2Res.status].sort();

    // Exactly one 200 OK and exactly one 409 Conflict
    expect(statuses).toEqual([200, 409]);

    const successRes = locker1Res.status === 200 ? locker1Res : locker2Res;
    const conflictRes = locker1Res.status === 409 ? locker1Res : locker2Res;

    expect(successRes.body.success).toBe(true);
    expect(successRes.body.order.status).toBe('claimed');
    expect(conflictRes.body.error).toBe('ConflictError');
    expect(conflictRes.body.message).toMatch(/already been claimed/i);

    // 4. Verify stock in database is permanently reduced exactly once: 5 - 2 = 3
    const finalProduct = await query('SELECT stock FROM products WHERE id = $1', [testProductId]);
    expect(finalProduct.rows[0].stock).toBe(3);

    // 5. Verify order status in database is 'claimed'
    const finalOrder = await request(app).get(`/orders/${orderId}`);
    expect(finalOrder.body.status).toBe('claimed');
    expect(finalOrder.body.claimedAt).toBeDefined();
  });
});
