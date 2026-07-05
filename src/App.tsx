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
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800" id="main-app-viewport">
      
      {/* 1. Global Navigation Hub Bar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-xs" id="navigation-hub">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3">
          
          {/* Brand Logo Display */}
          <div className="flex items-center space-x-3.5 cursor-pointer" onClick={() => setActiveRole('customer')}>
            <div className="w-10 h-10 bg-gradient-to-tr from-red-600 to-amber-500 rounded-xl flex items-center justify-center text-white shadow-md shadow-red-500/20 transform hover:scale-105 transition-all">
              <Pizza className="w-6 h-6 rotate-12" />
            </div>
            <div>
              <h1 className="font-extrabold text-lg text-gray-900 tracking-tight leading-none font-sans flex items-center gap-1">
                Slice of Heaven <span className="text-red-600 text-xs font-mono uppercase bg-red-50 px-1.5 py-0.5 rounded-md border border-red-100">Pizzeria</span>
              </h1>
              <p className="text-[10px] text-gray-400 mt-1 font-mono uppercase tracking-widest">Postgres & AI Ordering System</p>
            </div>
          </div>

          {/* TESTING SANDBOX PANEL: Role switcher */}
          <div className="flex items-center bg-gray-100 p-1 rounded-2xl border border-gray-200/60 text-xs font-medium max-w-full overflow-x-auto scrollbar-none">
            <button
              onClick={() => setActiveRole('customer')}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeRole === 'customer' 
                  ? 'bg-white text-red-600 shadow-sm font-bold' 
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <Pizza className="w-4 h-4" /> Dine-In Customer
            </button>
            
            <button
              onClick={() => {
                if (staffSession && (staffSession.role === 'staff' || staffSession.role === 'admin')) {
                  setActiveRole('staff');
                } else {
                  setActiveRole('staff');
                }
              }}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeRole === 'staff' 
                  ? 'bg-white text-amber-600 shadow-sm font-bold' 
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <ChefHat className="w-4 h-4" /> Staff Kitchen
            </button>

            <button
              onClick={() => {
                if (staffSession && staffSession.role === 'admin') {
                  setActiveRole('admin');
                } else {
                  setActiveRole('admin');
                }
              }}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeRole === 'admin' 
                  ? 'bg-white text-purple-600 shadow-sm font-bold' 
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <ShieldCheck className="w-4 h-4" /> Admin Analytics
            </button>

            <button
              onClick={() => setActiveRole('chatbot')}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeRole === 'chatbot' 
                  ? 'bg-white text-blue-600 shadow-sm font-bold' 
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <Bot className="w-4 h-4" /> Support Chat
            </button>

            <button
              onClick={() => setActiveRole('config')}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeRole === 'config' 
                  ? 'bg-white text-gray-800 shadow-sm font-bold' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              title="View Environment Variables, database link diagnostic logs, and copy Supabase SQL tables structure"
            >
              <Database className="w-4 h-4" /> Setup
            </button>
          </div>

          {/* Sync action / profile status */}
          <div className="flex items-center space-x-3 text-xs">
            <button
              onClick={fetchActiveData}
              className="p-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-500 hover:text-gray-700 border border-gray-200 cursor-pointer"
              title="Sync tables"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {staffSession ? (
              <div className="bg-gray-900 text-white pl-3.5 pr-2 py-1 rounded-xl flex items-center space-x-2 border border-gray-800">
                <span className="font-semibold text-[11px] max-w-[80px] truncate">{staffSession.name}</span>
                <button
                  onClick={handleStaffLogout}
                  className="p-1 bg-white/10 hover:bg-white/20 rounded-lg text-red-400 cursor-pointer"
                  title="Logout Session"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="text-gray-400 font-mono text-[10px] hidden md:block">
                Dine-in Tables Active
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 2. Main Content Canvas */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-0">
        
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400 space-y-3.5">
            <RefreshCw className="w-10 h-10 text-red-500 animate-spin" />
            <p className="text-xs font-mono">Initializing connection systems...</p>
          </div>
        ) : (
          <div className="space-y-6">
            
            {/* IF DINE-IN CUSTOMER MODE */}
            {activeRole === 'customer' && (
              <div className="space-y-4">
                {/* Check if staff logged in check: "The customers should be able to start a new transaction after the staff has logged in." */}
                {!staffSession && (
                  <div className="p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl text-xs space-y-2 flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Staff Supervision Mode Active</p>
                      <p className="leading-snug">To place pizza orders, a staff member must first log in using the Shift Login panel on the right or via the "Staff Kitchen" tab in the header. Once authorized, client ordering transaction modules are unlocked.</p>
                      <button
                        onClick={() => setActiveRole('staff')}
                        className="mt-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-[10px]"
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
                  <div className="max-w-md mx-auto bg-white border rounded-2xl p-6 shadow-md space-y-4">
                    <div className="text-center pb-2 border-b">
                      <ChefHat className="w-10 h-10 text-amber-500 mx-auto" />
                      <h3 className="text-lg font-bold text-gray-800 mt-2">Staff Shift Login</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Authorize your device to process kitchen pizzas and print table QRs.</p>
                    </div>

                    <form onSubmit={handleStaffLogin} className="space-y-3">
                      <div className="space-y-1 text-xs">
                        <label className="block font-bold text-gray-500 uppercase text-[9px]">Pizzeria Staff Email *</label>
                        <input
                          type="email"
                          required
                          placeholder="e.g. staff1@pizzeria.com or write 'admin@pizzeria.com' for admin demo"
                          value={staffLoginEmail}
                          onChange={(e) => setStaffLoginEmail(e.target.value)}
                          className="w-full px-3 py-2 border rounded-xl"
                        />
                        <p className="text-[10px] text-gray-400">Tip: Write "admin@pizzeria.com" or "staff1@pizzeria.com" for instant automatic bypass sign-in.</p>
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-sm"
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
                  <div className="max-w-md mx-auto bg-white border rounded-2xl p-6 shadow-md space-y-4">
                    <div className="text-center pb-2 border-b">
                      <ShieldCheck className="w-10 h-10 text-purple-600 mx-auto" />
                      <h3 className="text-lg font-bold text-gray-800 mt-2">Executive Access Required</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Secure dashboard contains analytical charts and financial reports.</p>
                    </div>

                    <form onSubmit={handleStaffLogin} className="space-y-3">
                      <div className="space-y-1 text-xs">
                        <label className="block font-bold text-gray-500 uppercase text-[9px]">Admin Email *</label>
                        <input
                          type="email"
                          required
                          placeholder="Write 'admin@pizzeria.com' to bypass"
                          value={staffLoginEmail}
                          onChange={(e) => setStaffLoginEmail(e.target.value)}
                          className="w-full px-3 py-2 border rounded-xl"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-sm"
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
      <footer className="bg-white border-t border-gray-200 py-6 mt-12 text-center" id="global-footer">
        <div className="max-w-7xl mx-auto px-4 text-xs text-gray-400 space-y-1.5 font-mono">
          <p>© 2026 Slice of Heaven Pizzeria Ltd. All rights reserved.</p>
          <p>
            Connected to: {supabaseConnected ? '⚡ Supabase Postgres Cloud' : '💾 Local Web Storage Engine'}
            {config.hasGemini ? ' • 💬 Gemini AI Engine Online' : ' • ⚠️ Gemini AI Key Offline'}
          </p>
        </div>
      </footer>
    </div>
  );
}
