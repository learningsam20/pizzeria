import React, { useState, useEffect } from 'react';
import { 
  Pizza, Plus, Minus, ShoppingBag, CreditCard, Sparkles, Clock, History, AlertCircle, CheckCircle2, RefreshCw, Smartphone 
} from 'lucide-react';
import { MenuItem, Order, OrderItem, OrderWithItems, Customer } from '../types';
import { dbService } from '../lib/dbService';

interface OrderingFlowProps {
  menuItems: MenuItem[];
  onOrderPlaced: () => void;
  staffLoggedIn: boolean;
  activeTableParam: number | null;
}

export default function OrderingFlow({ menuItems, onOrderPlaced, staffLoggedIn, activeTableParam }: OrderingFlowProps) {
  // Session opening timestamp (for session_started_at logs!)
  const [sessionStartedAt] = useState<string>(new Date().toISOString());
  
  // Views
  const [activeTab, setActiveTab] = useState<'order' | 'history'>('order');

  // Customer Context
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [tableNumber, setTableNumber] = useState<number>(activeTableParam || 1);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'Card' | 'UPI'>('UPI');

  // Cart: Map item id -> quantity
  const [cart, setCart] = useState<{ [itemId: number]: number }>({});
  const [cartBaseId, setCartBaseId] = useState<number | null>(null);

  // Verification & History states
  const [verifyName, setVerifyName] = useState('');
  const [verifyPhone, setVerifyPhone] = useState('');
  const [verifiedHistory, setVerifiedHistory] = useState<OrderWithItems[] | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Status/Submit Message
  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Auto-set table if parameter changes
  useEffect(() => {
    if (activeTableParam) {
      setTableNumber(activeTableParam);
    }
  }, [activeTableParam]);

  // Pre-select first base crust in the menu for convenience
  useEffect(() => {
    const firstBase = menuItems.find(m => m.category === 'base' && m.is_active);
    if (firstBase && !cartBaseId) {
      setCartBaseId(firstBase.id);
    }
  }, [menuItems, cartBaseId]);

  // Calculations
  const selectedPizzas = menuItems.filter(m => m.category === 'pizza' && m.is_active);
  const selectedToppings = menuItems.filter(m => m.category === 'topping' && m.is_active);
  const selectedBases = menuItems.filter(m => m.category === 'base' && m.is_active);

  const handleUpdateQty = (itemId: number, delta: number) => {
    setCart(prev => {
      const current = prev[itemId] || 0;
      const next = current + delta;
      if (next <= 0) {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      }
      return { ...prev, [itemId]: next };
    });
  };

  // Get total cart quantities
  const totalCartQty = (Object.values(cart) as number[]).reduce((sum: number, q: number) => sum + q, 0) + (cartBaseId ? 1 : 0);

  // Cart calculations
  const calculateBill = () => {
    let subtotal = 0;
    
    // Sum Pizzas and Toppings
    Object.keys(cart).forEach(idStr => {
      const id = parseInt(idStr);
      const item = menuItems.find(m => m.id === id);
      if (item) {
        subtotal += item.price_inr * cart[idStr];
      }
    });

    // Sum Base Crust selection
    if (cartBaseId) {
      const baseItem = menuItems.find(m => m.id === cartBaseId);
      if (baseItem) {
        subtotal += baseItem.price_inr;
      }
    }

    const gst = subtotal * 0.05; // 5% GST
    const discount = 0; // Default zero discount
    const totalPayable = subtotal + gst - discount;

    return {
      subtotal: Number(subtotal.toFixed(2)),
      gst: Number(gst.toFixed(2)),
      discount,
      totalPayable: Number(totalPayable.toFixed(2))
    };
  };

  const bill = calculateBill();

  // Submit checkout
  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitMsg(null);

    // Enforce Staff Login constraints: "The customers should be able to start a new transaction after the staff has logged in."
    if (!staffLoggedIn) {
      setSubmitMsg({
        type: 'error',
        text: "⛔ Ordering Forbidden. Self-ordering transactions can only be initiated after a staff member or manager has securely logged on."
      });
      return;
    }

    // Cart validation
    const pizzaCount = Object.keys(cart).filter(idStr => {
      const item = menuItems.find(m => m.id === parseInt(idStr));
      return item && item.category === 'pizza';
    }).reduce((sum, idStr) => sum + cart[idStr], 0);

    if (pizzaCount === 0) {
      setSubmitMsg({ type: 'error', text: "Please select at least one pizza variety to build your order." });
      return;
    }

    // Constraint check: "total_quantity integer NOT NULL CHECK (total_quantity BETWEEN 1 AND 10)"
    if (totalCartQty < 1 || totalCartQty > 10) {
      setSubmitMsg({
        type: 'error',
        text: `⛔ Billing constraint failed: Total order items count is ${totalCartQty}. Pizzas must be between 1 and 10 items per checkout.`
      });
      return;
    }

    // REGEX validation check for profiles
    const nameRegex = /^[A-Za-z \u00C0-\u017F]{2,40}$/;
    const phoneRegex = /^[6-9]\d{9}$/;

    if (!nameRegex.test(customerName.trim())) {
      setSubmitMsg({ type: 'error', text: "Customer Name must contain only alphabet/accented letters (2 to 40 characters) with no special symbols." });
      return;
    }

    if (!phoneRegex.test(customerPhone.trim())) {
      setSubmitMsg({ type: 'error', text: "Please enter a valid 10-digit Indian phone number starting with 6-9." });
      return;
    }

    // Strict UI and business boundary validations to disallow any incorrect operations
    if (tableNumber < 1 || tableNumber > 20) {
      setSubmitMsg({ type: 'error', text: "⛔ Table number must be between 1 and 20." });
      return;
    }

    if (!['Cash', 'Card', 'UPI'].includes(paymentMode)) {
      setSubmitMsg({ type: 'error', text: "⛔ Invalid payment mode selected." });
      return;
    }

    try {
      // 1. Double check or register customer in master table first
      let customerId: number | null = null;
      try {
        const existing = await dbService.findCustomerByPhone(customerPhone.trim());
        if (existing) {
          customerId = existing.id;
        } else {
          const registered = await dbService.createCustomer({
            name: customerName.trim(),
            phone: customerPhone.trim(),
            delivery_address: deliveryAddress.trim() || null
          });
          customerId = registered.id;
        }
      } catch (custErr) {
        console.warn("Soft handling customer pre-reg:", custErr);
      }

      // 2. Format Line Items snapshots
      const itemsToSubmit: Omit<OrderItem, 'id' | 'order_id' | 'created_at' | 'updated_at'>[] = [];

      // Add Pizzas and toppings
      Object.keys(cart).forEach(idStr => {
        const id = parseInt(idStr);
        const item = menuItems.find(m => m.id === id);
        if (item) {
          itemsToSubmit.push({
            menu_item_id: item.id,
            category: item.category,
            name: item.name,
            unit_price_snapshot: item.price_inr,
            currency: 'INR',
            quantity: cart[idStr]
          });
        }
      });

      // Add selected base
      if (cartBaseId) {
        const baseItem = menuItems.find(m => m.id === cartBaseId);
        if (baseItem) {
          itemsToSubmit.push({
            menu_item_id: baseItem.id,
            category: baseItem.category,
            name: baseItem.name,
            unit_price_snapshot: baseItem.price_inr,
            currency: 'INR',
            quantity: 1
          });
        }
      }

      // 3. Fire createOrder
      await dbService.createOrder({
        customer_id: customerId,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        table_number: tableNumber,
        total_quantity: totalCartQty,
        subtotal: bill.subtotal,
        discount: bill.discount,
        gst: bill.gst,
        total_payable: bill.totalPayable,
        currency: 'INR',
        payment_mode: paymentMode,
        order_source: 'customer',
        status: 'confirmed',
        staff_id: null,
        session_started_at: sessionStartedAt,
      }, itemsToSubmit);

      setSubmitMsg({
        type: 'success',
        text: `🎉 Success! Your table #${tableNumber} pizza transaction has been placed. Kitchen preparation starts shortly!`
      });

      // Reset cart
      setCart({});
      setCustomerName('');
      setCustomerPhone('');
      setDeliveryAddress('');
      onOrderPlaced();
    } catch (err: any) {
      setSubmitMsg({ type: 'error', text: err.message });
    }
  };

  // PII Verification & History Lookup
  const handleVerifyHistory = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError(null);
    setVerifiedHistory(null);
    setLoadingHistory(true);

    if (!verifyName.trim() || !verifyPhone.trim()) {
      setVerifyError("Please fill out both Name and Phone details.");
      setLoadingHistory(false);
      return;
    }

    try {
      // Find matching customer
      const customer = await dbService.findCustomerByPhone(verifyPhone.trim());
      
      // Strict PII Match: check if phone matches AND name contains the input
      if (!customer || !customer.name.toLowerCase().includes(verifyName.trim().toLowerCase())) {
        setVerifyError("⛔ PII verification failed: No matching customer found. Details do not match our secure records.");
        setLoadingHistory(false);
        return;
      }

      // Retrieve history
      const hist = await dbService.getCustomerOrdersHistory(verifyPhone.trim());
      setVerifiedHistory(hist);
    } catch (err: any) {
      setVerifyError(err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <div className="space-y-6" id="ordering-flow">
      {/* Navigation tabs */}
      <div className="flex bg-noir-sidebar p-1 rounded-xl border border-noir-border shadow-md font-sans max-w-sm">
        <button
          onClick={() => { setActiveTab('order'); setSubmitMsg(null); }}
          className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === 'order' 
              ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20 shadow-sm' 
              : 'text-noir-muted hover:text-noir-text hover:bg-noir-highlight/30'
          }`}
        >
          <Pizza className="w-4 h-4" /> Pizza Self-Ordering
        </button>
        <button
          onClick={() => { setActiveTab('history'); setVerifyError(null); setVerifiedHistory(null); }}
          className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === 'history' 
              ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20 shadow-sm' 
              : 'text-noir-muted hover:text-noir-text hover:bg-noir-highlight/30'
          }`}
        >
          <History className="w-4 h-4" /> Verify Order History
        </button>
      </div>

      {submitMsg && (
        <div className={`p-4 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
          submitMsg.type === 'success' 
            ? 'bg-noir-panel border-emerald-500/20 text-emerald-400' 
            : 'bg-noir-panel border-red-500/20 text-red-400'
        }`} id="submit-status-msg">
          {submitMsg.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertCircle className="w-5 h-5 text-red-400" />}
          <span className="flex-1 font-serif italic text-[13px]">{submitMsg.text}</span>
          <button onClick={() => setSubmitMsg(null)} className="text-noir-dim hover:text-noir-text text-base px-1">×</button>
        </div>
      )}

      {/* RENDER SELF ORDERING PIZZA FLOW */}
      {activeTab === 'order' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Menu Catalog builder */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Step 1: Base selection */}
            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg space-y-3">
              <div>
                <h3 className="font-serif italic text-noir-gold text-base">1. Select Pizza Crust Base</h3>
                <p className="text-xs text-noir-muted">Every slice of heaven pizza requires a hand-tossed base.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {selectedBases.map(base => (
                  <div
                    key={base.id}
                    onClick={() => setCartBaseId(base.id)}
                    className={`p-3.5 border rounded-xl cursor-pointer transition-all flex flex-col justify-between ${
                      cartBaseId === base.id 
                        ? 'border-2 border-noir-gold bg-noir-highlight shadow-md' 
                        : 'border-noir-border hover:border-noir-border-light bg-noir-panel'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-1">
                      <span className="font-semibold text-noir-text text-xs font-sans">{base.name}</span>
                      <span className="font-mono text-xs font-bold text-noir-gold">+₹{base.price_inr}</span>
                    </div>
                    <p className="text-[10px] text-noir-dim mt-1 italic leading-tight">{base.description || 'Traditional baked'}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Step 2: Choose Pizzas */}
            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg space-y-4">
              <div>
                <h3 className="font-serif italic text-noir-gold text-base">2. Select Your Pizza Variety</h3>
                <p className="text-xs text-noir-muted">Indulge in our master pizza recipes, baked freshly with premium sauce.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {selectedPizzas.map(pizza => {
                  const qty = cart[pizza.id] || 0;
                  return (
                    <div key={pizza.id} className="p-4 border border-noir-border rounded-xl bg-noir-panel flex justify-between items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-mono font-bold text-[9px] text-noir-dim bg-noir-highlight px-1.5 border border-noir-border rounded">{pizza.code}</span>
                          <h4 className="font-semibold text-noir-text text-xs font-sans truncate">{pizza.name}</h4>
                        </div>
                        <p className="text-[10px] text-noir-muted mt-1 italic line-clamp-2 leading-tight">{pizza.description}</p>
                        <p className="font-mono text-xs font-bold text-noir-gold mt-1.5">₹{pizza.price_inr}</p>
                      </div>

                      <div className="flex items-center space-x-2.5">
                        {qty > 0 ? (
                          <>
                            <button
                              onClick={() => handleUpdateQty(pizza.id, -1)}
                              className="p-1.5 bg-noir-highlight hover:bg-noir-sidebar text-noir-text rounded-lg cursor-pointer transition-colors border border-noir-border"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="font-mono font-bold text-xs text-noir-text w-4 text-center">{qty}</span>
                            <button
                              onClick={() => handleUpdateQty(pizza.id, 1)}
                              className="p-1.5 bg-noir-gold hover:bg-noir-gold-hover text-black rounded-lg cursor-pointer transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleUpdateQty(pizza.id, 1)}
                            className="px-3 py-1.5 bg-noir-highlight hover:bg-noir-sidebar text-noir-gold rounded-lg text-[10px] font-bold cursor-pointer transition-colors border border-noir-gold-o20"
                          >
                            Add +
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 3: Add extra toppings */}
            <div className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg space-y-3">
              <div>
                <h3 className="font-serif italic text-noir-gold text-base">3. Customize Toppings Slices</h3>
                <p className="text-xs text-noir-muted">Upgrade your slice of heaven pizza with our savory add-on toppings.</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {selectedToppings.map(top => {
                  const qty = cart[top.id] || 0;
                  return (
                    <div key={top.id} className="p-3 border border-noir-border rounded-xl bg-noir-panel flex flex-col justify-between h-24">
                      <div className="flex justify-between items-start gap-1">
                        <span className="font-semibold text-noir-text text-[11px] leading-tight">{top.name}</span>
                        <span className="font-mono text-[10px] font-bold text-noir-gold">+₹{top.price_inr}</span>
                      </div>
                      
                      <div className="flex items-center justify-between mt-2.5">
                        <span className="text-[9px] text-noir-dim font-mono">Qty: {qty}</span>
                        <div className="flex space-x-1">
                          {qty > 0 && (
                            <button
                              onClick={() => handleUpdateQty(top.id, -1)}
                              className="p-1 bg-noir-highlight text-noir-muted border border-noir-border rounded cursor-pointer"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={() => handleUpdateQty(top.id, 1)}
                            className="p-1 bg-noir-highlight text-noir-gold border border-noir-gold-o20 rounded cursor-pointer hover:bg-noir-sidebar"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right side check out card */}
          <div className="space-y-6">
            <form onSubmit={handleCheckout} className="bg-noir-card p-5 rounded-2xl border border-noir-border shadow-lg space-y-4">
              <div className="flex items-center space-x-2 border-b border-noir-border pb-3">
                <ShoppingBag className="w-5 h-5 text-noir-gold" />
                <h3 className="font-serif text-noir-text text-sm">Interactive Checkout Cart</h3>
              </div>

              {/* List Cart items */}
              <div className="space-y-2.5 text-xs max-h-[150px] overflow-y-auto pr-1">
                {/* Crust Base item */}
                {cartBaseId && (() => {
                  const item = menuItems.find(m => m.id === cartBaseId);
                  return item ? (
                    <div className="flex justify-between text-noir-text">
                      <span>1x {item.name} (Crust)</span>
                      <span className="font-mono text-noir-gold">₹{item.price_inr}</span>
                    </div>
                  ) : null;
                })()}

                {/* Other selections */}
                {Object.keys(cart).map(idStr => {
                  const item = menuItems.find(m => m.id === parseInt(idStr));
                  if (!item) return null;
                  return (
                    <div key={item.id} className="flex justify-between text-noir-text">
                      <span>{cart[idStr]}x {item.name}</span>
                      <span className="font-mono text-noir-gold">₹{item.price_inr * cart[idStr]}</span>
                    </div>
                  );
                })}

                {totalCartQty === 0 && (
                  <p className="text-center text-noir-dim text-xs py-4 italic">Your cart is empty. Click pizzas above to add.</p>
                )}
              </div>

              {/* Billing Breakdowns */}
              <div className="border-t border-noir-border pt-3.5 space-y-2 text-xs font-sans">
                <div className="flex justify-between text-noir-muted">
                  <span>Subtotal</span>
                  <span className="font-mono">₹{bill.subtotal}</span>
                </div>
                <div className="flex justify-between text-noir-muted">
                  <span>Goods and Services Tax (GST 5%)</span>
                  <span className="font-mono">₹{bill.gst}</span>
                </div>
                <div className="flex justify-between text-noir-text font-bold border-t border-noir-border pt-2 text-sm">
                  <span>Total Payable (INR)</span>
                  <span className="font-mono text-noir-gold">₹{bill.totalPayable}</span>
                </div>
              </div>

              {/* Customer details fields */}
              <div className="border-t border-noir-border pt-3.5 space-y-3 text-xs">
                <h4 className="font-semibold text-noir-dim text-[10px] uppercase tracking-wider">Customer Checkout Details</h4>
                
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Your Table (1-20) *</label>
                    <select
                      value={tableNumber}
                      onChange={(e) => setTableNumber(parseInt(e.target.value))}
                      className="w-full px-2.5 py-2 bg-noir-panel border border-noir-border rounded-xl font-mono text-noir-text focus:border-noir-gold outline-none"
                    >
                      {Array.from({ length: 20 }, (_, i) => i + 1).map(num => (
                        <option key={num} value={num}>Table #{num}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Payment Mode *</label>
                    <select
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value as any)}
                      className="w-full px-2.5 py-2 bg-noir-panel border border-noir-border rounded-xl text-noir-text focus:border-noir-gold outline-none"
                    >
                      <option value="UPI">UPI / QR Scan</option>
                      <option value="Card">Credit/Debit Card</option>
                      <option value="Cash">Cash at Counter</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Full Name (PII Verification) *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rahul Kumar"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full px-3 py-2 bg-noir-panel border border-noir-border rounded-xl text-noir-text focus:border-noir-gold outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">10-Digit Mobile (PII Verification) *</label>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. 9876543210"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-noir-panel border border-noir-border rounded-xl text-noir-text focus:border-noir-gold outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Delivery Address (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Suite 10, Sector 1"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    className="w-full px-3 py-2 bg-noir-panel border border-noir-border rounded-xl text-noir-text focus:border-noir-gold outline-none"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <button
                type="submit"
                className="w-full py-3 bg-noir-gold hover:bg-noir-gold-hover text-black font-semibold text-xs rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-1.5"
                disabled={totalCartQty === 0}
              >
                <Smartphone className="w-4 h-4" />
                Place Pizza Order (₹{bill.totalPayable})
              </button>
            </form>
          </div>
        </div>
      )}

      {/* RENDER VERIFY ORDER HISTORY TAB */}
      {activeTab === 'history' && (
        <div className="bg-noir-card p-6 rounded-2xl border border-noir-border shadow-lg max-w-2xl">
          <div className="border-b border-noir-border pb-3 mb-5">
            <h3 className="font-serif italic text-noir-gold text-base flex items-center gap-1.5">
              <History className="w-5 h-5" /> Secure Customer PII Verification Gate
            </h3>
            <p className="text-xs text-noir-muted mt-1">To protect customer privacy, you must authenticate by providing matching PII credentials before order histories can be rendered.</p>
          </div>

          <form onSubmit={handleVerifyHistory} className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end bg-noir-panel p-4 border border-noir-border rounded-xl">
            <div className="space-y-1 text-xs">
              <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Enter Your Exact Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Rahul Kumar"
                value={verifyName}
                onChange={(e) => setVerifyName(e.target.value)}
                className="w-full px-3 py-2 bg-noir-sidebar border border-noir-border rounded-xl text-xs text-noir-text focus:border-noir-gold outline-none"
              />
            </div>

            <div className="space-y-1 text-xs">
              <label className="block font-semibold text-noir-dim uppercase text-[9px] tracking-wider">Enter Your Registered Phone *</label>
              <input
                type="tel"
                required
                placeholder="e.g. 9876543210"
                value={verifyPhone}
                onChange={(e) => setVerifyPhone(e.target.value)}
                className="w-full px-3 py-2 bg-noir-sidebar border border-noir-border rounded-xl text-xs text-noir-text focus:border-noir-gold outline-none"
              />
            </div>

            <div className="sm:col-span-2 pt-2 text-right">
              <button
                type="submit"
                disabled={loadingHistory}
                className="px-5 py-2.5 bg-noir-gold hover:bg-noir-gold-hover text-black rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ml-auto shadow-md"
              >
                {loadingHistory ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                Verify & Show History
              </button>
            </div>
          </form>

          {verifyError && (
            <div className="mt-4 p-3 bg-noir-panel border border-red-500/20 rounded-xl text-xs font-semibold text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" />
              <span>{verifyError}</span>
            </div>
          )}

          {/* History Lists */}
          {verifiedHistory && (
            <div className="mt-6 space-y-4">
              <h4 className="font-serif italic text-noir-gold text-sm border-b border-noir-border pb-2">Verified Order History ({verifiedHistory.length} orders found)</h4>
              
              {verifiedHistory.length > 0 ? (
                <div className="space-y-4">
                  {verifiedHistory.map(o => (
                    <div key={o.id} className="border border-noir-border p-4 rounded-xl bg-noir-panel space-y-3.5 shadow-sm">
                      <div className="flex justify-between items-start border-b border-noir-border pb-2">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-xs font-semibold text-noir-dim">Order ID:</span>
                            <span className="font-mono font-bold text-noir-text text-xs">#{o.id}</span>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase border ${
                              o.status === 'confirmed' ? 'bg-blue-950/40 text-blue-300 border-blue-900/40' :
                              o.status === 'preparing' ? 'bg-amber-950/40 text-amber-300 border-amber-900/40' :
                              o.status === 'ready' ? 'bg-emerald-950/40 text-emerald-300 border-emerald-900/40' :
                              o.status === 'cancelled' ? 'bg-red-950/40 text-red-300 border-red-900/40' :
                              'bg-noir-highlight text-noir-muted border-noir-border'
                            }`}>
                              {o.status}
                            </span>
                          </div>
                          <p className="text-[10px] text-noir-dim mt-1 font-mono">Date: {new Date(o.created_at).toLocaleString()}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-noir-gold">₹{o.total_payable}</p>
                          <p className="text-[9px] text-noir-dim font-mono mt-0.5">Table {o.table_number}</p>
                        </div>
                      </div>

                      {/* Items list */}
                      <div className="space-y-1">
                        {o.items.map(item => (
                          <div key={item.id} className="flex justify-between text-xs text-noir-text">
                            <span>x{item.quantity} {item.name} <span className="text-[10px] text-noir-dim">({item.category})</span></span>
                            <span className="font-mono text-noir-gold">₹{Number(item.unit_price_snapshot) * item.quantity}</span>
                          </div>
                        ))}
                      </div>

                      {/* Status history tracking */}
                      <div className="pt-2 border-t border-noir-border text-[10px] text-noir-dim font-mono flex flex-wrap gap-x-4 gap-y-1">
                        <p>Confirmed: {new Date(o.created_at).toLocaleTimeString()}</p>
                        {o.cooking_started_at && <p>Cooking Started: {new Date(o.cooking_started_at).toLocaleTimeString()}</p>}
                        {o.ready_at && <p>Ready: {new Date(o.ready_at).toLocaleTimeString()}</p>}
                        {o.delivered_at && <p className="text-emerald-400 font-bold">Served: {new Date(o.delivered_at).toLocaleTimeString()}</p>}
                        {o.cancelled_at && <p className="text-red-400 font-bold">Cancelled: {new Date(o.cancelled_at).toLocaleTimeString()}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center py-6 text-xs text-noir-dim italic">No past transactions registered for your profile.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
