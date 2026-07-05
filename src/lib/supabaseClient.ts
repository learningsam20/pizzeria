import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

export function getSupabase(url?: string, key?: string): SupabaseClient | null {
  if (supabaseInstance) return supabaseInstance;
  
  // Use explicit parameters, otherwise fall back to VITE_ env variables if any
  const targetUrl = url || ((import.meta as any).env?.VITE_SUPABASE_URL as string);
  const targetKey = key || ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string);
  
  if (!targetUrl || !targetKey || targetUrl.trim() === "" || targetUrl.includes("YOUR_SUPABASE") || targetKey.includes("YOUR_SUPABASE")) {
    return null;
  }
  
  try {
    supabaseInstance = createClient(targetUrl, targetKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      }
    });
    return supabaseInstance;
  } catch (err) {
    console.error("Failed to initialize Supabase client:", err);
    return null;
  }
}

// Help set the instance if we load it from an API fetch
export function setSupabaseInstance(url: string, key: string): SupabaseClient | null {
  try {
    if (!url || !key || url.includes("YOUR_SUPABASE") || key.includes("YOUR_SUPABASE")) {
      return null;
    }
    supabaseInstance = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      }
    });
    return supabaseInstance;
  } catch (err) {
    console.error("Failed to force set Supabase instance:", err);
    return null;
  }
}
