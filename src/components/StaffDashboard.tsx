// @ts-ignore: missing React type declarations in this environment
import React, { useState, useEffect } from 'react';
import { 
  CheckCircle, Play, Flame, Send, XCircle, Clock, Table, QrCode, ClipboardList, Filter, Copy, ExternalLink 
} from 'lucide-react';
import { OrderWithItems, Order, DineInTable, tableQrNumber, AppSettings } from '../types';
import { dbService } from '../lib/dbService';
import { orderDisplayStatus, billSummaryLines } from '../lib/orderUtils';
import { bulkDiscountLabel, gstLabel, DEFAULT_APP_SETTINGS } from '../lib/appSettings';
import BillSummary from './BillSummary';

function isWalkInPhone(phone: string | null | undefined): boolean {
  return !!phone && /^6000000\d{3}$/.test(phone);
}

interface StaffDashboardProps {
  orders: OrderWithItems[];
  tables: DineInTable[];
  appSettings?: AppSettings;
  onRefresh: () => void;
  staffId: string;
  staffName: string;
}

export default function StaffDashboard({ orders, tables, appSettings = DEFAULT_APP_SETTINGS, onRefresh, staffId, staffName }: StaffDashboardProps) {
  const [statusFilter, setStatusFilter] = useState<'open' | 'confirmed' | 'preparing' | 'ready' | 'ready_to_bill' | 'delivered' | 'cancelled' | 'all'>('open');
  
  // QR Generator States
  const [selectedTableName, setSelectedTableName] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const selectedTable = tables.find(t => t.table_name === selectedTableName) ?? tables[0] ?? null;

  useEffect(() => {
    if (tables.length > 0 && !tables.some(t => t.table_name === selectedTableName)) {
      setSelectedTableName(tables[0].table_name);
    }
  }, [tables, selectedTableName]);

  // Cancellation Modal States
  const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('Customer changed mind');
  const [customReason, setCustomReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Bill & payment modal (for ready_to_bill orders only — after Mark Served)
  const [billingOrderId, setBillingOrderId] = useState<number | null>(null);
  const [billingPaymentMode, setBillingPaymentMode] = useState<'Cash' | 'Card' | 'UPI'>('Cash');
  // Back-compat aliases (HMR may briefly reference old names after rename)
  const deliveringOrderId = billingOrderId;
  const setDeliveringOrderId = setBillingOrderId;
  const deliveryPaymentMode = billingPaymentMode;
  const setDeliveryPaymentMode = setBillingPaymentMode;

  // Auto-refresh timers to show live clock ticks for orders waiting in queue!
  const [timeTicker, setTimeTicker] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTimeTicker(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Update QR link as table selection or hostname changes
  useEffect(() => {
    if (!selectedTable) {
      setQrUrl('');
      return;
    }
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    setQrUrl(`${origin}?table=${tableQrNumber(selectedTable)}&source=qr`);
  }, [selectedTable]);

  const billingOrder = billingOrderId ? orders.find(o => o.id === billingOrderId) ?? null : null;

  const effectiveStatus = (order: OrderWithItems): Order['status'] => orderDisplayStatus(order);

  const handleTransition = async (orderId: number, nextStatus: 'preparing' | 'ready') => {
    setErrorMsg(null);
    try {
      await dbService.updateOrderStatus(orderId, nextStatus, null, staffId);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleMarkServed = async (orderId: number) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status !== 'ready') return;
    try {
      await dbService.updateOrderStatus(orderId, 'ready_to_bill', null, staffId);
      setSuccessMsg(`Order #${orderId} marked as served. You can now collect payment.`);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const openBillingModal = (orderId: number) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || effectiveStatus(order) !== 'ready_to_bill') return;
    setBillingOrderId(orderId);
    setBillingPaymentMode(order.payment_mode || 'Cash');
  };

  const handleConfirmBilling = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!billingOrderId) return;
    setErrorMsg(null);
    try {
      const result = await dbService.updateOrderStatus(billingOrderId, 'delivered', null, staffId, billingPaymentMode);
      setBillingOrderId(null);
      setSuccessMsg((result as any).confirmationMessage || `Payment confirmed via ${billingPaymentMode}.`);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };
  const handleConfirmDelivery = handleConfirmBilling;

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingOrderId) return;
    setErrorMsg(null);

    const finalReason = cancelReason === 'Other' ? customReason : cancelReason;
    if (!finalReason.trim()) {
      setErrorMsg("Please specify a cancellation reason");
      return;
    }

    try {
      await dbService.updateOrderStatus(cancellingOrderId, 'cancelled', finalReason, staffId);
      setCancellingOrderId(null);
      setCustomReason('');
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(qrUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Helper to compute duration string
  const formatDuration = (start: string, end: string | null) => {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : timeTicker.getTime();
    const diffMs = endTime - startTime;
    
    if (diffMs < 0) return '0s';

    const secs = Math.floor(diffMs / 1000);
    const mins = Math.floor(secs / 60);
    
    if (mins > 0) {
      return `${mins}m ${secs % 60}s`;
    }
    return `${secs}s`;
  };

  // Filter logic
  const filteredOrders = orders.filter(o => {
    const status = effectiveStatus(o);
    if (statusFilter === 'all') return true;
    if (statusFilter === 'open') {
      return status === 'confirmed' || status === 'preparing' || status === 'ready' || status === 'ready_to_bill';
    }
    return status === statusFilter;
  });

  const openQueueCount = orders.filter(o => {
    const s = effectiveStatus(o);
    return s === 'confirmed' || s === 'preparing' || s === 'ready' || s === 'ready_to_bill';
  }).length;

  const readyToBillCount = orders.filter(o => effectiveStatus(o) === 'ready_to_bill').length;

  const statusLabel = (status: Order['status']) => {
    if (status === 'ready_to_bill') return 'Ready to Bill';
    if (status === 'ready') return 'Ready';
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const statusBadgeClass = (status: Order['status']) => {
    if (status === 'confirmed') return 'bg-blue-950/40 text-blue-300 border-blue-900/40';
    if (status === 'preparing') return 'bg-amber-950/40 text-amber-300 border-amber-900/40';
    if (status === 'ready') return 'bg-emerald-950/40 text-emerald-300 border-emerald-900/40';
    if (status === 'ready_to_bill') return 'bg-purple-950/40 text-purple-300 border-purple-900/40';
    if (status === 'cancelled') return 'bg-red-950/40 text-red-300 border-red-900/40';
    return 'bg-noir-panel text-noir-muted border-noir-border';
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="staff-dashboard">
      
      {/* LEFT & CENTER PANEL: Orders Queue */}
      <div className="lg:col-span-2 space-y-4">
        {/* Filter Toolbar */}
        <div className="bg-noir-card p-4 rounded-2xl border border-noir-border shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <ClipboardList className="w-5 h-5 text-noir-gold" />
            <h3 className="font-serif italic text-noir-text text-base">Kitchen Operations Flow</h3>
          </div>
          
          <div className="flex flex-wrap gap-1.5 bg-noir-sidebar p-1 rounded-xl border border-noir-border text-xs font-semibold">
            <button
              onClick={() => setStatusFilter('open')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'open' 
                  ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20' 
                  : 'text-noir-muted hover:text-noir-text'
              }`}
            >
              Open Queue ({openQueueCount})
            </button>
            <button
              onClick={() => setStatusFilter('confirmed')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'confirmed' 
                  ? 'bg-blue-950/40 text-blue-300 border border-blue-900/40' 
                  : 'text-noir-muted hover:text-noir-text'
              }`}
            >
              New ({orders.filter(o => o.status === 'confirmed').length})
            </button>
            <button
              onClick={() => setStatusFilter('preparing')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'preparing' 
                  ? 'bg-amber-950/40 text-amber-300 border border-amber-900/40' 
                  : 'text-noir-muted hover:text-noir-text'
              }`}
            >
              Cooking ({orders.filter(o => o.status === 'preparing').length})
            </button>
            <button
              onClick={() => setStatusFilter('ready')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'ready' 
                  ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-900/40' 
                  : 'text-noir-muted hover:text-noir-text'
              }`}
            >
              Ready ({orders.filter(o => effectiveStatus(o) === 'ready').length})
            </button>
            <button
              onClick={() => setStatusFilter('ready_to_bill')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'ready_to_bill' 
                  ? 'bg-purple-950/40 text-purple-300 border border-purple-900/40' 
                  : 'text-noir-muted hover:text-noir-text'
              }`}
            >
              Ready to Bill ({readyToBillCount})
            </button>
            <button
              onClick={() => setStatusFilter('delivered')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'delivered' 
                  ? 'bg-noir-highlight text-noir-text border border-noir-border' 
                  : 'text-noir-muted hover:text-noir-text'
              }`}
            >
              Delivered
            </button>
            <button
              onClick={() => setStatusFilter('cancelled')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'cancelled' 
                  ? 'bg-red-950/40 text-red-300 border border-red-900/40' 
                  : 'text-noir-muted hover:text-noir-text'
              }`}
            >
              Cancelled
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-noir-panel border border-red-500/20 text-red-400 rounded-xl text-xs font-semibold flex justify-between items-center">
            <span>⚠️ {errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-noir-dim hover:text-noir-text font-bold">×</button>
          </div>
        )}
        {successMsg && (
          <div className="p-3 bg-noir-panel border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-semibold flex justify-between items-center">
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg(null)} className="text-noir-dim hover:text-noir-text font-bold">×</button>
          </div>
        )}

        {/* Live Orders Loop */}
        <div className="space-y-4">
          {filteredOrders.length > 0 ? (
            filteredOrders.map(order => {
              const status = effectiveStatus(order);
              return (
              <div 
                key={order.id} 
                onClick={() => status === 'ready_to_bill' && openBillingModal(order.id)}
                className={`bg-noir-card border border-noir-border rounded-2xl p-5 shadow-md hover:shadow-lg transition-all relative ${
                  status === 'ready_to_bill' ? 'cursor-pointer ring-1 ring-purple-500/30 hover:ring-purple-500/50' : ''
                } ${
                  status === 'confirmed' 
                    ? 'border-l-4 border-l-blue-500' 
                    : status === 'preparing'
                    ? 'border-l-4 border-l-amber-500'
                    : status === 'ready'
                    ? 'border-l-4 border-l-emerald-500'
                    : status === 'ready_to_bill'
                    ? 'border-l-4 border-l-purple-500'
                    : status === 'cancelled'
                    ? 'border-l-4 border-l-red-500'
                    : 'border-l-4 border-l-noir-border'
                }`}
              >
                {/* Header info */}
                <div className="flex justify-between items-start gap-2 mb-3 pb-2.5 border-b border-noir-border">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-semibold text-noir-dim">Order ID:</span>
                      <span className="font-mono font-bold text-noir-text text-sm">#{order.id}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${statusBadgeClass(status)}`}>
                        {statusLabel(status)}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 mt-1 font-sans">
                      <span className="font-serif italic text-noir-gold text-xs">{order.table_name}</span>
                      <span className="text-noir-dim">•</span>
                      <span className="text-noir-muted text-xs font-medium">
                        {order.customer_name || 'Guest'}
                        {order.customer_phone && !isWalkInPhone(order.customer_phone) ? ` (${order.customer_phone})` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-xs font-bold text-noir-gold font-mono">₹{Number(order.total_payable).toLocaleString('en-IN')}</p>
                    <p className="text-[10px] text-noir-dim font-mono mt-0.5">{order.payment_mode} via {order.order_source}</p>
                  </div>
                </div>

                {/* Items snapshot list */}
                <div className="space-y-1.5 py-1">
                  {order.items.map(item => (
                    <div key={item.id} className="flex justify-between text-xs text-noir-text font-sans">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-semibold text-noir-gold">x{item.quantity}</span>
                        <span>{item.name}</span>
                        <span className="text-[10px] text-noir-dim uppercase tracking-wide">({item.category})</span>
                      </div>
                      <span className="font-mono text-noir-muted">₹{Number(item.unit_price_snapshot) * item.quantity}</span>
                    </div>
                  ))}
                </div>

                {/* Performance Metrics Tracker Timers */}
                <div className="mt-4 pt-3 border-t border-noir-border grid grid-cols-2 sm:grid-cols-3 gap-3 text-[10px] font-mono text-noir-dim">
                  <div className="flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-noir-dim" />
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-noir-dim">Received At</p>
                      <p className="text-noir-text font-medium">{new Date(order.created_at).toLocaleTimeString()}</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-blue-400" />
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-noir-dim">Queue Time</p>
                      <p className="text-blue-300 font-bold">
                        {formatDuration(order.created_at, order.cooking_started_at)}
                      </p>
                    </div>
                  </div>

                  {order.cooking_started_at && (
                    <div className="flex items-center space-x-1.5">
                      <Flame className="w-3.5 h-3.5 text-amber-400" />
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-noir-dim">Cooking Timer</p>
                        <p className="text-amber-300 font-bold">
                          {formatDuration(order.cooking_started_at, order.ready_at)}
                        </p>
                      </div>
                    </div>
                  )}

                  {order.ready_at && (
                    <div className="flex items-center space-x-1.5 col-span-2 sm:col-span-1">
                      <Send className="w-3.5 h-3.5 text-emerald-400" />
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-noir-dim">Serving Cycle</p>
                        <p className="text-emerald-300 font-bold">
                          {formatDuration(order.ready_at, order.delivered_at)}
                        </p>
                      </div>
                    </div>
                  )}

                  {order.status === 'cancelled' && (
                    <div className="col-span-2 sm:col-span-3 bg-red-950/20 p-2 border border-red-900/20 rounded-lg text-red-300 font-sans italic text-xs">
                      <strong>Canceled Reason:</strong> "{order.cancellation_reason || 'Not documented'}"
                    </div>
                  )}
                </div>

                {/* Operations Buttons Flow Controls */}
                <div className="mt-4 flex justify-between items-center flex-wrap gap-2 pt-2 border-t border-noir-border" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center space-x-2">
                    {status === 'confirmed' && (
                      <button
                        onClick={() => handleTransition(order.id, 'preparing')}
                        className="px-3.5 py-1.5 bg-noir-gold hover:bg-noir-gold-hover text-black font-semibold rounded-lg text-[11px] transition-all flex items-center gap-1 cursor-pointer shadow-sm"
                      >
                        <Flame className="w-3.5 h-3.5" /> Start Cooking
                      </button>
                    )}

                    {status === 'preparing' && (
                      <button
                        onClick={() => handleTransition(order.id, 'ready')}
                        className="px-3.5 py-1.5 bg-noir-gold hover:bg-noir-gold-hover text-black font-bold rounded-lg text-[11px] transition-all flex items-center gap-1 cursor-pointer shadow-sm animate-pulse"
                      >
                        <CheckCircle className="w-3.5 h-3.5" /> Mark Ready
                      </button>
                    )}

                    {status === 'ready' && (
                      <button
                        onClick={() => handleMarkServed(order.id)}
                        className="px-3.5 py-1.5 bg-noir-highlight hover:bg-noir-sidebar text-noir-text border border-noir-border font-semibold rounded-lg text-[11px] transition-colors flex items-center gap-1 cursor-pointer shadow-sm"
                      >
                        <Send className="w-3.5 h-3.5" /> Mark Served
                      </button>
                    )}

                    {status === 'ready_to_bill' && (
                      <button
                        onClick={() => openBillingModal(order.id)}
                        className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg text-[11px] transition-colors flex items-center gap-1 cursor-pointer shadow-sm"
                      >
                        <Send className="w-3.5 h-3.5" /> View Bill &amp; Collect Payment
                      </button>
                    )}
                  </div>

                  {/* Cancellations restriction: Cancellations are only allowed for orders in 'confirmed' status */}
                  {status === 'confirmed' && (
                    <button
                      onClick={() => setCancellingOrderId(order.id)}
                      className="px-2.5 py-1.5 border border-red-500/30 hover:border-red-500 text-red-400 hover:bg-red-950/10 font-semibold rounded-lg text-[11px] transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Cancel Order
                    </button>
                  )}
                </div>
              </div>
            );
            })
          ) : (
            <div className="bg-noir-card border border-noir-border rounded-2xl p-12 text-center text-noir-dim shadow-md">
              <ClipboardList className="w-12 h-12 stroke-1 text-noir-dim mx-auto mb-3 animate-pulse" />
              <h4 className="font-serif italic text-noir-gold text-base">Order pipeline is empty</h4>
              <p className="text-xs text-noir-muted mt-1 max-w-sm mx-auto">All orders are fulfilled. Direct customers to scan Table QRs to launch order transactions.</p>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: QR LINK GENERATOR & SHIFT SUMMARY */}
      <div className="space-y-6">
        
        {/* Table Link / QR Code Generator */}
        <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg space-y-4">
          <div className="flex items-center space-x-2 border-b border-noir-border pb-3">
            <QrCode className="w-5 h-5 text-noir-gold" />
            <h3 className="font-serif text-noir-text text-sm">Table QR Link Generator</h3>
          </div>
          
          <p className="text-xs text-noir-muted">Select a dine-in table to generate its self-ordering link.</p>

          <div className="space-y-1">
            <label htmlFor="qr-table-select" className="block text-[10px] font-bold text-noir-dim uppercase tracking-wider">Dine-In Table</label>
            <div className="flex space-x-2">
              <select
                id="qr-table-select"
                aria-label="Select Dine-In Table"
                value={selectedTableName}
                onChange={(e) => setSelectedTableName(e.target.value)}
                disabled={tables.length === 0}
                className="flex-1 px-3 py-2 bg-noir-panel border border-noir-border rounded-xl text-xs text-noir-text focus:border-noir-gold outline-none font-mono disabled:opacity-50"
              >
                {tables.length === 0 ? (
                  <option value="">No tables loaded</option>
                ) : (
                  tables.map(t => (
                    <option key={t.id} value={t.table_name}>
                      {t.table_name} · {t.capacity} seats{t.is_in_use ? ' (occupied)' : ''}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Visual QR Code simulator */}
          <div className="bg-noir-panel border border-noir-border p-4 rounded-xl flex flex-col items-center justify-center text-center">
            {selectedTable ? (
              <>
                <div className="bg-noir-sidebar p-3 rounded-xl border border-noir-border shadow-inner inline-block">
                  <div className="w-32 h-32 bg-black rounded-lg flex items-center justify-center p-2 relative">
                    <div className="absolute inset-0 bg-[radial-gradient(#c5a059_20%,transparent_21%)] bg-[length:12px_12px] opacity-70 m-3"></div>
                    <div className="absolute top-2 left-2 w-6 h-6 border-4 border-noir-gold bg-black"></div>
                    <div className="absolute top-2 right-2 w-6 h-6 border-4 border-noir-gold bg-black"></div>
                    <div className="absolute bottom-2 left-2 w-6 h-6 border-4 border-noir-gold bg-black"></div>
                    <div className="z-10 bg-noir-gold text-black font-mono font-bold text-[11px] leading-tight px-2 py-1.5 rounded-lg border-2 border-black shadow max-w-[5.5rem] truncate">
                      {selectedTable.table_name}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-noir-text font-semibold mt-3">{selectedTable.table_name}</p>
                <p className="text-[11px] text-noir-gold font-mono mt-0.5">{selectedTable.capacity} seats</p>
                {selectedTable.description && (
                  <p className="text-[10px] text-noir-muted mt-1 px-2 italic">{selectedTable.description}</p>
                )}
                {selectedTable.is_in_use && (
                  <p className="text-[10px] text-amber-400 mt-1">Currently occupied</p>
                )}

                <p className="text-[10px] text-noir-dim font-mono mt-3 break-all w-full px-2">
                  {qrUrl}
                </p>
              </>
            ) : (
              <p className="text-xs text-noir-dim italic py-6">No tables configured yet. Add tables in Admin to generate QR links.</p>
            )}
          </div>

          {/* Links actions */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleCopyLink}
              className="px-3 py-2 bg-noir-highlight hover:bg-noir-sidebar border border-noir-border text-noir-text rounded-xl text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <Copy className="w-3.5 h-3.5 text-noir-gold" />
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
            <a
              href={qrUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 bg-noir-gold hover:bg-noir-gold-hover text-black rounded-xl text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer text-center transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Screen
            </a>
          </div>
        </div>

        {/* Staff logged in status info */}
        <div className="bg-noir-sidebar text-noir-text p-5 rounded-2xl border border-noir-border space-y-3.5">
          <div className="flex items-center space-x-2 border-b border-noir-border pb-3">
            <div className="w-3.5 h-3.5 bg-emerald-500 rounded-full animate-ping"></div>
            <h4 className="font-serif italic text-noir-gold text-sm tracking-tight">Active Staff Session</h4>
          </div>
          <div className="text-xs space-y-1 font-mono text-noir-muted">
            <p>Fulfillment Agent: <strong className="text-noir-text">{staffName}</strong></p>
            <p>Staff ID: {staffId.slice(0, 18)}...</p>
            <p>Shift Opened: {new Date().toLocaleDateString()}</p>
          </div>
          <p className="text-[10px] text-noir-dim font-sans leading-relaxed">
            Orders you update are recorded under your staff profile for kitchen analytics.
          </p>
        </div>
      </div>

      {/* BILL & PAYMENT MODAL */}
      {billingOrderId && billingOrder && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleConfirmBilling} className="bg-noir-card p-5 border border-noir-border rounded-2xl max-w-md w-full shadow-2xl space-y-4">
            <div className="border-b border-noir-border pb-2">
              <h3 className="font-serif italic text-noir-gold text-base flex items-center gap-1.5">
                <Send className="w-5 h-5 text-purple-400" /> Bill — Order #{billingOrder.id}
              </h3>
              <p className="text-xs text-noir-muted mt-1">{billingOrder.table_name} · {billingOrder.customer_name || 'Guest'}</p>
            </div>

            <div className="bg-noir-panel border border-noir-border rounded-xl p-3">
              {(() => {
                const bill = billSummaryLines(billingOrder);
                return (
                  <BillSummary
                    lineItems={bill.rows}
                    subtotal={bill.subtotal}
                    discount={bill.discount}
                    gst={bill.gst}
                    total={bill.total}
                    currency={billingOrder.currency || appSettings.default_currency}
                    discountLabel={bulkDiscountLabel(appSettings)}
                    gstLabel={gstLabel(appSettings)}
                  />
                );
              })()}
            </div>

            <div className="space-y-2 text-xs">
              <p className="font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Payment Method</p>
              {(['Cash', 'Card', 'UPI'] as const).map(mode => (
                <label key={mode} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${billingPaymentMode === mode ? 'border-noir-gold bg-noir-highlight' : 'border-noir-border bg-noir-panel hover:border-noir-border-light'}`}>
                  <input type="radio" name="paymode" value={mode} checked={billingPaymentMode === mode}
                    onChange={() => setBillingPaymentMode(mode)} className="accent-yellow-500" />
                  <span className="font-semibold text-noir-text">{mode === 'Cash' ? 'Cash at Counter' : mode === 'Card' ? 'Credit / Debit Card' : 'UPI / QR Scan'}</span>
                </label>
              ))}
            </div>

            <div className="flex space-x-2 pt-2 text-xs">
              <button type="button" onClick={() => setBillingOrderId(null)}
                className="flex-1 py-2 bg-noir-highlight border border-noir-border hover:bg-noir-sidebar text-noir-text font-semibold rounded-xl cursor-pointer">
                Cancel
              </button>
              <button type="submit"
                className="flex-1 py-2 bg-noir-gold hover:bg-noir-gold-hover text-black font-bold rounded-xl cursor-pointer flex items-center justify-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" /> Confirm Payment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CANCELLATION MODAL */}
      {cancellingOrderId && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCancelSubmit} className="bg-noir-card p-5 border border-noir-border rounded-2xl max-w-sm w-full shadow-2xl space-y-4">
            <div className="border-b border-noir-border pb-2">
              <h3 className="font-serif italic text-noir-gold text-base flex items-center gap-1.5">
                <XCircle className="w-5 h-5 text-red-400" /> Cancel Order #{cancellingOrderId}
              </h3>
              <p className="text-xs text-noir-muted mt-1">Cancellations are irreversible and trigger instant billing audits.</p>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Select Cancellation Reason *</label>
                <select
                  id="cancel-reason-select"
                  aria-label="Select cancellation reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full px-3 py-2 bg-noir-panel border border-noir-border rounded-xl text-noir-text focus:border-noir-gold outline-none text-xs"
                >
                  <option value="Customer changed mind">Customer changed mind</option>
                  <option value="Kitchen ran out of selected Base">Kitchen ran out of selected Base</option>
                  <option value="Order placed in error / duplicate">Order placed in error / duplicate</option>
                  <option value="Kitchen oven capacity overflow">Kitchen oven capacity overflow</option>
                  <option value="Other">Other (Write Custom Reason)</option>
                </select>
              </div>

              {cancelReason === 'Other' && (
                <div className="space-y-1 animate-fadeIn">
                  <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Provide Custom Reason *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Card payment declined at counter"
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    className="w-full px-3 py-2 bg-noir-panel border border-noir-border rounded-xl text-noir-text focus:border-noir-gold outline-none text-xs"
                  />
                </div>
              )}
            </div>

            <div className="flex space-x-2 pt-2 text-xs">
              <button
                type="button"
                onClick={() => setCancellingOrderId(null)}
                className="flex-1 py-2 bg-noir-highlight border border-noir-border hover:bg-noir-sidebar text-noir-text font-semibold rounded-xl cursor-pointer"
              >
                Go Back
              </button>
              <button
                type="submit"
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl cursor-pointer"
              >
                Confirm Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
