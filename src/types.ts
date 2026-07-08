/**
 * Database Types for the Pizza Ordering and Analytics Application
 */

export interface Profile {
  id: string; // UUID
  email: string;
  display_name: string | null;
  role: 'staff' | 'admin';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  delivery_address: string | null;
  created_at: string;
  updated_at: string;
}

export interface MenuItem {
  id: number;
  code: string;
  category: 'base' | 'pizza' | 'topping';
  name: string;
  price_inr: number;
  currency: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DineInTable {
  id: number;
  table_name: string;
  description: string | null;
  capacity: number;
  is_in_use: boolean;
  created_at: string;
  updated_at: string;
}

/** Extract a numeric QR param from table_name (e.g. "Table 1" → 1), or fall back to id. */
export function tableQrNumber(table: DineInTable): number {
  const match = table.table_name.match(/(\d+)\s*$/);
  return match ? parseInt(match[1], 10) : table.id;
}

export interface Order {
  id: number;
  customer_id: number | null;
  
  // Customer Context
  customer_name: string | null;
  customer_phone: string | null;
  table_name: string;   // resolved from table_info; used in UI
  table_id: number;     // FK to table_info.id — stored in DB
  
  // Financial Aggregates
  total_quantity: number;
  subtotal: number;
  discount: number;
  gst: number;
  total_payable: number;
  currency: string;
  
  // Order Metadata & Flow Rules
  payment_mode: 'Cash' | 'Card' | 'UPI';
  order_source: 'staff' | 'customer';
  status: 'confirmed' | 'preparing' | 'ready' | 'ready_to_bill' | 'delivered' | 'cancelled';
  staff_id: string | null; // UUID
  /** Resolved from profiles when orders are loaded from the API */
  staff_name?: string | null;
  
  // Analytics Timestamps
  session_started_at: string; // Logs when the customer/staff opened the interface
  created_at: string; // Order confirmation time
  updated_at: string;
  
  // Kitchen Performance Analytics Timestamps
  cooking_started_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  
  // Quality Logs
  cancellation_reason: string | null;
}

export interface OrderItem {
  id: number;
  order_id: number;
  menu_item_id: number | null;
  category: string;
  name: string;
  unit_price_snapshot: number;
  currency: string;
  quantity: number;
  created_at: string;
  updated_at: string;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

export interface AppConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  /** True when any AI provider is configured (OpenRouter or Gemini). */
  hasGemini: boolean;
  hasAi?: boolean;
  aiProvider?: 'openrouter' | 'gemini' | null;
  aiModel?: string | null;
}

export interface AppSettings {
  bulk_discount_percent: number;
  bulk_discount_min_qty: number;
  default_currency: string;
  gst_percent: number;
  updated_at?: string;
}

export interface MenuFileLoadResult {
  file: string;
  category: MenuItem['category'];
  success: number;
  created: number;
  replaced: number;
  errors: string[];
  skipped: boolean;
  skipReason?: string;
}

export interface MenuLoadStatus {
  loadedAt: string | null;
  files: MenuFileLoadResult[];
  totalSuccess: number;
  totalErrors: number;
  hasErrors: boolean;
  supabaseConfigured: boolean;
  message?: string;
}
