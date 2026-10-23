import { pool, query } from '../db/index.js';
import { config } from '../config.js';

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

export interface OrderResponseItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPricePaise: number;
}

export interface OrderResponse {
  id: string;
  totalPaise: number;
  status: 'pending' | 'paid' | 'expired' | 'claimed' | 'needs_review';
  reviewReason?: string | null;
  expiresAt: string;
  expiresInSeconds: number;
  createdAt: string;
  paidAt?: string | null;
  claimedAt?: string | null;
  items: OrderResponseItem[];
}

export class InsufficientStockError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientStockError';
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export async function createOrder(rawItems: OrderItemInput[]): Promise<OrderResponse> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('Order must contain at least one item.');
  }

  // Aggregate quantities for duplicate productIds in the request
  const itemMap = new Map<string, number>();
  for (const item of rawItems) {
    if (!item.productId || typeof item.quantity !== 'number' || item.quantity <= 0) {
      throw new Error(`Invalid item in order: ${JSON.stringify(item)}`);
    }
    const current = itemMap.get(item.productId) || 0;
    itemMap.set(item.productId, current + item.quantity);
  }

  const items = Array.from(itemMap.entries()).map(([productId, quantity]) => ({
    productId,
    quantity,
  }));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Sort product IDs to prevent deadlocks under high concurrency
    const productIds = items.map((i) => i.productId).sort();

    // 2. Lock product rows FOR UPDATE
    const productsRes = await client.query(
      `
      SELECT id, name, price_paise, stock
      FROM products
      WHERE id = ANY($1::varchar[])
      ORDER BY id
      FOR UPDATE;
    `,
      [productIds]
    );

    const productMap = new Map<string, { id: string; name: string; price_paise: number; stock: number }>();
    for (const row of productsRes.rows) {
      productMap.set(row.id, row);
    }

    // Verify all requested products exist
    for (const item of items) {
      if (!productMap.has(item.productId)) {
        throw new NotFoundError(`Product not found: "${item.productId}"`);
      }
    }

    // 3. Query existing active holds and paid uncollected items
    const holdsRes = await client.query(
      `
      SELECT 
        oi.product_id,
        COALESCE(SUM(oi.quantity), 0)::int as held_quantity
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = ANY($1::varchar[])
        AND (
          (o.status = 'pending' AND o.expires_at > NOW())
          OR (o.status = 'paid')
        )
      GROUP BY oi.product_id;
    `,
      [productIds]
    );

    const holdsMap = new Map<string, number>();
    for (const row of holdsRes.rows) {
      holdsMap.set(row.product_id, row.held_quantity);
    }

    // 4. Validate stock availability for each requested item
    let totalPaise = 0;
    for (const item of items) {
      const prod = productMap.get(item.productId)!;
      const currentlyHeld = holdsMap.get(item.productId) || 0;
      const available = prod.stock - currentlyHeld;

      if (available < item.quantity) {
        throw new InsufficientStockError(
          `Insufficient stock for "${prod.name}". Requested: ${item.quantity}, Available: ${Math.max(0, available)}`
        );
      }

      totalPaise += prod.price_paise * item.quantity;
    }

    // 5. Create Order with hold duration
    const holdSeconds = config.holdDurationSeconds;
    const orderRes = await client.query(
      `
      INSERT INTO orders (total_paise, status, expires_at, created_at, updated_at)
      VALUES ($1, 'pending', NOW() + ($2 || ' seconds')::interval, NOW(), NOW())
      RETURNING id, total_paise, status, expires_at, created_at;
    `,
      [totalPaise, holdSeconds]
    );

    const newOrder = orderRes.rows[0];

    // 6. Insert Order Items
    const responseItems: OrderResponseItem[] = [];
    for (const item of items) {
      const prod = productMap.get(item.productId)!;
      await client.query(
        `
        INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise)
        VALUES ($1, $2, $3, $4);
      `,
        [newOrder.id, item.productId, item.quantity, prod.price_paise]
      );

      responseItems.push({
        productId: item.productId,
        productName: prod.name,
        quantity: item.quantity,
        unitPricePaise: prod.price_paise,
      });
    }

    await client.query('COMMIT');

    const expiresAtDate = new Date(newOrder.expires_at);
    const expiresInSeconds = Math.max(0, Math.floor((expiresAtDate.getTime() - Date.now()) / 1000));

    return {
      id: newOrder.id,
      totalPaise: newOrder.total_paise,
      status: newOrder.status,
      expiresAt: expiresAtDate.toISOString(),
      expiresInSeconds,
      createdAt: new Date(newOrder.created_at).toISOString(),
      items: responseItems,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getOrderById(orderId: string): Promise<OrderResponse> {
  const orderRes = await query(
    `
    SELECT 
      id,
      total_paise AS "totalPaise",
      status,
      review_reason AS "reviewReason",
      expires_at AS "expiresAt",
      paid_at AS "paidAt",
      claimed_at AS "claimedAt",
      created_at AS "createdAt"
    FROM orders
    WHERE id = $1;
  `,
    [orderId]
  );

  if (orderRes.rows.length === 0) {
    throw new NotFoundError(`Order not found: "${orderId}"`);
  }

  const order = orderRes.rows[0];
  const expiresAtDate = new Date(order.expiresAt);
  const now = Date.now();

  let effectiveStatus = order.status;
  if (order.status === 'pending' && expiresAtDate.getTime() <= now) {
    effectiveStatus = 'expired';
    // Async synchronize in DB if needed
    query(`UPDATE orders SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending'`, [
      orderId,
    ]).catch(() => {});
  }

  const expiresInSeconds = Math.max(0, Math.floor((expiresAtDate.getTime() - now) / 1000));

  const itemsRes = await query(
    `
    SELECT 
      oi.product_id AS "productId",
      p.name AS "productName",
      oi.quantity,
      oi.unit_price_paise AS "unitPricePaise"
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = $1;
  `,
    [orderId]
  );

  return {
    id: order.id,
    totalPaise: order.totalPaise,
    status: effectiveStatus,
    reviewReason: order.reviewReason,
    expiresAt: expiresAtDate.toISOString(),
    expiresInSeconds,
    createdAt: new Date(order.createdAt).toISOString(),
    paidAt: order.paidAt ? new Date(order.paidAt).toISOString() : null,
    claimedAt: order.claimedAt ? new Date(order.claimedAt).toISOString() : null,
    items: itemsRes.rows,
  };
}
