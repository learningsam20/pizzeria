import { getSupabase } from './supabaseClient';
import { Profile, Customer, MenuItem, Order, OrderItem, OrderWithItems, OrderItem as TOrderItem } from '../types';

// Pre-seeded menu items for immediate delightful experience
const SEED_MENU_ITEMS: Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>[] = [
  { code: 'PIZ01', category: 'pizza', name: 'Cheese Pizza', price_inr: 299, currency: 'INR', description: 'Classic mozzarella with a rich herb-infused tomato sauce', is_active: true },
  { code: 'PIZ02', category: 'pizza', name: 'Veggie Delight', price_inr: 349, currency: 'INR', description: 'Fresh capsicum, sweet onion, juicy tomatoes, and black olives', is_active: true },
  { code: 'PIZ03', category: 'pizza', name: 'Pepperoni Feast', price_inr: 449, currency: 'INR', description: 'Double loaded spicy pork pepperoni with extra premium cheese', is_active: true },
  { code: 'PIZ04', category: 'pizza', name: 'Margherita Classic', price_inr: 280, currency: 'INR', description: 'Fresh basil leaves, sliced roma tomatoes, and fresh bocconcini cheese', is_active: true },
  { code: 'PIZ05', category: 'pizza', name: 'Spicy Paneer Tikka', price_inr: 399, currency: 'INR', description: 'Tandoori paneer cubes, red paprika, and onions on a spicy sauce', is_active: true },
  { code: 'BAS01', category: 'base', name: 'Thin Crust Base', price_inr: 50, currency: 'INR', description: 'Crispy and light traditional hand-stretched crust', is_active: true },
  { code: 'BAS02', category: 'base', name: 'Pan Pizza Base', price_inr: 80, currency: 'INR', description: 'Thick, fluffy, and golden-baked crust with crispy edges', is_active: true },
  { code: 'BAS03', category: 'base', name: 'Wheat Thin Crust', price_inr: 70, currency: 'INR', description: 'Healthy and fiber-rich hand-crafted thin crust', is_active: true },
  { code: 'TOP01', category: 'topping', name: 'Extra Cheese', price_inr: 40, currency: 'INR', description: 'An extra layer of premium low-moisture mozzarella', is_active: true },
  { code: 'TOP02', category: 'topping', name: 'Jalapenos', price_inr: 30, currency: 'INR', description: 'Zesty pickled jalapeno slices for a spicy kick', is_active: true },
  { code: 'TOP03', category: 'topping', name: 'Black Olives', price_inr: 35, currency: 'INR', description: 'Salty, hand-sliced Spanish black olives', is_active: true },
  { code: 'TOP04', category: 'topping', name: 'Mushrooms', price_inr: 45, currency: 'INR', description: 'Earthy, pan-sauteed fresh white button mushrooms', is_active: true },
];

const SEED_PROFILES: Profile[] = [
  { id: '11111111-1111-1111-1111-111111111111', email: 'samdip2004@gmail.com', display_name: 'Admin Sam', role: 'admin', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: '22222222-2222-2222-2222-222222222222', email: 'staff1@pizzeria.com', display_name: 'Staff Rahul', role: 'staff', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: '33333333-3333-3333-3333-333333333333', email: 'staff2@pizzeria.com', display_name: 'Staff Priya', role: 'staff', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];

// Seed storage helpers
const initializeLocalStorage = () => {
  if (!localStorage.getItem('pz_profiles')) {
    localStorage.setItem('pz_profiles', JSON.stringify(SEED_PROFILES));
  }
  if (!localStorage.getItem('pz_menu_items')) {
    const formatted = SEED_MENU_ITEMS.map((item, index) => ({
      ...item,
      id: index + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    localStorage.setItem('pz_menu_items', JSON.stringify(formatted));
  }
  if (!localStorage.getItem('pz_customers')) {
    const defaultCustomers: Customer[] = [
      { id: 1, name: 'Aarav Sharma', phone: '9876543210', delivery_address: 'Flat 402, Skyline Residency, Mumbai', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { id: 2, name: 'Ananya Iyer', phone: '8765432109', delivery_address: 'Plot 12, Indiranagar, Bengaluru', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { id: 3, name: 'Kabir Mehta', phone: '7654321098', delivery_address: '15/A, Sector 4, Gurgaon', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    ];
    localStorage.setItem('pz_customers', JSON.stringify(defaultCustomers));
  }
  if (!localStorage.getItem('pz_orders')) {
    localStorage.setItem('pz_orders', JSON.stringify([]));
  }
  if (!localStorage.getItem('pz_order_items')) {
    localStorage.setItem('pz_order_items', JSON.stringify([]));
  }
};

// Initialize if client side
if (typeof window !== 'undefined') {
  initializeLocalStorage();
}

export const dbService = {
  isSupabaseConnected(): boolean {
    return getSupabase() !== null;
  },

  // Seed standard data to Supabase (if connected)
  async seedSupabaseData(): Promise<{ success: boolean; message: string }> {
    const supabase = getSupabase();
    if (!supabase) return { success: false, message: 'Supabase is not connected.' };

    try {
      // 1. Seed menu items
      // Check if menu items exist
      const { data: existingItems, error: getErr } = await supabase.from('menu_items').select('id');
      if (getErr) throw getErr;

      let menuCount = 0;
      if (!existingItems || existingItems.length === 0) {
        const { error: seedErr } = await supabase.from('menu_items').insert(
          SEED_MENU_ITEMS.map(item => ({
            code: item.code,
            category: item.category,
            name: item.name,
            price_inr: item.price_inr,
            currency: item.currency,
            description: item.description,
            is_active: item.is_active
          }))
        );
        if (seedErr) throw seedErr;
        menuCount = SEED_MENU_ITEMS.length;
      }

      // 2. Seed default customers if none exist
      const { data: existingCustomers, error: custErr } = await supabase.from('customers').select('id');
      if (custErr) throw custErr;
      
      let custCount = 0;
      if (!existingCustomers || existingCustomers.length === 0) {
        const defaultCustomers = [
          { name: 'Aarav Sharma', phone: '9876543210', delivery_address: 'Flat 402, Skyline Residency, Mumbai' },
          { name: 'Ananya Iyer', phone: '8765432109', delivery_address: 'Plot 12, Indiranagar, Bengaluru' },
          { name: 'Kabir Mehta', phone: '7654321098', delivery_address: '15/A, Sector 4, Gurgaon' }
        ];
        const { error: seedCustErr } = await supabase.from('customers').insert(defaultCustomers);
        if (seedCustErr) throw seedCustErr;
        custCount = defaultCustomers.length;
      }

      return {
        success: true,
        message: `Successfully seeded Supabase! Inserted ${menuCount} menu items and ${custCount} customers.`
      };
    } catch (err: any) {
      console.error("Error seeding Supabase:", err);
      return { success: false, message: `Seeding failed: ${err.message}. Please verify table schemas exist in Supabase first.` };
    }
  },

  // --- PROFILES API ---
  async getProfiles(): Promise<Profile[]> {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } else {
      return JSON.parse(localStorage.getItem('pz_profiles') || '[]');
    }
  },

  async createProfile(profile: Omit<Profile, 'created_at' | 'updated_at'>): Promise<Profile> {
    const supabase = getSupabase();
    const emailLower = profile.email.trim().toLowerCase();
    
    if (!emailLower.includes('@') || emailLower.length < 5) {
      throw new Error("Invalid staff email address format.");
    }

    const newProfile = {
      ...profile,
      email: emailLower,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (supabase) {
      // Duplication check in Supabase
      const { data: existing } = await supabase.from('profiles').select('id').eq('email', emailLower).maybeSingle();
      if (existing) {
        throw new Error(`Profile with email ${emailLower} already exists in database.`);
      }

      const { data, error } = await supabase.from('profiles').insert(newProfile).select().single();
      if (error) throw error;
      return data;
    } else {
      const list = JSON.parse(localStorage.getItem('pz_profiles') || '[]');
      if (list.some((p: Profile) => p.email.toLowerCase() === emailLower)) {
        throw new Error(`Profile with email ${emailLower} already exists.`);
      }
      list.push(newProfile);
      localStorage.setItem('pz_profiles', JSON.stringify(list));
      return newProfile;
    }
  },

  async updateProfile(id: string, updates: Partial<Profile>): Promise<Profile> {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase
        .from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const list = JSON.parse(localStorage.getItem('pz_profiles') || '[]');
      const index = list.findIndex((p: Profile) => p.id === id);
      if (index === -1) throw new Error('Profile not found');
      const updated = { ...list[index], ...updates, updated_at: new Date().toISOString() };
      list[index] = updated;
      localStorage.setItem('pz_profiles', JSON.stringify(list));
      return updated;
    }
  },

  // --- CUSTOMERS API (with Pagination and Search) ---
  async getCustomers(page: number = 1, pageSize: number = 10, search: string = ''): Promise<{ data: Customer[]; totalCount: number }> {
    const supabase = getSupabase();
    if (supabase) {
      let query = supabase.from('customers').select('*', { count: 'exact' });
      if (search) {
        query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
      }
      const { data, count, error } = await query
        .order('id', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);
      
      if (error) throw error;
      return { data: data || [], totalCount: count || 0 };
    } else {
      const list: Customer[] = JSON.parse(localStorage.getItem('pz_customers') || '[]');
      let filtered = list;
      if (search) {
        const searchLower = search.toLowerCase();
        filtered = list.filter(c => 
          c.name.toLowerCase().includes(searchLower) || 
          c.phone.includes(searchLower)
        );
      }
      const sorted = [...filtered].sort((a, b) => b.id - a.id);
      const paginated = sorted.slice((page - 1) * pageSize, page * pageSize);
      return { data: paginated, totalCount: filtered.length };
    }
  },

  async findCustomerByPhone(phone: string): Promise<Customer | null> {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.from('customers').select('*').eq('phone', phone).maybeSingle();
      if (error) throw error;
      return data;
    } else {
      const list: Customer[] = JSON.parse(localStorage.getItem('pz_customers') || '[]');
      return list.find(c => c.phone === phone) || null;
    }
  },

  async createCustomer(customer: Omit<Customer, 'id' | 'created_at' | 'updated_at'>): Promise<Customer> {
    const supabase = getSupabase();
    
    // Check regex boundaries
    const nameRegex = /^[A-Za-z \u00C0-\u017F]{2,40}$/;
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!nameRegex.test(customer.name)) {
      throw new Error("Customer Name must be 2 to 40 letters and contain only alphabet/accented characters.");
    }
    if (!phoneRegex.test(customer.phone)) {
      throw new Error("Phone number must be a valid 10-digit Indian phone starting with 6-9.");
    }

    if (supabase) {
      const { data, error } = await supabase.from('customers').insert(customer).select().single();
      if (error) throw error;
      return data;
    } else {
      const list = JSON.parse(localStorage.getItem('pz_customers') || '[]');
      // Duplicate phone check
      if (list.some((c: Customer) => c.phone === customer.phone)) {
        throw new Error(`Customer with phone ${customer.phone} already exists`);
      }
      const newCust: Customer = {
        ...customer,
        id: list.length > 0 ? Math.max(...list.map((c: any) => c.id)) + 1 : 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      list.push(newCust);
      localStorage.setItem('pz_customers', JSON.stringify(list));
      return newCust;
    }
  },

  async updateCustomer(id: number, updates: Partial<Customer>): Promise<Customer> {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase
        .from('customers')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const list = JSON.parse(localStorage.getItem('pz_customers') || '[]');
      const index = list.findIndex((c: Customer) => c.id === id);
      if (index === -1) throw new Error('Customer not found');
      const updated = { ...list[index], ...updates, updated_at: new Date().toISOString() };
      list[index] = updated;
      localStorage.setItem('pz_customers', JSON.stringify(list));
      return updated;
    }
  },

  async bulkCreateCustomers(customers: Omit<Customer, 'id' | 'created_at' | 'updated_at'>[]): Promise<{ success: number; errors: string[] }> {
    let successCount = 0;
    const errors: string[] = [];
    
    for (const cust of customers) {
      try {
        await this.createCustomer(cust);
        successCount++;
      } catch (err: any) {
        errors.push(`Row for phone ${cust.phone}: ${err.message}`);
      }
    }

    return { success: successCount, errors };
  },

  // --- MENU ITEMS API ---
  async getMenuItems(): Promise<MenuItem[]> {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.from('menu_items').select('*').order('category', { ascending: true }).order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    } else {
      return JSON.parse(localStorage.getItem('pz_menu_items') || '[]');
    }
  },

  async createMenuItem(item: Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>): Promise<MenuItem> {
    const supabase = getSupabase();
    
    // Strict Code & Category Validation
    const code = item.code.trim().toUpperCase();
    if (code.length < 3 || code.length > 10) {
      throw new Error("Item Code must be between 3 and 10 characters.");
    }
    if (!/^[A-Z0-9_-]+$/.test(code)) {
      throw new Error("Item Code must contain only alphanumeric characters, dashes, or underscores.");
    }

    if (item.category === 'pizza' && !code.startsWith('PIZ')) {
      throw new Error("Code mismatch: Pizza category must start with 'PIZ' prefix (e.g. PIZ08).");
    }
    if (item.category === 'base' && !code.startsWith('BAS')) {
      throw new Error("Code mismatch: Base Crust category must start with 'BAS' prefix (e.g. BAS04).");
    }
    if (item.category === 'topping' && !code.startsWith('TOP')) {
      throw new Error("Code mismatch: Topping category must start with 'TOP' prefix (e.g. TOP12).");
    }

    if (item.price_inr <= 0) {
      throw new Error("Price must be greater than 0 INR.");
    }
    if (item.price_inr > 10000) {
      throw new Error("Price cannot exceed 10,000 INR.");
    }

    const newItemPayload = {
      ...item,
      code
    };

    if (supabase) {
      // Duplication check in Supabase
      const { data: existing } = await supabase.from('menu_items').select('id').eq('code', code).maybeSingle();
      if (existing) {
        throw new Error(`Menu Item with code ${code} already exists in the database.`);
      }

      const { data, error } = await supabase.from('menu_items').insert(newItemPayload).select().single();
      if (error) throw error;
      return data;
    } else {
      const list = JSON.parse(localStorage.getItem('pz_menu_items') || '[]');
      if (list.some((m: MenuItem) => m.code.toUpperCase() === code)) {
        throw new Error(`Menu Item with code ${code} already exists`);
      }
      const newItem: MenuItem = {
        ...newItemPayload,
        id: list.length > 0 ? Math.max(...list.map((m: any) => m.id)) + 1 : 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      list.push(newItem);
      localStorage.setItem('pz_menu_items', JSON.stringify(list));
      return newItem;
    }
  },

  async updateMenuItem(id: number, updates: Partial<MenuItem>): Promise<MenuItem> {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase
        .from('menu_items')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const list = JSON.parse(localStorage.getItem('pz_menu_items') || '[]');
      const index = list.findIndex((m: MenuItem) => m.id === id);
      if (index === -1) throw new Error('Menu Item not found');
      const updated = { ...list[index], ...updates, updated_at: new Date().toISOString() };
      list[index] = updated;
      localStorage.setItem('pz_menu_items', JSON.stringify(list));
      return updated;
    }
  },

  async bulkCreateMenuItems(items: Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>[]): Promise<{ success: number; errors: string[] }> {
    let successCount = 0;
    const errors: string[] = [];

    for (const item of items) {
      try {
        await this.createMenuItem(item);
        successCount++;
      } catch (err: any) {
        errors.push(`Row for code ${item.code}: ${err.message}`);
      }
    }

    return { success: successCount, errors };
  },

  // --- ORDERS API (with comprehensive timing logs) ---
  async getOrders(): Promise<OrderWithItems[]> {
    const supabase = getSupabase();
    if (supabase) {
      // Fetch orders first
      const { data: orders, error: ordersErr } = await supabase
        .from('orders')
        .select('*')
        .order('id', { ascending: false });
      
      if (ordersErr) throw ordersErr;

      // Fetch all order items
      const { data: orderItems, error: itemsErr } = await supabase
        .from('order_items')
        .select('*');
      
      if (itemsErr) throw itemsErr;

      // Map items back to orders
      const ordersWithItems: OrderWithItems[] = (orders || []).map(order => {
        const items = (orderItems || []).filter(item => item.order_id === order.id);
        return { ...order, items };
      });

      return ordersWithItems;
    } else {
      const orders: Order[] = JSON.parse(localStorage.getItem('pz_orders') || '[]');
      const orderItems: OrderItem[] = JSON.parse(localStorage.getItem('pz_order_items') || '[]');
      
      const ordersWithItems: OrderWithItems[] = orders.map(order => {
        const items = orderItems.filter(item => item.order_id === order.id);
        return { ...order, items };
      });

      return ordersWithItems.sort((a, b) => b.id - a.id);
    }
  },

  async getCustomerOrdersHistory(phone: string): Promise<OrderWithItems[]> {
    const all = await this.getOrders();
    return all.filter(o => o.customer_phone === phone);
  },

  async createOrder(
    orderData: Omit<Order, 'id' | 'created_at' | 'updated_at' | 'cooking_started_at' | 'ready_at' | 'delivered_at' | 'cancelled_at' | 'cancellation_reason'>,
    items: Omit<OrderItem, 'id' | 'order_id' | 'created_at' | 'updated_at'>[]
  ): Promise<OrderWithItems> {
    const supabase = getSupabase();

    // Validations based on SQL check rules
    const nameRegex = /^[A-Za-z \u00C0-\u017F]{2,40}$/;
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!nameRegex.test(orderData.customer_name)) {
      throw new Error("Customer Name must be 2 to 40 letters and contain only alphabet/accented characters.");
    }
    if (!phoneRegex.test(orderData.customer_phone)) {
      throw new Error("Phone number must be a valid 10-digit Indian phone starting with 6-9.");
    }
    if (orderData.table_number < 1 || orderData.table_number > 20) {
      throw new Error("Table number must be between 1 and 20.");
    }
    if (orderData.total_quantity < 1 || orderData.total_quantity > 10) {
      throw new Error("Total quantity must be between 1 and 10 pizzas/items.");
    }

    const orderInsert = {
      ...orderData,
      status: 'confirmed' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      cooking_started_at: null,
      ready_at: null,
      delivered_at: null,
      cancelled_at: null,
      cancellation_reason: null
    };

    if (supabase) {
      // 1. Insert Order
      const { data: newOrder, error: orderErr } = await supabase
        .from('orders')
        .insert(orderInsert)
        .select()
        .single();
      
      if (orderErr) throw orderErr;

      // 2. Insert Order Items with snapshots
      const itemsToInsert = items.map(item => ({
        order_id: newOrder.id,
        menu_item_id: item.menu_item_id,
        category: item.category,
        name: item.name,
        unit_price_snapshot: item.unit_price_snapshot,
        currency: item.currency || 'INR',
        quantity: item.quantity,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      const { data: newItems, error: itemsErr } = await supabase
        .from('order_items')
        .insert(itemsToInsert)
        .select();

      if (itemsErr) {
        // Attempt cleanup order
        await supabase.from('orders').delete().eq('id', newOrder.id);
        throw itemsErr;
      }

      return {
        ...newOrder,
        items: newItems
      };
    } else {
      const ordersList: Order[] = JSON.parse(localStorage.getItem('pz_orders') || '[]');
      const orderItemsList: OrderItem[] = JSON.parse(localStorage.getItem('pz_order_items') || '[]');

      const newOrderId = ordersList.length > 0 ? Math.max(...ordersList.map((o: any) => o.id)) + 1 : 1;
      
      const newOrder: Order = {
        ...orderInsert,
        id: newOrderId,
      };

      const createdItems: OrderItem[] = [];
      let currentItemId = orderItemsList.length > 0 ? Math.max(...orderItemsList.map((i: any) => i.id)) : 0;

      for (const item of items) {
        currentItemId++;
        const newItem: OrderItem = {
          ...item,
          id: currentItemId,
          order_id: newOrderId,
          currency: item.currency || 'INR',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        createdItems.push(newItem);
        orderItemsList.push(newItem);
      }

      ordersList.push(newOrder);
      
      localStorage.setItem('pz_orders', JSON.stringify(ordersList));
      localStorage.setItem('pz_order_items', JSON.stringify(orderItemsList));

      // Also trigger saving a copy to a standard location so backend chatbot can load it
      // Since window is active, this is in local storage only, but we can send currentOrders dynamically to backend!

      return {
        ...newOrder,
        items: createdItems
      };
    }
  },

  async updateOrderStatus(
    orderId: number,
    newStatus: 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled',
    cancellationReason: string | null = null,
    staffId: string | null = null
  ): Promise<OrderWithItems> {
    const supabase = getSupabase();
    
    // State machine transit checks to disallow any incorrect operations beyond the baseline
    const currentOrders = await this.getOrders();
    const orderToUpdate = currentOrders.find(o => o.id === orderId);
    if (!orderToUpdate) throw new Error("Order not found");

    if (orderToUpdate.status === 'cancelled') {
      throw new Error("Invalid operation: Order is already cancelled and cannot be modified.");
    }
    if (orderToUpdate.status === 'delivered') {
      throw new Error("Invalid operation: Order has already been delivered and served.");
    }

    if (newStatus === 'cancelled' && orderToUpdate.status !== 'confirmed') {
      throw new Error(`Cancellation is forbidden. Order is already in ${orderToUpdate.status} phase.`);
    }
    if (newStatus === 'preparing' && orderToUpdate.status !== 'confirmed') {
      throw new Error(`Invalid transition: Only confirmed orders can be set to preparing. Current state: ${orderToUpdate.status}`);
    }
    if (newStatus === 'ready' && orderToUpdate.status !== 'preparing') {
      throw new Error(`Invalid transition: Only preparing orders can be marked as ready. Current state: ${orderToUpdate.status}`);
    }
    if (newStatus === 'delivered' && orderToUpdate.status !== 'ready') {
      throw new Error(`Invalid transition: Only ready orders can be marked as delivered. Current state: ${orderToUpdate.status}`);
    }

    const updates: Partial<Order> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    if (staffId) {
      updates.staff_id = staffId;
    }

    // Capture precise kitchen metrics timestamps!
    const nowStr = new Date().toISOString();
    if (newStatus === 'preparing') {
      updates.cooking_started_at = nowStr;
    } else if (newStatus === 'ready') {
      updates.ready_at = nowStr;
    } else if (newStatus === 'delivered') {
      updates.delivered_at = nowStr;
    } else if (newStatus === 'cancelled') {
      updates.cancelled_at = nowStr;
      updates.cancellation_reason = cancellationReason || "Not specified";
    }

    if (supabase) {
      const { data, error } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', orderId)
        .select()
        .single();
      
      if (error) throw error;

      // Re-fetch items
      const { data: items, error: itemsErr } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId);
      
      if (itemsErr) throw itemsErr;

      return {
        ...data,
        items: items || []
      };
    } else {
      const ordersList = JSON.parse(localStorage.getItem('pz_orders') || '[]');
      const index = ordersList.findIndex((o: any) => o.id === orderId);
      if (index === -1) throw new Error('Order not found');

      const updatedOrder = {
        ...ordersList[index],
        ...updates,
      };
      ordersList[index] = updatedOrder;
      localStorage.setItem('pz_orders', JSON.stringify(ordersList));

      const orderItemsList = JSON.parse(localStorage.getItem('pz_order_items') || '[]');
      const items = orderItemsList.filter((item: any) => item.order_id === orderId);

      return {
        ...updatedOrder,
        items
      };
    }
  },

  // --- ANALYTICS ENGINE ---
  calculateAnalytics(orders: OrderWithItems[]) {
    // 1. Simple Aggregates
    const confirmedCount = orders.filter(o => o.status === 'confirmed').length;
    const preparingCount = orders.filter(o => o.status === 'preparing').length;
    const readyCount = orders.filter(o => o.status === 'ready').length;
    const deliveredCount = orders.filter(o => o.status === 'delivered').length;
    const cancelledCount = orders.filter(o => o.status === 'cancelled').length;
    const activeOrdersCount = confirmedCount + preparingCount + readyCount;

    // Filter out cancelled orders for pure financial logs
    const completedOrders = orders.filter(o => o.status === 'delivered');
    const validOrdersForRevenue = orders.filter(o => o.status !== 'cancelled');

    const totalRevenue = validOrdersForRevenue.reduce((sum, o) => sum + Number(o.total_payable), 0);
    const totalGst = validOrdersForRevenue.reduce((sum, o) => sum + Number(o.gst), 0);
    const totalDiscount = validOrdersForRevenue.reduce((sum, o) => sum + Number(o.discount), 0);
    const subtotalRevenue = validOrdersForRevenue.reduce((sum, o) => sum + Number(o.subtotal), 0);

    // 2. Popular Pizza/Items analytics
    const itemFrequencies: { [name: string]: { quantity: number; revenue: number; category: string } } = {};
    orders.forEach(order => {
      if (order.status !== 'cancelled') {
        order.items.forEach(item => {
          if (!itemFrequencies[item.name]) {
            itemFrequencies[item.name] = { quantity: 0, revenue: 0, category: item.category };
          }
          itemFrequencies[item.name].quantity += item.quantity;
          itemFrequencies[item.name].revenue += Number(item.unit_price_snapshot) * item.quantity;
        });
      }
    });

    const popularItems = Object.keys(itemFrequencies).map(name => ({
      name,
      quantity: itemFrequencies[name].quantity,
      revenue: itemFrequencies[name].revenue,
      category: itemFrequencies[name].category,
    })).sort((a, b) => b.quantity - a.quantity);

    // 3. Payment modes analytics
    const paymentModes: { [mode: string]: number } = { Cash: 0, Card: 0, UPI: 0 };
    orders.forEach(o => {
      if (o.status !== 'cancelled') {
        paymentModes[o.payment_mode] = (paymentModes[o.payment_mode] || 0) + Number(o.total_payable);
      }
    });

    const paymentModesChart = Object.keys(paymentModes).map(mode => ({
      name: mode,
      value: Number(paymentModes[mode].toFixed(2)),
    }));

    // 4. Kitchen Efficiency & Operational Metrics (average wait times in minutes)
    let totalQueueTimeMs = 0; // confirmed -> preparing
    let queueCount = 0;
    
    let totalPrepTimeMs = 0;  // preparing -> ready
    let prepCount = 0;

    let totalDeliveryCycleMs = 0; // ready -> delivered
    let deliveryCount = 0;

    orders.forEach(o => {
      if (o.cooking_started_at) {
        const queueTime = new Date(o.cooking_started_at).getTime() - new Date(o.created_at).getTime();
        totalQueueTimeMs += queueTime;
        queueCount++;
      }
      if (o.ready_at && o.cooking_started_at) {
        const prepTime = new Date(o.ready_at).getTime() - new Date(o.cooking_started_at).getTime();
        totalPrepTimeMs += prepTime;
        prepCount++;
      }
      if (o.delivered_at && o.ready_at) {
        const deliveryCycle = new Date(o.delivered_at).getTime() - new Date(o.ready_at).getTime();
        totalDeliveryCycleMs += deliveryCycle;
        deliveryCount++;
      }
    });

    const avgQueueTimeMin = queueCount > 0 ? (totalQueueTimeMs / (1000 * 60)) / queueCount : 0;
    const avgPrepTimeMin = prepCount > 0 ? (totalPrepTimeMs / (1000 * 60)) / prepCount : 0;
    const avgDeliveryCycleMin = deliveryCount > 0 ? (totalDeliveryCycleMs / (1000 * 60)) / deliveryCount : 0;

    // 5. Staff Performance analytics
    const staffFrequencies: { [staffId: string]: { email: string; name: string; processed: number; avgPrepTimeMs: number; totalPrepCount: number } } = {};
    
    // Fetch profiles first to link
    const profiles: Profile[] = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('pz_profiles') || '[]') : SEED_PROFILES;

    orders.forEach(o => {
      if (o.staff_id) {
        const staffProfile = profiles.find(p => p.id === o.staff_id);
        const staffKey = o.staff_id;
        const displayName = staffProfile ? (staffProfile.display_name || staffProfile.email) : 'Unknown Staff';
        const email = staffProfile ? staffProfile.email : 'unknown@pizzeria.com';

        if (!staffFrequencies[staffKey]) {
          staffFrequencies[staffKey] = { email, name: displayName, processed: 0, avgPrepTimeMs: 0, totalPrepCount: 0 };
        }

        staffFrequencies[staffKey].processed += 1;

        if (o.ready_at && o.cooking_started_at) {
          const prepTime = new Date(o.ready_at).getTime() - new Date(o.cooking_started_at).getTime();
          staffFrequencies[staffKey].avgPrepTimeMs += prepTime;
          staffFrequencies[staffKey].totalPrepCount += 1;
        }
      }
    });

    const staffPerformance = Object.keys(staffFrequencies).map(id => {
      const s = staffFrequencies[id];
      const avgPrepMin = s.totalPrepCount > 0 ? (s.avgPrepTimeMs / (1000 * 60)) / s.totalPrepCount : 0;
      return {
        id,
        name: s.name,
        email: s.email,
        ordersProcessed: s.processed,
        avgPrepTimeMinutes: Number(avgPrepMin.toFixed(1)),
      };
    });

    // 6. Hourly distribution chart data (last 24 hours of logs)
    const hourlyBuckets: { [hour: string]: { hour: string; count: number; sales: number } } = {};
    // Populate last 8 hours or standard buckets
    for (let i = 0; i < 24; i++) {
      const hStr = `${i.toString().padStart(2, '0')}:00`;
      hourlyBuckets[i] = { hour: hStr, count: 0, sales: 0 };
    }

    orders.forEach(o => {
      const createdDate = new Date(o.created_at);
      const hour = createdDate.getHours();
      if (hourlyBuckets[hour]) {
        hourlyBuckets[hour].count += 1;
        hourlyBuckets[hour].sales += Number(o.total_payable);
      }
    });

    const hourlySalesData = Object.keys(hourlyBuckets).map(key => ({
      hour: hourlyBuckets[key].hour,
      orders: hourlyBuckets[key].count,
      sales: Number(hourlyBuckets[key].sales.toFixed(2)),
    })).filter(h => h.orders > 0 || h.sales > 0); // Only keep active hours to make charts elegant

    // 7. Cancellation metrics
    const cancellationReasons = orders
      .filter(o => o.status === 'cancelled' && o.cancellation_reason)
      .map(o => ({
        id: o.id,
        customer: o.customer_name,
        reason: o.cancellation_reason,
        amount: o.total_payable,
        at: o.cancelled_at || o.updated_at
      }));

    return {
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalGst: Number(totalGst.toFixed(2)),
      totalDiscount: Number(totalDiscount.toFixed(2)),
      subtotalRevenue: Number(subtotalRevenue.toFixed(2)),
      ordersCount: orders.length,
      activeOrdersCount,
      confirmedCount,
      preparingCount,
      readyCount,
      deliveredCount,
      cancelledCount,
      popularItems,
      paymentModesChart,
      staffPerformance,
      hourlySalesData,
      cancellationReasons,
      metrics: {
        avgQueueTimeMin: Number(avgQueueTimeMin.toFixed(1)),
        avgPrepTimeMin: Number(avgPrepTimeMin.toFixed(1)),
        avgDeliveryCycleMin: Number(avgDeliveryCycleMin.toFixed(1)),
      }
    };
  }
};
