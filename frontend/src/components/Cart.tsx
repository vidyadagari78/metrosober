import React from 'react';
import { Product, formatPaise } from '../api.js';
import { ShoppingBag, ArrowRight, Trash2, Clock, AlertTriangle } from 'lucide-react';
import { getProductImage } from './Catalog.js';

interface CartProps {
  products: Product[];
  cart: { [productId: string]: number };
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onClearCart: () => void;
  onCheckout: () => void;
  isCheckingOut: boolean;
  checkoutError: string | null;
}

export const Cart: React.FC<CartProps> = ({
  products,
  cart,
  onUpdateQuantity,
  onClearCart,
  onCheckout,
  isCheckingOut,
  checkoutError,
}) => {
  const cartItems = Object.entries(cart)
    .filter(([_, qty]) => qty > 0)
    .map(([productId, quantity]) => {
      const product = products.find((p) => p.id === productId);
      return {
        product,
        quantity,
        totalPaise: (product?.pricePaise || 0) * quantity,
      };
    })
    .filter((item) => item.product !== undefined);

  const totalPaise = cartItems.reduce((sum, item) => sum + item.totalPaise, 0);
  const totalItemsCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="card">
      <div className="cart-header">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
          <ShoppingBag size={20} color="#fbbf24" />
          Your Tray ({totalItemsCount})
        </h3>
        {cartItems.length > 0 && (
          <button
            onClick={onClearCart}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: '0.8rem',
            }}
          >
            <Trash2 size={14} /> Clear
          </button>
        )}
      </div>

      {checkoutError && (
        <div className="alert-banner alert-danger">
          <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          <div>{checkoutError}</div>
        </div>
      )}

      {cartItems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
          <ShoppingBag size={40} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
          <p style={{ fontWeight: 600 }}>Your tray is empty</p>
          <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
            Choose snacks from the counter to begin.
          </p>
        </div>
      ) : (
        <>
          <div className="cart-items-list">
            {cartItems.map(({ product, quantity, totalPaise }) => {
              if (!product) return null;
              return (
                <div key={product.id} className="cart-item">
                  <img
                    src={getProductImage(product.id)}
                    alt={product.name}
                    className="item-thumbnail"
                  />
                  <div style={{ flex: 1, marginLeft: '0.75rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-white)' }}>{product.name}</div>
                    <div style={{ fontSize: '0.78rem', color: '#86efac' }}>
                      {formatPaise(product.pricePaise)} × {quantity}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                      {formatPaise(totalPaise)}
                    </span>
                    <button
                      onClick={() => onUpdateQuantity(product.id, 0)}
                      className="btn-icon"
                      style={{ width: '26px', height: '26px' }}
                      title="Remove item"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="cart-total-box">
            <div className="cart-row">
              <span>Items Total</span>
              <span>{formatPaise(totalPaise)}</span>
            </div>
            <div className="cart-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Clock size={13} /> Stock Reservation
              </span>
              <span style={{ color: '#10b981', fontWeight: 600 }}>120 Seconds Hold</span>
            </div>
            <div className="cart-row total">
              <span>Amount to Pay</span>
              <span>{formatPaise(totalPaise)}</span>
            </div>
          </div>

          <button
            className="btn btn-primary"
            onClick={onCheckout}
            disabled={isCheckingOut || cartItems.length === 0}
          >
            {isCheckingOut ? (
              'Holding stock...'
            ) : (
              <>
                Place Order & Pay by UPI <ArrowRight size={18} />
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
};
