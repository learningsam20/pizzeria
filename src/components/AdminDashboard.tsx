// Disable TS checking in this file to avoid missing ambient type errors for dev environment
// (e.g. "Could not find a declaration file for module 'react'.")
// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, Users, Pizza, BarChart3, PieChart as PieIcon, Layers, Trash2, 
  PlusCircle, Upload, ChevronLeft, ChevronRight, FileSpreadsheet, Sparkles, CheckCircle2, AlertTriangle, Play, SlidersHorizontal, RefreshCw
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line 
} from 'recharts';
import { MenuItem, Profile, Customer, OrderWithItems, OrderItem, DineInTable, AppSettings, MenuLoadStatus } from '../types';
import { parseMenuFileRow, validatePhone, validateEmail } from '../lib/inputValidation';
import { dbService } from '../lib/dbService';

interface AdminDashboardProps {
  orders: OrderWithItems[];
  menuItems: MenuItem[];
  profiles: Profile[];
  tables: DineInTable[];
  appSettings: AppSettings;
  menuLoadStatus: MenuLoadStatus | null;
  onSettingsSaved: (settings: AppSettings) => void;
  onMenuReload: (status: MenuLoadStatus) => void;
  onRefresh: () => void;
  currentStaffId: string | null;
}

export default function AdminDashboard({
  orders,
  menuItems,
  profiles,
  tables,
  appSettings,
  menuLoadStatus,
  onSettingsSaved,
  onMenuReload,
  onRefresh,
  currentStaffId,
}: AdminDashboardProps) {
  const [activeSubTab, setActiveSubTab] = useState<'analytics' | 'users' | 'customers' | 'menu' | 'settings'>('analytics');
  
  // Pagination & Search States
  const [custPage, setCustPage] = useState(1);
  const [custSearch, setCustSearch] = useState('');
  const [customersData, setCustomersData] = useState<{ data: Customer[]; totalCount: number }>({ data: [], totalCount: 0 });
  const [menuSearch, setMenuSearch] = useState('');
  const [profileSearch, setProfileSearch] = useState('');

  // Individual Form States
  const [showAddForm, setShowAddForm] = useState(false);
  const [formType, setFormType] = useState<'customer' | 'menu' | 'profile'>('customer');
  
  // Customer Form
  const [custName, setCustName] = useState('');
  const [custLookupInput, setCustLookupInput] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custAddress, setCustAddress] = useState('');
  const [custExistingId, setCustExistingId] = useState<number | null>(null);
  const [custLookupStatus, setCustLookupStatus] = useState<'idle' | 'loading' | 'found' | 'new'>('idle');
  const [custLookupError, setCustLookupError] = useState<string | null>(null);
  
  // Menu Item Form
  const [menuCode, setMenuCode] = useState('');
  const [menuCat, setMenuCat] = useState<'base' | 'pizza' | 'topping'>('pizza');
  const [menuName, setMenuName] = useState('');
  const [menuPrice, setMenuPrice] = useState('');
  const [menuDesc, setMenuDesc] = useState('');
  
  // Staff Form
  const [staffEmail, setStaffEmail] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState<'staff' | 'admin'>('staff');

  // Bulk Upload States
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [bulkFormat, setBulkFormat] = useState<'csv' | 'json'>('csv');
  const [bulkResult, setBulkResult] = useState<{ success: number; errors: string[] } | null>(null);
  const [bulkFileName, setBulkFileName] = useState('');
  const [bulkDefaultMenuCategory, setBulkDefaultMenuCategory] = useState<'base' | 'pizza' | 'topping'>('pizza');
  const [bulkCategoryDetected, setBulkCategoryDetected] = useState<string | null>(null);

  // Status/Error Messages
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [chatStats, setChatStats] = useState<{ totalSessions: number; totalMessages: number; verifiedLookups: number; uniqueCustomers: number } | null>(null);
  const [analyticsRefreshing, setAnalyticsRefreshing] = useState(false);

  const [settingsDiscount, setSettingsDiscount] = useState(String(appSettings.bulk_discount_percent));
  const [settingsMinQty, setSettingsMinQty] = useState(String(appSettings.bulk_discount_min_qty));
  const [settingsCurrency, setSettingsCurrency] = useState(appSettings.default_currency);
  const [settingsGst, setSettingsGst] = useState(String(appSettings.gst_percent));
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [menuReloading, setMenuReloading] = useState(false);

  useEffect(() => {
    setSettingsDiscount(String(appSettings.bulk_discount_percent));
    setSettingsMinQty(String(appSettings.bulk_discount_min_qty));
    setSettingsCurrency(appSettings.default_currency);
    setSettingsGst(String(appSettings.gst_percent));
  }, [appSettings]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/chat/analytics')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setChatStats(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (activeSubTab !== 'analytics') return;

    let cancelled = false;
    const refresh = async () => {
      setAnalyticsRefreshing(true);
      try {
        await onRefresh();
        const r = await fetch('/api/chat/analytics');
        if (!cancelled && r.ok) {
          const d = await r.json();
          if (d) setChatStats(d);
        }
      } catch {
        // ignore refresh errors
      } finally {
        if (!cancelled) setAnalyticsRefreshing(false);
      }
    };

    refresh();
    const interval = setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeSubTab]); // onRefresh from parent is not memoized; manual Refresh button calls refreshAnalytics()

  useEffect(() => {
    let cancelled = false;
    dbService.getCustomers(custPage, 6, custSearch)
      .then(data => { if (!cancelled) setCustomersData(data); })
      .catch(err => { if (!cancelled) console.error('Error loading customers:', err); });
    return () => { cancelled = true; };
  }, [custPage, custSearch, orders]);

  const refreshAnalytics = async () => {
    setAnalyticsRefreshing(true);
    try {
      await onRefresh();
      const r = await fetch('/api/chat/analytics');
      if (r.ok) {
        const d = await r.json();
        if (d) setChatStats(d);
      }
    } catch {
      // ignore refresh errors
    } finally {
      setAnalyticsRefreshing(false);
    }
  };

  const loadCustomers = async () => {
    try {
      const data = await dbService.getCustomers(custPage, 6, custSearch);
      setCustomersData(data);
    } catch (err: any) {
      console.error('Error loading customers:', err);
    }
  };

  const totalTables = tables.length;
  const occupiedTables = tables.filter(t => t.is_in_use).length;
  const freeTables = totalTables - occupiedTables;
  const totalSeats = tables.reduce((sum, t) => sum + t.capacity, 0);
  const occupiedSeats = tables.filter(t => t.is_in_use).reduce((sum, t) => sum + t.capacity, 0);

  const analytics = dbService.calculateAnalytics(orders, profiles);

  const resetCustForm = () => {
    setCustName('');
    setCustLookupInput('');
    setCustPhone('');
    setCustEmail('');
    setCustAddress('');
    setCustExistingId(null);
    setCustLookupStatus('idle');
    setCustLookupError(null);
  };

  const handleCustLookup = async () => {
    setCustLookupError(null);
    const trimmed = custLookupInput.trim();
    if (!trimmed) {
      setCustLookupError('Enter a mobile number or email to look up.');
      setCustLookupStatus('idle');
      return;
    }

    let identifier = trimmed;
    if (trimmed.includes('@')) {
      const emailCheck = validateEmail(trimmed, { required: true });
      if (!emailCheck.ok) {
        setCustLookupError(emailCheck.error);
        setCustLookupStatus('idle');
        return;
      }
      identifier = trimmed.toLowerCase();
    } else {
      identifier = trimmed.replace(/\D/g, '').slice(0, 10);
      setCustLookupInput(identifier);
      const phoneCheck = validatePhone(identifier);
      if (!phoneCheck.ok) {
        setCustLookupError(phoneCheck.error);
        setCustLookupStatus('idle');
        return;
      }
    }

    setCustLookupStatus('loading');
    try {
      const existing = await dbService.findCustomerByPhoneOrEmail(identifier);
      if (existing) {
        setCustExistingId(existing.id);
        setCustName(existing.name);
        setCustPhone(existing.phone);
        setCustEmail(existing.email || '');
        setCustAddress(existing.delivery_address || '');
        setCustLookupStatus('found');
      } else {
        setCustExistingId(null);
        setCustName('');
        setCustAddress('');
        if (trimmed.includes('@')) {
          setCustEmail(identifier);
          setCustPhone('');
        } else {
          setCustPhone(identifier);
          setCustEmail('');
        }
        setCustLookupStatus('new');
      }
    } catch (err: any) {
      setCustLookupError(err.message || 'Could not look up customer.');
      setCustLookupStatus('idle');
    }
  };

  // Handle Individual Adds
  const handleAddIndividual = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);

    try {
      if (formType === 'customer') {
        const trimmedPhone = custPhone.replace(/\D/g, '').slice(0, 10);
        const phoneCheck = validatePhone(trimmedPhone);
        if (!phoneCheck.ok) throw new Error(phoneCheck.error);

        const payload = {
          name: custName.trim(),
          phone: trimmedPhone,
          email: custEmail.trim() || null,
          delivery_address: custAddress.trim() || null,
        };

        if (custExistingId) {
          await dbService.updateCustomer(custExistingId, payload);
          setStatusMsg({ type: 'success', text: `Updated customer ${payload.name}.` });
        } else {
          const existing = await dbService.findCustomerByPhone(trimmedPhone);
          if (existing) {
            throw new Error('This mobile number is already registered. Look up by mobile or email to load and edit the existing customer.');
          }
          await dbService.createCustomer(payload);
          setStatusMsg({ type: 'success', text: `Successfully registered customer ${payload.name}!` });
        }
        resetCustForm();
        loadCustomers();
      } else if (formType === 'menu') {
        const priceNum = parseFloat(menuPrice);
        if (isNaN(priceNum) || priceNum <= 0) {
          throw new Error("Price must be a valid number greater than 0");
        }
        await dbService.createMenuItem({
          code: menuCode.trim().toUpperCase(),
          category: menuCat,
          name: menuName.trim(),
          price_inr: priceNum,
          currency: appSettings.default_currency,
          description: menuDesc.trim() || null,
          is_active: true
        });
        setStatusMsg({ type: 'success', text: `Successfully created menu item ${menuName}!` });
        // Clear Form
        setMenuCode('');
        setMenuName('');
        setMenuPrice('');
        setMenuDesc('');
      } else if (formType === 'profile') {
        if (!staffEmail.includes('@')) {
          throw new Error("Invalid email address format.");
        }

        const result = await dbService.inviteStaffAccount({
          email: staffEmail.trim().toLowerCase(),
          displayName: staffName.trim() || null,
          role: staffRole
        });

        setStatusMsg({ type: 'success', text: result.message });
        setStaffEmail('');
        setStaffName('');
      }
      
      setShowAddForm(false);
      onRefresh();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentStaffId) return;
    setSettingsSaving(true);
    setStatusMsg(null);
    try {
      const updated = await dbService.updateSettings(currentStaffId, {
        bulk_discount_percent: Number(settingsDiscount),
        bulk_discount_min_qty: Number(settingsMinQty),
        default_currency: settingsCurrency.trim().toUpperCase(),
        gst_percent: Number(settingsGst),
      });
      onSettingsSaved(updated);
      setStatusMsg({ type: 'success', text: 'Store settings saved.' });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Could not save settings.' });
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleReloadInputData = async () => {
    setMenuReloading(true);
    setStatusMsg(null);
    try {
      const status = await dbService.reloadInputDataMenu();
      onMenuReload(status);
      onRefresh();
      setStatusMsg({
        type: status.hasErrors ? 'error' : 'success',
        text: status.hasErrors
          ? `Reload finished with ${status.totalErrors} issue(s). Check input_data/ files or use Bulk Upload.`
          : `Reloaded ${status.totalSuccess} menu items from input_data/.`,
      });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Reload failed.' });
    } finally {
      setMenuReloading(false);
    }
  };

  // Parse Bulk Input
  const inferCategoryFromFile = (name: string, content: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('base')) return 'base';
    if (lowerName.includes('pizza')) return 'pizza';
    if (lowerName.includes('topping') || lowerName.includes('toppings')) return 'topping';

    const lowerContent = content.toLowerCase();
    if (lowerContent.includes('base')) return 'base';
    if (lowerContent.includes('pizza')) return 'pizza';
    if (lowerContent.includes('topping')) return 'topping';
    return null;
  };

  const readBulkFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setBulkInput(text);
      setBulkFileName(file.name);
      const inferred = inferCategoryFromFile(file.name, text);
      if (inferred) {
        setBulkDefaultMenuCategory(inferred as 'base' | 'pizza' | 'topping');
        setBulkCategoryDetected(inferred);
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const parseDelimitedRows = (text: string) => {
    const rawLines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    if (rawLines.length === 0) return [];

    const firstLine = rawLines[0];
    const delimiter = firstLine.includes(';') ? ';' : ',';
    const firstRowCells = firstLine.split(delimiter).map(cell => cell.trim());
    const knownHeaders = new Set(['code','id','item_code','sku','category','type','item_type','name','dish','title','item_name','price','price_inr','cost','description','details','note','is_active']);
    const normalizedFirstCells = firstRowCells.map(cell => cell.toLowerCase());
    const headerMatches = normalizedFirstCells.filter(cell => knownHeaders.has(cell)).length;
    const hasHeaderRow = headerMatches >= 2 || normalizedFirstCells.includes('code') || normalizedFirstCells.includes('name');

    const rows: any[] = [];
    const headers = hasHeaderRow
      ? normalizedFirstCells
      : (firstRowCells.length === 3
          ? ['code','name','price_inr']
          : (firstRowCells.length === 4 ? ['code','name','price_inr','description'] : normalizedFirstCells));

    const dataLines = hasHeaderRow ? rawLines.slice(1) : rawLines;
    for (const line of dataLines) {
      const values = line.split(delimiter).map(v => v.trim());
      if (values.every(v => v.length === 0)) continue;
      if (values.length !== headers.length) continue;
      const rowObj: any = {};
      headers.forEach((h, idx) => {
        rowObj[h] = values[idx];
      });
      rows.push(rowObj);
    }

    return rows;
  };

  const handleBulkUpload = async () => {
    setBulkResult(null);
    setStatusMsg(null);
    if (!bulkInput.trim()) return;

    try {
      let rows: any[] = [];
      
      if (bulkFormat === 'json') {
        const parsed = JSON.parse(bulkInput);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        rows = parseDelimitedRows(bulkInput);
        if (rows.length === 0) {
          throw new Error("Delimited upload must contain data rows in the selected format.");
        }
      }

      // Auto-detect category from file name or content for menu uploads
      if (formType === 'menu') {
        const inferred = inferCategoryFromFile(bulkFileName, bulkInput);
        if (inferred) {
          setBulkDefaultMenuCategory(inferred as 'base' | 'pizza' | 'topping');
          setBulkCategoryDetected(inferred);
        }
      }

      const normalizeMenuCategory = (value: unknown) => {
        const raw = String(value || '').trim().toLowerCase();
        if (raw.startsWith('b') || raw === 'base') return 'base';
        if (raw.startsWith('t') || raw === 'topping' || raw === 'toppings') return 'topping';
        return 'pizza';
      };

      const formatMenuValue = (value: unknown) => {
        return value == null ? '' : String(value).trim();
      };

      // Execute insertions based on tab
      if (formType === 'customer') {
        const formatted = rows.map(r => ({
          name: r.name || r.customer_name,
          phone: String(r.phone || r.customer_phone || ''),
          email: r.email ? String(r.email).trim().toLowerCase() : null,
          delivery_address: r.address || r.delivery_address || null
        }));
        const res = await dbService.bulkCreateCustomers(formatted);
        setBulkResult(res);
        loadCustomers();
      } else if (formType === 'menu') {
        const formatted: Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>[] = [];
        const rowErrors: string[] = [];
        rows.forEach((r, idx) => {
          const parsed = parseMenuFileRow(r as Record<string, unknown>, idx + 1);
          if (!parsed.ok) {
            rowErrors.push(parsed.error);
            return;
          }
          formatted.push({
            code: parsed.code.toUpperCase(),
            category: bulkDefaultMenuCategory,
            name: parsed.name,
            price_inr: parsed.price_inr,
            currency: appSettings.default_currency,
            description: parsed.description,
            is_active: String(r.is_active || 'true').toLowerCase() !== 'false',
          });
        });
        if (formatted.length === 0 && rowErrors.length > 0) {
          setBulkResult({ success: 0, errors: rowErrors });
          setStatusMsg({ type: 'error', text: rowErrors[0] });
          return;
        }
        const res = await dbService.bulkCreateMenuItems(formatted);
        setBulkResult({ ...res, errors: [...rowErrors, ...res.errors] });
        if (res.errors.length > 0) {
          setStatusMsg({
            type: 'error',
            text: `Imported ${res.success} items (${res.created} created, ${res.replaced} replaced), but ${res.errors.length} row issues occurred.`
          });
        } else {
          setStatusMsg({
            type: 'success',
            text: `Imported ${res.success} items successfully (${res.created} created, ${res.replaced} replaced).`
          });
        }
      } else if (formType === 'profile') {
        let successCount = 0;
        const errors: string[] = [];
        for (const r of rows) {
          try {
            const result = await dbService.inviteStaffAccount({
              email: String(r.email || '').trim().toLowerCase(),
              displayName: r.name || r.display_name || null,
              role: (r.role === 'admin' ? 'admin' : 'staff')
            });
            if (result.success) successCount++;
          } catch (err: any) {
            errors.push(`Row email ${r.email}: ${err.message}`);
          }
        }
        setBulkResult({ success: successCount, errors });
      }

      setBulkInput('');
      onRefresh();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: 'Failed to parse inputs: ' + err.message });
    }
  };

  const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
  const COLOR_CLASSES = ['bg-red-500','bg-amber-500','bg-emerald-500','bg-sky-500','bg-indigo-500','bg-pink-500'];

  return (
    <div className="space-y-6" id="admin-dashboard">
      {/* Header with quick stats */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-serif italic text-noir-text tracking-tight">Business Executive Control Room</h2>
          <p className="text-xs text-noir-dim font-mono">Live database mode: {dbService.isSupabaseConnected() ? '⚡ Connected to Supabase' : '💾 Fallback Local Browser DB'}</p>
        </div>
        
        <div className="flex flex-wrap gap-2.5">
          {activeSubTab === 'analytics' && (
            <button
              type="button"
              onClick={refreshAnalytics}
              disabled={analyticsRefreshing}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-noir-border bg-noir-panel text-noir-muted hover:text-noir-gold hover:border-noir-gold-o20 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${analyticsRefreshing ? 'animate-spin' : ''}`} />
              Refresh analytics
            </button>
          )}
          {!dbService.isSupabaseConnected() && (
            <div className="bg-amber-950/40 border border-amber-900/40 text-amber-300 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>Connect Supabase in Secrets for cloud syncing</span>
            </div>
          )}
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="flex border-b border-noir-border pb-px font-sans">
        {(['analytics', 'users', 'customers', 'menu', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveSubTab(tab);
              setFormType(tab === 'menu' ? 'menu' : tab === 'users' ? 'profile' : 'customer');
              setStatusMsg(null);
            }}
            className={`px-5 py-3 border-b-2 text-sm font-medium transition-all cursor-pointer ${
              activeSubTab === tab 
                ? 'border-noir-gold text-noir-gold font-semibold bg-noir-highlight/30' 
                : 'border-transparent text-noir-dim hover:text-noir-text hover:border-noir-border'
            }`}
          >
            {tab === 'menu' ? 'Pizza & Master Menu' : tab === 'settings' ? 'Store Settings' : tab === 'users' ? 'User Management' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeSubTab === 'users' && (
        <div className="rounded-xl border border-purple-900/30 bg-purple-950/20 p-4 text-xs text-purple-100 space-y-2">
          <p className="font-semibold text-purple-200">User Management</p>
          <p>Add staff or admin accounts by email. Login instructions are emailed to the user only — admins never see the temporary password.</p>
          <p>Every new user must set a new password on first login. The first admin account must still be created once in Supabase Console.</p>
        </div>
      )}

      {statusMsg && (
        <div className={`p-4 rounded-xl text-sm font-medium flex items-center gap-2.5 border ${
          statusMsg.type === 'success' ? 'bg-emerald-950/40 border-emerald-900/40 text-emerald-300' : 'bg-red-950/40 border-red-900/40 text-red-300'
        }`}>
          {statusMsg.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertTriangle className="w-5 h-5 text-red-400" />}
          <span className="flex-1">{statusMsg.text}</span>
          <button onClick={() => setStatusMsg(null)} className="text-xs text-noir-dim hover:text-noir-text">Dismiss</button>
        </div>
      )}

      {/* RENDER ANALYTICS TAB */}
      {activeSubTab === 'analytics' && (
        <div className="space-y-6" id="analytics-panel">
          {/* KPI Dashboard Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-noir-dim uppercase tracking-wider">Gross Sales Payable</p>
                <h3 className="text-2xl font-bold text-noir-gold mt-1">₹{analytics.totalRevenue.toLocaleString('en-IN')}</h3>
                <p className="text-[10px] text-noir-dim mt-0.5 font-mono">Paid orders only · {analytics.deliveredCount} completed</p>
              </div>
              <div className="p-3 bg-noir-highlight rounded-xl text-noir-gold border border-noir-gold-o20">
                <TrendingUp className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-noir-dim uppercase tracking-wider">Order Volume</p>
                <h3 className="text-2xl font-bold text-noir-gold mt-1">{analytics.ordersCount} Total</h3>
                <p className="text-[10px] text-noir-dim mt-0.5 font-mono">
                  {analytics.activeOrdersCount} in pipeline · ₹{analytics.pipelineValue.toLocaleString('en-IN')} open
                </p>
              </div>
              <div className="p-3 bg-noir-highlight rounded-xl text-noir-gold border border-noir-gold-o20">
                <Layers className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-noir-dim uppercase tracking-wider">Dine-In Table Usage</p>
                <h3 className="text-2xl font-bold text-noir-gold mt-1">{occupiedTables}/{totalTables}</h3>
                <p className="text-[10px] text-noir-dim mt-0.5 font-mono">
                  {freeTables} free · {occupiedSeats}/{totalSeats} seats in use
                </p>
              </div>
              <div className="p-3 bg-noir-highlight rounded-xl text-noir-gold border border-noir-gold-o20">
                <Users className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-noir-dim uppercase tracking-wider">GST Collected (5%)</p>
                <h3 className="text-2xl font-bold text-noir-gold mt-1">₹{analytics.totalGst.toLocaleString('en-IN')}</h3>
                <p className="text-[10px] text-noir-dim mt-0.5 font-mono">Net base subtotal: ₹{analytics.subtotalRevenue.toLocaleString('en-IN')}</p>
              </div>
              <div className="p-3 bg-noir-highlight rounded-xl text-noir-gold border border-noir-gold-o20">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-noir-dim uppercase tracking-wider">Kitchen Churn Rate</p>
                <h3 className="text-2xl font-bold text-noir-gold mt-1">
                  {analytics.ordersCount > 0 ? ((analytics.cancelledCount / analytics.ordersCount) * 100).toFixed(1) : 0}%
                </h3>
                <p className="text-[10px] text-noir-dim mt-0.5 font-mono">
                  {analytics.cancelledCount} order failures logged
                </p>
              </div>
              <div className="p-3 bg-noir-highlight rounded-xl text-noir-gold border border-noir-gold-o20">
                <Trash2 className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-noir-dim uppercase tracking-wider">Support Chat</p>
                <h3 className="text-2xl font-bold text-noir-gold mt-1">{chatStats?.totalSessions ?? '—'}</h3>
                <p className="text-[10px] text-noir-dim mt-0.5 font-mono">
                  {chatStats ? `${chatStats.totalMessages} msgs · ${chatStats.verifiedLookups} verified · ${chatStats.uniqueCustomers} customers` : 'Run chat_logs migration in Config'}
                </p>
              </div>
              <div className="p-3 bg-noir-highlight rounded-xl text-noir-gold border border-noir-gold-o20">
                <Sparkles className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Graphical Analytics Charts (using recharts) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* 1. Popular Items Bar Chart */}
            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg">
              <h3 className="text-base font-serif italic text-noir-gold mb-4 flex items-center gap-1.5">
                <Pizza className="w-5 h-5" /> Top Selling Pizza & Add-ons
              </h3>
              <div className="h-64">
                {analytics.popularItems.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.popularItems.slice(0, 5)}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e1e24" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8b8b93' }} stroke="#2d2d34" />
                      <YAxis label={{ value: 'Qty Sold', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#8b8b93' }} tick={{ fontSize: 10, fill: '#8b8b93' }} stroke="#2d2d34" />
                      <Tooltip contentStyle={{ backgroundColor: '#131316', borderColor: '#2d2d34', color: '#c5a059' }} formatter={(value) => [`${value} units`, 'Quantity']} />
                      <Bar dataKey="quantity" fill="#c5a059" radius={[4, 4, 0, 0]}>
                        {analytics.popularItems.slice(0, 5).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-noir-dim">
                    <Pizza className="w-10 h-10 stroke-1 mb-2 text-noir-dim" />
                    <p className="text-xs">No food orders processed yet</p>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Payment Modes Split */}
            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg">
              <h3 className="text-base font-serif italic text-noir-gold mb-4 flex items-center gap-1.5">
                <PieIcon className="w-5 h-5" /> Revenue Split by Payment Mode
              </h3>
              <div className="h-64 flex items-center justify-center">
                {orders.some(o => o.status !== 'cancelled') ? (
                  <div className="w-full h-full flex flex-col md:flex-row items-center justify-around">
                    <div className="w-48 h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={analytics.paymentModesChart}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
                            paddingAngle={4}
                            dataKey="value"
                          >
                            {analytics.paymentModesChart.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ backgroundColor: '#131316', borderColor: '#2d2d34' }} formatter={(value) => [`₹${value.toLocaleString()}`, 'Total Revenue']} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2">
                      {analytics.paymentModesChart.map((mode, idx) => (
                        <div key={mode.name} className="flex items-center space-x-3 text-xs text-noir-text">
                          <span className={`w-3 h-3 rounded-full inline-block ${COLOR_CLASSES[idx % COLOR_CLASSES.length]}`} aria-hidden="true"></span>
                          <span className="font-semibold text-noir-text w-16">{mode.name}:</span>
                          <span className="text-noir-gold font-mono">₹{mode.value.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-noir-dim">No active revenue data available</p>
                )}
              </div>
            </div>

            {/* 3. Hourly Order distribution */}
            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg">
              <h3 className="text-base font-serif italic text-noir-gold mb-4 flex items-center gap-1.5">
                <BarChart3 className="w-5 h-5" /> Hourly Shop Traffic
              </h3>
              <div className="h-64">
                {analytics.hourlySalesData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={analytics.hourlySalesData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e1e24" />
                      <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#8b8b93' }} stroke="#2d2d34" />
                      <YAxis tick={{ fontSize: 10, fill: '#8b8b93' }} stroke="#2d2d34" />
                      <Tooltip contentStyle={{ backgroundColor: '#131316', borderColor: '#2d2d34' }} formatter={(value) => [`₹${value}`, 'Sales']} />
                      <Legend />
                      <Line type="monotone" dataKey="sales" name="Sales (₹)" stroke="#c5a059" activeDot={{ r: 8 }} strokeWidth={2} />
                      <Line type="monotone" dataKey="orders" name="Order count" stroke="#10b981" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center text-xs text-noir-dim pt-20">Hourly data will plot as customer transactions occur</p>
                )}
              </div>
            </div>

            {/* 4. Kitchen Efficiency & Durations */}
            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg">
              <h3 className="text-base font-serif italic text-noir-gold mb-4 flex items-center gap-1.5">
                <TrendingUp className="w-5 h-5" /> Average Wait Cycle Durations
              </h3>
              <div className="space-y-6 pt-3">
                <div>
                  <div className="flex justify-between text-xs font-semibold text-noir-text mb-1">
                    <span>Queue Wait Time (Confirmed → Cook Started)</span>
                    <span className="font-mono text-red-400">{analytics.metrics.avgQueueTimeMin.toFixed(1)} mins</span>
                  </div>
                  <div className="w-full bg-noir-panel h-2.5 rounded-full overflow-hidden border border-noir-border">
                    {(() => {
                      const pct = Math.min(100, analytics.metrics.avgQueueTimeMin * 4);
                      const widthClass = pct <= 25 ? 'w-1/4' : pct <= 50 ? 'w-1/2' : pct <= 75 ? 'w-3/4' : 'w-full';
                      return <div className={`bg-red-500 h-full transition-all duration-500 ${widthClass}`} />;
                    })()}
                  </div>
                  <p className="text-[10px] text-noir-dim mt-1">Measures kitchen prep bottlenecks and chef readiness.</p>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-noir-text mb-1">
                    <span>Active Preparation Efficiency (Cook Started → Ready)</span>
                    <span className="font-mono text-amber-400">{analytics.metrics.avgPrepTimeMin.toFixed(1)} mins</span>
                  </div>
                  <div className="w-full bg-noir-panel h-2.5 rounded-full overflow-hidden border border-noir-border">
                    {(() => {
                      const pct = Math.min(100, analytics.metrics.avgPrepTimeMin * 4);
                      const widthClass = pct <= 25 ? 'w-1/4' : pct <= 50 ? 'w-1/2' : pct <= 75 ? 'w-3/4' : 'w-full';
                      return <div className={`bg-amber-500 h-full transition-all duration-500 ${widthClass}`} />;
                    })()}
                  </div>
                  <p className="text-[10px] text-noir-dim mt-1">Measures average cooking duration inside pizza ovens.</p>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-noir-text mb-1">
                    <span>Dine-In Delivery Cycle (Ready → Served)</span>
                    <span className="font-mono text-emerald-400">{analytics.metrics.avgDeliveryCycleMin.toFixed(1)} mins</span>
                  </div>
                  <div className="w-full bg-noir-panel h-2.5 rounded-full overflow-hidden border border-noir-border">
                    {(() => {
                      const pct = Math.min(100, analytics.metrics.avgDeliveryCycleMin * 4);
                      const widthClass = pct <= 25 ? 'w-1/4' : pct <= 50 ? 'w-1/2' : pct <= 75 ? 'w-3/4' : 'w-full';
                      return <div className={`bg-emerald-500 h-full transition-all duration-500 ${widthClass}`} />;
                    })()}
                  </div>
                  <p className="text-[10px] text-noir-dim mt-1">Measures table-delivery cycle efficiency of runners.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Staff Performance Matrix Grid */}
          <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg">
            <h3 className="text-base font-serif italic text-noir-gold mb-4 flex items-center gap-1.5">
              <Users className="w-5 h-5" /> Active Staff Operational Performance Rating
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-noir-border text-noir-dim uppercase tracking-wider font-mono">
                    <th className="pb-3 pt-1">Staff Member</th>
                    <th className="pb-3 pt-1">Primary Email</th>
                    <th className="pb-3 pt-1 text-center">Orders Prepared & Handled</th>
                    <th className="pb-3 pt-1 text-right">Avg Chef Prep Speed</th>
                    <th className="pb-3 pt-1 text-right">Fulfillment Quality</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-noir-border">
                  {analytics.staffPerformance.length > 0 ? (
                    analytics.staffPerformance.map(staff => (
                      <tr key={staff.id} className="hover:bg-noir-highlight/30 transition-colors">
                        <td className="py-3 font-semibold text-noir-text">{staff.name}</td>
                        <td className="py-3 font-mono text-noir-muted">{staff.email}</td>
                        <td className="py-3 text-center font-bold text-noir-text">{staff.ordersProcessed}</td>
                        <td className="py-3 text-right font-mono text-amber-400 font-semibold">{staff.avgPrepTimeMinutes} mins</td>
                        <td className="py-3 text-right">
                          <span className="px-2 py-0.5 bg-emerald-950/40 text-emerald-300 border border-emerald-900/40 rounded-md font-medium text-[10px]">
                            Excellent
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="text-center py-6 text-noir-dim">Assign staff members to order preparação flow to compile speed analytics.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cancellation Reasons Logs */}
          <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg">
            <h3 className="text-base font-serif italic text-noir-gold mb-3 flex items-center gap-1.5">
              <AlertTriangle className="w-5 h-5 text-red-400" /> Detailed Quality Logs (Revenue Cancellations)
            </h3>
            <p className="text-xs text-noir-muted mb-4 font-sans">Reviews lost revenue and reasons logged by staff when order fails.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-noir-border text-noir-dim uppercase font-mono">
                    <th className="pb-3">Order ID</th>
                    <th className="pb-3">Customer Name</th>
                    <th className="pb-3">Logged Failure Reason</th>
                    <th className="pb-3 text-right">Refund Amount</th>
                    <th className="pb-3 text-right">Cancelled Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-noir-border">
                  {analytics.cancellationReasons.length > 0 ? (
                    analytics.cancellationReasons.map(c => (
                      <tr key={c.id} className="hover:bg-noir-highlight/30 transition-colors">
                        <td className="py-3 font-mono font-bold text-red-400">#{c.id}</td>
                        <td className="py-3 font-medium text-noir-text">{c.customer}</td>
                        <td className="py-3 text-noir-muted italic font-sans">"{c.reason}"</td>
                        <td className="py-3 text-right font-mono text-noir-text font-semibold">₹{c.amount}</td>
                        <td className="py-3 text-right text-noir-dim font-mono">{new Date(c.at).toLocaleTimeString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="text-center py-6 text-noir-dim">Zero churn! No cancelled orders registered today.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* RENDER MASTER CUSTOMERS TAB */}
      {activeSubTab === 'customers' && (
        <div className="bg-noir-card p-6 rounded-2xl border border-noir-border shadow-lg space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-serif italic text-noir-gold">Customers Registry (Master Table)</h3>
              <p className="text-xs text-noir-muted">Add, bulk-upload, and search client records securely.</p>
            </div>
            
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setFormType('customer');
                  if (showAddForm) resetCustForm();
                  setShowAddForm(!showAddForm);
                  setShowBulkUpload(false);
                }}
                className="px-3.5 py-1.5 bg-noir-gold hover:bg-noir-gold-hover text-black rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" /> Add Customer
              </button>
              <button
                onClick={() => { setShowBulkUpload(!showBulkUpload); setShowAddForm(false); }}
                className="px-3.5 py-1.5 bg-noir-highlight hover:bg-noir-sidebar text-noir-text rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer border border-noir-border"
              >
                <Upload className="w-4 h-4 text-noir-gold" /> Bulk Upload (CSV/JSON)
              </button>
            </div>
          </div>

          {/* Search Box */}
          <div className="max-w-md">
            <input
              type="text"
              placeholder="Search customers by name, phone, or email..."
              value={custSearch}
              onChange={(e) => { setCustSearch(e.target.value); setCustPage(1); }}
              className="w-full px-3.5 py-2 bg-noir-panel border border-noir-border focus:border-noir-gold text-noir-text outline-none rounded-xl text-xs transition-all"
            />
          </div>

          {/* Individual Register Form */}
          {showAddForm && formType === 'customer' && (
            <form onSubmit={handleAddIndividual} className="bg-noir-panel p-4 border border-noir-border rounded-xl grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-3 pb-2 border-b border-noir-border flex justify-between items-center">
                <h4 className="text-xs font-semibold text-noir-gold uppercase tracking-wider">Register or Update Customer</h4>
                <button type="button" onClick={() => { setShowAddForm(false); resetCustForm(); }} className="text-[10px] text-noir-dim hover:text-noir-text">Cancel</button>
              </div>

              <div className="md:col-span-3 rounded-lg border border-noir-border bg-noir-card/50 p-3 space-y-2">
                <p className="text-[10px] text-noir-muted">Enter a mobile number or email and look up an existing customer, or continue to register a new one.</p>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Mobile or email *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 9876543210 or you@example.com"
                      value={custLookupInput}
                      onChange={(e) => {
                        setCustLookupInput(e.target.value);
                        setCustExistingId(null);
                        setCustLookupStatus('idle');
                        setCustLookupError(null);
                      }}
                      className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCustLookup}
                    disabled={custLookupStatus === 'loading'}
                    className="px-4 py-1.5 bg-noir-highlight hover:bg-noir-sidebar border border-noir-border text-noir-text rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {custLookupStatus === 'loading' ? 'Looking up…' : 'Look up'}
                  </button>
                </div>
                {custLookupError && <p className="text-[10px] text-red-400">{custLookupError}</p>}
                {custLookupStatus === 'found' && (
                  <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Existing customer found — details loaded below. Save to update their record.
                  </p>
                )}
                {custLookupStatus === 'new' && (
                  <p className="text-[10px] text-amber-300">No customer with this number. Fill in the details below to add a new record.</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Customer Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Kumar"
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  disabled={custLookupStatus === 'idle'}
                  className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Mobile Number *</label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 9876543210"
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  disabled={custLookupStatus === 'idle'}
                  className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs font-mono disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  placeholder="e.g. rahul@example.com"
                  value={custEmail}
                  onChange={(e) => setCustEmail(e.target.value)}
                  disabled={custLookupStatus === 'idle'}
                  className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">&nbsp;</label>
                <button
                  type="button"
                  onClick={() => { setCustExistingId(null); setCustLookupStatus('new'); setCustName(''); setCustEmail(''); setCustAddress(''); }}
                  disabled={custLookupStatus === 'idle'}
                  className="w-full px-3 py-1.5 border border-noir-border rounded-lg text-[10px] text-noir-muted hover:text-noir-text disabled:opacity-40"
                >
                  Clear fields (keep as new)
                </button>
              </div>
              <div className="space-y-1 md:col-span-3">
                <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Delivery Address</label>
                <input
                  type="text"
                  placeholder="e.g. Room 402, Bangalore"
                  value={custAddress}
                  onChange={(e) => setCustAddress(e.target.value)}
                  disabled={custLookupStatus === 'idle'}
                  className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs disabled:opacity-50"
                />
              </div>
              <div className="md:col-span-3 pt-2 flex items-center gap-3">
                <button
                  type="submit"
                  disabled={custLookupStatus === 'idle'}
                  className="px-4 py-2 bg-noir-gold hover:bg-noir-gold-hover disabled:opacity-50 text-black rounded-lg text-xs font-bold cursor-pointer"
                >
                  {custExistingId ? 'Update Customer' : 'Save New Customer'}
                </button>
                {custLookupStatus === 'idle' && (
                  <span className="text-[10px] text-noir-dim">Look up by mobile or email first, or enter a value and click Look up.</span>
                )}
              </div>
            </form>
          )}

          {/* Bulk Paste Form */}
          {showBulkUpload && (
            <div className="bg-noir-panel p-4 border border-noir-border rounded-xl space-y-3">
              <div className="flex justify-between items-center pb-2 border-b border-noir-border">
                <h4 className="text-xs font-semibold text-noir-gold uppercase">Bulk Upload Customers</h4>
                <div className="flex bg-noir-card p-0.5 rounded border border-noir-border text-[10px]">
                  <button onClick={() => setBulkFormat('csv')} className={`px-2 py-0.5 rounded ${bulkFormat === 'csv' ? 'bg-noir-gold text-black' : 'text-noir-dim'}`}>CSV</button>
                  <button onClick={() => setBulkFormat('json')} className={`px-2 py-0.5 rounded ${bulkFormat === 'json' ? 'bg-noir-gold text-black' : 'text-noir-dim'}`}>JSON</button>
                </div>
              </div>

              <p className="text-[10px] text-noir-dim font-sans">
                {bulkFormat === 'csv' 
                  ? 'First row must be header: name,phone,email,address. Accented names like "Añejo" and 10-digit Indian phones starting with 6-9 are verified.'
                  : 'Must be an array of objects: [{"name":"Rahul","phone":"9876543210","email":"rahul@example.com","address":"Mumbai"}]'}
              </p>

              <textarea
                rows={4}
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder={bulkFormat === 'csv' ? 'name,phone,address\nRajesh Kumar,9876543210,123 Green Lane Bangalore\nAnika Rao,8765432109,Flat 1A Mumbai' : '[{"name":"Rajesh","phone":"9876543210"}]'}
                className="w-full p-2.5 text-xs font-mono border border-noir-border rounded-lg bg-noir-card text-noir-text outline-none focus:border-noir-gold"
              />

              <div className="flex items-center justify-between">
                <button onClick={handleBulkUpload} className="px-4 py-2 bg-noir-gold hover:bg-noir-gold-hover text-black rounded-lg text-xs font-bold cursor-pointer">
                  Parse & Insert Rows
                </button>
                <button onClick={() => setShowBulkUpload(false)} className="text-xs text-noir-dim hover:text-noir-text">Close</button>
              </div>

              {bulkResult && (
                <div className="p-3 bg-noir-card border border-noir-border rounded-lg text-xs space-y-1 font-mono">
                  <p className="font-bold text-emerald-400">Successfully loaded: {bulkResult.success} records</p>
                  {bulkResult.errors.length > 0 && (
                    <div className="text-red-400">
                      <p className="font-semibold">Errors ({bulkResult.errors.length}):</p>
                      <ul className="list-disc pl-4 max-h-[100px] overflow-y-auto space-y-0.5">
                        {bulkResult.errors.map((e, idx) => <li key={idx}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Paginated Customer Grid List */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-noir-border text-noir-dim uppercase font-mono">
                  <th className="py-2.5">ID</th>
                  <th className="py-2.5">Full Name</th>
                  <th className="py-2.5">Phone</th>
                  <th className="py-2.5">Email</th>
                  <th className="py-2.5">Address</th>
                  <th className="py-2.5 text-right">Created At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-noir-border text-noir-text">
                {customersData.data.length > 0 ? (
                  customersData.data.map(c => (
                    <tr key={c.id} className="hover:bg-noir-highlight/20 transition-colors">
                      <td className="py-2.5 font-mono text-noir-dim">#{c.id}</td>
                      <td className="py-2.5 font-bold text-noir-text">{c.name}</td>
                      <td className="py-2.5 font-mono">{c.phone}</td>
                      <td className="py-2.5 font-mono text-noir-muted">{c.email || '—'}</td>
                      <td className="py-2.5 text-noir-muted max-w-xs truncate" title={c.delivery_address || ''}>{c.delivery_address || '—'}</td>
                      <td className="py-2.5 text-right text-noir-dim font-mono">{new Date(c.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-noir-dim">No customer records matching search terms.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {customersData.totalCount > 6 && (
            <div className="flex items-center justify-between border-t border-noir-border pt-3">
              <span className="text-xs text-noir-muted">
                Showing {Math.min(customersData.totalCount, (custPage - 1) * 6 + 1)} - {Math.min(customersData.totalCount, custPage * 6)} of {customersData.totalCount} customers
              </span>
              <div className="flex space-x-1">
                <button
                  type="button"
                  aria-label="Previous customers page"
                  title="Previous customers page"
                  disabled={custPage === 1}
                  onClick={() => setCustPage(p => p - 1)}
                  className="p-1.5 bg-noir-highlight hover:bg-noir-sidebar border border-noir-border rounded-lg text-noir-text disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronLeft className="w-4 h-4 text-noir-gold" />
                </button>
                <button
                  type="button"
                  aria-label="Next customers page"
                  title="Next customers page"
                  disabled={custPage * 6 >= customersData.totalCount}
                  onClick={() => setCustPage(p => p + 1)}
                  className="p-1.5 bg-noir-highlight hover:bg-noir-sidebar border border-noir-border rounded-lg text-noir-text disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronRight className="w-4 h-4 text-noir-gold" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RENDER MASTER MENU ITEMS TAB */}
      {activeSubTab === 'menu' && (
        <div className="bg-noir-card p-6 rounded-2xl border border-noir-border shadow-lg space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-serif italic text-noir-gold">Pizza & Master Menu (Master Table)</h3>
              <p className="text-xs text-noir-muted">Manage pizza recipes, customized bases, and topping snapshots.</p>
              <p className="text-[10px] text-noir-dim mt-1">
                On server startup: <span className="font-mono text-noir-text">input_data/Types_of_Base.txt</span>,{' '}
                <span className="font-mono text-noir-text">Types_of_Pizza.txt</span>,{' '}
                <span className="font-mono text-noir-text">Types_of_Toppings.txt</span> (semicolon-separated; CSV fallback).
              </p>
            </div>
            
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleReloadInputData}
                disabled={menuReloading}
                className="px-3.5 py-1.5 bg-noir-highlight hover:bg-noir-sidebar text-noir-text rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer border border-noir-border disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 text-noir-gold ${menuReloading ? 'animate-spin' : ''}`} />
                Reload input_data
              </button>
              <button
                onClick={() => { setShowAddForm(!showAddForm); setShowBulkUpload(false); }}
                className="px-3.5 py-1.5 bg-noir-gold hover:bg-noir-gold-hover text-black rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" /> Add Menu Item
              </button>
              <button
                onClick={() => { setShowBulkUpload(!showBulkUpload); setShowAddForm(false); }}
                className="px-3.5 py-1.5 bg-noir-highlight hover:bg-noir-sidebar text-noir-text rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer border border-noir-border"
              >
                <Upload className="w-4 h-4 text-noir-gold" /> Bulk Upload (CSV/JSON)
              </button>
            </div>
          </div>

          {/* Search Box */}
          <div className="max-w-md">
            <input
              type="text"
              placeholder="Search dishes by name or code..."
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              className="w-full px-3.5 py-2 bg-noir-panel border border-noir-border focus:border-noir-gold text-noir-text outline-none rounded-xl text-xs transition-all"
            />
          </div>

          {/* Individual Register Form */}
          {showAddForm && (
            <form onSubmit={handleAddIndividual} className="bg-noir-panel p-4 border border-noir-border rounded-xl grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-4 pb-2 border-b border-noir-border flex justify-between items-center">
                <h4 className="text-xs font-semibold text-noir-gold uppercase tracking-wider">Register Individual Menu Item</h4>
                <button type="button" onClick={() => setShowAddForm(false)} className="text-[10px] text-noir-dim hover:text-noir-text">Cancel</button>
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Item Code *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. PIZ08"
                  value={menuCode}
                  onChange={(e) => setMenuCode(e.target.value)}
                  className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs font-mono uppercase"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="menu-category-select" className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Category *</label>
                <select
                  id="menu-category-select"
                  value={menuCat}
                  onChange={(e) => setMenuCat(e.target.value as any)}
                  className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs"
                >
                  <option value="pizza">Pizza</option>
                  <option value="base">Base Crust</option>
                  <option value="topping">Topping</option>
                </select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Dishes Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Golden Corn Pizza"
                  value={menuName}
                  onChange={(e) => setMenuName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Price in INR (₹) *</label>
                <input
                  type="number"
                  required
                  min="1"
                  placeholder="e.g. 299"
                  value={menuPrice}
                  onChange={(e) => setMenuPrice(e.target.value)}
                  className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs"
                />
              </div>
              <div className="space-y-1 md:col-span-3">
                <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Description</label>
                <input
                  type="text"
                  placeholder="e.g. Loaded with golden corn and mozzarella"
                  value={menuDesc}
                  onChange={(e) => setMenuDesc(e.target.value)}
                  className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs"
                />
              </div>
              <div className="md:col-span-4 pt-2">
                <button type="submit" className="px-4 py-2 bg-noir-gold hover:bg-noir-gold-hover text-black rounded-lg text-xs font-bold cursor-pointer">
                  Save Menu Item
                </button>
              </div>
            </form>
          )}

          {/* Bulk Paste Menu Form */}
          {showBulkUpload && (
            <div className="bg-noir-panel p-4 border border-noir-border rounded-xl space-y-3">
              <div className="flex justify-between items-center pb-2 border-b border-noir-border">
                <h4 className="text-xs font-semibold text-noir-gold uppercase">Bulk Upload Menu Items</h4>
                <div className="flex bg-noir-card p-0.5 rounded border border-noir-border text-[10px]">
                  <button onClick={() => setBulkFormat('csv')} className={`px-2 py-0.5 rounded ${bulkFormat === 'csv' ? 'bg-noir-gold text-black' : 'text-noir-dim'}`}>CSV</button>
                  <button onClick={() => setBulkFormat('json')} className={`px-2 py-0.5 rounded ${bulkFormat === 'json' ? 'bg-noir-gold text-black' : 'text-noir-dim'}`}>JSON</button>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                  <div className="space-y-2">
                    <p className="text-[10px] text-noir-dim">
                      {bulkFormat === 'csv'
                        ? 'Upload a file containing code, name, price_inr separated by ; or , and then choose the category to apply to every row.'
                        : 'Must be an array of objects: [{"code":"PIZ99","name":"Mock","price_inr":200}]'}
                    </p>
                    {formType === 'menu' && (
                      <div className="space-y-1">
                        <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Upload menu file</label>
                        <input
                          type="file"
                          accept=".csv,.txt"
                          aria-label="Upload menu file"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) readBulkFile(file);
                          }}
                          className="w-full text-[10px] text-noir-text file:bg-noir-card file:border file:border-noir-border file:px-3 file:py-1.5 file:rounded-lg"
                        />
                        {bulkFileName && (
                          <p className="text-[10px] text-noir-muted">Loaded file: <span className="font-semibold text-noir-text">{bulkFileName}</span>. Content is shown below for review.</p>
                        )}
                      </div>
                    )}
                  </div>

                  {formType === 'menu' && (
                    <div className="space-y-2">
                      <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Menu category</label>
                      <select
                        aria-label="Select menu category for bulk upload"
                        value={bulkDefaultMenuCategory}
                        onChange={(e) => {
                          setBulkDefaultMenuCategory(e.target.value as 'base' | 'pizza' | 'topping');
                          setBulkCategoryDetected(null);
                        }}
                        className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs"
                      >
                        <option value="pizza">Pizza</option>
                        <option value="base">Base</option>
                        <option value="topping">Topping</option>
                      </select>
                      <div className="text-[10px] text-noir-muted">
                        Selected category will be applied to every imported row.
                      </div>
                    </div>
                  )}
                </div>

                {formType === 'menu' && bulkCategoryDetected && (
                  <div className="text-[10px] text-noir-muted italic">Detected menu type from file name: <span className="font-semibold text-noir-text">{bulkCategoryDetected}</span>.</div>
                )}

                <textarea
                  rows={4}
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  placeholder={bulkFormat === 'csv' ? 'code;category;name;price;description\nPIZ10;pizza;Spicy Chicken;499;Spicy chicken toppings\nTOP12;topping;Garlic butter;50;Premium roasted garlic dip' : '[{"code":"PIZ10","category":"pizza","name":"Spicy Chicken","price":499}]'}
                  className="w-full p-2.5 text-xs font-mono border border-noir-border rounded-lg bg-noir-card text-noir-text outline-none focus:border-noir-gold"
                />
              </div>

              <div className="flex items-center justify-between">
                <button onClick={handleBulkUpload} className="px-4 py-2 bg-noir-gold hover:bg-noir-gold-hover text-black rounded-lg text-xs font-bold cursor-pointer">
                  Parse & Insert Menu
                </button>
                <button onClick={() => setShowBulkUpload(false)} className="text-xs text-noir-dim hover:text-noir-text">Close</button>
              </div>

              {bulkResult && (
                <div className="p-3 bg-noir-card border border-noir-border rounded-lg text-xs space-y-1 font-mono">
                  <p className="font-bold text-emerald-400">Successfully loaded: {bulkResult.success} dishes</p>
                  {bulkResult.errors.length > 0 && (
                    <div className="text-red-400">
                      <p className="font-semibold">Errors ({bulkResult.errors.length}):</p>
                      <ul className="list-disc pl-4 max-h-[100px] overflow-y-auto space-y-0.5">
                        {bulkResult.errors.map((e, idx) => <li key={idx}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Simple Menu List Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-noir-border text-noir-dim uppercase font-mono">
                  <th className="py-2.5">Code</th>
                  <th className="py-2.5">Category</th>
                  <th className="py-2.5">Name</th>
                  <th className="py-2.5">Base Price</th>
                  <th className="py-2.5">Description</th>
                  <th className="py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-noir-border text-noir-text">
                {menuItems
                  .filter(m => 
                    m.name.toLowerCase().includes(menuSearch.toLowerCase()) || 
                    m.code.toLowerCase().includes(menuSearch.toLowerCase())
                  )
                  .map(m => (
                    <tr key={m.id} className="hover:bg-noir-highlight/20 transition-colors">
                      <td className="py-2.5 font-mono font-bold text-noir-gold uppercase">{m.code}</td>
                      <td className="py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                          m.category === 'pizza' 
                            ? 'bg-red-950/40 text-red-300 border-red-900/40' 
                            : m.category === 'base'
                            ? 'bg-amber-950/40 text-amber-300 border-amber-900/40'
                            : 'bg-emerald-950/40 text-emerald-300 border-emerald-900/40'
                        }`}>
                          {m.category}
                        </span>
                      </td>
                      <td className="py-2.5 font-semibold text-noir-text">{m.name}</td>
                      <td className="py-2.5 font-mono font-bold text-noir-text">₹{m.price_inr}</td>
                      <td className="py-2.5 text-noir-muted italic max-w-xs truncate" title={m.description || ''}>{m.description || 'No description added'}</td>
                      <td className="py-2.5 text-right">
                        <span className="text-[10px] bg-emerald-950/40 text-emerald-300 font-medium px-2 py-0.5 rounded border border-emerald-900/40">Active</span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'settings' && (
        <div className="bg-noir-card p-6 rounded-2xl border border-noir-border shadow-lg space-y-5">
          <div>
            <h3 className="text-lg font-serif italic text-noir-gold flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5" /> Store Settings
            </h3>
            <p className="text-xs text-noir-muted mt-1">
              Configure billing rules for the pizzeria. Values are stored in the database — no SQL required here.
            </p>
          </div>

          <form onSubmit={handleSaveSettings} className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
            <div className="space-y-1">
              <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Bulk pizza discount (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                value={settingsDiscount}
                onChange={(e) => setSettingsDiscount(e.target.value)}
                className="w-full px-3 py-2 bg-noir-panel border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-xl text-sm"
              />
              <p className="text-[10px] text-noir-muted">Applied when total pizza quantity meets the minimum below.</p>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Minimum pizzas for discount</label>
              <input
                type="number"
                min="1"
                max="100"
                required
                value={settingsMinQty}
                onChange={(e) => setSettingsMinQty(e.target.value)}
                className="w-full px-3 py-2 bg-noir-panel border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-xl text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Default currency</label>
              <input
                type="text"
                required
                maxLength={3}
                value={settingsCurrency}
                onChange={(e) => setSettingsCurrency(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 bg-noir-panel border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-xl text-sm font-mono uppercase"
              />
              <p className="text-[10px] text-noir-muted">3-letter code, e.g. INR, USD, EUR.</p>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">GST (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                value={settingsGst}
                onChange={(e) => setSettingsGst(e.target.value)}
                className="w-full px-3 py-2 bg-noir-panel border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-xl text-sm"
              />
            </div>

            <div className="md:col-span-2 flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={settingsSaving}
                className="px-5 py-2.5 bg-noir-gold hover:bg-noir-gold-hover disabled:opacity-60 text-black rounded-xl text-xs font-bold cursor-pointer"
              >
                {settingsSaving ? 'Saving…' : 'Save settings'}
              </button>
              {appSettings.updated_at && (
                <span className="text-[10px] text-noir-muted">Last updated {new Date(appSettings.updated_at).toLocaleString()}</span>
              )}
            </div>
          </form>

          {menuLoadStatus?.hasErrors && (
            <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 text-xs text-amber-200 space-y-2">
              <p className="font-semibold text-amber-100">Startup menu import issues</p>
              <ul className="list-disc pl-4 space-y-0.5 max-h-28 overflow-y-auto">
                {menuLoadStatus.files.flatMap(f => [
                  ...(f.skipReason ? [`${f.file}: ${f.skipReason}`] : []),
                  ...f.errors.map(e => `${f.file}: ${e}`),
                ])}
              </ul>
              <p className="text-amber-200/80">Fix files in input_data/ and use Reload input_data on the Menu tab, or Bulk Upload corrected files.</p>
            </div>
          )}
        </div>
      )}

      {/* RENDER USER MANAGEMENT TAB */}
      {activeSubTab === 'users' && (
        <div className="bg-noir-card p-6 rounded-2xl border border-noir-border shadow-lg space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-serif italic text-noir-gold">User Management</h3>
              <p className="text-xs text-noir-muted">Invite staff and admin logins. Credentials are emailed to the user; they must change their password on first sign-in.</p>
            </div>
            
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { setFormType('profile'); setShowAddForm(true); setShowBulkUpload(false); }}
                className="px-3.5 py-1.5 bg-noir-gold hover:bg-noir-gold-hover text-black rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" /> Invite User
              </button>
            </div>
          </div>

          {/* Search Box */}
          <div className="max-w-md">
            <input
              type="text"
              placeholder="Search profiles by email or name..."
              value={profileSearch}
              onChange={(e) => setProfileSearch(e.target.value)}
              className="w-full px-3.5 py-2 bg-noir-panel border border-noir-border focus:border-noir-gold text-noir-text outline-none rounded-xl text-xs transition-all"
            />
          </div>

          {/* Individual Register Form */}
          {showAddForm && formType === 'profile' && (
            <form onSubmit={handleAddIndividual} className="bg-noir-panel p-4 border border-noir-border rounded-xl grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-3 pb-2 border-b border-noir-border flex justify-between items-center">
                <h4 className="text-xs font-semibold text-noir-gold uppercase tracking-wider">Invite new user</h4>
                <button type="button" onClick={() => setShowAddForm(false)} className="text-[10px] text-noir-dim hover:text-noir-text">Cancel</button>
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Pizzeria Email *</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. chef1@heaven.com"
                  value={staffEmail}
                  onChange={(e) => setStaffEmail(e.target.value)}
                  className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Master Chef Chef Priya"
                  value={staffName}
                  onChange={(e) => setStaffName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-semibold text-noir-dim uppercase tracking-wider">Role Access Permission *</label>
                <select
                  title="Role Access Permission"
                  value={staffRole}
                  onChange={(e) => setStaffRole(e.target.value as any)}
                  className="w-full px-3 py-1.5 bg-noir-card border border-noir-border text-noir-text focus:border-noir-gold outline-none rounded-lg text-xs"
                >
                  <option value="staff">Staff (Kitchen/Orders)</option>
                  <option value="admin">Admin (Full Control + Analytics)</option>
                </select>
              </div>
              <div className="md:col-span-3 pt-2">
                <button type="submit" className="px-4 py-2 bg-noir-gold hover:bg-noir-gold-hover text-black rounded-lg text-xs font-bold cursor-pointer">
                  Send invitation
                </button>
              </div>
            </form>
          )}

          {profiles.length === 0 && (
            <p className="text-xs text-noir-muted italic py-4 text-center">No users yet. Click Invite User to add staff or admin accounts.</p>
          )}

          {/* Simple Staff Grid Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-noir-border text-noir-dim uppercase font-mono">
                  <th className="py-2.5">User ID</th>
                  <th className="py-2.5">Display Name</th>
                  <th className="py-2.5">Login Email</th>
                  <th className="py-2.5">Role</th>
                  <th className="py-2.5 text-right">Created At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-noir-border text-noir-text">
                {profiles
                  .filter(p => 
                    p.email.toLowerCase().includes(profileSearch.toLowerCase()) || 
                    (p.display_name && p.display_name.toLowerCase().includes(profileSearch.toLowerCase()))
                  )
                  .map(p => (
                    <tr key={p.id} className="hover:bg-noir-highlight/20 transition-colors">
                      <td className="py-2.5 font-mono text-noir-dim text-[10px]" title={p.id}>{p.id.slice(0, 18)}...</td>
                      <td className="py-2.5 font-bold text-noir-text">{p.display_name || 'No display name'}</td>
                      <td className="py-2.5 font-mono text-noir-muted">{p.email}</td>
                      <td className="py-2.5">
                        <span className={`px-2.5 py-0.5 rounded text-[10px] font-semibold border ${
                          p.role === 'admin' 
                            ? 'bg-purple-950/40 text-purple-300 border-purple-900/40 font-bold' 
                            : 'bg-indigo-950/40 text-indigo-300 border-indigo-900/40'
                        }`}>
                          {p.role}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-noir-dim font-mono">{new Date(p.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
