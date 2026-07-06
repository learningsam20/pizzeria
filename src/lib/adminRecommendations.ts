import type { Customer, DineInTable, OrderWithItems } from '../types';
import { groupOrderItemsIntoCombos } from './orderFormat';

export interface AdminRecommendation {
  id: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  action: string;
}

export function buildAdminRecommendations(
  orders: OrderWithItems[],
  tables: DineInTable[],
  customers: Customer[]
): AdminRecommendation[] {
  const recs: AdminRecommendation[] = [];
  const active = orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled');
  const delivered = orders.filter(o => o.status === 'delivered');
  const cancelled = orders.filter(o => o.status === 'cancelled');
  const inUse = tables.filter(t => t.is_in_use);
  const free = tables.filter(t => !t.is_in_use);

  const occupancyPct = tables.length ? Math.round((inUse.length / tables.length) * 100) : 0;

  if (occupancyPct >= 85) {
    recs.push({
      id: 'occ-high',
      priority: 'high',
      title: 'High table occupancy',
      detail: `${inUse.length} of ${tables.length} tables are marked in use (${occupancyPct}%).`,
      action: 'Review kitchen queue; consider pacing new confirmations or freeing completed tables promptly.',
    });
  } else if (occupancyPct <= 25 && tables.length > 0) {
    recs.push({
      id: 'occ-low',
      priority: 'low',
      title: 'Low dine-in occupancy',
      detail: `Only ${inUse.length} tables in use. ${free.length} tables available.`,
      action: 'Promote QR ordering at empty tables; verify table usage flags match reality.',
    });
  }

  if (active.length >= 8) {
    recs.push({
      id: 'queue-deep',
      priority: 'high',
      title: 'Deep open order queue',
      detail: `${active.length} orders still open (confirmed through ready-to-bill).`,
      action: 'Add kitchen capacity or pause new order intake until queue clears.',
    });
  }

  const confirmedStale = active.filter(o => {
    if (o.status !== 'confirmed') return false;
    const ageMs = Date.now() - new Date(o.created_at).getTime();
    return ageMs > 15 * 60 * 1000;
  });
  if (confirmedStale.length) {
    recs.push({
      id: 'stale-confirmed',
      priority: 'high',
      title: 'Orders waiting to start cooking',
      detail: `${confirmedStale.length} confirmed order(s) older than 15 minutes.`,
      action: `Move order #${confirmedStale[0].id} and others to Preparing in Staff Kitchen.`,
    });
  }

  const cancelRate = orders.length ? (cancelled.length / orders.length) * 100 : 0;
  if (cancelRate >= 10 && cancelled.length >= 3) {
    recs.push({
      id: 'cancel-rate',
      priority: 'medium',
      title: 'Elevated cancellation rate',
      detail: `${cancelRate.toFixed(1)}% of orders cancelled (${cancelled.length} total).`,
      action: 'Review cancellation reasons in Admin → Orders; address recurring issues at tables.',
    });
  }

  const itemFreq: Record<string, number> = {};
  delivered.forEach(o => o.items.filter(i => i.category === 'pizza').forEach(i => {
    itemFreq[i.name] = (itemFreq[i.name] || 0) + i.quantity;
  }));
  const topPizza = Object.entries(itemFreq).sort((a, b) => b[1] - a[1])[0];
  if (topPizza) {
    recs.push({
      id: 'top-pizza',
      priority: 'low',
      title: `Best seller: ${topPizza[0]}`,
      detail: `${topPizza[1]} pizzas sold across delivered orders.`,
      action: 'Ensure ingredients stocked; consider featuring this pizza on table QR landing.',
    });
  }

  const hourBuckets: Record<number, number> = {};
  delivered.forEach(o => {
    const h = new Date(o.delivered_at || o.created_at).getHours();
    hourBuckets[h] = (hourBuckets[h] || 0) + 1;
  });
  const peakHour = Object.entries(hourBuckets).sort((a, b) => b[1] - a[1])[0];
  if (peakHour && Number(peakHour[1]) >= 3) {
    recs.push({
      id: 'peak-hour',
      priority: 'medium',
      title: `Peak hour around ${peakHour[0].padStart(2, '0')}:00`,
      detail: `${peakHour[1]} delivered orders in that hour block.`,
      action: 'Schedule extra staff 30 minutes before peak; pre-prep popular bases.',
    });
  }

  const repeatCustomers = customers.filter(c => {
    const count = orders.filter(o => o.customer_id === c.id && o.status === 'delivered').length;
    return count >= 2;
  });
  if (repeatCustomers.length) {
    recs.push({
      id: 'repeat-cust',
      priority: 'low',
      title: `${repeatCustomers.length} repeat customer(s)`,
      detail: 'Customers with 2+ delivered orders in the system.',
      action: 'Consider loyalty messaging or bulk discount reminders for returning guests.',
    });
  }

  const tablesWithMultipleActive = inUse.filter(t =>
    active.filter(o => o.table_name === t.table_name).length >= 2
  );
  if (tablesWithMultipleActive.length) {
    recs.push({
      id: 'multi-active',
      priority: 'medium',
      title: 'Tables with multiple open orders',
      detail: tablesWithMultipleActive.map(t => t.table_name).join(', '),
      action: 'Verify table assignment; merge or sequence orders to avoid service confusion.',
    });
  }

  const avgItems = delivered.length
    ? delivered.reduce((s, o) => s + groupOrderItemsIntoCombos(o.items).length, 0) / delivered.length
    : 0;
  if (avgItems >= 2) {
    recs.push({
      id: 'multi-combo',
      priority: 'low',
      title: 'Customers order multiple combos',
      detail: `Average ${avgItems.toFixed(1)} combos per delivered order.`,
      action: 'Highlight combo deals in voice assistant and menu chips.',
    });
  }

  if (!recs.length) {
    recs.push({
      id: 'all-clear',
      priority: 'low',
      title: 'Operations look healthy',
      detail: 'No urgent issues detected from current order, table, and customer data.',
      action: 'Keep monitoring Analytics and the Orders tab during service hours.',
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}
