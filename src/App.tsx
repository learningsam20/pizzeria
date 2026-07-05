import React, { useState, useEffect } from 'react';
import { 
  Pizza, ChefHat, ShieldAlert, Bot, Database, RefreshCw, Key, LogIn, LogOut, CheckCircle, Flame, ShieldCheck, SlidersHorizontal 
} from 'lucide-react';
import { setSupabaseInstance, getSupabase } from './lib/supabaseClient';
import { dbService } from './lib/dbService';
import { AppConfig, MenuItem, OrderWithItems, Profile } from './types';

// Import our modular components
import OrderingFlow from './components/OrderingFlow';
import StaffDashboard from './components/StaffDashboard';
import AdminDashboard from './components/AdminDashboard';
import Chatbot from './components/Chatbot';
import ConfigGuide from './components/ConfigGuide';

export default function App() {
  // Global States
  const [config, setConfig] = useState<AppConfig>({ supabaseUrl: null, supabaseAnonKey: null, hasGemini: false });
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  // Loaded database matrices
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // Testing Sandbox Roles Selector
  const [activeRole, setActiveRole] = useState<'customer' | 'staff' | 'admin' | 'chatbot' | 'config'>('customer');

  // Staff and Admin logged status
  const [staffSession, setStaffSession] = useState<{ id: string; name: string; role: 'staff' | 'admin' } | null>(null);
  const [staffLoginEmail, setStaffLoginEmail] = useState('');
  const [staffLoginPassword, setStaffLoginPassword] = useState('');

  // Active query parameters for scanned QR tables
  const [scannedTable, setScannedTable] = useState<number | null>(null);

  // Initialize and load configurations
  useEffect(() => {
    // Check url search parameters for table e.g. ?table=5 from QR codes
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tbl = params.get('table');
      if (tbl) {
        const tNum = parseInt(tbl);
        if (tNum >= 1 && tNum <= 20) {
          setScannedTable(tNum);
          setActiveRole('customer'); // Direct scanned table to Customer Ordering flow
        }
      }
    }
    
    initializeConfig();
  }, []);

  const initializeConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/config');
      const data: AppConfig = await res.json();
      setConfig(data);

      if (data.supabaseUrl && data.supabaseAnonKey) {
        const client = setSupabaseInstance(data.supabaseUrl, data.supabaseAnonKey);
        if (client) {
          setSupabaseConnected(true);
        } else {
          setSupabaseConnected(false);
        }
      } else {
        setSupabaseConnected(false);
      }
    } catch (err) {
      console.error("Config load error:", err);
      setSupabaseConnected(false);
    } finally {
      setLoading(false);
    }
  };

  // Sync data across all tabs instantly on events
  useEffect(() => {
    fetchActiveData();
  }, [supabaseConnected]);

  const fetchActiveData = async () => {
    try {
      const loadedMenu = await dbService.getMenuItems();
      setMenuItems(loadedMenu);

      const loadedOrders = await dbService.getOrders();
      setOrders(loadedOrders);

      const loadedProfiles = await dbService.getProfiles();
      setProfiles(loadedProfiles);
    } catch (err) {
      console.error("Error fetching live matrices:", err);
    }
  };

  // Handle local mock or real auth sign-in for staff
  const handleStaffLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffLoginEmail.trim()) return;

    // Look up email in our profiles table (works for both Supabase or Local localStorage profiles!)
    const match = profiles.find(p => p.email.toLowerCase() === staffLoginEmail.trim().toLowerCase());
    
    if (match) {
      setStaffSession({
        id: match.id,
        name: match.display_name || match.email,
        role: match.role
      });
      // Set to appropriate dashboard
      if (match.role === 'admin') {
        setActiveRole('admin');
      } else {
        setActiveRole('staff');
      }
      setStaffLoginEmail('');
    } else {
      // Create a transient demo session if it doesn't exist, for convenient developer previewing!
      const isDemoAdmin = staffLoginEmail.toLowerCase().includes('admin');
      const mockId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 12);
      
      const newSession = {
        id: mockId,
        name: isDemoAdmin ? 'Demo Admin Officer' : 'Demo Staff Runner',
        role: (isDemoAdmin ? 'admin' : 'staff') as 'staff' | 'admin'
      };

      // Add profile to local DB
      dbService.createProfile({
        id: mockId,
        email: staffLoginEmail.trim().toLowerCase(),
        display_name: newSession.name,
        role: newSession.role
      }).then(() => {
        setStaffSession(newSession);
        if (newSession.role === 'admin') {
          setActiveRole('admin');
        } else {
          setActiveRole('staff');
        }
        setStaffLoginEmail('');
        fetchActiveData();
      });
    }
  };

  const handleStaffLogout = () => {
    setStaffSession(null);
    setActiveRole('customer');
  };

  return (
    <div className="min-h-screen bg-noir-bg flex flex-col font-sans text-noir-text" id="main-app-viewport">
      
      {/* 1. Global Navigation Hub Bar */}
      <header className="bg-noir-panel border-b border-noir-border sticky top-0 z-40 shadow-md" id="navigation-hub">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3">
          
          {/* Brand Logo Display */}
          <div className="flex items-center space-x-3.5 cursor-pointer" onClick={() => setActiveRole('customer')}>
            <div className="w-9 h-9 bg-noir-gold rounded-sm rotate-45 flex items-center justify-center text-black shadow-lg transform hover:scale-105 transition-all">
              <Pizza className="w-5 h-5 -rotate-45" />
            </div>
            <div>
              <h1 className="font-serif text-lg font-bold tracking-tight text-noir-text leading-none flex items-center gap-1.5">
                Slice of Heaven <span className="text-noir-gold text-[10px] font-mono uppercase bg-noir-highlight px-1.5 py-0.5 rounded border border-noir-gold-o20">Pizzeria Noir</span>
              </h1>
              <p className="text-[9px] text-noir-dim mt-1 font-mono uppercase tracking-widest">Postgres & AI Intelligence</p>
            </div>
          </div>

          {/* TESTING SANDBOX PANEL: Role switcher */}
          <div className="flex items-center bg-noir-sidebar p-1 rounded-xl border border-noir-border text-xs font-medium max-w-full overflow-x-auto scrollbar-none">
            <button
              onClick={() => setActiveRole('customer')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeRole === 'customer' 
                  ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20 font-semibold' 
                  : 'text-noir-muted hover:text-noir-text hover:bg-noir-highlight/40'
              }`}
            >
              <Pizza className="w-3.5 h-3.5" /> Dine-In Customer
            </button>
            
            <button
              onClick={() => {
                if (staffSession && (staffSession.role === 'staff' || staffSession.role === 'admin')) {
                  setActiveRole('staff');
                } else {
                  setActiveRole('staff');
                }
              }}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeRole === 'staff' 
                  ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20 font-semibold' 
                  : 'text-noir-muted hover:text-noir-text hover:bg-noir-highlight/40'
              }`}
            >
              <ChefHat className="w-3.5 h-3.5" /> Staff Kitchen
            </button>

            <button
              onClick={() => {
                if (staffSession && staffSession.role === 'admin') {
                  setActiveRole('admin');
                } else {
                  setActiveRole('admin');
                }
              }}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeRole === 'admin' 
                  ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20 font-semibold' 
                  : 'text-noir-muted hover:text-noir-text hover:bg-noir-highlight/40'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" /> Admin Analytics
            </button>

            <button
              onClick={() => setActiveRole('chatbot')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeRole === 'chatbot' 
                  ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20 font-semibold' 
                  : 'text-noir-muted hover:text-noir-text hover:bg-noir-highlight/40'
              }`}
            >
              <Bot className="w-3.5 h-3.5" /> Support Chat
            </button>

            <button
              onClick={() => setActiveRole('config')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeRole === 'config' 
                  ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20 font-semibold' 
                  : 'text-noir-muted hover:text-noir-text hover:bg-noir-highlight/40'
              }`}
              title="View Environment Variables, database link diagnostic logs, and copy Supabase SQL tables structure"
            >
              <Database className="w-3.5 h-3.5" /> Setup
            </button>
          </div>

          {/* Sync action / profile status */}
          <div className="flex items-center space-x-3 text-xs">
            <button
              onClick={fetchActiveData}
              className="p-2 bg-noir-highlight hover:bg-noir-sidebar rounded-lg text-noir-muted hover:text-noir-text border border-noir-border cursor-pointer transition-colors"
              title="Sync tables"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            {staffSession ? (
              <div className="bg-noir-sidebar text-noir-text pl-3.5 pr-2 py-1 rounded-lg flex items-center space-x-2 border border-noir-border">
                <span className="font-semibold text-[11px] max-w-[80px] truncate">{staffSession.name}</span>
                <button
                  onClick={handleStaffLogout}
                  className="p-1 bg-noir-highlight hover:bg-noir-sidebar text-red-400 rounded-md cursor-pointer transition-colors"
                  title="Logout Session"
                >
                  <LogOut className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="text-noir-dim font-mono text-[10px] hidden md:block">
                Dine-in Tables Active
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 2. Main Content Canvas */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-0">
        
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-noir-dim space-y-3.5">
            <RefreshCw className="w-10 h-10 text-noir-gold animate-spin" />
            <p className="text-xs font-mono tracking-widest uppercase">Initializing connection systems...</p>
          </div>
        ) : (
          <div className="space-y-6">
            
            {/* IF DINE-IN CUSTOMER MODE */}
            {activeRole === 'customer' && (
              <div className="space-y-4">
                {/* Check if staff logged in check: "The customers should be able to start a new transaction after the staff has logged in." */}
                {!staffSession && (
                  <div className="p-4 bg-noir-card border border-noir-border rounded-2xl text-xs space-y-2 flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-noir-gold flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-serif italic text-sm text-noir-gold">Staff Supervision Mode Active</p>
                      <p className="leading-snug text-noir-muted mt-1">To place pizza orders, a staff member must first log in using the Shift Login panel on the right or via the "Staff Kitchen" tab in the header. Once authorized, client ordering transaction modules are unlocked.</p>
                      <button
                        onClick={() => setActiveRole('staff')}
                        className="mt-3 px-3 py-1.5 bg-noir-gold hover:bg-noir-gold-hover text-black font-semibold rounded text-[10px] transition-colors"
                      >
                        Bypass & Sign In as Staff
                      </button>
                    </div>
                  </div>
                )}
                
                <OrderingFlow 
                  menuItems={menuItems} 
                  onOrderPlaced={fetchActiveData} 
                  staffLoggedIn={!!staffSession}
                  activeTableParam={scannedTable}
                />
              </div>
            )}

            {/* IF STAFF OPERATIONS TAB */}
            {activeRole === 'staff' && (
              <div>
                {staffSession && (staffSession.role === 'staff' || staffSession.role === 'admin') ? (
                  <StaffDashboard 
                    orders={orders} 
                    onRefresh={fetchActiveData} 
                    staffId={staffSession.id}
                    staffName={staffSession.name}
                  />
                ) : (
                  /* Render staff login screen */
                  <div className="max-w-md mx-auto bg-noir-card border border-noir-border rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="text-center pb-3 border-b border-noir-border">
                      <ChefHat className="w-10 h-10 text-noir-gold mx-auto" />
                      <h3 className="text-lg font-serif italic text-noir-text mt-2">Staff Shift Login</h3>
                      <p className="text-xs text-noir-muted mt-1">Authorize your device to process kitchen pizzas and print table QRs.</p>
                    </div>

                    <form onSubmit={handleStaffLogin} className="space-y-4">
                      <div className="space-y-1 text-xs">
                        <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Pizzeria Staff Email *</label>
                        <input
                          type="email"
                          required
                          placeholder="e.g. staff1@pizzeria.com or write 'admin@pizzeria.com' for admin demo"
                          value={staffLoginEmail}
                          onChange={(e) => setStaffLoginEmail(e.target.value)}
                          className="w-full px-3 py-2 bg-noir-panel border border-noir-border focus:border-noir-gold outline-none rounded-xl text-noir-text transition-all"
                        />
                        <p className="text-[10px] text-noir-dim mt-1">Tip: Write "admin@pizzeria.com" or "staff1@pizzeria.com" for instant automatic bypass sign-in.</p>
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2.5 bg-noir-gold hover:bg-noir-gold-hover text-black font-semibold text-xs rounded-xl transition-all cursor-pointer shadow-md"
                      >
                        Start shift & Log In
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}

            {/* IF EXECUTIVE ADMIN CONTROL TAB */}
            {activeRole === 'admin' && (
              <div>
                {staffSession && staffSession.role === 'admin' ? (
                  <AdminDashboard 
                    orders={orders} 
                    menuItems={menuItems} 
                    profiles={profiles} 
                    onRefresh={fetchActiveData}
                    currentStaffId={staffSession.id}
                  />
                ) : (
                  /* Render admin login/bypass alert */
                  <div className="max-w-md mx-auto bg-noir-card border border-noir-border rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="text-center pb-3 border-b border-noir-border">
                      <ShieldCheck className="w-10 h-10 text-noir-gold mx-auto" />
                      <h3 className="text-lg font-serif italic text-noir-text mt-2">Executive Access Required</h3>
                      <p className="text-xs text-noir-muted mt-1">Secure dashboard contains analytical charts and financial reports.</p>
                    </div>

                    <form onSubmit={handleStaffLogin} className="space-y-4">
                      <div className="space-y-1 text-xs">
                        <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Admin Email *</label>
                        <input
                          type="email"
                          required
                          placeholder="Write 'admin@pizzeria.com' to bypass"
                          value={staffLoginEmail}
                          onChange={(e) => setStaffLoginEmail(e.target.value)}
                          className="w-full px-3 py-2 bg-noir-panel border border-noir-border focus:border-noir-gold outline-none rounded-xl text-noir-text transition-all"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2.5 bg-noir-gold hover:bg-noir-gold-hover text-black font-semibold text-xs rounded-xl transition-all cursor-pointer shadow-md"
                      >
                        Unlock Executive Dashboard
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}

            {/* IF SUPPORT CHATBOT CHAT VIEW */}
            {activeRole === 'chatbot' && (
              <div className="max-w-4xl mx-auto">
                <Chatbot 
                  currentOrders={orders} 
                  menuItems={menuItems} 
                  isAdmin={staffSession?.role === 'admin'} 
                />
              </div>
            )}

            {/* IF KEY CONFIGURATION SETUP VIEW */}
            {activeRole === 'config' && (
              <ConfigGuide 
                config={config} 
                supabaseConnected={supabaseConnected} 
                onRefresh={initializeConfig}
              />
            )}

          </div>
        )}
      </main>

      {/* 3. Global footer */}
      <footer className="bg-black border-t border-noir-border py-6 mt-12 text-center" id="global-footer">
        <div className="max-w-7xl mx-auto px-4 text-xs text-noir-dim space-y-1.5 font-mono">
          <p>© 2026 Slice of Heaven Pizzeria Ltd. All rights reserved.</p>
          <p className="text-[10px] tracking-wider">
            Connected to: {supabaseConnected ? '⚡ Supabase Postgres Cloud' : '💾 Local Web Storage Engine'}
            {config.hasGemini ? ' • 💬 Gemini AI Engine Online' : ' • ⚠️ Gemini AI Key Offline'}
          </p>
        </div>
      </footer>
    </div>
  );
}
