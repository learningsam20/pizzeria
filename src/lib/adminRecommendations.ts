import type { Customer, DineInTable, MenuItem, OrderWithItems, Profile } from '../types';

export type RecommendationCategory =
  | 'temporal'
  | 'table'
  | 'sales'
  | 'staff'
  | 'cancellation'
  | 'operations'
  | 'customer';

export type ImpactArea = 'delivery_time' | 'satisfaction' | 'revenue' | 'efficiency';

export interface RecommendationImpact {
  area: ImpactArea;
  direction: 'improve' | 'risk' | 'neutral';
  magnitude: 'high' | 'medium' | 'low';
  summary: string;
}

export interface AdminRecommendation {
  id: string;
  source: 'analytics' | 'ai';
  category: RecommendationCategory;
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  action: string;
  rationale?: string;
  impacts: RecommendationImpact[];
  evidence?: string;
}

export interface RecommendationAnalyticsSnapshot {
  generatedAt: string;
  season: string;
  monthLabel: string;
  summary: {
    totalOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
    activeOrders: number;
    totalRevenue: number;
    avgOrderValue: number;
    cancelRatePct: number;
    avgQueueMinutes: number | null;
    avgPrepMinutes: number | null;
    avgServeMinutes: number | null;
    avgTotalDeliveryMinutes: number | null;
  };
  dayOfWeek: { day: string; orders: number; revenue: number; sharePct: number }[];
  hourOfDay: { hour: string; orders: number; revenue: number; avgDeliveryMin: number | null }[];
  tableInsights: {
    table: string;
    orders: number;
    revenue: number;
    topPizzas: string[];
    topToppings: string[];
    cancelRatePct: number;
  }[];
  sales: {
    topPizzas: { name: string; qty: number; revenue: number }[];
    topToppings: { name: string; qty: number; revenue: number }[];
    topBases: { name: string; qty: number; revenue: number }[];
    trendingUp: { name: string; category: string; recentQty: number; priorQty: number; changePct: number }[];
    trendingDown: { name: string; category: string; recentQty: number; priorQty: number; changePct: number }[];
  };
  staff: {
    id: string;
    name: string;
    ordersDelivered: number;
    avgPrepMinutes: number | null;
    cancellationsOnShift: number;
    avgTotalDeliveryMinutes: number | null;
  }[];
  cancellations: {
    total: number;
    ratePct: number;
    topReasons: { reason: string; count: number }[];
    byTable: { table: string; count: number }[];
    avgMinutesToCancel: number | null;
    lostRevenue: number;
  };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function seasonLabel(date: Date): string {
  const m = date.getMonth();
  if (m >= 2 && m <= 4) return 'Spring (Mar–May)';
  if (m >= 5 && m <= 7) return 'Summer (Jun–Aug)';
  if (m >= 8 && m <= 10) return 'Monsoon/Autumn (Sep–Nov)';
  return 'Winter (Dec–Feb)';
}

function minutesBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return null;
  return ms / 60000;
}

function avg(nums: (number | null)[]): number | null {
  const valid = nums.filter((n): n is number => n != null && Number.isFinite(n));
  if (!valid.length) return null;
  return valid.reduce((s, n) => s + n, 0) / valid.length;
}

function itemQtyByCategory(orders: OrderWithItems[], category: string): Record<string, { qty: number; revenue: number }> {
  const map: Record<string, { qty: number; revenue: number }> = {};
  for (const o of orders) {
    for (const item of o.items.filter(i => i.category === category)) {
      if (!map[item.name]) map[item.name] = { qty: 0, revenue: 0 };
      map[item.name].qty += item.quantity;
      map[item.name].revenue += Number(item.unit_price_snapshot) * item.quantity;
    }
  }
  return map;
}

function topEntries(map: Record<string, { qty: number; revenue: number }>, limit = 5) {
  return Object.entries(map)
    .map(([name, v]) => ({ name, qty: v.qty, revenue: Number(v.revenue.toFixed(2)) }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit);
}

function splitRecentPrior<T extends { created_at: string }>(items: T[], recentDays = 14): { recent: T[]; prior: T[] } {
  if (items.length < 4) {
    const mid = Math.floor(items.length / 2);
    return { recent: items.slice(0, mid), prior: items.slice(mid) };
  }
  const cutoff = Date.now() - recentDays * 86400000;
  const recent = items.filter(i => new Date(i.created_at).getTime() >= cutoff);
  const prior = items.filter(i => new Date(i.created_at).getTime() < cutoff);
  if (!recent.length || !prior.length) {
    const sorted = [...items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const mid = Math.floor(sorted.length / 2);
    return { recent: sorted.slice(mid), prior: sorted.slice(0, mid) };
  }
  return { recent, prior };
}

function pctChange(recent: number, prior: number): number {
  if (prior === 0) return recent > 0 ? 100 : 0;
  return Math.round(((recent - prior) / prior) * 100);
}

function impact(
  area: ImpactArea,
  direction: RecommendationImpact['direction'],
  magnitude: RecommendationImpact['magnitude'],
  summary: string
): RecommendationImpact {
  return { area, direction, magnitude, summary };
}

export function buildRecommendationAnalytics(
  orders: OrderWithItems[],
  tables: DineInTable[],
  customers: Customer[],
  profiles: Profile[],
  _menuItems: MenuItem[] = []
): RecommendationAnalyticsSnapshot {
  const now = new Date();
  const delivered = orders.filter(o => o.status === 'delivered');
  const cancelled = orders.filter(o => o.status === 'cancelled');
  const active = orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled');
  const totalRevenue = delivered.reduce((s, o) => s + Number(o.total_payable), 0);

  const queueMins = delivered.map(o => minutesBetween(o.created_at, o.cooking_started_at));
  const prepMins = delivered.map(o => minutesBetween(o.cooking_started_at, o.ready_at));
  const serveMins = delivered.map(o => minutesBetween(o.ready_at, o.delivered_at));
  const totalDelMins = delivered.map(o => minutesBetween(o.created_at, o.delivered_at));

  const dayBuckets: Record<number, { orders: number; revenue: number }> = {};
  for (let d = 0; d < 7; d++) dayBuckets[d] = { orders: 0, revenue: 0 };
  for (const o of delivered) {
    const d = new Date(o.delivered_at || o.created_at).getDay();
    dayBuckets[d].orders++;
    dayBuckets[d].revenue += Number(o.total_payable);
  }
  const totalDelivered = delivered.length || 1;
  const dayOfWeek = DAY_NAMES.map((day, idx) => ({
    day,
    orders: dayBuckets[idx].orders,
    revenue: Number(dayBuckets[idx].revenue.toFixed(2)),
    sharePct: Math.round((dayBuckets[idx].orders / totalDelivered) * 100),
  }));

  const hourBuckets: Record<number, { orders: number; revenue: number; deliveryTimes: number[] }> = {};
  for (let h = 0; h < 24; h++) hourBuckets[h] = { orders: 0, revenue: 0, deliveryTimes: [] };
  for (const o of delivered) {
    const h = new Date(o.delivered_at || o.created_at).getHours();
    hourBuckets[h].orders++;
    hourBuckets[h].revenue += Number(o.total_payable);
    const td = minutesBetween(o.created_at, o.delivered_at);
    if (td != null) hourBuckets[h].deliveryTimes.push(td);
  }
  const hourOfDay = Object.entries(hourBuckets)
    .map(([h, v]) => ({
      hour: `${h.padStart(2, '0')}:00`,
      orders: v.orders,
      revenue: Number(v.revenue.toFixed(2)),
      avgDeliveryMin: avg(v.deliveryTimes) != null ? Number(avg(v.deliveryTimes)!.toFixed(1)) : null,
    }))
    .filter(h => h.orders > 0);

  const tableNames = [...new Set([...tables.map(t => t.table_name), ...orders.map(o => o.table_name)])];
  const tableInsights = tableNames.map(table => {
    const tableOrders = orders.filter(o => o.table_name === table);
    const tableDelivered = tableOrders.filter(o => o.status === 'delivered');
    const tableCancelled = tableOrders.filter(o => o.status === 'cancelled');
    const pizzaMap = itemQtyByCategory(tableDelivered, 'pizza');
    const toppingMap = itemQtyByCategory(tableDelivered, 'topping');
    return {
      table,
      orders: tableOrders.length,
      revenue: Number(tableDelivered.reduce((s, o) => s + Number(o.total_payable), 0).toFixed(2)),
      topPizzas: topEntries(pizzaMap, 3).map(p => p.name),
      topToppings: topEntries(toppingMap, 3).map(t => t.name),
      cancelRatePct: tableOrders.length ? Math.round((tableCancelled.length / tableOrders.length) * 100) : 0,
    };
  }).filter(t => t.orders > 0).sort((a, b) => b.orders - a.orders);

  const { recent: recentDelivered, prior: priorDelivered } = splitRecentPrior(delivered);
  const recentPizzaMap = itemQtyByCategory(recentDelivered, 'pizza');
  const priorPizzaMap = itemQtyByCategory(priorDelivered, 'pizza');
  const allItemNames = new Set([...Object.keys(recentPizzaMap), ...Object.keys(priorPizzaMap),
    ...Object.keys(itemQtyByCategory(recentDelivered, 'topping')), ...Object.keys(itemQtyByCategory(priorDelivered, 'topping'))]);

  const trends: { name: string; category: string; recentQty: number; priorQty: number; changePct: number }[] = [];
  for (const name of allItemNames) {
    const cat = recentPizzaMap[name] || priorPizzaMap[name] ? 'pizza' : 'topping';
    const rMap = cat === 'pizza' ? recentPizzaMap : itemQtyByCategory(recentDelivered, 'topping');
    const pMap = cat === 'pizza' ? priorPizzaMap : itemQtyByCategory(priorDelivered, 'topping');
    const recentQty = rMap[name]?.qty || 0;
    const priorQty = pMap[name]?.qty || 0;
    if (recentQty + priorQty >= 2) {
      trends.push({ name, category: cat, recentQty, priorQty, changePct: pctChange(recentQty, priorQty) });
    }
  }
  trends.sort((a, b) => b.changePct - a.changePct);

  const reasonMap: Record<string, number> = {};
  for (const o of cancelled) {
    const r = (o.cancellation_reason || 'Unspecified').trim();
    reasonMap[r] = (reasonMap[r] || 0) + 1;
  }
  const cancelByTable: Record<string, number> = {};
  for (const o of cancelled) {
    cancelByTable[o.table_name] = (cancelByTable[o.table_name] || 0) + 1;
  }
  const cancelTimes = cancelled.map(o => minutesBetween(o.created_at, o.cancelled_at || o.updated_at));

  const staffMap: Record<string, {
    ordersDelivered: number;
    prepTimes: number[];
    cancelCount: number;
    deliveryTimes: number[];
  }> = {};
  for (const o of delivered) {
    if (!o.staff_id) continue;
    if (!staffMap[o.staff_id]) staffMap[o.staff_id] = { ordersDelivered: 0, prepTimes: [], cancelCount: 0, deliveryTimes: [] };
    staffMap[o.staff_id].ordersDelivered++;
    const prep = minutesBetween(o.cooking_started_at, o.ready_at);
    if (prep != null) staffMap[o.staff_id].prepTimes.push(prep);
    const td = minutesBetween(o.created_at, o.delivered_at);
    if (td != null) staffMap[o.staff_id].deliveryTimes.push(td);
  }
  for (const o of cancelled) {
    if (!o.staff_id) continue;
    if (!staffMap[o.staff_id]) staffMap[o.staff_id] = { ordersDelivered: 0, prepTimes: [], cancelCount: 0, deliveryTimes: [] };
    staffMap[o.staff_id].cancelCount++;
  }

  const staff = Object.entries(staffMap).map(([id, s]) => {
    const p = profiles.find(x => x.id === id);
    return {
      id,
      name: p?.display_name || p?.email || 'Staff',
      ordersDelivered: s.ordersDelivered,
      avgPrepMinutes: avg(s.prepTimes) != null ? Number(avg(s.prepTimes)!.toFixed(1)) : null,
      cancellationsOnShift: s.cancelCount,
      avgTotalDeliveryMinutes: avg(s.deliveryTimes) != null ? Number(avg(s.deliveryTimes)!.toFixed(1)) : null,
    };
  }).sort((a, b) => b.ordersDelivered - a.ordersDelivered);

  void customers;

  return {
    generatedAt: now.toISOString(),
    season: seasonLabel(now),
    monthLabel: now.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
    summary: {
      totalOrders: orders.length,
      deliveredOrders: delivered.length,
      cancelledOrders: cancelled.length,
      activeOrders: active.length,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      avgOrderValue: delivered.length ? Number((totalRevenue / delivered.length).toFixed(2)) : 0,
      cancelRatePct: orders.length ? Number(((cancelled.length / orders.length) * 100).toFixed(1)) : 0,
      avgQueueMinutes: avg(queueMins) != null ? Number(avg(queueMins)!.toFixed(1)) : null,
      avgPrepMinutes: avg(prepMins) != null ? Number(avg(prepMins)!.toFixed(1)) : null,
      avgServeMinutes: avg(serveMins) != null ? Number(avg(serveMins)!.toFixed(1)) : null,
      avgTotalDeliveryMinutes: avg(totalDelMins) != null ? Number(avg(totalDelMins)!.toFixed(1)) : null,
    },
    dayOfWeek,
    hourOfDay,
    tableInsights,
    sales: {
      topPizzas: topEntries(itemQtyByCategory(delivered, 'pizza')),
      topToppings: topEntries(itemQtyByCategory(delivered, 'topping')),
      topBases: topEntries(itemQtyByCategory(delivered, 'base')),
      trendingUp: trends.filter(t => t.changePct > 15).slice(0, 5),
      trendingDown: trends.filter(t => t.changePct < -15).sort((a, b) => a.changePct - b.changePct).slice(0, 5),
    },
    staff,
    cancellations: {
      total: cancelled.length,
      ratePct: orders.length ? Number(((cancelled.length / orders.length) * 100).toFixed(1)) : 0,
      topReasons: Object.entries(reasonMap).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      byTable: Object.entries(cancelByTable).map(([table, count]) => ({ table, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      avgMinutesToCancel: avg(cancelTimes) != null ? Number(avg(cancelTimes)!.toFixed(1)) : null,
      lostRevenue: Number(cancelled.reduce((s, o) => s + Number(o.total_payable), 0).toFixed(2)),
    },
  };
}

export function buildAdminRecommendations(
  orders: OrderWithItems[],
  tables: DineInTable[],
  customers: Customer[],
  profiles: Profile[] = [],
  menuItems: MenuItem[] = []
): AdminRecommendation[] {
  const snapshot = buildRecommendationAnalytics(orders, tables, customers, profiles, menuItems);
  const recs: AdminRecommendation[] = [];
  const { summary, dayOfWeek, hourOfDay, tableInsights, sales, staff, cancellations } = snapshot;
  const active = orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled');
  const inUse = tables.filter(t => t.is_in_use);

  const push = (rec: Omit<AdminRecommendation, 'source'> & { source?: 'analytics' }) => {
    recs.push({ source: 'analytics', ...rec });
  };

  // ── Temporal: day of week ──
  const peakDay = [...dayOfWeek].sort((a, b) => b.orders - a.orders)[0];
  const quietDay = [...dayOfWeek].filter(d => d.orders > 0).sort((a, b) => a.orders - b.orders)[0];
  if (peakDay && peakDay.orders >= 2) {
    push({
      id: 'peak-day',
      category: 'temporal',
      priority: peakDay.sharePct >= 25 ? 'high' : 'medium',
      title: `${peakDay.day} is your busiest day`,
      detail: `${peakDay.orders} delivered orders (${peakDay.sharePct}% of volume) · ₹${peakDay.revenue.toLocaleString('en-IN')} revenue historically.`,
      rationale: `${snapshot.monthLabel} falls in ${snapshot.season} — consider aligning prep and staffing with weekday patterns.`,
      action: `Pre-stock top pizzas before ${peakDay.day} service; run a mid-week promo on ${quietDay?.day || 'quieter days'} to flatten demand.`,
      evidence: `Day-of-week distribution across ${summary.deliveredOrders} delivered orders`,
      impacts: [
        impact('revenue', 'improve', 'medium', `Up to ${Math.min(peakDay.sharePct, 20)}% revenue lift if peak-day capacity is optimized`),
        impact('delivery_time', 'improve', 'medium', '15–25% shorter waits on peak day with pre-prep'),
        impact('satisfaction', 'improve', 'low', 'Fewer stock-outs and delays on busiest day'),
      ],
    });
  }

  // ── Temporal: hour of day ──
  const peakHour = [...hourOfDay].sort((a, b) => b.orders - a.orders)[0];
  const slowHour = hourOfDay.length > 1 ? [...hourOfDay].sort((a, b) => a.orders - b.orders)[0] : null;
  if (peakHour && peakHour.orders >= 2) {
    const slowLabel = slowHour && slowHour.hour !== peakHour.hour
      ? ` Quietest slot: ${slowHour.hour} (${slowHour.orders} orders).`
      : '';
    push({
      id: 'peak-hour',
      category: 'temporal',
      priority: 'medium',
      title: `Rush window: ${peakHour.hour}–${String(Number(peakHour.hour.slice(0, 2)) + 1).padStart(2, '0')}:00`,
      detail: `${peakHour.orders} orders · ₹${peakHour.revenue.toLocaleString('en-IN')}.${slowLabel}${peakHour.avgDeliveryMin != null ? ` Avg delivery ${peakHour.avgDeliveryMin} min in this slot.` : ''}`,
      rationale: 'Kitchen load spikes compress queue time; historic hour data shows when guests actually receive food.',
      action: `Staff up 30 min before ${peakHour.hour}; pre-fire popular bases; use ${slowHour?.hour || 'off-peak'} for prep and cleaning.`,
      evidence: 'Hourly order and delivery-time buckets',
      impacts: [
        impact('delivery_time', 'improve', 'high', '20–30% faster turnaround during rush with staggered prep'),
        impact('efficiency', 'improve', 'medium', 'Better labour utilization across the day'),
        impact('satisfaction', 'improve', 'medium', 'Lower wait frustration at peak'),
      ],
    });
  }

  // ── Table preferences ──
  for (const t of tableInsights.filter(ti => ti.orders >= 2 && ti.topPizzas.length).slice(0, 3)) {
    push({
      id: `table-pref-${t.table.replace(/\s+/g, '-')}`,
      category: 'table',
      priority: 'low',
      title: `${t.table} favors ${t.topPizzas[0]}`,
      detail: `${t.orders} orders · top picks: ${t.topPizzas.join(', ')}${t.topToppings.length ? ` · toppings: ${t.topToppings.join(', ')}` : ''}.`,
      rationale: 'Repeat dine-in patterns by table help tailor QR suggestions and server upsells.',
      action: `Feature ${t.topPizzas[0]} on ${t.table} QR landing; train staff to suggest ${t.topToppings[0] || 'popular add-ons'} at this table.`,
      evidence: `${t.table} order history`,
      impacts: [
        impact('revenue', 'improve', 'low', '5–10% higher attach rate on targeted upsell'),
        impact('satisfaction', 'improve', 'low', 'Guests see favorites quickly'),
      ],
    });
  }

  const highCancelTables = tableInsights.filter(t => t.cancelRatePct >= 20 && t.orders >= 2);
  for (const t of highCancelTables.slice(0, 2)) {
    push({
      id: `table-cancel-${t.table.replace(/\s+/g, '-')}`,
      category: 'table',
      priority: 'high',
      title: `${t.table} has ${t.cancelRatePct}% cancellations`,
      detail: `${t.orders} total orders with elevated cancel rate vs store average ${summary.cancelRatePct}%.`,
      action: `Audit service flow at ${t.table}; check QR clarity, wait times, and staff coverage.`,
      rationale: 'Table-level cancel clustering often signals seating, communication, or timing issues.',
      impacts: [
        impact('satisfaction', 'improve', 'high', 'Recover guest confidence at problem tables'),
        impact('revenue', 'improve', 'medium', `Protect ~₹${Math.round(t.revenue * (t.cancelRatePct / 100))} at-risk revenue`),
        impact('delivery_time', 'improve', 'low', 'Fewer re-fires from confused orders'),
      ],
    });
  }

  // ── Sales & menu ──
  if (sales.topPizzas[0]) {
    const top = sales.topPizzas[0];
    push({
      id: 'top-pizza',
      category: 'sales',
      priority: 'medium',
      title: `Hot seller: ${top.name}`,
      detail: `${top.qty} units · ₹${top.revenue.toLocaleString('en-IN')} revenue across delivered orders.`,
      rationale: `${snapshot.season} menus often skew toward comfort/spicy profiles — validate stock for your #1 pizza.`,
      action: `Never 86 ${top.name}; bundle with top topping ${sales.topToppings[0]?.name || 'add-ons'} in voice assistant.`,
      impacts: [
        impact('revenue', 'improve', 'medium', 'Protect majority of pizza-line revenue'),
        impact('satisfaction', 'improve', 'medium', 'Avoid disappointment from stock-outs'),
      ],
    });
  }

  for (const t of sales.trendingUp.slice(0, 2)) {
    push({
      id: `trend-up-${t.name.replace(/\s+/g, '-')}`,
      category: 'sales',
      priority: 'medium',
      title: `Rising demand: ${t.name} (+${t.changePct}%)`,
      detail: `Recent period: ${t.recentQty} vs prior ${t.priorQty} (${t.category}).`,
      rationale: `Momentum may reflect ${snapshot.season} tastes, local events, or successful upselling — capitalize while demand climbs.`,
      action: `Increase prep par for ${t.name}; highlight on menu board and combo builder.`,
      impacts: [
        impact('revenue', 'improve', 'medium', `Capture ${t.changePct}% growth trend`),
        impact('efficiency', 'improve', 'low', 'Prep alignment reduces rush-hour delays'),
      ],
    });
  }

  for (const t of sales.trendingDown.slice(0, 2)) {
    push({
      id: `trend-down-${t.name.replace(/\s+/g, '-')}`,
      category: 'sales',
      priority: 'low',
      title: `Cooling item: ${t.name} (${t.changePct}%)`,
      detail: `Recent ${t.recentQty} vs prior ${t.priorQty} — investigate menu fatigue or seasonal shift.`,
      rationale: 'Declining velocity may free prep capacity or signal need for repositioning/promo.',
      action: `Run limited-time combo featuring ${t.name}; review pricing vs ${sales.topPizzas[0]?.name || 'top sellers'}.`,
      impacts: [
        impact('revenue', 'risk', 'low', 'Continued decline without action'),
        impact('efficiency', 'improve', 'low', 'Reduce waste on slow movers'),
      ],
    });
  }

  if (sales.topToppings[0]) {
    const top = sales.topToppings[0];
    push({
      id: 'top-topping',
      category: 'sales',
      priority: 'low',
      title: `Top add-on ingredient: ${top.name}`,
      detail: `${top.qty} portions sold · ₹${top.revenue.toLocaleString('en-IN')}.`,
      action: `Ensure ${top.name} inventory is 2× normal par; suggest in voice order flow after first pizza add.`,
      impacts: [
        impact('revenue', 'improve', 'low', '3–8% attach-rate uplift'),
        impact('satisfaction', 'improve', 'low', 'Consistent topping availability'),
      ],
    });
  }

  // ── Staff ──
  if (staff.length >= 2) {
    const byPrep = staff.filter(s => s.avgPrepMinutes != null).sort((a, b) => (a.avgPrepMinutes || 0) - (b.avgPrepMinutes || 0));
    const fastest = byPrep[0];
    const slowest = byPrep[byPrep.length - 1];
    if (fastest && slowest && fastest.id !== slowest.id && (slowest.avgPrepMinutes || 0) - (fastest.avgPrepMinutes || 0) >= 3) {
      push({
        id: 'staff-prep-gap',
        category: 'staff',
        priority: 'medium',
        title: `Learn from ${fastest.name}'s kitchen pace`,
        detail: `${fastest.name} avg prep ${fastest.avgPrepMinutes} min vs ${slowest.name} at ${slowest.avgPrepMinutes} min (${slowest.ordersDelivered} orders each tracked).`,
        rationale: 'Staff-level prep variance is a training opportunity without blaming individuals publicly.',
        action: `Pair ${slowest.name} with ${fastest.name} during ${peakHour?.hour || 'peak'} shift; document ${fastest.name}'s station setup.`,
        impacts: [
          impact('delivery_time', 'improve', 'high', `Up to ${Math.round((slowest.avgPrepMinutes || 0) - (fastest.avgPrepMinutes || 0))} min faster prep if gap closes`),
          impact('efficiency', 'improve', 'medium', 'Standardized kitchen workflow'),
          impact('satisfaction', 'improve', 'medium', 'More consistent guest experience'),
        ],
      });
    }
  }

  const staffWithCancels = staff.filter(s => s.cancellationsOnShift >= 2);
  for (const s of staffWithCancels.slice(0, 1)) {
    push({
      id: `staff-cancel-${s.id.slice(0, 8)}`,
      category: 'staff',
      priority: 'high',
      title: `Review cancellations linked to ${s.name}`,
      detail: `${s.cancellationsOnShift} cancelled orders associated with this staff member's shifts.`,
      action: 'Review order-taking accuracy and kitchen communication; refresher on order confirmation script.',
      impacts: [
        impact('satisfaction', 'improve', 'high', 'Fewer guest disappointments'),
        impact('revenue', 'improve', 'medium', `Reduce lost revenue from cancels`),
      ],
    });
  }

  // ── Cancellations ──
  if (cancellations.total >= 2) {
    const topReason = cancellations.topReasons[0];
    push({
      id: 'cancel-overview',
      category: 'cancellation',
      priority: cancellations.ratePct >= 10 ? 'high' : 'medium',
      title: `${cancellations.ratePct}% cancellation rate`,
      detail: `${cancellations.total} cancels · ₹${cancellations.lostRevenue.toLocaleString('en-IN')} lost${topReason ? ` · top reason: "${topReason.reason}" (${topReason.count}×)` : ''}.`,
      rationale: cancellations.avgMinutesToCancel != null
        ? `Avg ${cancellations.avgMinutesToCancel} min from order to cancel — often wait-time or order-error driven.`
        : 'Pattern analysis on reasons and tables reveals operational fixes.',
      action: topReason
        ? `Address "${topReason.reason}" root cause; add confirmation step before kitchen for similar cases.`
        : 'Capture structured cancel reasons on every void.',
      impacts: [
        impact('revenue', 'improve', 'high', `Recover up to ${Math.min(cancellations.ratePct, 30)}% of lost sales`),
        impact('satisfaction', 'improve', 'high', 'Trust recovery for affected guests'),
        impact('delivery_time', 'improve', 'low', 'Less kitchen rework from bad orders'),
      ],
    });
  }

  if (cancellations.byTable[0]) {
    const ct = cancellations.byTable[0];
    push({
      id: 'cancel-table',
      category: 'cancellation',
      priority: 'medium',
      title: `${ct.table} leads cancellation count`,
      detail: `${ct.count} cancellations at this table.`,
      action: `Inspect ${ct.table} QR flow, seating, and server check-in frequency.`,
      impacts: [
        impact('satisfaction', 'improve', 'medium', 'Targeted fix for repeat pain point'),
        impact('revenue', 'improve', 'low', 'Reduce table-specific voids'),
      ],
    });
  }

  // ── Operations (existing) ──
  const occupancyPct = tables.length ? Math.round((inUse.length / tables.length) * 100) : 0;
  if (occupancyPct >= 85) {
    push({
      id: 'occ-high',
      category: 'operations',
      priority: 'high',
      title: 'High table occupancy',
      detail: `${inUse.length}/${tables.length} tables in use (${occupancyPct}%).`,
      action: 'Pace confirmations; free tables promptly after billing.',
      impacts: [
        impact('delivery_time', 'risk', 'high', 'Queue may stretch 25%+ without pacing'),
        impact('satisfaction', 'risk', 'medium', 'Guest frustration from waits'),
      ],
    });
  }

  if (active.length >= 8) {
    push({
      id: 'queue-deep',
      category: 'operations',
      priority: 'high',
      title: 'Deep open order queue',
      detail: `${active.length} orders in pipeline.`,
      action: 'Add kitchen capacity or pause new confirmations temporarily.',
      impacts: [
        impact('delivery_time', 'risk', 'high', '+10–20 min average wait if unaddressed'),
        impact('satisfaction', 'risk', 'high', 'Elevated complaint risk'),
      ],
    });
  }

  if (summary.avgTotalDeliveryMinutes != null && summary.avgTotalDeliveryMinutes > 35) {
    push({
      id: 'slow-delivery',
      category: 'operations',
      priority: 'medium',
      title: `Avg end-to-end delivery ${summary.avgTotalDeliveryMinutes} min`,
      detail: `Queue ${summary.avgQueueMinutes ?? '—'} · prep ${summary.avgPrepMinutes ?? '—'} · serve ${summary.avgServeMinutes ?? '—'} min.`,
      action: 'Attack longest stage first — usually queue (confirm→cooking) or prep (cooking→ready).',
      impacts: [
        impact('delivery_time', 'improve', 'high', '10–15% cycle-time reduction possible'),
        impact('satisfaction', 'improve', 'high', 'Directly tied to guest wait perception'),
      ],
    });
  }

  const repeatCustomers = customers.filter(c =>
    orders.filter(o => o.customer_id === c.id && o.status === 'delivered').length >= 2
  );
  if (repeatCustomers.length) {
    push({
      id: 'repeat-cust',
      category: 'customer',
      priority: 'low',
      title: `${repeatCustomers.length} repeat customer(s)`,
      detail: 'Guests with 2+ delivered orders — loyalty opportunity.',
      action: 'Personalized bulk-discount reminder via email/SMS where available.',
      impacts: [
        impact('revenue', 'improve', 'low', '5–12% lift from repeat visits'),
        impact('satisfaction', 'improve', 'medium', 'Recognition builds loyalty'),
      ],
    });
  }

  if (!recs.length) {
    push({
      id: 'all-clear',
      category: 'operations',
      priority: 'low',
      title: 'Operations look healthy',
      detail: 'No urgent patterns detected — keep monitoring as order volume grows.',
      action: 'Refresh this tab after busy service periods for updated AI insights.',
      impacts: [
        impact('efficiency', 'neutral', 'low', 'Baseline maintained'),
      ],
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

export const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  temporal: 'Day & Time',
  table: 'Table Insights',
  sales: 'Sales & Menu',
  staff: 'Staff',
  cancellation: 'Cancellations',
  operations: 'Operations',
  customer: 'Customers',
};

export const IMPACT_LABELS: Record<ImpactArea, string> = {
  delivery_time: 'Delivery time',
  satisfaction: 'Satisfaction',
  revenue: 'Revenue',
  efficiency: 'Efficiency',
};

export function mergeRecommendations(
  analyticsRecs: AdminRecommendation[],
  aiRecs: AdminRecommendation[]
): AdminRecommendation[] {
  const seen = new Set(analyticsRecs.map(r => r.title.toLowerCase().slice(0, 40)));
  const merged = [...analyticsRecs];
  for (const r of aiRecs) {
    const key = r.title.toLowerCase().slice(0, 40);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push({ ...r, source: 'ai' });
    }
  }
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return merged.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

export function parseAiRecommendations(raw: unknown): AdminRecommendation[] {
  if (!raw || typeof raw !== 'object') return [];
  const arr = (raw as { recommendations?: unknown }).recommendations;
  if (!Array.isArray(arr)) return [];
  const validCategories = new Set<string>(['temporal', 'table', 'sales', 'staff', 'cancellation', 'operations', 'customer']);
  const validAreas = new Set<string>(['delivery_time', 'satisfaction', 'revenue', 'efficiency']);
  const validPriority = new Set(['high', 'medium', 'low']);

  return arr.map((item, idx) => {
    const o = item as Record<string, unknown>;
    const impactsRaw = Array.isArray(o.impacts) ? o.impacts : [];
    const impacts: RecommendationImpact[] = impactsRaw
      .map((imp) => {
        const i = imp as Record<string, unknown>;
        const area = String(i.area || '');
        if (!validAreas.has(area)) return null;
        return {
          area: area as ImpactArea,
          direction: (['improve', 'risk', 'neutral'].includes(String(i.direction)) ? i.direction : 'neutral') as RecommendationImpact['direction'],
          magnitude: (validPriority.has(String(i.magnitude)) ? i.magnitude : 'low') as RecommendationImpact['magnitude'],
          summary: String(i.summary || '').slice(0, 200),
        };
      })
      .filter((x): x is RecommendationImpact => x != null && x.summary.length > 0);

    const category = validCategories.has(String(o.category)) ? String(o.category) as RecommendationCategory : 'operations';
    const priority = validPriority.has(String(o.priority)) ? String(o.priority) as AdminRecommendation['priority'] : 'low';

    return {
      id: String(o.id || `ai-${idx}`),
      source: 'ai' as const,
      category,
      priority,
      title: String(o.title || 'Insight').slice(0, 120),
      detail: String(o.detail || '').slice(0, 500),
      action: String(o.action || '').slice(0, 400),
      rationale: o.rationale ? String(o.rationale).slice(0, 400) : undefined,
      evidence: o.evidence ? String(o.evidence).slice(0, 200) : undefined,
      impacts: impacts.length ? impacts : [impact('efficiency', 'neutral', 'low', 'Operational improvement expected')],
    };
  }).filter(r => r.title && r.action);
}
