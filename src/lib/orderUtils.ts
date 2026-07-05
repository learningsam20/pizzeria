import { Order, OrderItem, OrderWithItems, AppSettings } from '../types';
import { calcBillTotals, DEFAULT_APP_SETTINGS } from './appSettings';

/** UI status: ready + served_at → ready_to_bill (DB may still say `ready`). */
export function orderDisplayStatus(order: Pick<Order, 'status' | 'served_at'>): Order['status'] {
  if (order.status === 'ready' && order.served_at) return 'ready_to_bill';
  return order.status;
}

export function isActiveOrder(order: Pick<Order, 'status'>): boolean {
  return order.status !== 'delivered' && order.status !== 'cancelled';
}

export function calcOrderTotals(
  subtotal: number,
  pizzaQty: number,
  settings: AppSettings = DEFAULT_APP_SETTINGS
) {
  return calcBillTotals(subtotal, pizzaQty, settings);
}

export function formatBillRows(items: Pick<OrderItem, 'name' | 'quantity' | 'unit_price_snapshot'>[]) {
  return items.map(i => ({
    label: `${i.name} ×${i.quantity}`,
    amount: Number(i.unit_price_snapshot) * i.quantity,
  }));
}

export function billSummaryLines(order: Pick<OrderWithItems, 'items' | 'subtotal' | 'discount' | 'gst' | 'total_payable'>) {
  return {
    rows: formatBillRows(order.items),
    subtotal: Number(order.subtotal),
    discount: Number(order.discount),
    gst: Number(order.gst),
    total: Number(order.total_payable),
  };
}
