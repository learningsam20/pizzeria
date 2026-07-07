import React, { useState, useEffect, useRef } from 'react';
import {
  Pizza, Plus, Minus, ShoppingBag, History, AlertCircle, CheckCircle2,
  RefreshCw, Smartphone, Trash2, PackagePlus
} from 'lucide-react';
import { MenuItem, OrderItem, OrderWithItems, DineInTable, Order, tableQrNumber, AppSettings } from '../types';
import { dbService } from '../lib/dbService';
import { calcOrderTotals, isActiveOrder } from '../lib/orderUtils';
import { bulkDiscountFooterNote, bulkDiscountLabel, gstLabel } from '../lib/appSettings';
import {
  validateCustomerName,
  validatePhone,
  validateEmail,
  validateQuantityInput,
  validateNonEmpty,
} from '../lib/inputValidation';
import { findMenuNameConflicts } from '../lib/menuImport';
import BillSummary from './BillSummary';
import OrderCombosDisplay from './OrderCombosDisplay';

interface OrderingFlowProps {
  menuItems: MenuItem[];
  appSettings: AppSettings;
  onOrderPlaced: () => void;
  onGoToQueue?: () => void;
  staffLoggedIn: boolean;
  lockedTable: DineInTable | null;
  scannedTableQr: number | null;
  activeTableOrders: OrderWithItems[];
  allTables: DineInTable[];
  availableTables: DineInTable[];
}

interface ComboEntry {
  id: string;
  baseId: number | null;
  pizzas: Record<string, number>;
  toppings: Record<string, number>;
}

function comboSubtotalOf(combo: ComboEntry, items: MenuItem[]): number {
  let t = 0;
  if (combo.baseId) { const b = items.find(m => m.id === combo.baseId); if (b) t += b.price_inr; }
  Object.entries(combo.pizzas).forEach(([id, q]) => { const m = items.find(x => x.id === Number(id)); if (m) t += m.price_inr * q; });
  Object.entries(combo.toppings).forEach(([id, q]) => { const m = items.find(x => x.id === Number(id)); if (m) t += m.price_inr * q; });
  return t;
}

function comboPizzaCount(combo: ComboEntry): number {
  return Object.values(combo.pizzas).reduce((s, q) => s + q, 0);
}

export default function OrderingFlow({ menuItems, appSettings, onOrderPlaced, onGoToQueue, staffLoggedIn, lockedTable, scannedTableQr, activeTableOrders, allTables, availableTables }: OrderingFlowProps) {
  const [sessionStartedAt] = useState<string>(new Date().toISOString());
  const [activeTab, setActiveTab] = useState<'order' | 'history'>('order');

  const [customerLookupInput, setCustomerLookupInput] = useState('');
  const [customerExistingId, setCustomerExistingId] = useState<number | null>(null);
  const [customerLookupStatus, setCustomerLookupStatus] = useState<'idle' | 'loading' | 'found' | 'new'>('idle');
  const [customerLookupError, setCustomerLookupError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [tableName, setTableName] = useState<string>(lockedTable?.table_name || 'Table 1');
  const [qtyError, setQtyError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string; email?: string }>({});

  // Draft combo being built
  const [draftBaseId, setDraftBaseId] = useState<number | null>(null);
  const [draftPizzas, setDraftPizzas] = useState<Record<string, number>>({});
  const [draftToppings, setDraftToppings] = useState<Record<string, number>>({});

  // Committed combos
  const [combos, setCombos] = useState<ComboEntry[]>([]);
  const [editingComboId, setEditingComboId] = useState<string | null>(null);

  // History verification
  const [historySearchMode, setHistorySearchMode] = useState<'phone' | 'orderId'>('phone');
  const [verifyIdentifier, setVerifyIdentifier] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<Order['status'] | 'all'>('all');
  const [verifiedHistory, setVerifiedHistory] = useState<OrderWithItems[] | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error'; text: string; orderId?: number } | null>(null);
  const cartSectionRef = useRef<HTMLDivElement>(null);

  const resetCustomerFields = () => {
    setCustomerLookupInput('');
    setCustomerExistingId(null);
    setCustomerLookupStatus('idle');
    setCustomerLookupError(null);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerAddress('');
  };

  const handleCustomerLookup = async () => {
    setCustomerLookupError(null);
    const trimmed = customerLookupInput.trim();
    if (!trimmed) {
      setCustomerLookupError('Enter a mobile number or email to look up.');
      setCustomerLookupStatus('idle');
      return;
    }

    let identifier = trimmed;
    if (trimmed.includes('@')) {
      const emailCheck = validateEmail(trimmed, { required: true });
      if (!emailCheck.ok) {
        setCustomerLookupError(emailCheck.error);
        setCustomerLookupStatus('idle');
        return;
      }
      identifier = trimmed.toLowerCase();
    } else {
      identifier = trimmed.replace(/\D/g, '').slice(0, 10);
      setCustomerLookupInput(identifier);
      const phoneCheck = validatePhone(identifier);
      if (!phoneCheck.ok) {
        setCustomerLookupError(phoneCheck.error);
        setCustomerLookupStatus('idle');
        return;
      }
    }

    setCustomerLookupStatus('loading');
    try {
      const existing = await dbService.findCustomerByPhoneOrEmail(identifier);
      if (existing) {
        setCustomerExistingId(existing.id);
        setCustomerName(existing.name);
        setCustomerPhone(existing.phone);
        setCustomerEmail(existing.email || '');
        setCustomerAddress(existing.delivery_address || '');
        setCustomerLookupStatus('found');
      } else {
        setCustomerExistingId(null);
        setCustomerName('');
        setCustomerAddress('');
        if (trimmed.includes('@')) {
          setCustomerEmail(identifier);
          setCustomerPhone('');
        } else {
          setCustomerPhone(identifier);
          setCustomerEmail('');
        }
        setCustomerLookupStatus('new');
      }
    } catch (err: any) {
      setCustomerLookupError(err.message || 'Could not look up customer.');
      setCustomerLookupStatus('idle');
    }
  };

  useEffect(() => {
    if (lockedTable) {
      setTableName(lockedTable.table_name);
      return;
    }
    const free = availableTables || [];
    if (!free.some(t => t.table_name === tableName)) setTableName(free[0]?.table_name || allTables[0]?.table_name || 'Table 1');
  }, [lockedTable, availableTables, allTables, tableName]);

  useEffect(() => {
    if (lockedTable && activeTableOrders.length > 0) {
      setActiveTab('history');
      setHistorySearchMode('orderId');
      setVerifyIdentifier(String(activeTableOrders[0].id));
      setVerifiedHistory(activeTableOrders);
    }
  }, [lockedTable?.table_name, activeTableOrders]);

  useEffect(() => {
    if (!draftBaseId) {
      const first = menuItems.find(m => m.category === 'base' && m.is_active);
      if (first) setDraftBaseId(first.id);
    }
  }, [menuItems]);

  const activeBases    = menuItems.filter(m => m.category === 'base'    && m.is_active);
  const activePizzas   = menuItems.filter(m => m.category === 'pizza'   && m.is_active);
  const activeToppings = menuItems.filter(m => m.category === 'topping' && m.is_active);

  const menuNameConflicts = findMenuNameConflicts(
    menuItems.filter(m => m.is_active).map(m => ({ name: m.name, code: m.code, category: m.category }))
  );

  const draftPizzaCount = Object.values(draftPizzas).reduce((s, q) => s + q, 0);

  const committedPizzaQty = combos.reduce((s, c) => s + comboPizzaCount(c), 0);

  const updateDraftQty = (kind: 'pizza' | 'topping', id: number, delta: number) => {
    if (!Number.isInteger(delta)) {
      setQtyError('Quantity changes must be whole numbers — decimals are not allowed.');
      return;
    }
    const setter = kind === 'pizza' ? setDraftPizzas : setDraftToppings;
    setter(prev => {
      const key = String(id);
      const current = prev[key] || 0;
      const next = current + delta;
      if (next <= 0) {
        setQtyError(null);
        const c = { ...prev };
        delete c[key];
        return c;
      }
      if (!Number.isInteger(next) || next > 10) {
        setQtyError('Each pizza line must be an integer from 1 to 10.');
        return prev;
      }
      if (kind === 'pizza') {
        const draftTotal = Object.entries(prev).reduce((s, [k, q]) => s + (k === key ? 0 : q), 0) + next;
        const orderTotal = committedPizzaQty + draftTotal - current;
        if (orderTotal > 10) {
          setQtyError(`Maximum 10 pizzas per order. You already have ${committedPizzaQty} in your cart — only ${Math.max(0, 10 - committedPizzaQty)} more can be added.`);
          return prev;
        }
      }
      setQtyError(null);
      return { ...prev, [key]: next };
    });
  };

  const resetDraft = () => {
    const first = menuItems.find(m => m.category === 'base' && m.is_active);
    setDraftBaseId(first?.id ?? null);
    setDraftPizzas({});
    setDraftToppings({});
  };

  const handleAddCombo = () => {
    if (!draftPizzaCount) {
      setQtyError('Add at least one pizza (quantity must be 1–10) before saving this combo.');
      return;
    }
    const qtyCheck = validateQuantityInput(draftPizzaCount, { min: 1, max: 10, label: 'Pizza quantity' });
    if (!qtyCheck.ok) {
      setQtyError(qtyCheck.error);
      return;
    }
    const entry: ComboEntry = {
      id: editingComboId || `combo-${Date.now()}-${Math.random()}`,
      baseId: draftBaseId,
      pizzas: { ...draftPizzas },
      toppings: { ...draftToppings },
    };
    if (editingComboId) {
      setCombos(prev => prev.map(c => c.id === editingComboId ? entry : c));
      setEditingComboId(null);
    } else {
      setCombos(prev => [...prev, entry]);
    }
    resetDraft();
    requestAnimationFrame(() => {
      cartSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const handleEditCombo = (combo: ComboEntry) => {
    setEditingComboId(combo.id);
    setDraftBaseId(combo.baseId);
    setDraftPizzas({ ...combo.pizzas });
    setDraftToppings({ ...combo.toppings });
    setActiveTab('order');
    setSubmitMsg(null);
  };

  const handleCancelEdit = () => {
    setEditingComboId(null);
    resetDraft();
  };

  const handleRemoveCombo = (id: string) => setCombos(prev => prev.filter(c => c.id !== id));

  const totalPizzaQty  = combos.reduce((s, c) => s + comboPizzaCount(c), 0);
  const orderSubtotal  = Number(combos.reduce((s, c) => s + comboSubtotalOf(c, menuItems), 0).toFixed(2));
  const { discount: orderDiscount, gst: orderGst, total_payable: orderTotal } = calcOrderTotals(orderSubtotal, totalPizzaQty, appSettings);

  const billLineItems = combos.flatMap(combo => {
    const rows: { label: string; amount: number }[] = [];
    if (combo.baseId) {
      const b = menuItems.find(m => m.id === combo.baseId);
      if (b) rows.push({ label: `${b.name} (base)`, amount: b.price_inr });
    }
    Object.entries(combo.pizzas).forEach(([id, qty]) => {
      const p = menuItems.find(m => m.id === Number(id));
      if (p) rows.push({ label: `${p.name} ×${qty}`, amount: p.price_inr * qty });
    });
    Object.entries(combo.toppings).forEach(([id, qty]) => {
      const t = menuItems.find(m => m.id === Number(id));
      if (t) rows.push({ label: `+ ${t.name} ×${qty}`, amount: t.price_inr * qty });
    });
    return rows;
  });

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitMsg(null);

    if (!staffLoggedIn) {
      setSubmitMsg({ type: 'error', text: '⛔ Ordering is only available after a staff member has logged in.' });
      return;
    }
    if (menuNameConflicts.length > 0) {
      setSubmitMsg({
        type: 'error',
        text: `Menu configuration error: duplicate item names (${menuNameConflicts[0]}). Ask admin to fix Pizza & Menu before ordering.`,
      });
      return;
    }
    if (combos.length === 0) {
      setSubmitMsg({ type: 'error', text: 'Build at least one pizza combo and add it to the order.' });
      return;
    }
    if (totalPizzaQty < 1) {
      setSubmitMsg({ type: 'error', text: 'Total pizzas must be at least 1. Add items to your order.' });
      return;
    }
    if (totalPizzaQty > 10) {
      setSubmitMsg({ type: 'error', text: `Maximum 10 pizzas per order. Your cart has ${totalPizzaQty} — remove ${totalPizzaQty - 10} pizza(s).` });
      return;
    }
    const totalQtyCheck = validateQuantityInput(totalPizzaQty, { min: 1, max: 10, label: 'Total pizza quantity' });
    if (!totalQtyCheck.ok) {
      setSubmitMsg({ type: 'error', text: totalQtyCheck.error });
      return;
    }
    if (lockedTable?.is_in_use && activeTableOrders.some(isActiveOrder)) {
      setSubmitMsg({ type: 'error', text: `${lockedTable.table_name} already has an active order. View it in Order History below.` });
      setActiveTab('history');
      return;
    }
    const trimmedName = customerName;
    const trimmedPhone = customerPhone;
    const trimmedEmail = customerEmail;
    const nameCheck = validateCustomerName(trimmedName);
    const phoneCheck = validatePhone(trimmedPhone);
    const emailCheck = validateEmail(trimmedEmail);
    const errors: { name?: string; phone?: string; email?: string } = {};

    if (!nameCheck.ok) errors.name = nameCheck.error;
    if (!phoneCheck.ok) errors.phone = phoneCheck.error;
    if (!emailCheck.ok) errors.email = emailCheck.error;

    if (errors.name || errors.phone || errors.email) {
      setFieldErrors(errors);
      setSubmitMsg({ type: 'error', text: errors.name || errors.phone || errors.email || 'Please fix the highlighted fields.' });
      return;
    }
    setFieldErrors({});
    const finalName = String(trimmedName).trim();
    const finalPhone = String(trimmedPhone).trim();
    const finalEmail = String(trimmedEmail).trim().toLowerCase();
    if (!availableTables.some(t => t.table_name === tableName)) {
      setSubmitMsg({ type: 'error', text: `⛔ ${tableName} is occupied. Please pick a free table.` });
      return;
    }

    try {
      let customerId: number | null = null;
      try {
        const saved = await dbService.upsertCustomerForOrder(
          {
            name: finalName,
            phone: finalPhone,
            email: finalEmail,
            delivery_address: customerAddress.trim() || null,
          },
          customerExistingId
        );
        customerId = saved.id;
      } catch (custErr: any) {
        setSubmitMsg({ type: 'error', text: custErr.message || 'Could not register customer details.' });
        return;
      }

      const itemsToSubmit: Omit<OrderItem, 'id' | 'order_id' | 'created_at' | 'updated_at'>[] = [];
      combos.forEach(combo => {
        if (combo.baseId) {
          const b = menuItems.find(m => m.id === combo.baseId);
          if (b) itemsToSubmit.push({ menu_item_id: b.id, category: b.category, name: b.name, unit_price_snapshot: b.price_inr, currency: appSettings.default_currency, quantity: 1 });
        }
        Object.entries(combo.pizzas).forEach(([id, qty]) => {
          const p = menuItems.find(m => m.id === Number(id));
          if (p) itemsToSubmit.push({ menu_item_id: p.id, category: p.category, name: p.name, unit_price_snapshot: p.price_inr, currency: appSettings.default_currency, quantity: qty });
        });
        Object.entries(combo.toppings).forEach(([id, qty]) => {
          const t = menuItems.find(m => m.id === Number(id));
          if (t) itemsToSubmit.push({ menu_item_id: t.id, category: t.category, name: t.name, unit_price_snapshot: t.price_inr, currency: appSettings.default_currency, quantity: qty });
        });
      });

      const placedOrder = await dbService.createOrder({
        customer_id: customerId,
        customer_name: finalName,
        customer_phone: finalPhone,
        table_name: tableName,
        total_quantity: totalPizzaQty,
        subtotal: orderSubtotal,
        discount: orderDiscount,
        gst: orderGst,
        total_payable: orderTotal,
        currency: appSettings.default_currency,
        payment_mode: 'Cash',
        order_source: 'customer',
        status: 'confirmed',
        staff_id: null,
        session_started_at: sessionStartedAt,
      }, itemsToSubmit);

      setSubmitMsg({
        type: 'success',
        text: `Order #${placedOrder.id} placed for ${tableName}.`,
        orderId: placedOrder.id,
      });
      setCombos([]);
      resetCustomerFields();
      resetDraft();
      onOrderPlaced();
    } catch (err: any) {
      setSubmitMsg({ type: 'error', text: err.message });
    }
  };

  const handleVerifyHistory = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError(null);
    setVerifiedHistory(null);
    setLoadingHistory(true);
    const trimmed = verifyIdentifier.trim();
    const emptyCheck = validateNonEmpty(trimmed, historySearchMode === 'orderId' ? 'Order ID' : 'Phone or email');
    if (!emptyCheck.ok) {
      setVerifyError(emptyCheck.error);
      setLoadingHistory(false);
      return;
    }
    try {
      if (historySearchMode === 'orderId') {
        const orderId = parseInt(trimmed.replace(/^#/, ''), 10);
        if (Number.isNaN(orderId) || orderId < 1) {
          setVerifyError('Enter a valid numeric order ID (e.g. 5 or #5).');
          setLoadingHistory(false);
          return;
        }
        setVerifiedHistory(await dbService.searchOrderHistory({ orderId, status: historyStatusFilter }));
      } else {
        setVerifiedHistory(await dbService.searchOrderHistory({ phoneOrEmail: trimmed, status: historyStatusFilter }));
      }
    } catch (err: any) {
      setVerifyError(err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  const historyStatusLabel = (status: Order['status']) => {
    if (status === 'ready_to_bill') return 'Ready to Bill';
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  // ---- Draft combo preview values ----
  const draftBase = draftBaseId ? menuItems.find(m => m.id === draftBaseId) : null;
  const draftPizzaItems  = Object.entries(draftPizzas).map(([id, qty]) => ({ item: menuItems.find(m => m.id === Number(id))!, qty })).filter(x => x.item);
  const draftToppingItems = Object.entries(draftToppings).map(([id, qty]) => ({ item: menuItems.find(m => m.id === Number(id))!, qty })).filter(x => x.item);
  const draftSubtotal = draftBase ? draftBase.price_inr : 0
    + draftPizzaItems.reduce((s, x) => s + x.item.price_inr * x.qty, 0)
    + draftToppingItems.reduce((s, x) => s + x.item.price_inr * x.qty, 0);

  return (
    <div className="space-y-6" id="ordering-flow">

      {/* Tab bar */}
      <div className="flex bg-noir-sidebar p-1 rounded-xl border border-noir-border shadow-md font-sans max-w-sm">
        <button onClick={() => { setActiveTab('order'); setSubmitMsg(null); }}
          className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${activeTab === 'order' ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20 shadow-sm' : 'text-noir-muted hover:text-noir-text hover:bg-noir-highlight/30'}`}>
          <Pizza className="w-4 h-4" /> Pizza Self-Ordering
        </button>
        <button onClick={() => { setActiveTab('history'); setVerifyError(null); setVerifiedHistory(null); setVerifyIdentifier(''); }}
          className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${activeTab === 'history' ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20 shadow-sm' : 'text-noir-muted hover:text-noir-text hover:bg-noir-highlight/30'}`}>
          <History className="w-4 h-4" /> Order History
        </button>
      </div>

      {/* ========== ORDERING TAB ========== */}
      {activeTab === 'order' && (
        <div className="space-y-6">
          {menuNameConflicts.length > 0 && (
            <div className="p-3 bg-noir-panel border border-red-500/30 rounded-xl text-xs text-red-400 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Menu has duplicate item names with different codes — ordering is blocked until admin fixes this.</p>
                <ul className="mt-1 list-disc pl-4 space-y-0.5 text-[11px]">
                  {menuNameConflicts.map(msg => <li key={msg}>{msg}</li>)}
                </ul>
              </div>
            </div>
          )}
          {lockedTable && (
            <div className="bg-noir-highlight border border-noir-gold-o20 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-noir-gold uppercase tracking-wider">Table QR · #{scannedTableQr ?? tableQrNumber(lockedTable)}</p>
                <p className="text-sm text-noir-text font-serif italic mt-0.5">{lockedTable.table_name} · {lockedTable.capacity} seats</p>
                {lockedTable.description && <p className="text-[11px] text-noir-muted mt-1">{lockedTable.description}</p>}
              </div>
              {activeTableOrders.length > 0 ? (
                <button
                  type="button"
                  onClick={() => { setActiveTab('history'); setHistorySearchMode('orderId'); setVerifyIdentifier(String(activeTableOrders[0].id)); }}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl cursor-pointer"
                >
                  View active order #{activeTableOrders[0].id}
                </button>
              ) : (
                <span className="text-xs text-emerald-400 font-semibold">Ready to order</span>
              )}
            </div>
          )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* LEFT / CENTER — combo builder */}
          <div className="lg:col-span-2 space-y-6">

            {/* Step 1: Base */}
            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg space-y-3">
              <div>
                <h3 className="font-serif italic text-noir-gold text-base">1. Choose Crust Base</h3>
                <p className="text-xs text-noir-muted">Every combo needs a hand-tossed base.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {activeBases.map(base => (
                  <div key={base.id} onClick={() => setDraftBaseId(base.id)}
                    className={`p-3.5 border rounded-xl cursor-pointer transition-all flex flex-col justify-between ${draftBaseId === base.id ? 'border-2 border-noir-gold bg-noir-highlight shadow-md' : 'border-noir-border hover:border-noir-border-light bg-noir-panel'}`}>
                    <div className="flex justify-between items-start gap-1">
                      <span className="font-semibold text-noir-text text-xs">{base.name}</span>
                      <span className="font-mono text-xs font-bold text-noir-gold">+₹{base.price_inr}</span>
                    </div>
                    <p className="text-[10px] text-noir-dim mt-1 italic leading-tight">{base.description || 'Traditional baked'}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Step 2: Pizzas */}
            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg space-y-4">
              <div>
                <h3 className="font-serif italic text-noir-gold text-base">2. Select Pizza Variety</h3>
                <p className="text-xs text-noir-muted">Tap a pizza to add it to this combo (use +/− to adjust quantity).</p>
              </div>
              {qtyError && (
                <p className="text-xs text-red-400 font-semibold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{qtyError}</p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {activePizzas.map(pizza => {
                  const qty = draftPizzas[String(pizza.id)] || 0;
                  return (
                    <div
                      key={pizza.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => updateDraftQty('pizza', pizza.id, 1)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); updateDraftQty('pizza', pizza.id, 1); } }}
                      className={`p-4 border rounded-xl cursor-pointer transition-all flex justify-between items-center gap-3 ${qty > 0 ? 'border-noir-gold bg-noir-highlight' : 'border-noir-border bg-noir-panel hover:border-noir-gold-o20'}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-mono font-bold text-[9px] text-noir-dim bg-noir-highlight px-1.5 border border-noir-border rounded">{pizza.code}</span>
                          <h4 className="font-semibold text-noir-text text-xs truncate">{pizza.name}</h4>
                        </div>
                        <p className="text-[10px] text-noir-muted mt-1 italic line-clamp-2 leading-tight">{pizza.description}</p>
                        <p className="font-mono text-xs font-bold text-noir-gold mt-1.5">₹{pizza.price_inr}</p>
                      </div>
                      <div className="flex items-center space-x-2.5" onClick={e => e.stopPropagation()}>
                        {qty > 0 ? (
                          <>
                            <button type="button" onClick={() => updateDraftQty('pizza', pizza.id, -1)} aria-label={`Decrease ${pizza.name}`} className="p-1.5 bg-noir-highlight hover:bg-noir-sidebar text-noir-text rounded-lg cursor-pointer transition-colors border border-noir-border"><Minus className="w-3.5 h-3.5" /></button>
                            <span className="font-mono font-bold text-xs text-noir-text w-4 text-center">{qty}</span>
                            <button type="button" onClick={() => updateDraftQty('pizza', pizza.id, 1)} aria-label={`Increase ${pizza.name}`} className="p-1.5 bg-noir-gold hover:bg-noir-gold-hover text-black rounded-lg cursor-pointer transition-colors"><Plus className="w-3.5 h-3.5" /></button>
                          </>
                        ) : (
                          <span className="px-3 py-1.5 bg-noir-highlight text-noir-gold rounded-lg text-[10px] font-bold border border-noir-gold-o20">Tap to add</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 3: Toppings */}
            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg space-y-3">
              <div>
                <h3 className="font-serif italic text-noir-gold text-base">3. Add Toppings <span className="text-noir-dim font-sans font-normal text-xs">(optional)</span></h3>
                <p className="text-xs text-noir-muted">Upgrade this combo with savory add-ons.</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {activeToppings.map(top => {
                  const qty = draftToppings[String(top.id)] || 0;
                  return (
                    <div
                      key={top.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => updateDraftQty('topping', top.id, 1)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); updateDraftQty('topping', top.id, 1); } }}
                      className={`p-3 border rounded-xl cursor-pointer transition-all flex flex-col justify-between h-24 ${qty > 0 ? 'border-noir-gold bg-noir-highlight' : 'border-noir-border bg-noir-panel hover:border-noir-gold-o20'}`}
                    >
                      <div className="flex justify-between items-start gap-1">
                        <span className="font-semibold text-noir-text text-[11px] leading-tight">{top.name}</span>
                        <span className="font-mono text-[10px] font-bold text-noir-gold">+₹{top.price_inr}</span>
                      </div>
                      <div className="flex items-center justify-between mt-2.5" onClick={e => e.stopPropagation()}>
                        {qty > 0 && <span className="text-[9px] text-noir-dim font-mono">Qty: {qty}</span>}
                        <div className="flex space-x-1 ml-auto">
                          {qty > 0 && <button type="button" onClick={() => updateDraftQty('topping', top.id, -1)} aria-label={`Decrease ${top.name}`} className="p-1 bg-noir-highlight text-noir-muted border border-noir-border rounded cursor-pointer"><Minus className="w-3 h-3" /></button>}
                          <button type="button" onClick={() => updateDraftQty('topping', top.id, 1)} aria-label={`Add ${top.name}`} className="p-1 bg-noir-highlight text-noir-gold border border-noir-gold-o20 rounded cursor-pointer hover:bg-noir-sidebar"><Plus className="w-3 h-3" /></button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={handleAddCombo}
                disabled={!draftPizzaCount || menuNameConflicts.length > 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-noir-gold hover:bg-noir-gold-hover disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold text-xs rounded-xl shadow transition-all cursor-pointer"
              >
                <PackagePlus className="w-4 h-4" />
                {editingComboId ? 'Save Combo Changes' : 'Add Combo to Order'}
              </button>
              {editingComboId && (
                <button type="button" onClick={handleCancelEdit} className="text-xs text-noir-muted hover:text-noir-text underline cursor-pointer">
                  Cancel edit
                </button>
              )}
              {draftPizzaCount > 0 && (
                <span className="text-xs text-noir-muted italic">
                  {draftBase?.name ?? 'No base'} · {draftPizzaItems.map(x => `${x.item.name} ×${x.qty}`).join(', ')}
                  {draftToppingItems.length > 0 && ` · ${draftToppingItems.map(x => x.item.name).join(', ')}`}
                </span>
              )}
            </div>
          </div>

          {/* RIGHT — order cart & checkout */}
          <div className="space-y-5" ref={cartSectionRef}>
            <form onSubmit={handleCheckout} className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg space-y-4">
              <div className="flex items-center space-x-2 border-b border-noir-border pb-3">
                <ShoppingBag className="w-5 h-5 text-noir-gold" />
                <h3 className="font-serif text-noir-text text-sm">Your Order</h3>
                {combos.length > 0 && <span className="ml-auto text-[10px] font-mono bg-noir-highlight border border-noir-border text-noir-gold px-2 py-0.5 rounded-full">{combos.length} combo{combos.length > 1 ? 's' : ''}</span>}
              </div>

              {/* Committed combos list */}
              {combos.length > 0 ? (
                <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                  {combos.map((combo, idx) => {
                    const base = combo.baseId ? menuItems.find(m => m.id === combo.baseId) : null;
                    const pizzaList  = Object.entries(combo.pizzas).map(([id, qty]) => ({ item: menuItems.find(m => m.id === Number(id))!, qty })).filter(x => x.item);
                    const toppingList = Object.entries(combo.toppings).map(([id, qty]) => ({ item: menuItems.find(m => m.id === Number(id))!, qty })).filter(x => x.item);
                    const sub = comboSubtotalOf(combo, menuItems);
                    return (
                      <div
                        key={combo.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleEditCombo(combo)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleEditCombo(combo); } }}
                        className={`rounded-xl border bg-noir-panel p-3 space-y-1.5 cursor-pointer transition-all hover:border-noir-gold-o20 ${editingComboId === combo.id ? 'border-noir-gold ring-1 ring-noir-gold-o20' : 'border-noir-border'}`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-semibold text-noir-gold uppercase tracking-wider">
                            Combo {idx + 1}{editingComboId === combo.id ? ' · editing' : ''}
                          </span>
                          <button type="button" onClick={e => { e.stopPropagation(); handleRemoveCombo(combo.id); if (editingComboId === combo.id) handleCancelEdit(); }} aria-label="Remove combo" className="p-1 text-noir-dim hover:text-red-400 transition-colors cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="text-[11px] text-noir-text space-y-0.5">
                          {base && <p className="text-noir-dim">Base: <span className="text-noir-text">{base.name}</span></p>}
                          {pizzaList.map(x => <p key={x.item.id}>{x.item.name} <span className="text-noir-dim">×{x.qty}</span></p>)}
                          {toppingList.map(x => <p key={x.item.id} className="text-noir-dim">+ {x.item.name} ×{x.qty}</p>)}
                        </div>
                        <div className="flex justify-between text-[11px] border-t border-noir-border pt-1.5 mt-1">
                          <span className="text-noir-dim">Combo subtotal</span>
                          <span className="font-mono text-noir-gold">₹{sub.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-center text-noir-dim text-xs py-6 italic">Build a combo above and tap "Add Combo to Order".</p>
              )}

              {/* Bill summary */}
              {combos.length > 0 && (
                <BillSummary
                  lineItems={billLineItems}
                  subtotal={orderSubtotal}
                  discount={orderDiscount}
                  gst={orderGst}
                  total={orderTotal}
                  currency={appSettings.default_currency}
                  discountLabel={bulkDiscountLabel(appSettings)}
                  gstLabel={gstLabel(appSettings)}
                  footerNote={
                    bulkDiscountFooterNote(appSettings, totalPizzaQty)
                    || 'Payment is collected by staff when your order is served.'
                  }
                />
              )}

              {/* Customer details */}
              <div className="border-t border-noir-border pt-3.5 space-y-3 text-xs">
                <h4 className="font-semibold text-noir-dim text-[10px] uppercase tracking-wider">Order Details</h4>
                <div className="space-y-1">
                  <label htmlFor="table-select" className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Table *</label>
                  <select id="table-select" aria-label="Select Table" value={tableName} onChange={e => setTableName(e.target.value)} disabled={!!lockedTable}
                    className="w-full px-2.5 py-2 bg-noir-panel border border-noir-border rounded-xl font-mono text-noir-text focus:border-noir-gold outline-none text-xs disabled:opacity-70">
                    {(lockedTable ? [lockedTable] : (availableTables.length > 0 ? availableTables : allTables)).map(t => (
                      <option key={t.id || t.table_name} value={t.table_name}>
                        {t.table_name} · {t.capacity} seats{t.description ? ` — ${t.description}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl border border-noir-border bg-noir-card/40 p-3 space-y-2">
                  <p className="text-[10px] text-noir-muted">Look up your account by mobile or email, then confirm or edit your details below.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
                    <div className="space-y-1">
                      <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Mobile or email</label>
                      <input
                        type="text"
                        placeholder="e.g. 9876543210 or you@example.com"
                        value={customerLookupInput}
                        onChange={e => {
                          setCustomerLookupInput(e.target.value);
                          setCustomerExistingId(null);
                          setCustomerLookupStatus('idle');
                          setCustomerLookupError(null);
                        }}
                        className="w-full px-3 py-2 bg-noir-panel border border-noir-border rounded-xl text-noir-text focus:border-noir-gold outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleCustomerLookup}
                      disabled={customerLookupStatus === 'loading'}
                      className="px-4 py-2 bg-noir-highlight hover:bg-noir-sidebar border border-noir-border text-noir-text rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      {customerLookupStatus === 'loading' ? 'Looking up…' : 'Look up'}
                    </button>
                  </div>
                  {customerLookupError && <p className="text-[10px] text-red-400">{customerLookupError}</p>}
                  {customerLookupStatus === 'found' && (
                    <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Account found — review and edit below before placing your order.
                    </p>
                  )}
                  {customerLookupStatus === 'new' && (
                    <p className="text-[10px] text-amber-300">No account found. Fill in your details below to register with this order.</p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Full Name *</label>
                  <input type="text" required placeholder="e.g. Rahul Kumar" value={customerName} onChange={e => { setCustomerName(e.target.value); setFieldErrors(p => ({ ...p, name: undefined })); }}
                    className={`w-full px-3 py-2 bg-noir-panel border rounded-xl text-noir-text focus:border-noir-gold outline-none ${fieldErrors.name ? 'border-red-500/50' : 'border-noir-border'}`} />
                  {fieldErrors.name && <p className="text-[10px] text-red-400">{fieldErrors.name}</p>}
                </div>
                <div className="space-y-1">
                  <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Mobile Number *</label>
                  <input type="tel" required placeholder="e.g. 9876543210" value={customerPhone} onChange={e => { setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setFieldErrors(p => ({ ...p, phone: undefined })); }}
                    className={`w-full px-3 py-2 bg-noir-panel border rounded-xl text-noir-text focus:border-noir-gold outline-none ${fieldErrors.phone ? 'border-red-500/50' : 'border-noir-border'}`} />
                  {fieldErrors.phone && <p className="text-[10px] text-red-400">{fieldErrors.phone}</p>}
                </div>
                <div className="space-y-1">
                  <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Email (optional)</label>
                  <input
                    type="email"
                    placeholder="e.g. rahul@example.com"
                    value={customerEmail}
                    onChange={e => { setCustomerEmail(e.target.value); setFieldErrors(p => ({ ...p, email: undefined })); }}
                    className={`w-full px-3 py-2 bg-noir-panel border rounded-xl text-noir-text focus:border-noir-gold outline-none ${fieldErrors.email ? 'border-red-500/50' : 'border-noir-border'}`}
                  />
                  {fieldErrors.email && <p className="text-[10px] text-red-400">{fieldErrors.email}</p>}
                </div>
                <div className="space-y-1">
                  <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Address (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. 12 MG Road, Bengaluru"
                    value={customerAddress}
                    onChange={e => setCustomerAddress(e.target.value)}
                    className="w-full px-3 py-2 bg-noir-panel border border-noir-border rounded-xl text-noir-text focus:border-noir-gold outline-none"
                  />
                </div>
              </div>

              {submitMsg && (
                <div
                  id="submit-status-msg"
                  role={submitMsg.type === 'success' && submitMsg.orderId && staffLoggedIn && onGoToQueue ? 'button' : undefined}
                  tabIndex={submitMsg.type === 'success' && submitMsg.orderId && staffLoggedIn && onGoToQueue ? 0 : undefined}
                  onClick={() => {
                    if (submitMsg.type === 'success' && submitMsg.orderId && staffLoggedIn && onGoToQueue) {
                      onGoToQueue();
                    }
                  }}
                  onKeyDown={e => {
                    if ((e.key === 'Enter' || e.key === ' ') && submitMsg.type === 'success' && submitMsg.orderId && staffLoggedIn && onGoToQueue) {
                      e.preventDefault();
                      onGoToQueue();
                    }
                  }}
                  className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 border ${submitMsg.type === 'success' ? 'bg-noir-panel border-emerald-500/20 text-emerald-400' : 'bg-noir-panel border-red-500/20 text-red-400'} ${submitMsg.type === 'success' && submitMsg.orderId && staffLoggedIn && onGoToQueue ? 'cursor-pointer hover:border-emerald-500/40' : ''}`}
                >
                  {submitMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                  <span className="flex-1">
                    {submitMsg.text}
                    {submitMsg.type === 'success' && submitMsg.orderId && staffLoggedIn && onGoToQueue && (
                      <span className="block text-[10px] text-emerald-300/80 mt-0.5 font-normal">Tap to open Kitchen Queue</span>
                    )}
                  </span>
                  {submitMsg.type === 'success' && submitMsg.orderId && staffLoggedIn && onGoToQueue && (
                    <button
                      type="button"
                      onClick={onGoToQueue}
                      className="shrink-0 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold cursor-pointer"
                    >
                      View queue
                    </button>
                  )}
                  <button type="button" onClick={() => setSubmitMsg(null)} className="text-noir-dim hover:text-noir-text px-1">×</button>
                </div>
              )}

              <button type="submit"
                className="w-full py-3 bg-noir-gold hover:bg-noir-gold-hover text-black font-semibold text-xs rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-1.5">
                <Smartphone className="w-4 h-4" />
                {combos.length === 0 ? 'Add a combo to place order' : `Place Order (₹${orderTotal})`}
              </button>
            </form>
          </div>
        </div>
        </div>
      )}

      {/* ========== HISTORY TAB ========== */}
      {activeTab === 'history' && (
        <div className="bg-noir-card p-6 rounded-2xl border border-noir-border shadow-lg max-w-2xl">
          <div className="border-b border-noir-border pb-3 mb-5">
            <h3 className="font-serif italic text-noir-gold text-base flex items-center gap-1.5">
              <History className="w-5 h-5" /> Order History Lookup
            </h3>
            <p className="text-xs text-noir-muted mt-1">Search by order ID, phone, or email. Filter by status.</p>
          </div>

          <form onSubmit={handleVerifyHistory} className="space-y-3 bg-noir-panel p-4 border border-noir-border rounded-xl">
            <div className="flex gap-1 bg-noir-sidebar p-1 rounded-lg border border-noir-border text-[10px] font-semibold">
              <button type="button" onClick={() => setHistorySearchMode('phone')} className={`flex-1 py-1.5 rounded-md cursor-pointer ${historySearchMode === 'phone' ? 'bg-noir-highlight text-noir-gold' : 'text-noir-muted'}`}>Phone / Email</button>
              <button type="button" onClick={() => setHistorySearchMode('orderId')} className={`flex-1 py-1.5 rounded-md cursor-pointer ${historySearchMode === 'orderId' ? 'bg-noir-highlight text-noir-gold' : 'text-noir-muted'}`}>Order ID</button>
            </div>
            <div className="space-y-1 text-xs">
              <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">
                {historySearchMode === 'orderId' ? 'Order ID *' : 'Phone Number or Email *'}
              </label>
              <input type="text" required placeholder={historySearchMode === 'orderId' ? 'e.g. 5 or #5' : 'e.g. 9876543210 or rahul@example.com'} value={verifyIdentifier} onChange={e => setVerifyIdentifier(e.target.value)}
                className="w-full px-3 py-2 bg-noir-sidebar border border-noir-border rounded-xl text-xs text-noir-text focus:border-noir-gold outline-none" />
            </div>
            <div className="space-y-1 text-xs">
              <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Status Filter</label>
              <select value={historyStatusFilter} onChange={e => setHistoryStatusFilter(e.target.value as Order['status'] | 'all')}
                className="w-full px-3 py-2 bg-noir-sidebar border border-noir-border rounded-xl text-xs text-noir-text focus:border-noir-gold outline-none">
                <option value="all">All statuses</option>
                <option value="confirmed">Confirmed</option>
                <option value="preparing">Preparing</option>
                <option value="ready">Ready</option>
                <option value="ready_to_bill">Ready to Bill</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="text-right pt-1">
              <button type="submit" disabled={loadingHistory}
                className="px-5 py-2.5 bg-noir-gold hover:bg-noir-gold-hover text-black rounded-xl text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-md">
                {loadingHistory ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Look Up Orders
              </button>
            </div>
          </form>

          {verifyError && (
            <div className="mt-4 p-3 bg-noir-panel border border-red-500/20 rounded-xl text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" /><span>{verifyError}</span>
            </div>
          )}

          {verifiedHistory && (
            <div className="mt-6 space-y-4">
              <h4 className="font-serif italic text-noir-gold text-sm border-b border-noir-border pb-2">
                {verifiedHistory.length} order{verifiedHistory.length !== 1 ? 's' : ''} found
              </h4>
              {verifiedHistory.length > 0 ? (
                <div className="space-y-4">
                  {verifiedHistory.map(o => (
                    <div key={o.id} className="border border-noir-border p-4 rounded-xl bg-noir-panel space-y-3">
                      <div className="flex justify-between items-start border-b border-noir-border pb-2">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-xs font-semibold text-noir-dim">#{o.id}</span>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase border ${
                              o.status === 'confirmed' ? 'bg-blue-950/40 text-blue-300 border-blue-900/40' :
                              o.status === 'preparing' ? 'bg-amber-950/40 text-amber-300 border-amber-900/40' :
                              o.status === 'ready'     ? 'bg-emerald-950/40 text-emerald-300 border-emerald-900/40' :
                              o.status === 'ready_to_bill' ? 'bg-purple-950/40 text-purple-300 border-purple-900/40' :
                              o.status === 'cancelled' ? 'bg-red-950/40 text-red-300 border-red-900/40' :
                              'bg-noir-highlight text-noir-muted border-noir-border'}`}>{historyStatusLabel(o.status)}</span>
                          </div>
                          <p className="text-[10px] text-noir-dim mt-1 font-mono">{new Date(o.created_at).toLocaleString()}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-noir-gold">₹{o.total_payable}</p>
                          <p className="text-[9px] text-noir-dim font-mono mt-0.5">{o.table_name}</p>
                        </div>
                      </div>
                      <OrderCombosDisplay items={o.items} />
                      <div className="pt-2 border-t border-noir-border text-[10px] text-noir-dim font-mono flex flex-wrap gap-x-4 gap-y-1">
                        <p>Placed: {new Date(o.created_at).toLocaleTimeString()}</p>
                        {o.cooking_started_at && <p>Cooking: {new Date(o.cooking_started_at).toLocaleTimeString()}</p>}
                        {o.ready_at && <p>Ready: {new Date(o.ready_at).toLocaleTimeString()}</p>}
                        {o.delivered_at && <p className="text-emerald-400 font-bold">Served: {new Date(o.delivered_at).toLocaleTimeString()}</p>}
                        {o.cancelled_at && <p className="text-red-400 font-bold">Cancelled: {new Date(o.cancelled_at).toLocaleTimeString()}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center py-6 text-xs text-noir-dim italic">No orders found for this account.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
