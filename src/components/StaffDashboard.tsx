import React, { useState, useEffect } from 'react';
import { 
  CheckCircle, Play, Flame, Send, XCircle, Clock, Table, QrCode, ClipboardList, Filter, Copy, ExternalLink 
} from 'lucide-react';
import { OrderWithItems, Order } from '../types';
import { dbService } from '../lib/dbService';

interface StaffDashboardProps {
  orders: OrderWithItems[];
  onRefresh: () => void;
  staffId: string;
  staffName: string;
}

export default function StaffDashboard({ orders, onRefresh, staffId, staffName }: StaffDashboardProps) {
  const [statusFilter, setStatusFilter] = useState<'open' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled' | 'all'>('open');
  
  // QR Generator States
  const [selectedTable, setSelectedTable] = useState(1);
  const [qrUrl, setQrUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // Cancellation Modal States
  const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('Customer changed mind');
  const [customReason, setCustomReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto-refresh timers to show live clock ticks for orders waiting in queue!
  const [timeTicker, setTimeTicker] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTimeTicker(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Update QR link as table number or hostname changes
  useEffect(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    setQrUrl(`${origin}?table=${selectedTable}&source=qr`);
  }, [selectedTable]);

  // Handle flow transitions
  const handleTransition = async (orderId: number, nextStatus: 'preparing' | 'ready' | 'delivered') => {
    setErrorMsg(null);
    try {
      await dbService.updateOrderStatus(orderId, nextStatus, null, staffId);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

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
    if (statusFilter === 'all') return true;
    if (statusFilter === 'open') {
      return o.status === 'confirmed' || o.status === 'preparing' || o.status === 'ready';
    }
    return o.status === statusFilter;
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="staff-dashboard">
      
      {/* LEFT & CENTER PANEL: Orders Queue */}
      <div className="lg:col-span-2 space-y-4">
        {/* Filter Toolbar */}
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <ClipboardList className="w-5 h-5 text-red-600" />
            <h3 className="font-bold text-gray-800 text-base">Kitchen Operations Flow</h3>
          </div>
          
          <div className="flex flex-wrap gap-1.5 bg-gray-50 p-1 rounded-xl border border-gray-100 text-xs font-semibold">
            <button
              onClick={() => setStatusFilter('open')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${statusFilter === 'open' ? 'bg-red-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Open Queue ({orders.filter(o => o.status === 'confirmed' || o.status === 'preparing' || o.status === 'ready').length})
            </button>
            <button
              onClick={() => setStatusFilter('confirmed')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${statusFilter === 'confirmed' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              New ({orders.filter(o => o.status === 'confirmed').length})
            </button>
            <button
              onClick={() => setStatusFilter('preparing')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${statusFilter === 'preparing' ? 'bg-amber-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Cooking ({orders.filter(o => o.status === 'preparing').length})
            </button>
            <button
              onClick={() => setStatusFilter('ready')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${statusFilter === 'ready' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Ready ({orders.filter(o => o.status === 'ready').length})
            </button>
            <button
              onClick={() => setStatusFilter('delivered')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${statusFilter === 'delivered' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Delivered
            </button>
            <button
              onClick={() => setStatusFilter('cancelled')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${statusFilter === 'cancelled' ? 'bg-red-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Cancelled
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs font-semibold flex justify-between items-center">
            <span>⚠️ {errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-gray-400 hover:text-gray-600 font-bold">×</button>
          </div>
        )}

        {/* Live Orders Loop */}
        <div className="space-y-4">
          {filteredOrders.length > 0 ? (
            filteredOrders.map(order => (
              <div 
                key={order.id} 
                className={`bg-white border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all relative ${
                  order.status === 'confirmed' 
                    ? 'border-l-4 border-l-blue-500 border-gray-100' 
                    : order.status === 'preparing'
                    ? 'border-l-4 border-l-amber-500 border-gray-100'
                    : order.status === 'ready'
                    ? 'border-l-4 border-l-emerald-500 border-gray-100'
                    : order.status === 'cancelled'
                    ? 'border-l-4 border-l-red-500 border-gray-100'
                    : 'border-l-4 border-l-gray-400 border-gray-100'
                }`}
              >
                {/* Header info */}
                <div className="flex justify-between items-start gap-2 mb-3 pb-2.5 border-b border-gray-100">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-bold text-gray-400">Order ID:</span>
                      <span className="font-mono font-bold text-gray-800 text-sm">#{order.id}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        order.status === 'confirmed' ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                        order.status === 'preparing' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                        order.status === 'ready' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                        order.status === 'cancelled' ? 'bg-red-50 text-red-700 border border-red-100' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {order.status}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 mt-1 font-sans">
                      <span className="font-bold text-gray-700 text-xs">Table {order.table_number}</span>
                      <span className="text-gray-300">•</span>
                      <span className="text-gray-500 text-xs font-medium">{order.customer_name} ({order.customer_phone})</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-xs font-bold text-gray-800 font-mono">₹{Number(order.total_payable).toLocaleString('en-IN')}</p>
                    <p className="text-[10px] text-gray-400 font-mono mt-0.5">{order.payment_mode} via {order.order_source}</p>
                  </div>
                </div>

                {/* Items snapshot list */}
                <div className="space-y-1.5 py-1">
                  {order.items.map(item => (
                    <div key={item.id} className="flex justify-between text-xs text-gray-600 font-sans">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-semibold text-gray-800">x{item.quantity}</span>
                        <span>{item.name}</span>
                        <span className="text-[10px] text-gray-400 uppercase tracking-wide">({item.category})</span>
                      </div>
                      <span className="font-mono text-gray-500">₹{Number(item.unit_price_snapshot) * item.quantity}</span>
                    </div>
                  ))}
                </div>

                {/* Performance Metrics Tracker Timers */}
                <div className="mt-4 pt-3 border-t border-gray-50 grid grid-cols-2 sm:grid-cols-3 gap-3 text-[10px] font-mono text-gray-500">
                  <div className="flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-gray-400" />
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-gray-400">Received At</p>
                      <p className="text-gray-700 font-medium">{new Date(order.created_at).toLocaleTimeString()}</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-blue-500" />
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-gray-400">Queue Time</p>
                      <p className="text-blue-600 font-bold">
                        {formatDuration(order.created_at, order.cooking_started_at)}
                      </p>
                    </div>
                  </div>

                  {order.cooking_started_at && (
                    <div className="flex items-center space-x-1.5">
                      <Flame className="w-3.5 h-3.5 text-amber-500" />
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-gray-400">Cooking Timer</p>
                        <p className="text-amber-600 font-bold">
                          {formatDuration(order.cooking_started_at, order.ready_at)}
                        </p>
                      </div>
                    </div>
                  )}

                  {order.ready_at && (
                    <div className="flex items-center space-x-1.5 col-span-2 sm:col-span-1">
                      <Send className="w-3.5 h-3.5 text-emerald-500" />
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-gray-400">Serving Cycle</p>
                        <p className="text-emerald-600 font-bold">
                          {formatDuration(order.ready_at, order.delivered_at)}
                        </p>
                      </div>
                    </div>
                  )}

                  {order.status === 'cancelled' && (
                    <div className="col-span-2 sm:col-span-3 bg-red-50 p-2 border border-red-100 rounded-lg text-red-700 font-sans italic text-xs">
                      <strong>Canceled Reason:</strong> "{order.cancellation_reason || 'Not documented'}"
                    </div>
                  )}
                </div>

                {/* Operations Buttons Flow Controls */}
                <div className="mt-4 flex justify-between items-center flex-wrap gap-2 pt-2 border-t border-gray-100">
                  <div className="flex items-center space-x-2">
                    {order.status === 'confirmed' && (
                      <button
                        onClick={() => handleTransition(order.id, 'preparing')}
                        className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-[11px] transition-colors flex items-center gap-1 cursor-pointer shadow-sm"
                      >
                        <Flame className="w-3.5 h-3.5" /> Start Cooking
                      </button>
                    )}

                    {order.status === 'preparing' && (
                      <button
                        onClick={() => handleTransition(order.id, 'ready')}
                        className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg text-[11px] transition-colors flex items-center gap-1 cursor-pointer shadow-sm animate-pulse"
                      >
                        <CheckCircle className="w-3.5 h-3.5" /> Mark Ready (Serve)
                      </button>
                    )}

                    {order.status === 'ready' && (
                      <button
                        onClick={() => handleTransition(order.id, 'delivered')}
                        className="px-3.5 py-1.5 bg-gray-700 hover:bg-gray-800 text-white font-bold rounded-lg text-[11px] transition-colors flex items-center gap-1 cursor-pointer shadow-sm"
                      >
                        <Send className="w-3.5 h-3.5" /> Confirm Served
                      </button>
                    )}
                  </div>

                  {/* Cancellations restriction: Cancellations are only allowed for orders in 'confirmed' status */}
                  {order.status === 'confirmed' && (
                    <button
                      onClick={() => setCancellingOrderId(order.id)}
                      className="px-2.5 py-1.5 border border-red-200 hover:border-red-300 text-red-600 hover:bg-red-50 font-semibold rounded-lg text-[11px] transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Cancel Order
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="bg-white border rounded-2xl p-12 text-center text-gray-400 shadow-sm border-gray-100">
              <ClipboardList className="w-12 h-12 stroke-1 text-gray-300 mx-auto mb-3" />
              <h4 className="font-bold text-gray-700 text-sm">Order pipeline is empty</h4>
              <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">All orders are fulfilled. Direct customers to scan Table QRs to launch order transactions.</p>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: QR LINK GENERATOR & SHIFT SUMMARY */}
      <div className="space-y-6">
        
        {/* Table Link / QR Code Generator */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <div className="flex items-center space-x-2 border-b border-gray-100 pb-3">
            <QrCode className="w-5 h-5 text-red-600" />
            <h3 className="font-bold text-gray-800 text-sm">Table QR Link Generator</h3>
          </div>
          
          <p className="text-xs text-gray-500">Select a dine-in table number to print or generate its direct self-ordering link.</p>

          <div className="space-y-1">
            <label className="block text-[10px] font-bold text-gray-500 uppercase">Dine-In Table Select (1 to 20)</label>
            <div className="flex space-x-2">
              <select
                value={selectedTable}
                onChange={(e) => setSelectedTable(parseInt(e.target.value))}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-xs bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {Array.from({ length: 20 }, (_, i) => i + 1).map(num => (
                  <option key={num} value={num}>Dine-In Table #{num}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Visual QR Code simulator */}
          <div className="bg-gray-50 border border-gray-100 p-4 rounded-xl flex flex-col items-center justify-center text-center">
            <div className="bg-white p-3 rounded-xl border border-gray-200/60 shadow-inner inline-block">
              <div className="w-32 h-32 bg-gray-800 rounded-lg flex items-center justify-center p-2 relative">
                {/* Simulated QR block layout */}
                <div className="absolute inset-0 bg-[radial-gradient(#1e293b_35%,transparent_36%)] bg-[length:12px_12px] opacity-90 m-3"></div>
                {/* Outer corners */}
                <div className="absolute top-2 left-2 w-6 h-6 border-4 border-white bg-gray-800"></div>
                <div className="absolute top-2 right-2 w-6 h-6 border-4 border-white bg-gray-800"></div>
                <div className="absolute bottom-2 left-2 w-6 h-6 border-4 border-white bg-gray-800"></div>
                {/* Center table ID marker */}
                <div className="z-10 bg-red-600 text-white font-mono font-bold text-base px-2.5 py-1.5 rounded-lg border-2 border-white shadow">
                  T{selectedTable}
                </div>
              </div>
            </div>
            
            <p className="text-[10px] text-gray-400 font-mono mt-3 break-all w-full px-2">
              {qrUrl}
            </p>
          </div>

          {/* Links actions */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleCopyLink}
              className="px-3 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
            <a
              href={qrUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer text-center transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Screen
            </a>
          </div>
        </div>

        {/* Staff logged in status info */}
        <div className="bg-gray-900 text-white p-5 rounded-2xl space-y-3.5">
          <div className="flex items-center space-x-2 border-b border-gray-800 pb-3">
            <div className="w-3.5 h-3.5 bg-emerald-500 rounded-full animate-ping"></div>
            <h4 className="font-bold text-sm font-sans tracking-tight">Active Staff Session</h4>
          </div>
          <div className="text-xs space-y-1 font-mono text-gray-400">
            <p>Fulfillment Agent: <strong className="text-white">{staffName}</strong></p>
            <p>UUID Ref: {staffId.slice(0, 18)}...</p>
            <p>Shift Opened: {new Date().toLocaleDateString()}</p>
          </div>
          <p className="text-[10px] text-gray-500 font-sans leading-relaxed">
            All database modifications will log your Staff UUID as the primary prepared officer inside the analytical kitchen records.
          </p>
        </div>
      </div>

      {/* CANCELLATION MODAL */}
      {cancellingOrderId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCancelSubmit} className="bg-white p-5 rounded-2xl max-w-sm w-full border shadow-xl space-y-4">
            <div className="border-b border-gray-100 pb-2">
              <h3 className="font-bold text-gray-800 text-base flex items-center gap-1.5">
                <XCircle className="w-5 h-5 text-red-500" /> Cancel Order #{cancellingOrderId}
              </h3>
              <p className="text-xs text-gray-400 mt-1">Cancellations are irreversible and trigger instant billing audits.</p>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="block font-bold text-gray-500 uppercase text-[9px]">Select Cancellation Reason *</label>
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl"
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
                  <label className="block font-bold text-gray-500 uppercase text-[9px]">Provide Custom Reason *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Card payment declined at counter"
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    className="w-full px-3 py-2 border rounded-xl"
                  />
                </div>
              )}
            </div>

            <div className="flex space-x-2 pt-2 text-xs">
              <button
                type="button"
                onClick={() => setCancellingOrderId(null)}
                className="flex-1 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold rounded-xl cursor-pointer"
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
