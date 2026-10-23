import crypto from 'crypto';
import { pool } from '../db/index.js';
import { config } from '../config.js';
import { NotFoundError } from './order.service.js';

export class InvalidSignatureError extends Error {
  statusCode = 401;
  constructor(message: string = 'Invalid webhook signature') {
    super(message);
    this.name = 'InvalidSignatureError';
  }
}

export interface WebhookPayload {
  eventId: string;
  orderId: string;
  amountPaise: number;
  status: 'captured' | 'failed' | string;
}

export function verifyWebhookSignature(rawBody: Buffer | string | undefined, signature: string | undefined): void {
  if (!signature || !rawBody) {
    throw new InvalidSignatureError('Missing webhook signature or request body');
  }

  const hmac = crypto.createHmac('sha256', config.webhookSecret);
  hmac.update(rawBody);
  const expectedSignature = hmac.digest('hex');

  const sigBuf = Buffer.from(signature.trim().toLowerCase(), 'hex');
  const expBuf = Buffer.from(expectedSignature.toLowerCase(), 'hex');

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new InvalidSignatureError('Signature does not match');
  }
}

export async function processPaymentWebhook(payload: WebhookPayload, rawPayloadJson?: any) {
  const { eventId, orderId, amountPaise, status } = payload;

  if (!eventId || !orderId || typeof amountPaise !== 'number' || !status) {
    throw new Error('Invalid webhook payload structure');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Idempotency check: see if event was already processed
    const existingEvent = await client.query(
      `SELECT event_id, order_id, status FROM payment_events WHERE event_id = $1 FOR UPDATE;`,
      [eventId]
    );

    if (existingEvent.rows.length > 0) {
      await client.query('COMMIT');
      return {
        success: true,
        message: 'Event already processed',
        eventId,
        duplicate: true,
      };
    }

    // 2. Lock the target order
    const orderRes = await client.query(
      `SELECT id, total_paise, status, expires_at FROM orders WHERE id = $1 FOR UPDATE;`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      throw new NotFoundError(`Order not found for webhook: "${orderId}"`);
    }

    const order = orderRes.rows[0];

    // 3. Record event in payment_events table
    await client.query(
      `
      INSERT INTO payment_events (event_id, order_id, amount_paise, status, raw_payload, processed_at)
      VALUES ($1, $2, $3, $4, $5, NOW());
    `,
      [eventId, orderId, amountPaise, status, JSON.stringify(rawPayloadJson || payload)]
    );

    // 4. Verify amount matches order total
    if (order.total_paise !== amountPaise) {
      await client.query(
        `
        UPDATE orders 
        SET status = 'needs_review', review_reason = 'AMOUNT_MISMATCH', updated_at = NOW() 
        WHERE id = $1;
      `,
        [orderId]
      );

      await client.query('COMMIT');
      return {
        success: true,
        orderId,
        status: 'needs_review',
        reason: 'AMOUNT_MISMATCH',
        expectedPaise: order.total_paise,
        receivedPaise: amountPaise,
      };
    }

    // 5. Late payment decision:
    // If the 120-second hold expired, do NOT mark paid because inventory may have been released
    // or re-allocated, and the customer screen may have timed out. Flag for review/refund.
    const isExpired = new Date(order.expires_at).getTime() <= Date.now();
    if (isExpired && order.status === 'pending') {
      await client.query(
        `
        UPDATE orders 
        SET status = 'needs_review', review_reason = 'PAYMENT_RECEIVED_AFTER_EXPIRY', updated_at = NOW() 
        WHERE id = $1;
      `,
        [orderId]
      );

      await client.query('COMMIT');
      return {
        success: true,
        orderId,
        status: 'needs_review',
        reason: 'PAYMENT_RECEIVED_AFTER_EXPIRY',
      };
    }

    // 6. Valid capture on active pending order
    if (status === 'captured' && order.status === 'pending') {
      await client.query(
        `
        UPDATE orders 
        SET status = 'paid', paid_at = NOW(), updated_at = NOW() 
        WHERE id = $1;
      `,
        [orderId]
      );

      await client.query('COMMIT');
      return {
        success: true,
        orderId,
        status: 'paid',
      };
    }

    // 7. Order was already paid or claimed (idempotent state transition)
    await client.query('COMMIT');
    return {
      success: true,
      orderId,
      status: order.status,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
