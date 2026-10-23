import { useState, useEffect } from 'react';
import { Product, Order, fetchProducts, createOrder } from './api.js';
import { Catalog } from './components/Catalog.js';
import { Cart } from './components/Cart.js';
import { OrderStatus } from './components/OrderStatus.js';
import { Utensils, Shield, ArrowLeft } from 'lucide-react';

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<{ [productId: string]: number }>({});
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCheckingOut, setIsCheckingOut] = useState<boolean>(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const loadCatalog = async () => {
    setIsLoading(true);
    try {
      const data = await fetchProducts();
      setProducts(data);
    } catch (err: any) {
      console.error('Failed to load products:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCatalog();

    // Auto-refresh catalog every 5 seconds when on counter screen to reflect live holds
    const interval = setInterval(() => {
      if (!activeOrder) {
        fetchProducts().then(setProducts).catch(() => {});
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeOrder]);

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    setCart((prev) => {
      const next = { ...prev };
      if (quantity <= 0) {
        delete next[productId];
      } else {
        next[productId] = quantity;
      }
      return next;
    });
    setCheckoutError(null);
  };

  const handleClearCart = () => {
    setCart({});
    setCheckoutError(null);
  };

  const handleCheckout = async () => {
    const items = Object.entries(cart)
      .filter(([_, qty]) => qty > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));

    if (items.length === 0) return;

    setIsCheckingOut(true);
    setCheckoutError(null);

    try {
      const order = await createOrder(items);
      setActiveOrder(order);
      setCart({});
    } catch (err: any) {
      setCheckoutError(err.message || 'Failed to place order');
      // Re-fetch catalog so user sees latest available stock
      loadCatalog();
    } finally {
      setIsCheckingOut(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <header className="app-header">
        <div className="header-container">
          <div className="brand">
            <div className="brand-icon">
              <Utensils size={22} color="#ffffff" />
            </div>
            <div>
              <div className="brand-title">SNACK BOX</div>
              <div className="brand-subtitle">Self-Service Counter & Locker Pickup</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {activeOrder && (
              <button
                className="btn btn-secondary"
                style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                onClick={() => {
                  setActiveOrder(null);
                  loadCatalog();
                }}
              >
                <ArrowLeft size={14} /> Back to Counter
              </button>
            )}
            <span className="badge badge-success">
              <Shield size={12} /> Live Stock Holds Active
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-container">
        {activeOrder ? (
          <OrderStatus
            initialOrder={activeOrder}
            onNewOrder={() => {
              setActiveOrder(null);
              loadCatalog();
            }}
          />
        ) : (
          <div className="grid-layout">
            <Catalog
              products={products}
              cart={cart}
              onUpdateQuantity={handleUpdateQuantity}
              onRefresh={loadCatalog}
              isLoading={isLoading}
            />
            <Cart
              products={products}
              cart={cart}
              onUpdateQuantity={handleUpdateQuantity}
              onClearCart={handleClearCart}
              onCheckout={handleCheckout}
              isCheckingOut={isCheckingOut}
              checkoutError={checkoutError}
            />
          </div>
        )}
      </main>
    </div>
  );
}
