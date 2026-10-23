import React from 'react';
import { Product, formatPaise } from '../api.js';
import { Plus, Minus, Package, RefreshCw } from 'lucide-react';

interface CatalogProps {
  products: Product[];
  cart: { [productId: string]: number };
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRefresh: () => void;
  isLoading: boolean;
}

const PRODUCT_IMAGES: Record<string, string> = {
  'chips-classic': '/images/chips-classic.jpg',
  'chocolate-dark': '/images/chocolate-dark.jpg',
  'roasted-almonds': '/images/roasted-almonds.jpg',
  'lemon-fizz': '/images/lemon-fizz.jpg',
  'masala-peanuts': '/images/masala-peanuts.jpg',
};

const RANDOM_FALLBACK_IMAGES = [
  '/images/chips-classic.jpg',
  '/images/chocolate-dark.jpg',
  '/images/roasted-almonds.jpg',
  '/images/lemon-fizz.jpg',
  '/images/masala-peanuts.jpg',
];

export function getProductImage(productId: string): string {
  if (PRODUCT_IMAGES[productId]) {
    return PRODUCT_IMAGES[productId];
  }
  // Deterministic fallback for any random product id
  let hash = 0;
  for (let i = 0; i < productId.length; i++) {
    hash = (hash << 5) - hash + productId.charCodeAt(i);
  }
  const idx = Math.abs(hash) % RANDOM_FALLBACK_IMAGES.length;
  return RANDOM_FALLBACK_IMAGES[idx];
}

export const Catalog: React.FC<CatalogProps> = ({
  products,
  cart,
  onUpdateQuantity,
  onRefresh,
  isLoading,
}) => {
  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">
          <Package size={22} color="#fbbf24" />
          Fresh Snacks & Beverages
        </h2>
        <button
          onClick={onRefresh}
          className="btn-icon"
          title="Refresh available inventory"
          disabled={isLoading}
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="products-grid">
        {products.map((product) => {
          const inCart = cart[product.id] || 0;
          const isSoldOut = product.availableUnits <= 0;
          const maxAvailable = product.availableUnits;
          const imageUrl = getProductImage(product.id);

          return (
            <div
              key={product.id}
              className={`product-card ${isSoldOut ? 'sold-out' : ''}`}
            >
              <div>
                {/* Product Image with Live Stock Badge Overlay */}
                <div className="product-image-container">
                  <img
                    src={imageUrl}
                    alt={product.name}
                    className="product-image"
                    loading="lazy"
                  />
                  <span
                    className={`badge product-badge-overlay ${
                      product.availableUnits > 2
                        ? 'badge-success'
                        : product.availableUnits > 0
                        ? 'badge-warning'
                        : 'badge-danger'
                    }`}
                  >
                    {product.availableUnits > 0
                      ? `${product.availableUnits} available`
                      : 'Sold Out'}
                  </span>
                </div>

                <h3 className="product-name">{product.name}</h3>

                <div className="product-price">
                  {formatPaise(product.pricePaise)}
                  <span className="product-price-paise">({product.pricePaise} paise)</span>
                </div>

                <div className="stock-info">
                  <span>Physical Stock: {product.stock}</span>
                  {product.stock - product.availableUnits > 0 && (
                    <span style={{ color: '#fbbf24', fontSize: '0.75rem', fontWeight: 600 }}>
                      ({product.stock - product.availableUnits} held)
                    </span>
                  )}
                </div>
              </div>

              <div>
                {isSoldOut ? (
                  <button className="btn btn-secondary" disabled style={{ width: '100%' }}>
                    Currently Unavailable
                  </button>
                ) : inCart === 0 ? (
                  <button
                    className="btn btn-primary"
                    onClick={() => onUpdateQuantity(product.id, 1)}
                    disabled={maxAvailable <= 0}
                  >
                    <Plus size={16} /> Add to Cart
                  </button>
                ) : (
                  <div className="qty-control">
                    <button
                      className="btn-icon"
                      onClick={() => onUpdateQuantity(product.id, inCart - 1)}
                      title="Decrease quantity"
                    >
                      <Minus size={16} />
                    </button>
                    <span className="qty-display">{inCart}</span>
                    <button
                      className="btn-icon"
                      onClick={() => onUpdateQuantity(product.id, inCart + 1)}
                      disabled={inCart >= maxAvailable}
                      title={inCart >= maxAvailable ? 'Max available stock reached' : 'Increase quantity'}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
