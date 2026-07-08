import type { OrderItem, OrderWithItems } from '../types';

export interface OrderComboGroup {
  index: number;
  base: OrderItem | null;
  pizzas: OrderItem[];
  toppings: OrderItem[];
  subtotal: number;
}

export function formatInr(value: number): string {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Reconstruct combo groups from flat order line items (base starts a new combo). */
export function groupOrderItemsIntoCombos(items: OrderItem[]): OrderComboGroup[] {
  if (!items.length) return [];

  const groups: OrderComboGroup[] = [];
  let current: OrderComboGroup | null = null;

  const startCombo = () => {
    current = { index: groups.length + 1, base: null, pizzas: [], toppings: [], subtotal: 0 };
    groups.push(current);
  };

  for (const item of items) {
    if (item.category === 'base' || !current) {
      startCombo();
    }
    if (item.category === 'base') current!.base = item;
    else if (item.category === 'pizza') current!.pizzas.push(item);
    else current!.toppings.push(item);
    current!.subtotal += Number(item.unit_price_snapshot) * item.quantity;
  }

  return groups;
}

export function comboGroupLabel(group: OrderComboGroup): string {
  const parts: string[] = [];
  if (group.base) parts.push(group.base.name);
  group.pizzas.forEach(p => parts.push(`${p.name} ×${p.quantity}`));
  group.toppings.forEach(t => parts.push(`+ ${t.name} ×${t.quantity}`));
  return parts.join(' · ') || `Combo ${group.index}`;
}

export function formatOrderLogBlock(order: OrderWithItems, opts?: { statusLabel?: string; timestamp?: string }): string {
  const ts = opts?.timestamp || order.delivered_at || order.cancelled_at || order.updated_at || order.created_at;
  const dt = new Date(ts);
  const tsIst = dt.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const status = opts?.statusLabel || (order.status === 'delivered' ? 'PAID / DELIVERED' : order.status.toUpperCase());
  const divider = '─'.repeat(80);
  const combos = groupOrderItemsIntoCombos(order.items);

  const comboLines: string[] = [];
  if (combos.length) {
    combos.forEach(group => {
      comboLines.push(`  Combo ${group.index}: ${comboGroupLabel(group)}`);
      comboLines.push(`           Subtotal ₹${formatInr(group.subtotal)}`);
      if (group.base) {
        comboLines.push(`     • Base: ${group.base.name}  ₹${formatInr(Number(group.base.unit_price_snapshot))}`);
      }
      group.pizzas.forEach(p => {
        comboLines.push(`     • ${p.name}  ×${p.quantity}  @ ₹${formatInr(Number(p.unit_price_snapshot))}  →  ₹${formatInr(Number(p.unit_price_snapshot) * p.quantity)}`);
      });
      group.toppings.forEach(t => {
        comboLines.push(`     • + ${t.name}  ×${t.quantity}  @ ₹${formatInr(Number(t.unit_price_snapshot))}  →  ₹${formatInr(Number(t.unit_price_snapshot) * t.quantity)}`);
      });
      comboLines.push('');
    });
  } else {
    order.items.forEach((item, idx) => {
      const lineTotal = Number(item.unit_price_snapshot) * item.quantity;
      comboLines.push(`  ${String(idx + 1).padStart(2)}. ${item.name.padEnd(26).slice(0, 26)}  ×${item.quantity}  @ ₹${formatInr(Number(item.unit_price_snapshot))}  →  ₹${formatInr(lineTotal)}`);
    });
  }

  return [
    divider,
    ` ORDER #${order.id}  ·  ${status}  ·  ${tsIst} IST`,
    divider,
    ` Customer     ${order.customer_name || 'Guest'}`,
    ` Phone        ${order.customer_phone || '—'}`,
    ` Table        ${order.table_name}`,
    ` Staff        ${order.staff_name?.trim() || 'Unassigned'}`,
    ` Payment      ${order.payment_mode}`,
    ` Source       ${order.order_source}`,
    order.cancellation_reason ? ` Cancel reason ${order.cancellation_reason}` : null,
    '',
    combos.length ? ' Combos' : ' Line items',
    ...comboLines,
    ' Bill summary',
    `   Subtotal .............. ₹${formatInr(Number(order.subtotal))}`,
    `   Bulk discount ......... ₹${formatInr(Number(order.discount))}`,
    `   GST ................... ₹${formatInr(Number(order.gst))}`,
    `   TOTAL PAYABLE ......... ₹${formatInr(Number(order.total_payable))}`,
    divider,
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export function formatOrdersExportDocument(orders: OrderWithItems[], title = 'ALL ORDERS EXPORT'): string {
  const header = [
    '='.repeat(80),
    ` SLICE OF HEAVEN PIZZERIA — ${title}`,
    ` Exported: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
    ` Total orders: ${orders.length}`,
    '='.repeat(80),
    '',
  ].join('\n');

  const blocks = orders.map(o => {
    const label =
      o.status === 'delivered' ? 'PAID / DELIVERED'
        : o.status === 'cancelled' ? 'CANCELLED'
          : o.status.toUpperCase();
    return formatOrderLogBlock(o, { statusLabel: label, timestamp: o.updated_at || o.created_at });
  });

  return header + blocks.join('\n');
}

export function filterOrdersForSearch(orders: OrderWithItems[], query: string): OrderWithItems[] {
  const q = query.trim().toLowerCase();
  if (!q) return orders;
  return orders.filter(o => {
    const hay = [
      String(o.id),
      o.customer_name,
      o.customer_phone,
      o.table_name,
      o.status,
      o.payment_mode,
      o.staff_name,
      ...o.items.map(i => i.name),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}
