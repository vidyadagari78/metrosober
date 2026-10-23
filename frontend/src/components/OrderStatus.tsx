import React, { useState, useEffect, useRef } from 'react';
import { Order, fetchOrder, claimOrderPickup, formatPaise } from '../api.js';
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  QrCode,
  PackageCheck,
  Copy,
  Check,
  RotateCcw,
  ShieldCheck,
  Lock,
  Unlock,
} from 'lucide-react';
import { getProductImage } from './Catalog.js';

interface OrderStatusProps {
  initialOrder: Order;
  onNewOrder: () => void;
}

export const OrderStatus: React.FC<OrderStatusProps> = ({ initialOrder, onNewOrder }) => {
  const [order, setOrder] = useState<Order>(initialOrder);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(initialOrder.expiresInSeconds);
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [simulatingWebhook, setSimulatingWebhook] = useState<boolean>(false);

  // MONOTONIC CLOCK ANCHOR:
  // Immune to client clock skew (even if machine's system clock is hours/minutes off).
  // Uses hardware monotonic performance.now() combined with server-calculated expiresInSeconds.
  const anchorRef = useRef<{
    receivedPerformanceNow: number;
    initialExpiresIn: number;
  }>({
    receivedPerformanceNow: performance.now(),
    initialExpiresIn: initialOrder.expiresInSeconds,
  });

  // 1. High-frequency timer tick using monotonic clock
  useEffect(() => {
    if (order.status !== 'pending') return;

    const tick = () => {
      const elapsedSeconds = (performance.now() - anchorRef.current.receivedPerformanceNow) / 1000;
      const left = Math.max(0, Math.floor(anchorRef.current.initialExpiresIn - elapsedSeconds));
      setRemainingSeconds(left);
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [order.status]);

  // 2. Periodic polling from server to check order status
  useEffect(() => {
    if (order.status === 'claimed') return;

    const poller = setInterval(async () => {
      try {
        const fresh = await fetchOrder(order.id);
        setOrder(fresh);

        // Re-anchor monotonic countdown with fresh server-reported expiresInSeconds
        anchorRef.current = {
          receivedPerformanceNow: performance.now(),
          initialExpiresIn: fresh.expiresInSeconds,
        };

        if (fresh.status !== 'pending') {
          clearInterval(poller);
        }
      } catch (err) {
        console.error('Failed to poll order status', err);
      }
    }, 1500);

    return () => clearInterval(poller);
  }, [order.id, order.status]);

  const handleCopyOrderId = () => {
    navigator.clipboard.writeText(order.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLockerPickup = async () => {
    setIsClaiming(true);
    setClaimError(null);
    try {
      const res = await claimOrderPickup(order.id);
      setOrder((prev) => ({
        ...prev,
        status: 'claimed',
        claimedAt: res.order?.claimedAt || new Date().toISOString(),
      }));
    } catch (err: any) {
      setClaimError(err.message || 'Pickup claim failed');
    } finally {
      setIsClaiming(false);
    }
  };

  // Helper to trigger payment webhook directly from UI for reviewer convenience
  const handleSimulatePayment = async (amountPaise: number) => {
    setSimulatingWebhook(true);
    try {
      const eventId = `evt_ui_${Date.now()}`;
      // In development or review, we can post directly or invoke backend
      // Here we compute HMAC on server or send to a test simulation helper
      const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || '';
      const res = await fetch(`${apiBase}/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Compute client-side test signature using known dev secret
          'X-Signature': await computeHmac(
            JSON.stringify({
              eventId,
              orderId: order.id,
              amountPaise,
              status: 'captured',
            }),
            'pickup_counter_super_secret_key_2026'
          ),
        },
        body: JSON.stringify({
          eventId,
          orderId: order.id,
          amountPaise,
          status: 'captured',
        }),
      });

      const data = await res.json();
      console.log('Webhook simulation response:', data);

      // Re-fetch order status immediately
      const updated = await fetchOrder(order.id);
      setOrder(updated);
    } catch (err: any) {
      console.error('Simulation error:', err);
    } finally {
      setSimulatingWebhook(false);
    }
  };

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const formattedCountdown = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  const cliCommand = `npm run send-webhook -- ${order.id}`;

  return (
    <div className="order-screen-container">
      <div className="card">
        {/* Header with status badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Order Reference</div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontFamily: 'monospace',
                fontSize: '0.95rem',
                fontWeight: 600,
                marginTop: '0.15rem',
              }}
            >
              {order.id.slice(0, 8)}...{order.id.slice(-8)}
              <button
                onClick={handleCopyOrderId}
                className="btn-icon"
                style={{ width: '24px', height: '24px' }}
                title="Copy full Order ID"
              >
                {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          <div>
            {order.status === 'pending' && (
              <span className="badge badge-warning">
                <span className="pulse-dot" style={{ background: '#f59e0b' }}></span> Awaiting UPI Payment
              </span>
            )}
            {order.status === 'paid' && (
              <span className="badge badge-success">
                <CheckCircle2 size={14} /> Payment Captured
              </span>
            )}
            {order.status === 'expired' && (
              <span className="badge badge-danger">
                <XCircle size={14} /> Hold Expired
              </span>
            )}
            {order.status === 'needs_review' && (
              <span className="badge badge-warning">
                <AlertCircle size={14} /> Needs Review
              </span>
            )}
            {order.status === 'claimed' && (
              <span className="badge badge-info">
                <PackageCheck size={14} /> Order Collected
              </span>
            )}
          </div>
        </div>

        {/* STATE: PENDING PAYMENT */}
        {order.status === 'pending' && (
          <div>
            <div className="timer-box">
              <div className="timer-digits font-mono">{formattedCountdown}</div>
              <div className="timer-label">
                <Clock size={14} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> Stock Held (120s
                server countdown • clock-skew safe)
              </div>
            </div>

            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '1rem', color: '#cbd5e1' }}>Total Payable Amount</div>
              <div style={{ fontSize: '2.75rem', fontWeight: 800, color: '#fbbf24', margin: '0.25rem 0', textShadow: '0 2px 14px rgba(245, 158, 11, 0.3)' }}>
                {formatPaise(order.totalPaise)}
              </div>
              <div style={{ fontSize: '0.82rem', color: '#86efac' }}>
                Exact amount: {order.totalPaise} paise
              </div>

              {/* Simulated UPI QR Box */}
              <div className="qr-box">
                <QrCode size={160} color="#05140e" />
                <div style={{ fontSize: '0.78rem', color: '#047857', fontWeight: 800, marginTop: '0.5rem', letterSpacing: '0.02em' }}>
                  UPI: snackcounter@upi
                </div>
              </div>

              <p style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                Scan with BHIM, GPay, PhonePe or Paytm.
              </p>
            </div>

            {/* Simulation controls for tester/reviewer */}
            <div className="simulator-card">
              <div style={{ fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#ffffff' }}>
                <ShieldCheck size={16} color="#fbbf24" />
                Reviewer / Webhook Test Controls
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Simulate the payment webhook or run the CLI script in your terminal:
              </p>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-success"
                  style={{ flex: 1, minWidth: '180px', padding: '0.6rem' }}
                  onClick={() => handleSimulatePayment(order.totalPaise)}
                  disabled={simulatingWebhook}
                >
                  Pay Exact {formatPaise(order.totalPaise)}
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1, minWidth: '180px', padding: '0.6rem', fontSize: '0.85rem' }}
                  onClick={() => handleSimulatePayment(Math.max(100, order.totalPaise - 1000))}
                  disabled={simulatingWebhook}
                  title="Simulate underpayment (sends mismatched amount)"
                >
                  Test Amount Mismatch
                </button>
              </div>

              <div className="code-snippet">
                <span>{cliCommand}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(cliCommand);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="btn-icon"
                  style={{ width: '24px', height: '24px' }}
                  title="Copy command"
                >
                  {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STATE: PAID (READY FOR LOCKER PICKUP) */}
        {order.status === 'paid' && (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div className="alert-banner alert-success" style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
              <CheckCircle2 size={24} style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700 }}>Payment Successfully Captured!</div>
                <div style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}>
                  Amount of {formatPaise(order.totalPaise)} verified via webhook. Your snacks are prepared in Locker Bay #4.
                </div>
              </div>
            </div>

            <div
              style={{
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: 'var(--radius-lg)',
                padding: '2rem 1rem',
                marginBottom: '1.5rem',
              }}
            >
              <Lock size={48} color="#10b981" style={{ margin: '0 auto 1rem' }} />
              <h3 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Locker #4 is Ready</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
                Tap the button below to simulate the locker door unlocking and claiming the order.
              </p>
            </div>

            {claimError && (
              <div className="alert-banner alert-danger">
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <div>{claimError}</div>
              </div>
            )}

            <button
              className="btn btn-success"
              style={{ padding: '1rem', fontSize: '1.1rem' }}
              onClick={handleLockerPickup}
              disabled={isClaiming}
            >
              {isClaiming ? (
                'Unlocking locker...'
              ) : (
                <>
                  <Unlock size={20} /> Open Locker & Collect Snacks
                </>
              )}
            </button>
          </div>
        )}

        {/* STATE: CLAIMED / COLLECTED */}
        {order.status === 'claimed' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <div
              style={{
                width: '72px',
                height: '72px',
                background: 'rgba(59, 130, 246, 0.15)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem',
                border: '1px solid rgba(59, 130, 246, 0.4)',
              }}
            >
              <PackageCheck size={36} color="#3b82f6" />
            </div>

            <h3 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Snacks Collected!</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
              The locker has closed and stock has been permanently updated in the system. Enjoy your snacks!
            </p>

            <div
              style={{
                background: 'rgba(0, 0, 0, 0.25)',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                marginTop: '1.5rem',
                fontSize: '0.85rem',
                textAlign: 'left',
              }}
            >
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Order Summary</div>
              {order.items.map((item, idx) => (
                <div
                  key={idx}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <img
                      src={getProductImage(item.productId)}
                      alt={item.productName}
                      className="item-thumbnail"
                      style={{ width: '36px', height: '36px' }}
                    />
                    <span>
                      {item.productName} × {item.quantity}
                    </span>
                  </div>
                  <span style={{ fontWeight: 600, color: '#fbbf24' }}>{formatPaise(item.unitPricePaise * item.quantity)}</span>
                </div>
              ))}
              <div
                style={{
                  borderTop: '1px solid var(--border-color)',
                  marginTop: '0.5rem',
                  paddingTop: '0.5rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: 700,
                }}
              >
                <span>Total Paid</span>
                <span>{formatPaise(order.totalPaise)}</span>
              </div>
            </div>

            <button className="btn btn-secondary" style={{ marginTop: '1.5rem' }} onClick={onNewOrder}>
              <RotateCcw size={16} /> Order Again
            </button>
          </div>
        )}

        {/* STATE: EXPIRED */}
        {order.status === 'expired' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <div className="alert-banner alert-danger" style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
              <XCircle size={24} style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700 }}>Reservation Time Expired</div>
                <div style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}>
                  The 120-second stock hold has elapsed. The items have been released back to available counter inventory.
                </div>
              </div>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              If UPI funds were deducted after expiry, our webhook will safely flag the transaction for review and automatic refund.
            </p>

            <button className="btn btn-primary" onClick={onNewOrder}>
              <RotateCcw size={16} /> Start a New Order
            </button>
          </div>
        )}

        {/* STATE: NEEDS_REVIEW */}
        {order.status === 'needs_review' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <div className="alert-banner alert-warning" style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
              <AlertCircle size={24} style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700 }}>Order Marked for Review</div>
                <div style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}>
                  {order.reviewReason === 'AMOUNT_MISMATCH' && (
                    <span>The received payment amount did not match the order total ({formatPaise(order.totalPaise)}).</span>
                  )}
                  {order.reviewReason === 'PAYMENT_RECEIVED_AFTER_EXPIRY' && (
                    <span>Payment was received after the 120-second hold expired. To prevent overselling, your order is flagged for a full refund.</span>
                  )}
                  {!order.reviewReason && (
                    <span>This transaction requires operator review before locker release.</span>
                  )}
                </div>
              </div>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              A customer service alert has been logged with Reference: <code>{order.id}</code>.
            </p>

            <button className="btn btn-secondary" onClick={onNewOrder}>
              <RotateCcw size={16} /> Return to Counter
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// Client-side HMAC helper for the in-browser simulator buttons
async function computeHmac(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
