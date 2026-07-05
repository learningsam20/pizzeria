import React from 'react';

interface BillSummaryProps {
  lineItems: { label: string; amount: number }[];
  subtotal: number;
  discount: number;
  gst: number;
  total: number;
  currency?: string;
  discountLabel?: string;
  gstLabel?: string;
  footerNote?: string;
}

export default function BillSummary({
  lineItems,
  subtotal,
  discount,
  gst,
  total,
  currency = 'INR',
  discountLabel = 'Bulk discount',
  gstLabel = 'GST',
  footerNote,
}: BillSummaryProps) {
  const sym = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : `${currency} `;
  const fmt = (n: number) => `${sym}${n.toFixed(2).padStart(currency === 'INR' ? 8 : 6)}`;

  return (
    <div className="font-mono text-xs bg-noir-panel border border-noir-border rounded-xl p-3 space-y-2">
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-noir-text border-b border-noir-border pb-2">
        <span className="text-noir-dim uppercase text-[9px] tracking-wider">Item</span>
        <span className="text-noir-dim uppercase text-[9px] tracking-wider text-right">Amount</span>
        {lineItems.map((row, i) => (
          <React.Fragment key={i}>
            <span className="truncate pr-2">{row.label}</span>
            <span className="text-right text-noir-gold">{fmt(row.amount)}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-noir-muted">
        <span>Subtotal</span>
        <span className="text-right">{fmt(subtotal)}</span>
        {discount > 0 && (
          <>
            <span className="text-emerald-400">{discountLabel}</span>
            <span className="text-right text-emerald-400">−{fmt(discount).trim()}</span>
          </>
        )}
        <span>{gstLabel}</span>
        <span className="text-right">{fmt(gst)}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 pt-2 border-t border-noir-border text-sm font-bold text-noir-text">
        <span>TOTAL PAYABLE</span>
        <span className="text-right text-noir-gold">{fmt(total)}</span>
      </div>
      {footerNote && <p className="text-[10px] text-noir-dim font-sans pt-1">{footerNote}</p>}
    </div>
  );
}
