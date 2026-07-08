import { Receipt, X } from 'lucide-react';
import type { OrderWithItems } from '../types';
import { billSummaryLines, getOrderStaffLabel } from '../lib/orderUtils';
import BillSummary from './BillSummary';
import OrderCombosDisplay from './OrderCombosDisplay';

interface OrderBillModalProps {
  order: OrderWithItems;
  currency?: string;
  onClose: () => void;
}

export default function OrderBillModal({ order, currency = 'INR', onClose }: OrderBillModalProps) {
  const bill = billSummaryLines(order);
  const statusLabel = order.status.replace(/_/g, ' ');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--noir-overlay)]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-noir-card border border-noir-border rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-labelledby="order-bill-title"
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-noir-border">
          <div>
            <h3 id="order-bill-title" className="text-lg font-serif text-noir-gold flex items-center gap-2">
              <Receipt className="w-5 h-5 icon-noir" /> Bill — Order #{order.id}
            </h3>
            <p className="text-xs text-noir-muted mt-1">
              {order.table_name} · {order.customer_name || 'Guest'}
              {order.customer_phone ? ` · ${order.customer_phone}` : ''}
            </p>
            <p className="text-xs text-noir-muted mt-0.5">
              Staff: <span className="text-noir-text font-medium">{getOrderStaffLabel(order)}</span>
            </p>
            <p className="text-[10px] text-noir-dim font-mono mt-1 uppercase tracking-wide">
              {statusLabel} · {order.payment_mode} · {new Date(order.created_at).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg border border-noir-border bg-noir-panel hover:bg-noir-highlight text-noir-muted hover:text-noir-text cursor-pointer"
            aria-label="Close bill"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <p className="text-[10px] font-semibold text-noir-dim uppercase tracking-wider mb-2">Items</p>
            <OrderCombosDisplay items={order.items} />
          </div>

          <BillSummary
            lineItems={bill.rows}
            subtotal={bill.subtotal}
            discount={bill.discount}
            gst={bill.gst}
            total={bill.total}
            currency={order.currency || currency}
            footerNote={order.payment_mode ? `Payment mode: ${order.payment_mode}` : undefined}
          />
        </div>
      </div>
    </div>
  );
}
