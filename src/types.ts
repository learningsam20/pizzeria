/**
 * Database Types for the Pizza Ordering and Analytics Application
 */

export interface Profile {
  id: string; // UUID
  email: string;
  display_name: string | null;
  role: 'staff' | 'admin';
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
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

export interface Order {
  id: number;
  customer_id: number | null;
  
  // Customer Context
  customer_name: string;
  customer_phone: string;
  table_number: number;
  
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
  status: 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
  staff_id: string | null; // UUID
  
  // Analytics Timestamps
  session_started_at: string; // Logs when the customer/staff opened the interface
  created_at: string; // Order confirmation time
  updated_at: string;
  
  // Kitchen Performance Analytics Timestamps
  cooking_started_at: string | null;
  ready_at: string | null;
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
  hasGemini: boolean;
}
