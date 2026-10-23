export interface Product {
  id: string;
  name: string;
  pricePaise: number;
  stock: number;
  availableUnits: number;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPricePaise: number;
}

export interface Order {
  id: string;
  totalPaise: number;
  status: 'pending' | 'paid' | 'expired' | 'claimed' | 'needs_review';
  reviewReason?: string | null;
  expiresAt: string;
  expiresInSeconds: number;
  createdAt: string;
  paidAt?: string | null;
  claimedAt?: string | null;
  items: OrderItem[];
}

const API_BASE = ''; // proxied via Vite to http://localhost:3000

export async function fetchProducts(): Promise<Product[]> {
  const res = await fetch(`${API_BASE}/products`);
  if (!res.ok) {
    throw new Error(`Failed to fetch products: ${res.statusText}`);
  }
  return res.json();
}

export async function createOrder(items: { productId: string; quantity: number }[]): Promise<Order> {
  const res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'Failed to place order');
  }
  return data;
}

export async function fetchOrder(orderId: string): Promise<Order> {
  const res = await fetch(`${API_BASE}/orders/${orderId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch order: ${res.statusText}`);
  }
  return res.json();
}

export async function claimOrderPickup(orderId: string): Promise<{ success: boolean; message: string; order: any }> {
  const res = await fetch(`${API_BASE}/orders/${orderId}/pickup-claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'Failed to claim pickup');
  }
  return data;
}

// Helper to format whole paise into Indian Rupees without floating point math issues
export function formatPaise(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const remainingPaise = Math.abs(paise % 100);
  return `₹${rupees}.${remainingPaise.toString().padStart(2, '0')}`;
}
