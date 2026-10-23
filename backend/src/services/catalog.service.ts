import { query } from '../db/index.js';

export interface ProductCatalogItem {
  id: string;
  name: string;
  pricePaise: number;
  stock: number;
  availableUnits: number;
}

export async function getProductsWithAvailableStock(): Promise<ProductCatalogItem[]> {
  const result = await query<ProductCatalogItem>(`
    SELECT 
      p.id,
      p.name,
      p.price_paise AS "pricePaise",
      p.stock,
      GREATEST(0, p.stock - COALESCE(holds.held_quantity, 0))::int AS "availableUnits"
    FROM products p
    LEFT JOIN (
      SELECT 
        oi.product_id,
        SUM(oi.quantity)::int AS held_quantity
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE 
        (o.status = 'pending' AND o.expires_at > NOW())
        OR (o.status = 'paid')
      GROUP BY oi.product_id
    ) holds ON holds.product_id = p.id
    ORDER BY p.id;
  `);

  return result.rows;
}
