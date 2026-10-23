import { pool } from '../db/index.js';
import { NotFoundError } from './order.service.js';

export class ConflictError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export async function claimOrderPickup(orderId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock the order row exclusively
    const orderRes = await client.query(
      `
      SELECT id, status, expires_at 
      FROM orders 
      WHERE id = $1 
      FOR UPDATE;
    `,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      throw new NotFoundError(`Order not found: "${orderId}"`);
    }

    const order = orderRes.rows[0];

    // 2. If already claimed, reject with 409 Conflict
    if (order.status === 'claimed') {
      throw new ConflictError('Order has already been claimed and collected.');
    }

    // 3. An unpaid or expired order cannot be claimed
    if (order.status !== 'paid') {
      throw new ConflictError(
        `Order cannot be claimed with status "${order.status}". Only "paid" orders can be collected.`
      );
    }

    // 4. Fetch the order items to reduce physical stock permanently
    const itemsRes = await client.query(
      `
      SELECT product_id, quantity 
      FROM order_items 
      WHERE order_id = $1;
    `,
      [orderId]
    );

    for (const item of itemsRes.rows) {
      await client.query(
        `
        UPDATE products 
        SET stock = stock - $1, updated_at = NOW() 
        WHERE id = $2;
      `,
        [item.quantity, item.product_id]
      );
    }

    // 5. Update order status to claimed
    const updatedOrderRes = await client.query(
      `
      UPDATE orders 
      SET status = 'claimed', claimed_at = NOW(), updated_at = NOW() 
      WHERE id = $1 
      RETURNING id, status, claimed_at AS "claimedAt";
    `,
      [orderId]
    );

    await client.query('COMMIT');

    return {
      success: true,
      message: 'Order claimed and physical stock permanently deducted.',
      order: updatedOrderRes.rows[0],
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
