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

describe('Payment Webhook: Idempotency, Signature & Edge Cases', () => {
  const app = createApp();
  const testProductId = 'snack-webhook-test';

  beforeAll(async () => {
    await ensureDatabaseReady();

    await query('DELETE FROM order_items WHERE product_id = $1', [testProductId]);
    await query('DELETE FROM products WHERE id = $1', [testProductId]);

    await query(
      `
      INSERT INTO products (id, name, price_paise, stock, created_at, updated_at)
      VALUES ($1, 'Webhook Test Biscuit', 3000, 10, NOW(), NOW())
    `,
      [testProductId]
    );
  });

  afterAll(async () => {
    await cleanupDatabase();
  });

  it('rejects a webhook with invalid signature with 401 Unauthorized', async () => {
    // Create an order
    const orderRes = await request(app)
      .post('/orders')
      .send({ items: [{ productId: testProductId, quantity: 1 }] });

    const payload = {
      eventId: `evt_sig_fail_${Date.now()}`,
      orderId: orderRes.body.id,
      amountPaise: 3000,
      status: 'captured',
    };

    const res = await request(app)
      .post('/payments/webhook')
      .set('X-Signature', 'invalid_hex_signature_abcdef123456')
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('InvalidSignatureError');
  });

  it('processes a valid webhook once and marks the order paid', async () => {
    const orderRes = await request(app)
      .post('/orders')
      .send({ items: [{ productId: testProductId, quantity: 1 }] });

    const orderId = orderRes.body.id;
    const eventId = `evt_success_${Date.now()}`;
    const payload = {
      eventId,
      orderId,
      amountPaise: 3000,
      status: 'captured',
    };

    const bodyStr = JSON.stringify(payload);
    const signature = signPayload(bodyStr);

    const res = await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(bodyStr);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');

    // Check order status
    const checkOrder = await request(app).get(`/orders/${orderId}`);
    expect(checkOrder.body.status).toBe('paid');
    expect(checkOrder.body.paidAt).toBeDefined();
  });

  it('processes the same webhook event twice idempotently (processed once)', async () => {
    const orderRes = await request(app)
      .post('/orders')
      .send({ items: [{ productId: testProductId, quantity: 1 }] });

    const orderId = orderRes.body.id;
    const eventId = `evt_duplicate_${Date.now()}`;
    const payload = {
      eventId,
      orderId,
      amountPaise: 3000,
      status: 'captured',
    };

    const bodyStr = JSON.stringify(payload);
    const signature = signPayload(bodyStr);

    // First call
    const firstRes = await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(bodyStr);

    expect(firstRes.status).toBe(200);
    expect(firstRes.body.status).toBe('paid');

    // Second call with identical payload and eventId
    const secondRes = await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(bodyStr);

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.duplicate).toBe(true);

    // Database verification: payment_events table has EXACTLY one entry for this eventId
    const eventsInDb = await query('SELECT * FROM payment_events WHERE event_id = $1', [eventId]);
    expect(eventsInDb.rows.length).toBe(1);

    // Order remains paid and was not modified erroneously
    const checkOrder = await request(app).get(`/orders/${orderId}`);
    expect(checkOrder.body.status).toBe('paid');
  });

  it('marks order as needs_review if amountPaise does not match order total', async () => {
    const orderRes = await request(app)
      .post('/orders')
      .send({ items: [{ productId: testProductId, quantity: 1 }] });

    const orderId = orderRes.body.id;
    const eventId = `evt_mismatch_${Date.now()}`;
    // Order total is 3000, but payment provider sends 1500
    const payload = {
      eventId,
      orderId,
      amountPaise: 1500,
      status: 'captured',
    };

    const bodyStr = JSON.stringify(payload);
    const signature = signPayload(bodyStr);

    const res = await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(bodyStr);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('needs_review');
    expect(res.body.reason).toBe('AMOUNT_MISMATCH');

    const checkOrder = await request(app).get(`/orders/${orderId}`);
    expect(checkOrder.body.status).toBe('needs_review');
    expect(checkOrder.body.reviewReason).toBe('AMOUNT_MISMATCH');
  });

  it('marks order as needs_review if payment arrives after hold expired', async () => {
    // Create an order
    const orderRes = await request(app)
      .post('/orders')
      .send({ items: [{ productId: testProductId, quantity: 1 }] });

    const orderId = orderRes.body.id;

    // Simulate expired hold by updating expires_at to 10 seconds ago
    await query(`UPDATE orders SET expires_at = NOW() - INTERVAL '10 seconds' WHERE id = $1`, [orderId]);

    const eventId = `evt_late_${Date.now()}`;
    const payload = {
      eventId,
      orderId,
      amountPaise: 3000,
      status: 'captured',
    };

    const bodyStr = JSON.stringify(payload);
    const signature = signPayload(bodyStr);

    const res = await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(bodyStr);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('needs_review');
    expect(res.body.reason).toBe('PAYMENT_RECEIVED_AFTER_EXPIRY');

    const checkOrder = await request(app).get(`/orders/${orderId}`);
    expect(checkOrder.body.status).toBe('needs_review');
    expect(checkOrder.body.reviewReason).toBe('PAYMENT_RECEIVED_AFTER_EXPIRY');
  });
});
