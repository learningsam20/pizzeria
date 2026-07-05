import { getSupabase } from './supabaseClient';
import { Profile, Customer, MenuItem, Order, OrderItem, OrderWithItems, DineInTable, AppSettings, MenuLoadStatus } from '../types';

// ─── helpers ────────────────────────────────────────────────────────────────

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Expected JSON from ${path} but got HTML. Run "npm run dev" (not vite alone) and restart the server after code changes.`
    );
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `API error ${res.status}`);
  return body as T;
}

// Supabase client is still used for auth-related operations only
export const dbService = {
  isSupabaseConnected(): boolean {
    return getSupabase() !== null;
  },

  // ── PROFILES ──────────────────────────────────────────────────────────────
  async getProfiles(): Promise<Profile[]> {
    return api<Profile[]>('/api/profiles');
  },

  async createProfile(profile: Omit<Profile, 'created_at' | 'updated_at'>): Promise<Profile> {
    return api<Profile>('/api/staff/invite', {
      method: 'POST',
      body: JSON.stringify({
        email: profile.email,
        displayName: profile.display_name,
        role: profile.role,
      }),
    });
  },

  async updateProfile(id: string, updates: Partial<Profile>): Promise<Profile> {
    return api<Profile>(`/api/profiles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  // ── TABLES ────────────────────────────────────────────────────────────────
  async getTables(): Promise<DineInTable[]> {
    return api<DineInTable[]>('/api/tables');
  },

  async getAvailableTables(): Promise<DineInTable[]> {
    const tables = await this.getTables();
    return tables.filter(t => !t.is_in_use);
  },

  async setTableUsage(tableName: string, inUse: boolean): Promise<DineInTable> {
    return api<DineInTable>(`/api/tables/${encodeURIComponent(tableName)}/usage`, {
      method: 'PATCH',
      body: JSON.stringify({ is_in_use: inUse }),
    });
  },

  async inviteStaffAccount(input: { email: string; displayName?: string | null; role: 'staff' | 'admin' }): Promise<{
    success: boolean;
    email: string;
    role: string;
    emailSent: boolean;
    message: string;
  }> {
    return api('/api/staff/invite', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  // ── CUSTOMERS ─────────────────────────────────────────────────────────────
  async getCustomers(page = 1, pageSize = 10, search = ''): Promise<{ data: Customer[]; totalCount: number }> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search });
    return api<{ data: Customer[]; totalCount: number }>(`/api/customers?${params}`);
  },

  async findCustomerByPhone(phone: string): Promise<Customer | null> {
    return api<Customer | null>(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`);
  },

  async findCustomerByEmail(email: string): Promise<Customer | null> {
    return api<Customer | null>(`/api/customers/lookup?email=${encodeURIComponent(email)}`);
  },

  async findCustomerByPhoneOrEmail(identifier: string): Promise<Customer | null> {
    const trimmed = identifier.trim();
    return trimmed.includes('@')
      ? this.findCustomerByEmail(trimmed)
      : this.findCustomerByPhone(trimmed);
  },

  async createCustomer(customer: Omit<Customer, 'id' | 'created_at' | 'updated_at'>): Promise<Customer> {
    return api<Customer>('/api/customers', {
      method: 'POST',
      body: JSON.stringify(customer),
    });
  },

  async updateCustomer(id: number, updates: Partial<Customer>): Promise<Customer> {
    return api<Customer>(`/api/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  /** Create or update a customer record when placing an order. */
  async upsertCustomerForOrder(
    data: { name: string; phone: string; email: string; delivery_address?: string | null },
    existingId?: number | null
  ): Promise<Customer> {
    const payload = {
      name: data.name.trim(),
      phone: data.phone.replace(/\D/g, '').slice(0, 10),
      email: data.email.trim().toLowerCase(),
      delivery_address: data.delivery_address?.trim() || null,
    };

    if (existingId) {
      return this.updateCustomer(existingId, payload);
    }

    const byPhone = await this.findCustomerByPhone(payload.phone);
    if (byPhone) {
      return this.updateCustomer(byPhone.id, payload);
    }

    if (payload.email) {
      const byEmail = await this.findCustomerByEmail(payload.email);
      if (byEmail) {
        return this.updateCustomer(byEmail.id, payload);
      }
    }

    return this.createCustomer(payload);
  },

  async bulkCreateCustomers(customers: Omit<Customer, 'id' | 'created_at' | 'updated_at'>[]): Promise<{ success: number; errors: string[] }> {
    let successCount = 0;
    const errors: string[] = [];
    for (const c of customers) {
      try { await this.createCustomer(c); successCount++; }
      catch (e: any) { errors.push(`${c.phone}: ${e.message}`); }
    }
    return { success: successCount, errors };
  },

  // ── MENU ITEMS ────────────────────────────────────────────────────────────
  async getMenuItems(): Promise<MenuItem[]> {
    return api<MenuItem[]>('/api/menu');
  },

  async createMenuItem(item: Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>): Promise<MenuItem> {
    return api<MenuItem>('/api/menu', {
      method: 'POST',
      body: JSON.stringify(item),
    });
  },

  async updateMenuItem(id: number, updates: Partial<MenuItem>): Promise<MenuItem> {
    return api<MenuItem>(`/api/menu/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async bulkCreateMenuItems(items: Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>[]): Promise<{ success: number; created: number; replaced: number; errors: string[] }> {
    let success = 0, created = 0, replaced = 0;
    const errors: string[] = [];
    for (const item of items) {
      const code = item.code.trim().toUpperCase();
      try {
        const existing = await api<MenuItem | null>(`/api/menu`).then(
          (all: any) => (all as MenuItem[]).find((m: MenuItem) => m.code === code) ?? null
        );
        if (existing) { await this.updateMenuItem(existing.id, { ...item, code }); replaced++; }
        else { await this.createMenuItem({ ...item, code }); created++; }
        success++;
      } catch (e: any) { errors.push(`${code}: ${e.message}`); }
    }
    return { success, created, replaced, errors };
  },

  async getSettings(): Promise<AppSettings> {
    return api<AppSettings>('/api/settings');
  },

  async updateSettings(staffId: string, patch: Partial<AppSettings>): Promise<AppSettings> {
    return api<AppSettings>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ staffId, ...patch }),
    });
  },

  async getMenuLoadStatus(): Promise<MenuLoadStatus> {
    return api<MenuLoadStatus>('/api/startup/menu-load');
  },

  async reloadInputDataMenu(): Promise<MenuLoadStatus> {
    return api<MenuLoadStatus>('/api/menu/reload-input-data', { method: 'POST' });
  },

  // ── ORDERS ────────────────────────────────────────────────────────────────
  async getOrders(): Promise<OrderWithItems[]> {
    return api<OrderWithItems[]>('/api/orders');
  },

  async getOrderById(orderId: number): Promise<OrderWithItems | null> {
    try {
      return await api<OrderWithItems>(`/api/orders/${orderId}`);
    } catch (e: any) {
      if (String(e.message).toLowerCase().includes('not found')) return null;
      throw e;
    }
  },

  async searchOrderHistory(filters: {
    orderId?: number;
    phoneOrEmail?: string;
    status?: Order['status'] | 'all';
  }): Promise<OrderWithItems[]> {
    let results: OrderWithItems[] = [];
    if (filters.orderId) {
      const order = await this.getOrderById(filters.orderId);
      results = order ? [order] : [];
    } else if (filters.phoneOrEmail?.trim()) {
      const trimmed = filters.phoneOrEmail.trim();
      const customer = await this.findCustomerByPhoneOrEmail(trimmed);
      if (customer) {
        results = await this.getCustomerOrdersHistory(trimmed);
      } else {
        const all = await this.getOrders();
        if (trimmed.includes('@')) {
          results = [];
        } else {
          results = all.filter(o => o.customer_phone === trimmed);
        }
      }
    } else {
      results = await this.getOrders();
    }
    if (filters.status && filters.status !== 'all') {
      results = results.filter(o => o.status === filters.status);
    }
    return results.sort((a, b) => b.id - a.id);
  },

  async getCustomerOrdersHistory(phoneOrEmail: string): Promise<OrderWithItems[]> {
    const trimmed = phoneOrEmail.trim();
    const customer = await this.findCustomerByPhoneOrEmail(trimmed);
    if (!customer) return [];
    const all = await this.getOrders();
    return all.filter(o => o.customer_id === customer.id || o.customer_phone === customer.phone);
  },

  async createOrder(
    orderData: Omit<Order, 'id' | 'table_id' | 'created_at' | 'updated_at' | 'cooking_started_at' | 'ready_at' | 'served_at' | 'delivered_at' | 'cancelled_at' | 'cancellation_reason'>,
    items: Omit<OrderItem, 'id' | 'order_id' | 'created_at' | 'updated_at'>[]
  ): Promise<OrderWithItems> {
    return api<OrderWithItems>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ orderData, items }),
    });
  },

  async updateOrderStatus(
    orderId: number,
    newStatus: 'confirmed' | 'preparing' | 'ready' | 'ready_to_bill' | 'delivered' | 'cancelled',
    cancellationReason: string | null = null,
    staffId: string | null = null,
    paymentMode: 'Cash' | 'Card' | 'UPI' | null = null
  ): Promise<OrderWithItems> {
    return api<OrderWithItems>(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ newStatus, cancellationReason, staffId, paymentMode }),
    });
  },

  // ── ANALYTICS ─────────────────────────────────────────────────────────────
  calculateAnalytics(orders: OrderWithItems[], profiles: Profile[] = []) {
    const confirmedCount  = orders.filter(o => o.status === 'confirmed').length;
    const preparingCount  = orders.filter(o => o.status === 'preparing').length;
    const readyCount      = orders.filter(o => o.status === 'ready' && !o.served_at).length;
    const readyToBillCount = orders.filter(o => o.status === 'ready_to_bill' || (o.status === 'ready' && o.served_at)).length;
    const deliveredCount  = orders.filter(o => o.status === 'delivered').length;
    const cancelledCount  = orders.filter(o => o.status === 'cancelled').length;
    const activeOrdersCount = confirmedCount + preparingCount + readyCount + readyToBillCount;

    const deliveredOrders = orders.filter(o => o.status === 'delivered');
    const activeOrders = orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled');

    const totalRevenue   = deliveredOrders.reduce((s, o) => s + Number(o.total_payable), 0);
    const totalGst       = deliveredOrders.reduce((s, o) => s + Number(o.gst), 0);
    const totalDiscount  = deliveredOrders.reduce((s, o) => s + Number(o.discount), 0);
    const subtotalRevenue = deliveredOrders.reduce((s, o) => s + Number(o.subtotal), 0);
    const pipelineValue  = activeOrders.reduce((s, o) => s + Number(o.total_payable), 0);

    const itemFrequencies: Record<string, { quantity: number; revenue: number; category: string }> = {};
    deliveredOrders.forEach(order => {
      order.items.forEach(item => {
        if (!itemFrequencies[item.name]) itemFrequencies[item.name] = { quantity: 0, revenue: 0, category: item.category };
        itemFrequencies[item.name].quantity += item.quantity;
        itemFrequencies[item.name].revenue += Number(item.unit_price_snapshot) * item.quantity;
      });
    });
    const popularItems = Object.entries(itemFrequencies)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.quantity - a.quantity);

    const paymentModes: Record<string, number> = { Cash: 0, Card: 0, UPI: 0 };
    deliveredOrders.forEach(o => { paymentModes[o.payment_mode] = (paymentModes[o.payment_mode] || 0) + Number(o.total_payable); });
    const paymentModesChart = Object.entries(paymentModes).map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }));

    let totalQueueMs = 0, queueCount = 0, totalPrepMs = 0, prepCount = 0, totalDelivMs = 0, delivCount = 0;
    orders.forEach(o => {
      if (o.cooking_started_at) { totalQueueMs += new Date(o.cooking_started_at).getTime() - new Date(o.created_at).getTime(); queueCount++; }
      if (o.ready_at && o.cooking_started_at) { totalPrepMs += new Date(o.ready_at).getTime() - new Date(o.cooking_started_at).getTime(); prepCount++; }
      if (o.delivered_at && o.ready_at) { totalDelivMs += new Date(o.delivered_at).getTime() - new Date(o.ready_at).getTime(); delivCount++; }
    });

    const profilesList = profiles;
    const staffFreq: Record<string, { email: string; name: string; processed: number; totalMs: number; cnt: number }> = {};
    deliveredOrders.forEach(o => {
      if (o.staff_id) {
        const p = profilesList.find(x => x.id === o.staff_id);
        if (!staffFreq[o.staff_id]) staffFreq[o.staff_id] = { email: p?.email || '', name: p?.display_name || p?.email || 'Unknown', processed: 0, totalMs: 0, cnt: 0 };
        staffFreq[o.staff_id].processed++;
        if (o.ready_at && o.cooking_started_at) { staffFreq[o.staff_id].totalMs += new Date(o.ready_at).getTime() - new Date(o.cooking_started_at).getTime(); staffFreq[o.staff_id].cnt++; }
      }
    });
    const staffPerformance = Object.entries(staffFreq).map(([id, s]) => ({
      id, name: s.name, email: s.email, ordersProcessed: s.processed,
      avgPrepTimeMinutes: s.cnt > 0 ? Number((s.totalMs / (1000 * 60) / s.cnt).toFixed(1)) : 0,
    }));

    const hourlyBuckets: Record<number, { hour: string; count: number; sales: number }> = {};
    for (let i = 0; i < 24; i++) hourlyBuckets[i] = { hour: `${String(i).padStart(2, '0')}:00`, count: 0, sales: 0 };
    deliveredOrders.forEach(o => {
      const ts = o.delivered_at || o.created_at;
      const h = new Date(ts).getHours();
      hourlyBuckets[h].count++; hourlyBuckets[h].sales += Number(o.total_payable);
    });
    const hourlySalesData = Object.values(hourlyBuckets)
      .map(h => ({ hour: h.hour, orders: h.count, sales: Number(h.sales.toFixed(2)) }))
      .filter(h => h.orders > 0 || h.sales > 0);

    const cancellationReasons = orders
      .filter(o => o.status === 'cancelled' && o.cancellation_reason)
      .map(o => ({ id: o.id, customer: o.customer_name, reason: o.cancellation_reason, amount: o.total_payable, at: o.cancelled_at || o.updated_at }));

    return {
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalGst: Number(totalGst.toFixed(2)),
      totalDiscount: Number(totalDiscount.toFixed(2)),
      subtotalRevenue: Number(subtotalRevenue.toFixed(2)),
      pipelineValue: Number(pipelineValue.toFixed(2)),
      ordersCount: orders.length, activeOrdersCount,
      confirmedCount, preparingCount, readyCount, readyToBillCount, deliveredCount, cancelledCount,
      popularItems, paymentModesChart, staffPerformance, hourlySalesData, cancellationReasons,
      metrics: {
        avgQueueTimeMin: queueCount > 0 ? Number((totalQueueMs / (1000 * 60) / queueCount).toFixed(1)) : 0,
        avgPrepTimeMin: prepCount > 0 ? Number((totalPrepMs / (1000 * 60) / prepCount).toFixed(1)) : 0,
        avgDeliveryCycleMin: delivCount > 0 ? Number((totalDelivMs / (1000 * 60) / delivCount).toFixed(1)) : 0,
      },
    };
  },
};
