import React, { useState, useEffect } from 'react';
import { 
  Pizza, ChefHat, ShieldAlert, Bot, RefreshCw, Key, LogIn, LogOut, CheckCircle, Flame, ShieldCheck, SlidersHorizontal, AlertTriangle, BookOpen, Sun, Moon
} from 'lucide-react';
import { setSupabaseInstance, getSupabase } from './lib/supabaseClient';
import { dbService } from './lib/dbService';
import { AppConfig, MenuItem, OrderWithItems, Profile, DineInTable, tableQrNumber, AppSettings, MenuLoadStatus } from './types';
import { DEFAULT_APP_SETTINGS } from './lib/appSettings';

// Import our modular components
import OrderingFlow from './components/OrderingFlow';
import StaffDashboard from './components/StaffDashboard';
import AdminDashboard from './components/AdminDashboard';
import Chatbot from './components/Chatbot';
import AppHelp from './components/AppHelp';
import { useTheme } from './hooks/useTheme';

export default function App() {
  // Global States
  const [config, setConfig] = useState<AppConfig>({ supabaseUrl: null, supabaseAnonKey: null, hasGemini: false });
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  // Loaded database matrices
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tables, setTables] = useState<DineInTable[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [menuLoadStatus, setMenuLoadStatus] = useState<MenuLoadStatus | null>(null);

  // Testing Sandbox Roles Selector
  const [activeRole, setActiveRole] = useState<'customer' | 'staff' | 'admin' | 'chatbot' | 'help'>('customer');

  // Staff and Admin logged status
  const [staffSession, setStaffSession] = useState<{ id: string; name: string; role: 'staff' | 'admin' } | null>(null);
  const [staffLoginEmail, setStaffLoginEmail] = useState('');
  const [staffLoginPassword, setStaffLoginPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [passwordChangeRequiredFor, setPasswordChangeRequiredFor] = useState<{ id: string; email: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordChangeError, setPasswordChangeError] = useState('');
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);

  // Active query parameters for scanned QR tables (?table=N)
  const [scannedTableQr, setScannedTableQr] = useState<number | null>(null);

  // Initialize and load configurations
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tbl = params.get('table');
      if (tbl) {
        const tNum = parseInt(tbl, 10);
        if (!Number.isNaN(tNum) && tNum >= 1) {
          setScannedTableQr(tNum);
          setActiveRole('customer');
        }
      }
    }
    
    initializeConfig();
    dbService.getSettings().then(setAppSettings).catch(() => {});
    dbService.getMenuLoadStatus().then(setMenuLoadStatus).catch(() => {});
  }, []);

  const lockedTable = scannedTableQr != null
    ? tables.find(t => tableQrNumber(t) === scannedTableQr)
      ?? tables.find(t => t.table_name === `Table ${scannedTableQr}`)
      ?? null
    : null;

  const activeTableOrders = lockedTable
    ? orders.filter(o => o.table_name === lockedTable.table_name && o.status !== 'delivered' && o.status !== 'cancelled')
    : [];

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

  const resolveStaffSession = async (userId: string, email: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Cloud sign-in is not available.');

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('No staff profile exists for this account.');
    if (data.role !== 'staff' && data.role !== 'admin') {
      throw new Error('This account does not have staff access.');
    }

    return {
      id: data.id,
      name: data.display_name || email,
      role: data.role as 'staff' | 'admin'
    };
  };

  // Sync data across all tabs instantly on events
  useEffect(() => {
    if (supabaseConnected) {
      fetchActiveData();
    }
  }, [supabaseConnected]);

  useEffect(() => {
    const restoreSession = async () => {
      const supabase = getSupabase();
      if (!supabase) return;

      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session?.user) {
        setStaffSession(null);
        return;
      }

      try {
        const mustChangePassword = Boolean(session.user.user_metadata?.must_change_password);
        if (mustChangePassword) {
          setPasswordChangeRequiredFor({ id: session.user.id, email: session.user.email || '' });
          setStaffSession(null);
          setActiveRole('customer');
          return;
        }

        const profile = await resolveStaffSession(session.user.id, session.user.email || '');
        setStaffSession(profile);
        setActiveRole(profile.role === 'admin' ? 'admin' : 'staff');
      } catch (err: any) {
        setStaffSession(null);
        await supabase.auth.signOut();
      }
    };

    if (supabaseConnected) {
      restoreSession();
    }
  }, [supabaseConnected]);

  const fetchActiveData = async () => {
    try {
      const [loadedMenu, loadedOrders, loadedProfiles, loadedTables, loadedSettings] = await Promise.all([
        dbService.getMenuItems(),
        dbService.getOrders(),
        dbService.getProfiles(),
        dbService.getTables().catch(() => []),
        dbService.getSettings().catch(() => DEFAULT_APP_SETTINGS),
      ]);
      setMenuItems(loadedMenu);
      setOrders(loadedOrders);
      setProfiles(loadedProfiles);
      setTables(loadedTables);
      setAppSettings(loadedSettings);
    } catch (err) {
      console.error("Error fetching live matrices:", err);
    }
  };

  /** Lightweight refresh after placing an order — skips menu/profiles. */
  const refreshOrdersAndTables = async () => {
    try {
      const [loadedOrders, loadedTables] = await Promise.all([
        dbService.getOrders(),
        dbService.getTables().catch(() => []),
      ]);
      setOrders(loadedOrders);
      setTables(loadedTables);
    } catch (err) {
      console.error("Error refreshing orders:", err);
    }
  };

  useEffect(() => {
    if (supabaseConnected && staffSession && (activeRole === 'admin' || activeRole === 'staff')) {
      if (activeRole === 'admin') {
        fetchActiveData();
      } else {
        refreshOrdersAndTables();
      }
    }
  }, [activeRole, supabaseConnected, staffSession?.id]);

  const getAuthErrorMessage = (err: any) => {
    const message = err?.message || '';
    const lower = message.toLowerCase();

    if (err?.status === 400 || lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
      return 'The email or password is incorrect. If this is the first login, please use the temporary password issued by the admin.';
    }

    if (err?.status === 500 || lower.includes('internal server error') || lower.includes('fetch failed')) {
      return 'Sign-in is temporarily unavailable. Please try again in a moment or confirm your account exists.';
    }

    return message || 'Unable to sign in. Check your email and password.';
  };

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (!staffLoginEmail.trim() || !staffLoginPassword.trim()) {
      setAuthError('Please enter your email and password.');
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      setAuthError('Cloud sign-in is not available. Contact your administrator.');
      return;
    }

    setAuthLoading(true);
    try {
      const { data: { session }, error } = await supabase.auth.signInWithPassword({
        email: staffLoginEmail.trim().toLowerCase(),
        password: staffLoginPassword
      });

      if (error || !session?.user) {
        throw error || new Error('Invalid email or password.');
      }

      const mustChangePassword = Boolean(session.user.user_metadata?.must_change_password);
      if (mustChangePassword) {
        setPasswordChangeRequiredFor({ id: session.user.id, email: session.user.email || staffLoginEmail.trim().toLowerCase() });
        setStaffSession(null);
        setAuthError('Please choose a new password before continuing.');
        setStaffLoginPassword('');
        return;
      }

      const profile = await resolveStaffSession(session.user.id, session.user.email || staffLoginEmail.trim().toLowerCase());
      setStaffSession(profile);
      setActiveRole(profile.role === 'admin' ? 'admin' : 'staff');
      setStaffLoginEmail('');
      setStaffLoginPassword('');
      setPasswordChangeRequiredFor(null);
      await fetchActiveData();
    } catch (err: any) {
      setStaffSession(null);
      setAuthError(getAuthErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordChangeError('');

    if (!newPassword.trim() || newPassword.length < 8) {
      setPasswordChangeError('Please use a password with at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordChangeError('The new passwords do not match.');
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      setPasswordChangeError('Cloud sign-in is not available. Contact your administrator.');
      return;
    }

    setPasswordChangeLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        data: { must_change_password: false }
      });

      if (error) {
        throw error;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        throw userError || new Error('Unable to refresh your session.');
      }

      const profile = await resolveStaffSession(userData.user.id, userData.user.email || passwordChangeRequiredFor?.email || '');
      setStaffSession(profile);
      setActiveRole(profile.role === 'admin' ? 'admin' : 'staff');
      setPasswordChangeRequiredFor(null);
      setNewPassword('');
      setConfirmPassword('');
      await fetchActiveData();
    } catch (err: any) {
      setPasswordChangeError(err.message || 'Unable to update your password right now.');
    } finally {
      setPasswordChangeLoading(false);
    }
  };

  const handleStaffLogout = async () => {
    const supabase = getSupabase();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setStaffSession(null);
    setAuthError('');
    setPasswordChangeRequiredFor(null);
    setStaffLoginPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordChangeError('');
    setActiveRole('customer');
  };

  const canAccessStaffTabs = Boolean(staffSession && (staffSession.role === 'staff' || staffSession.role === 'admin'));
  const canAccessAdminTab = Boolean(staffSession && staffSession.role === 'admin');
  const canAccessChatbotTab = Boolean(staffSession);
  const { toggleTheme, isDark } = useTheme();

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
              <p className="text-[9px] text-noir-dim mt-1 font-mono uppercase tracking-widest">Orders · Kitchen · Service</p>
            </div>
          </div>

          {/* Role switcher */}
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

            {canAccessStaffTabs && (
              <button
                onClick={() => setActiveRole('staff')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  activeRole === 'staff' 
                    ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20 font-semibold' 
                    : 'text-noir-muted hover:text-noir-text hover:bg-noir-highlight/40'
                }`}
              >
                <ChefHat className="w-3.5 h-3.5" /> Staff Kitchen
              </button>
            )}

            {canAccessAdminTab && (
              <button
                onClick={() => setActiveRole('admin')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  activeRole === 'admin' 
                    ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20 font-semibold' 
                    : 'text-noir-muted hover:text-noir-text hover:bg-noir-highlight/40'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" /> Admin Analytics
              </button>
            )}

            <button
              onClick={() => setActiveRole('help')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeRole === 'help' 
                  ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20 font-semibold' 
                  : 'text-noir-muted hover:text-noir-text hover:bg-noir-highlight/40'
              }`}
              title="App help, setup guide, roles, features, and FAQ"
            >
              <BookOpen className="w-3.5 h-3.5" /> Help
            </button>

            {canAccessChatbotTab && (
              <button
                onClick={() => setActiveRole('chatbot')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  activeRole === 'chatbot' 
                    ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20 font-semibold' 
                    : 'text-noir-muted hover:text-noir-text hover:bg-noir-highlight/40'
                }`}
              >
                <Bot className="w-3.5 h-3.5" /> Assistant
              </button>
            )}
          </div>

          {/* Sync action / profile status */}
          <div className="flex items-center space-x-3 text-xs">
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 bg-noir-highlight hover:bg-noir-sidebar rounded-lg text-noir-muted hover:text-noir-gold border border-noir-border cursor-pointer transition-colors"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
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
        
        {!loading && menuLoadStatus?.hasErrors && (
          <div className="mb-6 rounded-xl border border-amber-900/40 bg-amber-950/30 p-4 text-sm text-amber-200 space-y-2">
            <div className="flex items-start gap-2 font-semibold text-amber-100">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400" />
              <span>Some menu import files could not be loaded at startup.</span>
            </div>
            <p className="text-xs text-amber-200/90">
              The app will continue running. Correct the files below and re-upload them via <strong>Admin → Pizza &amp; Master Menu → Bulk Upload</strong> after sign-in, or replace the files and restart the server.
            </p>
            <ul className="text-xs list-disc pl-5 space-y-1 max-h-32 overflow-y-auto text-amber-100/90">
              {menuLoadStatus.files.flatMap(f => {
                const lines: string[] = [];
                if (f.skipReason) lines.push(`${f.file}: ${f.skipReason}`);
                return [...lines, ...f.errors.map(e => `${f.file}: ${e}`)];
              })}
            </ul>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-noir-dim space-y-3.5">
            <RefreshCw className="w-10 h-10 text-noir-gold animate-spin" />
            <p className="text-xs font-mono tracking-widest uppercase">Loading menu and orders…</p>
          </div>
        ) : activeRole === 'help' ? (
          <AppHelp />
        ) : !staffSession ? (
          <div className="max-w-md mx-auto bg-noir-card border border-noir-border rounded-2xl p-6 shadow-xl space-y-4">
            <div className="text-center pb-3 border-b border-noir-border">
              <ChefHat className="w-10 h-10 text-noir-gold mx-auto" />
              <h3 className="text-lg font-serif italic text-noir-text mt-2">Staff Access Required</h3>
              <p className="text-xs text-noir-muted mt-1">Staff sign-in required for ordering. Admins add users under <strong className="text-noir-text">Admin Analytics → User Management</strong>. Login details are emailed to the user; they must change their password on first login.</p>
            </div>

            {passwordChangeRequiredFor ? (
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-300">
                  Set a new password for {passwordChangeRequiredFor.email}. This is required on the first login after your temporary password is issued.
                </div>

                <div className="space-y-1 text-xs">
                  <label htmlFor="new-password" className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">New password *</label>
                  <input
                    id="new-password"
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-noir-panel border border-noir-border focus:border-noir-gold outline-none rounded-xl text-noir-text transition-all"
                  />
                </div>

                <div className="space-y-1 text-xs">
                  <label htmlFor="confirm-password" className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Confirm password *</label>
                  <input
                    id="confirm-password"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-noir-panel border border-noir-border focus:border-noir-gold outline-none rounded-xl text-noir-text transition-all"
                  />
                </div>

                {passwordChangeError && (
                  <div className="rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-[11px] text-red-300">
                    {passwordChangeError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={passwordChangeLoading}
                  className="w-full py-2.5 bg-noir-gold hover:bg-noir-gold-hover disabled:opacity-70 text-black font-semibold text-xs rounded-xl transition-all cursor-pointer shadow-md"
                >
                  {passwordChangeLoading ? 'Updating password…' : 'Set new password'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleStaffLogin} className="space-y-4">
                <div className="space-y-1 text-xs">
                  <label htmlFor="staff-email" className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Email *</label>
                  <input
                    id="staff-email"
                    type="email"
                    required
                    value={staffLoginEmail}
                    onChange={(e) => setStaffLoginEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-noir-panel border border-noir-border focus:border-noir-gold outline-none rounded-xl text-noir-text transition-all"
                  />
                </div>

                <div className="space-y-1 text-xs">
                  <label htmlFor="staff-password" className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Password *</label>
                  <input
                    id="staff-password"
                    type="password"
                    required
                    value={staffLoginPassword}
                    onChange={(e) => setStaffLoginPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-noir-panel border border-noir-border focus:border-noir-gold outline-none rounded-xl text-noir-text transition-all"
                  />
                </div>

                {authError && (
                  <div className="rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-[11px] text-red-300">
                    {authError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-2.5 bg-noir-gold hover:bg-noir-gold-hover disabled:opacity-70 text-black font-semibold text-xs rounded-xl transition-all cursor-pointer shadow-md"
                >
                  {authLoading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {activeRole === 'customer' && (
              <div className="space-y-4">
                <OrderingFlow 
                  menuItems={menuItems} 
                  appSettings={appSettings}
                  onOrderPlaced={refreshOrdersAndTables}
                  onGoToQueue={() => setActiveRole('staff')}
                  staffLoggedIn={!!staffSession}
                  lockedTable={lockedTable}
                  scannedTableQr={scannedTableQr}
                  activeTableOrders={activeTableOrders}
                  allTables={tables}
                  availableTables={lockedTable ? [lockedTable] : tables.filter(t => !t.is_in_use)}
                />
              </div>
            )}

            {activeRole === 'staff' && canAccessStaffTabs && (
              <StaffDashboard 
                orders={orders} 
                tables={tables}
                appSettings={appSettings}
                onRefresh={refreshOrdersAndTables} 
                staffId={staffSession.id}
                staffName={staffSession.name}
              />
            )}

            {activeRole === 'admin' && canAccessAdminTab && (
              <AdminDashboard 
                orders={orders} 
                menuItems={menuItems} 
                profiles={profiles} 
                tables={tables}
                appSettings={appSettings}
                menuLoadStatus={menuLoadStatus}
                onSettingsSaved={setAppSettings}
                onMenuReload={(status) => {
                  setMenuLoadStatus(status);
                  fetchActiveData();
                }}
                onRefresh={fetchActiveData}
                currentStaffId={staffSession.id}
              />
            )}

            {activeRole === 'chatbot' && canAccessChatbotTab && (
              <div className="max-w-5xl mx-auto">
                <Chatbot 
                  currentOrders={orders} 
                  menuItems={menuItems} 
                  isAdmin={staffSession?.role === 'admin'}
                  appSettings={appSettings}
                  staffLoggedIn={!!staffSession}
                  availableTables={lockedTable ? [lockedTable] : tables.filter(t => !t.is_in_use)}
                  defaultTableName={lockedTable?.table_name || 'Table 1'}
                  onOrderPlaced={refreshOrdersAndTables}
                />
              </div>
            )}

          </div>
        )}
      </main>

      {/* 3. Global footer */}
      <footer className="bg-noir-footer border-t border-noir-border py-6 mt-12 text-center" id="global-footer">
        <div className="max-w-7xl mx-auto px-4 text-xs text-noir-dim space-y-1.5 font-mono">
          <p>© 2026 Slice of Heaven Pizzeria Ltd. All rights reserved.</p>
          <p className="text-[10px] tracking-wider">
            Service status: {supabaseConnected ? '⚡ Cloud connected' : '💾 Offline demo mode'}
            {(config.hasAi ?? config.hasGemini)
              ? ` • 💬 AI assistant (${config.aiProvider || 'configured'}${config.aiModel ? `: ${config.aiModel}` : ''})`
              : ' • ⚠️ AI assistant unavailable'}
          </p>
        </div>
      </footer>
    </div>
  );
}
