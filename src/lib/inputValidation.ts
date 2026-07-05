/**
 * Input validation helpers — always return { ok, error? }, never throw.
 */

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateNonEmpty(input: unknown, fieldLabel: string): ValidationResult {
  if (input == null || String(input).trim() === '') {
    return { ok: false, error: `${fieldLabel} is required and cannot be empty.` };
  }
  return { ok: true };
}

/** 1. Name with only spaces; 6. empty name */
export function validateCustomerName(input: unknown): ValidationResult {
  if (input == null || String(input) === '') {
    return { ok: false, error: 'Please enter your full name (letters and spaces only).' };
  }
  if (typeof input === 'string' && input.length > 0 && input.trim().length === 0) {
    return { ok: false, error: 'Name cannot be only spaces. Enter 2–40 letters and spaces.' };
  }
  const trimmed = String(input).trim();
  const nameRegex = /^[A-Za-z \u00C0-\u017F]{2,40}$/;
  if (!nameRegex.test(trimmed)) {
    return {
      ok: false,
      error: 'Name must be 2–40 characters, letters and spaces only — no numbers or symbols.',
    };
  }
  return { ok: true };
}

/** Email — optional by default; set required: true for mandatory intake */
export function validateEmail(input: unknown, options?: { required?: boolean }): ValidationResult {
  const trimmed = input == null ? '' : String(input).trim();
  if (!trimmed) {
    if (options?.required) {
      return { ok: false, error: 'Email is required.' };
    }
    return { ok: true };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: 'Please enter a valid email address (e.g. name@example.com).' };
  }
  return { ok: true };
}

/** 2. Phone starting with 1; 6. empty phone */
export function validatePhone(input: unknown): ValidationResult {
  const empty = validateNonEmpty(input, 'Mobile number');
  if (!empty.ok) return empty;

  const trimmed = String(input).trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: 'Phone must contain digits only — no letters or special characters.' };
  }
  if (trimmed.length !== 10) {
    return { ok: false, error: 'Phone must be exactly 10 digits.' };
  }
  if (trimmed.startsWith('1')) {
    return {
      ok: false,
      error: 'Indian mobile numbers must start with 6, 7, 8, or 9 — numbers starting with 1 are not valid.',
    };
  }
  if (!/^[6-9]\d{9}$/.test(trimmed)) {
    return { ok: false, error: 'Indian mobile numbers must start with 6, 7, 8, or 9.' };
  }
  return { ok: true };
}

/** 3. Qty 0 / 11; 6. empty qty; 7. non-integer qty */
export function validateQuantityInput(
  input: unknown,
  opts?: { min?: number; max?: number; label?: string }
): ValidationResult {
  const min = opts?.min ?? 1;
  const max = opts?.max ?? 10;
  const label = opts?.label ?? 'Quantity';

  const empty = validateNonEmpty(input, label);
  if (!empty.ok) return empty;

  const raw = String(input).trim();

  if (/[a-zA-Z]/.test(raw)) {
    return { ok: false, error: `${label} must be a whole number (e.g. 1, 2, 3) — text like "${raw}" is not allowed.` };
  }

  if (raw.includes('.') || raw.includes(',')) {
    return { ok: false, error: `${label} must be a whole number — decimals such as "${raw}" are not allowed.` };
  }

  if (!/^-?\d+$/.test(raw)) {
    return { ok: false, error: `${label} must be a whole number.` };
  }

  const num = Number(raw);
  if (!Number.isInteger(num)) {
    return { ok: false, error: `${label} must be a whole number.` };
  }

  if (num === 0) {
    return { ok: false, error: `${label} must be at least ${min}. Zero is not allowed.` };
  }
  if (num < 0) {
    return { ok: false, error: `${label} cannot be negative.` };
  }
  if (num > max) {
    return {
      ok: false,
      error: `Maximum ${max} pizzas per order. You entered ${num} — please enter ${min}–${max}.`,
    };
  }
  if (num < min) {
    return { ok: false, error: `${label} must be at least ${min}.` };
  }

  return { ok: true };
}

export function parseQuantityInput(input: unknown, opts?: { min?: number; max?: number; label?: string }): { ok: true; value: number } | { ok: false; error: string } {
  const result = validateQuantityInput(input, opts);
  if (!result.ok) return result;
  return { ok: true, value: Number(String(input).trim()) };
}

/** 4–5. Item index; 6. empty; 7. non-integer item number */
export function validateMenuItemSelection(
  input: unknown,
  menuItems: { name: string; price_inr: number }[]
): ValidationResult {
  const menuLength = menuItems.length;
  if (menuLength === 0) {
    return { ok: false, error: 'Menu is empty — cannot select an item.' };
  }

  const empty = validateNonEmpty(input, 'Item number');
  if (!empty.ok) return empty;

  const raw = String(input).trim();

  if (/[a-zA-Z]/.test(raw)) {
    return { ok: false, error: `Item number must be a whole number from 1–${menuLength}, not text like "${raw}".` };
  }

  const looksLikeDecimal = raw.includes('.') || raw.includes(',');
  const asNumber = Number(raw.replace(',', '.'));

  if (looksLikeDecimal || (Number.isFinite(asNumber) && !Number.isInteger(asNumber))) {
    const priceMatch = menuItems.find(m => Math.abs(m.price_inr - asNumber) < 0.01);
    if (priceMatch) {
      return {
        ok: false,
        error: `₹${priceMatch.price_inr} is the price of "${priceMatch.name}", not an item number. Enter 1–${menuLength} from the menu list.`,
      };
    }
    return { ok: false, error: 'Item number must be a whole number — decimals are not allowed.' };
  }

  if (!/^-?\d+$/.test(raw)) {
    return { ok: false, error: 'Item number must be a whole number.' };
  }

  const num = Number(raw);

  if (num === 0) {
    return { ok: false, error: `Item number cannot be 0. Choose an item from 1 to ${menuLength}.` };
  }
  if (num < 0) {
    return { ok: false, error: 'Item number cannot be negative.' };
  }

  if (num > menuLength) {
    const priceMatch = menuItems.find(m => Math.round(m.price_inr) === num || m.price_inr === num);
    if (priceMatch) {
      return {
        ok: false,
        error: `₹${priceMatch.price_inr} is the price of "${priceMatch.name}", not an item number. Enter 1–${menuLength} from the menu list.`,
      };
    }
    return {
      ok: false,
      error: `Item number ${num} is out of range. The menu has ${menuLength} items (enter 1–${menuLength}).`,
    };
  }

  return { ok: true };
}

export function parseMenuItemSelection(
  input: unknown,
  menuItems: { name: string; price_inr: number }[]
): { ok: true; index: number } | { ok: false; error: string } {
  const result = validateMenuItemSelection(input, menuItems);
  if (!result.ok) return result;
  const num = Number(String(input).trim());
  return { ok: true, index: num - 1 };
}

/** 8. Menu file row missing price field */
export function parseMenuFileRow(
  row: Record<string, unknown>,
  rowNum: number
): { ok: true; code: string; name: string; price_inr: number; description: string | null } | { ok: false; error: string } {
  try {
    const code = String(row.code ?? row.id ?? row.item_code ?? row.sku ?? '').trim();
    const name = String(row.name ?? row.dish ?? row.title ?? row.item_name ?? '').trim();
    const priceRaw = row.price ?? row.price_inr ?? row.cost;
    const hasPriceField = priceRaw !== undefined && priceRaw !== null && String(priceRaw).trim() !== '';

    if (!name) {
      return { ok: false, error: `Row ${rowNum}: item name is missing or empty.` };
    }
    if (!hasPriceField) {
      return { ok: false, error: `Row ${rowNum} ("${name}"): price field is missing — each menu item must include price or price_inr.` };
    }

    const price_inr = Number(String(priceRaw).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(price_inr) || price_inr <= 0) {
      return { ok: false, error: `Row ${rowNum} ("${name}"): price must be a positive number.` };
    }

    return {
      ok: true,
      code: code || `ITEM${rowNum}`,
      name,
      price_inr,
      description: row.description ? String(row.description).trim() : null,
    };
  } catch {
    return { ok: false, error: `Row ${rowNum}: could not parse menu row.` };
  }
}

/** Safe menu list — skip invalid rows instead of throwing */
export function sanitizeMenuItems<T extends { price_inr?: unknown; name?: unknown; code?: unknown }>(
  items: T[]
): { valid: (T & { price_inr: number })[]; skipped: string[] } {
  const valid: (T & { price_inr: number })[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const row = items[i];
    try {
      const price = row.price_inr;
      if (price == null || price === '' || !Number.isFinite(Number(price)) || Number(price) <= 0) {
        skipped.push(`Item "${row.name ?? row.code ?? i + 1}": missing or invalid price — skipped.`);
        continue;
      }
      valid.push({ ...row, price_inr: Number(price) });
    } catch {
      skipped.push(`Row ${i + 1}: skipped due to parse error.`);
    }
  }

  return { valid, skipped };
}
