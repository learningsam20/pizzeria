import type { AppSettings, DineInTable, MenuItem } from '../types';
import { formatMoney, calcBillTotals } from './appSettings';
import { validateCustomerName, validatePhone, validateEmail } from './inputValidation';
import { dbService } from './dbService';

export interface VoiceCombo {
  id: string;
  baseId: number | null;
  pizzas: Record<string, number>;
  toppings: Record<string, number>;
}

export interface VoiceOrderCustomer {
  existingId: number | null;
  name: string;
  phone: string;
  email: string;
  address: string;
  verified: boolean;
}

export interface VoiceOrderState {
  combos: VoiceCombo[];
  customer: VoiceOrderCustomer;
  tableName: string;
}

export type VoiceActionType =
  | 'show_menu'
  | 'verify_customer'
  | 'add_combo'
  | 'remove_combo'
  | 'show_cart'
  | 'set_table'
  | 'place_order'
  | 'none';

export interface VoiceAction {
  type: VoiceActionType;
  params: Record<string, unknown>;
}

export interface VoiceOrderContext {
  menuItems: MenuItem[];
  appSettings: AppSettings;
  availableTables: DineInTable[];
  sessionStartedAt: string;
}

export interface VoiceActionResult {
  reply: string;
  state: VoiceOrderState;
  orderId?: number;
  needsTypedInput?: boolean;
}

export const TYPE_IN_HINT =
  'Please **type** the exact details in the box below — typed input is clearer for names, phone numbers, and menu items.';

export const POLITE_DECLINE_PREFIX = "I'm sorry, I can't help with that here.";

export function createInitialVoiceOrderState(defaultTable: string): VoiceOrderState {
  return {
    combos: [],
    customer: {
      existingId: null,
      name: '',
      phone: '',
      email: '',
      address: '',
      verified: false,
    },
    tableName: defaultTable,
  };
}

function activeMenu(items: MenuItem[]): MenuItem[] {
  return items.filter(m => m.is_active);
}

export function findMenuItem(
  items: MenuItem[],
  name: string,
  category?: MenuItem['category']
): MenuItem | null {
  const normalized = name.toLowerCase().trim();
  if (!normalized) return null;
  const pool = category
    ? activeMenu(items).filter(m => m.category === category)
    : activeMenu(items);

  const exact = pool.find(m => m.name.toLowerCase() === normalized);
  if (exact) return exact;

  const contains = pool.find(
    m => m.name.toLowerCase().includes(normalized) || normalized.includes(m.name.toLowerCase())
  );
  if (contains) return contains;

  const words = normalized.split(/\s+/).filter(Boolean);
  let best: MenuItem | null = null;
  let bestScore = 0;
  for (const item of pool) {
    const itemWords = item.name.toLowerCase().split(/\s+/);
    const score = words.filter(w => itemWords.some(iw => iw.includes(w) || w.includes(iw))).length;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore > 0 ? best : null;
}

export type MenuResolveResult =
  | { status: 'found'; item: MenuItem; confidence: 'exact' | 'partial' }
  | { status: 'ambiguous'; options: MenuItem[] }
  | { status: 'not_found'; suggestions: MenuItem[] };

/** Stricter matching for cart changes — avoids wrong items from fuzzy voice transcripts. */
export function resolveMenuItem(
  items: MenuItem[],
  name: string,
  category?: MenuItem['category']
): MenuResolveResult {
  const normalized = name.toLowerCase().trim();
  if (!normalized) return { status: 'not_found', suggestions: [] };

  const pool = category
    ? activeMenu(items).filter(m => m.category === category)
    : activeMenu(items);

  const exact = pool.filter(m => m.name.toLowerCase() === normalized);
  if (exact.length === 1) return { status: 'found', item: exact[0], confidence: 'exact' };
  if (exact.length > 1) return { status: 'ambiguous', options: exact };

  const partial = pool.filter(
    m => m.name.toLowerCase().includes(normalized) || normalized.includes(m.name.toLowerCase())
  );
  if (partial.length === 1) return { status: 'found', item: partial[0], confidence: 'partial' };
  if (partial.length > 1) return { status: 'ambiguous', options: partial };

  const words = normalized.split(/\s+/).filter(w => w.length > 2);
  const scored = pool
    .map(item => {
      const itemWords = item.name.toLowerCase().split(/\s+/);
      const score = words.filter(w => itemWords.some(iw => iw.includes(w) || w.includes(iw))).length;
      return { item, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length >= 2 && scored[0].score === scored[1].score) {
    return { status: 'ambiguous', options: scored.filter(x => x.score === scored[0].score).map(x => x.item) };
  }
  if (scored.length === 1) return { status: 'found', item: scored[0].item, confidence: 'partial' };

  const suggestions = pool
    .filter(m => words.some(w => m.name.toLowerCase().includes(w)))
    .slice(0, 5);
  return { status: 'not_found', suggestions };
}

function formatMenuOptions(items: MenuItem[]): string {
  if (!items.length) return '';
  return items.map(m => `**${m.name}** (₹${m.price_inr.toFixed(2)})`).join(', ');
}

function clarifyMenuMessage(label: string, result: MenuResolveResult): string {
  if (result.status === 'ambiguous') {
    return `I'm not sure which ${label} you mean. Did you want ${formatMenuOptions(result.options)}? ${TYPE_IN_HINT}`;
  }
  if (result.status === 'not_found') {
    const hint = result.suggestions.length
      ? ` Closest options: ${formatMenuOptions(result.suggestions)}.`
      : ' Say **show menu** to see everything we offer.';
    return `I couldn't find **${label}** on our menu.${hint} ${TYPE_IN_HINT}`;
  }
  return '';
}

function comboSubtotal(combo: VoiceCombo, items: MenuItem[]): number {
  let total = 0;
  if (combo.baseId) {
    const base = items.find(m => m.id === combo.baseId);
    if (base) total += base.price_inr;
  }
  Object.entries(combo.pizzas).forEach(([id, qty]) => {
    const p = items.find(m => m.id === Number(id));
    if (p) total += p.price_inr * qty;
  });
  Object.entries(combo.toppings).forEach(([id, qty]) => {
    const t = items.find(m => m.id === Number(id));
    if (t) total += t.price_inr * qty;
  });
  return total;
}

function comboPizzaCount(combo: VoiceCombo): number {
  return Object.values(combo.pizzas).reduce((s, q) => s + q, 0);
}

export function orderTotalsFromCombos(combos: VoiceCombo[], items: MenuItem[], settings: AppSettings) {
  const subtotal = combos.reduce((s, c) => s + comboSubtotal(c, items), 0);
  const pizzaQty = combos.reduce((s, c) => s + comboPizzaCount(c), 0);
  const { discount, gst, total_payable } = calcBillTotals(subtotal, pizzaQty, settings);
  return { subtotal, pizzaQty, discount, gst, total_payable };
}

function describeCombo(combo: VoiceCombo, items: MenuItem[], index: number, currency: string): string {
  const parts: string[] = [];
  if (combo.baseId) {
    const base = items.find(m => m.id === combo.baseId);
    if (base) parts.push(base.name);
  }
  Object.entries(combo.pizzas).forEach(([id, qty]) => {
    const p = items.find(m => m.id === Number(id));
    if (p) parts.push(`${p.name} ×${qty}`);
  });
  Object.entries(combo.toppings).forEach(([id, qty]) => {
    const t = items.find(m => m.id === Number(id));
    if (t) parts.push(`${t.name} ×${qty}`);
  });
  const label = parts.length ? parts.join(', ') : 'Empty combo';
  const sub = comboSubtotal(combo, items);
  return `${index + 1}. ${label} — ${formatMoney(sub, currency)}`;
}

export function formatMenuForVoice(items: MenuItem[], category?: string): string {
  const pool = activeMenu(items);
  const categories: MenuItem['category'][] = category
    ? [category as MenuItem['category']]
    : ['base', 'pizza', 'topping'];

  const lines: string[] = ['**Available menu**', ''];
  for (const cat of categories) {
    const section = pool.filter(m => m.category === cat);
    if (!section.length) continue;
    const title = cat === 'base' ? 'Bases' : cat === 'pizza' ? 'Pizzas' : 'Toppings';
    lines.push(`**${title}**`);
    section.forEach(m => {
      lines.push(`- ${m.name} — ₹${m.price_inr.toFixed(2)}`);
    });
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function formatCartSummary(state: VoiceOrderState, items: MenuItem[], settings: AppSettings): string {
  if (!state.combos.length) {
    return 'Your cart is empty. Type or say what you would like — e.g. **Thin Crust + Margherita** — or ask to **show menu**.';
  }
  const { subtotal, discount, gst, total_payable, pizzaQty } = orderTotalsFromCombos(state.combos, items, settings);
  const lines = state.combos.map((c, i) => describeCombo(c, items, i, settings.default_currency));
  lines.push('');
  lines.push(`Subtotal: ${formatMoney(subtotal, settings.default_currency)}`);
  if (discount > 0) lines.push(`Bulk discount: −${formatMoney(discount, settings.default_currency)}`);
  lines.push(`GST: ${formatMoney(gst, settings.default_currency)}`);
  lines.push(`**Total: ${formatMoney(total_payable, settings.default_currency)}** (${pizzaQty} pizza${pizzaQty === 1 ? '' : 's'})`);
  lines.push(`Table: ${state.tableName}`);
  if (state.customer.verified && state.customer.name) {
    lines.push(`Customer: ${state.customer.name} (${state.customer.phone})`);
  } else {
    lines.push('_Customer details not verified yet — share name and mobile before placing the order._');
  }
  return lines.join('\n');
}

function parseItemList(raw: unknown): { name: string; quantity: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(entry => {
      if (typeof entry === 'string') return { name: entry, quantity: 1 };
      if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        const name = String(obj.name || obj.item || '').trim();
        const qty = Number(obj.quantity ?? obj.qty ?? 1);
        return { name, quantity: Number.isFinite(qty) && qty > 0 ? Math.min(10, Math.floor(qty)) : 1 };
      }
      return null;
    })
    .filter((x): x is { name: string; quantity: number } => Boolean(x?.name));
}

async function verifyCustomerFields(state: VoiceOrderState): Promise<{ state: VoiceOrderState; error?: string }> {
  const customer = { ...state.customer };

  if (!customer.name.trim() && !customer.phone.trim()) {
    return {
      state,
      error: `I need your **full name** and **10-digit mobile number** before we can continue. ${TYPE_IN_HINT}`,
    };
  }

  const nameCheck = validateCustomerName(customer.name);
  if (!nameCheck.ok) {
    return { state, error: `${nameCheck.error} ${TYPE_IN_HINT}` };
  }
  const phoneCheck = validatePhone(customer.phone);
  if (!phoneCheck.ok) {
    return { state, error: `${phoneCheck.error} ${TYPE_IN_HINT}` };
  }
  if (customer.email) {
    const emailCheck = validateEmail(customer.email);
    if (!emailCheck.ok) {
      return { state, error: `${emailCheck.error} ${TYPE_IN_HINT}` };
    }
  }

  try {
    const existing = await dbService.findCustomerByPhoneOrEmail(customer.phone || customer.email);
    if (existing) {
      customer.existingId = existing.id;
      if (!customer.name) customer.name = existing.name;
      if (!customer.phone) customer.phone = existing.phone;
      if (!customer.email && existing.email) customer.email = existing.email;
      if (!customer.address && existing.delivery_address) customer.address = existing.delivery_address;
    }
    customer.verified = true;
    return { state: { ...state, customer } };
  } catch (err: unknown) {
    return { state, error: err instanceof Error ? err.message : 'Customer lookup failed.' };
  }
}

function combosToOrderItems(
  combos: VoiceCombo[],
  menuItems: MenuItem[],
  currency: string
): { menu_item_id: number; category: MenuItem['category']; name: string; unit_price_snapshot: number; currency: string; quantity: number }[] {
  const items: { menu_item_id: number; category: MenuItem['category']; name: string; unit_price_snapshot: number; currency: string; quantity: number }[] = [];
  combos.forEach(combo => {
    if (combo.baseId) {
      const b = menuItems.find(m => m.id === combo.baseId);
      if (b) items.push({ menu_item_id: b.id, category: b.category, name: b.name, unit_price_snapshot: b.price_inr, currency, quantity: 1 });
    }
    Object.entries(combo.pizzas).forEach(([id, qty]) => {
      const p = menuItems.find(m => m.id === Number(id));
      if (p) items.push({ menu_item_id: p.id, category: p.category, name: p.name, unit_price_snapshot: p.price_inr, currency, quantity: qty });
    });
    Object.entries(combo.toppings).forEach(([id, qty]) => {
      const t = menuItems.find(m => m.id === Number(id));
      if (t) items.push({ menu_item_id: t.id, category: t.category, name: t.name, unit_price_snapshot: t.price_inr, currency, quantity: qty });
    });
  });
  return items;
}

export async function applyVoiceAction(
  state: VoiceOrderState,
  action: VoiceAction,
  ctx: VoiceOrderContext
): Promise<VoiceActionResult> {
  const { menuItems, appSettings, availableTables, sessionStartedAt } = ctx;
  let next = { ...state, customer: { ...state.customer }, combos: [...state.combos] };

  switch (action.type) {
    case 'show_menu': {
      const category = action.params.category ? String(action.params.category).toLowerCase() : undefined;
      const cat = category === 'base' || category === 'pizza' || category === 'topping' ? category : undefined;
      return { reply: formatMenuForVoice(menuItems, cat), state: next };
    }

    case 'show_cart':
      return { reply: formatCartSummary(next, menuItems, appSettings), state: next };

    case 'verify_customer': {
      if (action.params.name) next.customer.name = String(action.params.name).trim();
      if (action.params.phone) next.customer.phone = String(action.params.phone).replace(/\D/g, '').slice(0, 10);
      if (action.params.email) next.customer.email = String(action.params.email).trim().toLowerCase();
      if (action.params.address) next.customer.address = String(action.params.address).trim();

      if (Boolean(action.params.unclear) || (!next.customer.name.trim() && !next.customer.phone.trim())) {
        return {
          reply: String(action.params.message || `I need your **full name** and **10-digit mobile number**. ${TYPE_IN_HINT}`),
          state: next,
          needsTypedInput: true,
        };
      }

      const verified = await verifyCustomerFields(next);
      if (verified.error) {
        return { reply: verified.error, state: next, needsTypedInput: true };
      }
      next = verified.state;
      return {
        reply: `Thanks ${next.customer.name}! You're verified (${next.customer.phone}). You can add items and say "place order" when ready.`,
        state: next,
      };
    }

    case 'set_table': {
      const tableName = String(action.params.tableName || action.params.table || '').trim();
      if (!tableName) {
        const options = availableTables.map(t => t.table_name).join(', ');
        return {
          reply: options
            ? `Which table are you at? Available: ${options}. ${TYPE_IN_HINT}`
            : `Sorry, no tables are free right now. Please ask staff for assistance.`,
          state: next,
          needsTypedInput: Boolean(options),
        };
      }
      const exact = availableTables.find(t => t.table_name.toLowerCase() === tableName.toLowerCase());
      const partial = availableTables.filter(t => t.table_name.toLowerCase().includes(tableName.toLowerCase()));
      if (exact) {
        next.tableName = exact.table_name;
        return { reply: `Table set to **${exact.table_name}**.`, state: next };
      }
      if (partial.length === 1) {
        next.tableName = partial[0].table_name;
        return { reply: `Table set to **${partial[0].table_name}**.`, state: next };
      }
      if (partial.length > 1) {
        return {
          reply: `Several tables match that. Please type the exact table name: ${partial.map(t => t.table_name).join(', ')}. ${TYPE_IN_HINT}`,
          state: next,
          needsTypedInput: true,
        };
      }
      return {
        reply: `${POLITE_DECLINE_PREFIX} **${tableName}** isn't available or doesn't exist. Free tables: ${availableTables.map(t => t.table_name).join(', ') || 'none'}. ${TYPE_IN_HINT}`,
        state: next,
        needsTypedInput: true,
      };
    }

    case 'add_combo': {
      const pizzas = parseItemList(action.params.pizzas ?? action.params.pizza);
      const toppings = parseItemList(action.params.toppings ?? action.params.topping);
      const baseName = String(action.params.baseName || action.params.base || '').trim();
      const mustType = Boolean(action.params.unclear || action.params.needsTypedInput);

      if (mustType) {
        return {
          reply: String(action.params.message || action.params.reply || `I need a bit more detail before I can add that. ${TYPE_IN_HINT}`),
          state: next,
          needsTypedInput: true,
        };
      }

      if (!baseName && !pizzas.length && !toppings.length) {
        return {
          reply: `I didn't catch what to add. Try typing something like **Thin Crust + Margherita**, or say **show menu** first. ${TYPE_IN_HINT}`,
          state: next,
          needsTypedInput: true,
        };
      }

      const combo: VoiceCombo = {
        id: crypto.randomUUID(),
        baseId: null,
        pizzas: {},
        toppings: {},
      };

      if (baseName) {
        const baseResult = resolveMenuItem(menuItems, baseName, 'base');
        if (baseResult.status !== 'found') {
          return {
            reply: clarifyMenuMessage(`base "${baseName}"`, baseResult),
            state: next,
            needsTypedInput: true,
          };
        }
        combo.baseId = baseResult.item.id;
      }

      for (const p of pizzas) {
        const result = resolveMenuItem(menuItems, p.name, 'pizza');
        if (result.status !== 'found') {
          return {
            reply: clarifyMenuMessage(`pizza "${p.name}"`, result),
            state: next,
            needsTypedInput: true,
          };
        }
        if (p.quantity < 1 || p.quantity > 10) {
          return {
            reply: `${POLITE_DECLINE_PREFIX} Quantity must be between 1 and 10 per pizza. ${TYPE_IN_HINT}`,
            state: next,
            needsTypedInput: true,
          };
        }
        combo.pizzas[String(result.item.id)] = (combo.pizzas[String(result.item.id)] || 0) + p.quantity;
      }

      for (const t of toppings) {
        const result = resolveMenuItem(menuItems, t.name, 'topping');
        if (result.status !== 'found') {
          return {
            reply: clarifyMenuMessage(`topping "${t.name}"`, result),
            state: next,
            needsTypedInput: true,
          };
        }
        combo.toppings[String(result.item.id)] = (combo.toppings[String(result.item.id)] || 0) + t.quantity;
      }

      if (!combo.baseId && !Object.keys(combo.pizzas).length) {
        return {
          reply: `Please choose at least a **base** or a **pizza** from our menu. Say **show menu** or type your choice. ${TYPE_IN_HINT}`,
          state: next,
          needsTypedInput: true,
        };
      }

      next.combos = [...next.combos, combo];
      const added = describeCombo(combo, menuItems, next.combos.length - 1, appSettings.default_currency);
      return {
        reply: `Added to cart:\n${added}\n\n${formatCartSummary(next, menuItems, appSettings)}`,
        state: next,
      };
    }

    case 'remove_combo': {
      if (!next.combos.length) {
        return { reply: 'Your cart is already empty.', state: next };
      }
      let index = Number(action.params.index ?? action.params.itemNumber ?? action.params.comboIndex);
      if (!Number.isFinite(index) || index < 1) {
        const nameQuery = String(action.params.name || action.params.item || '').toLowerCase().trim();
        if (nameQuery) {
          index = next.combos.findIndex(c => {
            const labels = [
              c.baseId ? menuItems.find(m => m.id === c.baseId)?.name : '',
              ...Object.keys(c.pizzas).map(id => menuItems.find(m => m.id === Number(id))?.name),
            ].filter(Boolean).join(' ').toLowerCase();
            return labels.includes(nameQuery) || nameQuery.split(/\s+/).some(w => labels.includes(w));
          }) + 1;
        }
      }
      if (!Number.isFinite(index) || index < 1 || index > next.combos.length) {
        return {
          reply: `Which cart item should I remove? You have ${next.combos.length} item${next.combos.length === 1 ? '' : 's'} — type **remove item 1** (or 2, 3…). ${TYPE_IN_HINT}\n\n${formatCartSummary(next, menuItems, appSettings)}`,
          state: next,
          needsTypedInput: true,
        };
      }
      const removed = next.combos[index - 1];
      next.combos = next.combos.filter((_, i) => i !== index - 1);
      return {
        reply: `Removed:\n${describeCombo(removed, menuItems, index - 1, appSettings.default_currency)}\n\n${formatCartSummary(next, menuItems, appSettings)}`,
        state: next,
      };
    }

    case 'place_order': {
      if (!next.combos.length) {
        return {
          reply: `Your cart is empty — add items from the menu first, or type what you'd like. ${TYPE_IN_HINT}`,
          state: next,
          needsTypedInput: true,
        };
      }
      if (!next.customer.verified) {
        if (!next.customer.name.trim() || !next.customer.phone.trim()) {
          return {
            reply: `Before placing the order, I need your **full name** and **10-digit mobile**. ${TYPE_IN_HINT}`,
            state: next,
            needsTypedInput: true,
          };
        }
        const verified = await verifyCustomerFields(next);
        if (verified.error || !verified.state.customer.verified) {
          return {
            reply: verified.error || `Please verify your details first. ${TYPE_IN_HINT}`,
            state: next,
            needsTypedInput: true,
          };
        }
        next = verified.state;
      }
      if (!availableTables.some(t => t.table_name === next.tableName)) {
        return {
          reply: `${POLITE_DECLINE_PREFIX} **${next.tableName}** is not available for a new order. Type your table name (e.g. **Table 3**). ${TYPE_IN_HINT}`,
          state: next,
          needsTypedInput: true,
        };
      }

      const { subtotal, pizzaQty, discount, gst, total_payable } = orderTotalsFromCombos(next.combos, menuItems, appSettings);
      try {
        const saved = await dbService.upsertCustomerForOrder(
          {
            name: next.customer.name,
            phone: next.customer.phone,
            email: next.customer.email || '',
            delivery_address: next.customer.address || null,
          },
          next.customer.existingId
        );
        const items = combosToOrderItems(next.combos, menuItems, appSettings.default_currency);
        const placed = await dbService.createOrder(
          {
            customer_id: saved.id,
            customer_name: next.customer.name,
            customer_phone: next.customer.phone,
            table_name: next.tableName,
            total_quantity: pizzaQty,
            subtotal,
            discount,
            gst,
            total_payable,
            currency: appSettings.default_currency,
            payment_mode: 'Cash',
            order_source: 'customer',
            status: 'confirmed',
            staff_id: null,
            session_started_at: sessionStartedAt,
          },
          items
        );
        next = createInitialVoiceOrderState(next.tableName);
        return {
          reply: `🎉 Order **#${placed.id}** placed for **${placed.table_name}**! Total ${formatMoney(total_payable, appSettings.default_currency)}. Track it in Order History.`,
          state: next,
          orderId: placed.id,
        };
      } catch (err: unknown) {
        return {
          reply: `${POLITE_DECLINE_PREFIX} ${err instanceof Error ? err.message : 'Could not place the order.'} Please try again or use **Dine-In Customer** ordering. ${TYPE_IN_HINT}`,
          state: next,
          needsTypedInput: true,
        };
      }
    }

    case 'none':
    default:
      return { reply: '', state: next };
  }
}

export function detectImpossibleRequest(message: string): string | null {
  const text = message.trim();
  if (/\bdeliver(y|)\b/i.test(text) && !/dine/i.test(text)) {
    return `${POLITE_DECLINE_PREFIX} We only take **dine-in** orders at the restaurant — delivery isn't available through this assistant. You can still order for your table here.`;
  }
  if (/\bcancel (my )?order\b/i.test(text) || /\brefund\b/i.test(text)) {
    return `${POLITE_DECLINE_PREFIX} Order cancellations and refunds need to be handled by **staff at your table**. I can't process that in voice ordering.`;
  }
  if (/\bfree pizza\b/i.test(text) || (/\bdiscount\b/i.test(text) && !/\bbulk\b/i.test(text))) {
    return `${POLITE_DECLINE_PREFIX} I can't apply custom discounts here. Bulk discounts apply automatically when you order ${5}+ pizzas (see the menu).`;
  }
  if (/\bpay(ment)?\b/i.test(text) && /\b(card|upi|online)\b/i.test(text)) {
    return `${POLITE_DECLINE_PREFIX} Payment is collected at the table when your order is served — I can't change payment method during ordering.`;
  }
  return null;
}

export function unclearLocalMessage(message: string): string {
  if (detectImpossibleRequest(message)) return detectImpossibleRequest(message)!;
  return `I'm not sure I understood "${message.slice(0, 60)}${message.length > 60 ? '…' : ''}". Try **show menu**, or type your request clearly below. ${TYPE_IN_HINT}`;
}

/** Simple local intent parser when AI is unavailable. */
export function parseLocalVoiceIntent(message: string): VoiceAction {
  const text = message.toLowerCase().trim();
  if (/show (the )?menu|what('s| is) (on )?(the )?menu|list (the )?menu/.test(text)) {
    const cat = text.includes('base') ? 'base' : text.includes('topping') ? 'topping' : text.includes('pizza') ? 'pizza' : undefined;
    return { type: 'show_menu', params: cat ? { category: cat } : {} };
  }
  if (/show (my )?cart|what('s| is) in (my )?cart|view cart/.test(text)) {
    return { type: 'show_cart', params: {} };
  }
  if (/place (the )?order|confirm (the )?order|checkout/.test(text)) {
    return { type: 'place_order', params: {} };
  }
  if (/remove|delete/.test(text)) {
    const numMatch = text.match(/(?:item|number|#)\s*(\d+)/) || text.match(/\b(\d+)\b/);
    return { type: 'remove_combo', params: numMatch ? { index: Number(numMatch[1]) } : {} };
  }
  const tableMatch = text.match(/table\s*(\d+)/i);
  if (tableMatch) {
    return { type: 'set_table', params: { tableName: `Table ${tableMatch[1]}` } };
  }
  if (/my name is|i am|call me|phone|mobile|email/.test(text)) {
    const nameMatch = text.match(/(?:name is|i am|call me)\s+([a-z][a-z\s]{1,30})/i);
    const phoneMatch = text.match(/\b([6-9]\d{9})\b/);
    const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.\w+/);
    return {
      type: 'verify_customer',
      params: {
        ...(nameMatch ? { name: nameMatch[1].trim() } : {}),
        ...(phoneMatch ? { phone: phoneMatch[1] } : {}),
        ...(emailMatch ? { email: emailMatch[0] } : {}),
      },
    };
  }
  return { type: 'none', params: {} };
}

export function mergeVoiceReplies(engineReply: string, aiReply: string, actionType: VoiceActionType, userMessage = ''): string {
  if (engineReply) return engineReply;
  if (aiReply) return aiReply;
  if (actionType === 'none') return unclearLocalMessage(userMessage || 'your request');
  return `How can I help with your order? Say **show menu** or type below. ${TYPE_IN_HINT}`;
}
