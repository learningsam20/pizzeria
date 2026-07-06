import React from 'react';
import type { OrderItem } from '../types';
import { comboGroupLabel, formatInr, groupOrderItemsIntoCombos } from '../lib/orderFormat';

interface OrderCombosDisplayProps {
  items: OrderItem[];
  compact?: boolean;
}

export default function OrderCombosDisplay({ items, compact = false }: OrderCombosDisplayProps) {
  const groups = groupOrderItemsIntoCombos(items);

  if (!groups.length) {
    return <p className="text-xs text-noir-dim italic">No items</p>;
  }

  if (compact) {
    return (
      <div className="space-y-1">
        {groups.map(g => (
          <div key={g.index} className="text-xs text-noir-text">
            <span className="text-noir-gold font-semibold">Combo {g.index}</span>
            <span className="text-noir-muted"> — {comboGroupLabel(g)}</span>
            <span className="text-noir-dim font-mono ml-1">₹{formatInr(g.subtotal)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map(g => (
        <div key={g.index} className="rounded-lg border border-noir-border bg-noir-panel/60 p-2.5">
          <div className="flex justify-between items-start gap-2 mb-1.5">
            <p className="text-xs font-semibold text-noir-gold">Combo {g.index}</p>
            <p className="text-xs font-mono text-noir-muted">₹{formatInr(g.subtotal)}</p>
          </div>
          <ul className="space-y-0.5 text-xs text-noir-text">
            {g.base && (
              <li className="flex justify-between gap-2">
                <span><span className="text-noir-dim uppercase text-[9px] mr-1">Base</span>{g.base.name}</span>
                <span className="font-mono text-noir-muted shrink-0">₹{formatInr(Number(g.base.unit_price_snapshot))}</span>
              </li>
            )}
            {g.pizzas.map(p => (
              <li key={p.id} className="flex justify-between gap-2">
                <span><span className="text-noir-gold font-semibold mr-1">×{p.quantity}</span>{p.name}</span>
                <span className="font-mono text-noir-muted shrink-0">₹{formatInr(Number(p.unit_price_snapshot) * p.quantity)}</span>
              </li>
            ))}
            {g.toppings.map(t => (
              <li key={t.id} className="flex justify-between gap-2 text-noir-muted">
                <span><span className="text-noir-gold font-semibold mr-1">+{t.quantity}</span>{t.name}</span>
                <span className="font-mono shrink-0">₹{formatInr(Number(t.unit_price_snapshot) * t.quantity)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
