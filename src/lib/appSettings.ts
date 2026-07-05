import type { AppSettings } from '../types';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  bulk_discount_percent: 10,
  bulk_discount_min_qty: 5,
  default_currency: 'INR',
  gst_percent: 5,
};

export function currencySymbol(currency: string): string {
  if (currency === 'INR') return '₹';
  if (currency === 'USD') return '$';
  if (currency === 'EUR') return '€';
  return `${currency} `;
}

export function formatMoney(amount: number, currency: string): string {
  return `${currencySymbol(currency)}${amount.toFixed(2)}`;
}

export function calcBillTotals(subtotal: number, pizzaQty: number, settings: AppSettings) {
  const discount =
    pizzaQty >= settings.bulk_discount_min_qty
      ? Number((subtotal * settings.bulk_discount_percent / 100).toFixed(2))
      : 0;
  const taxable = Number((subtotal - discount).toFixed(2));
  const gst = Number((taxable * settings.gst_percent / 100).toFixed(2));
  const total_payable = Number((taxable + gst).toFixed(2));
  return { discount, gst, total_payable, taxable };
}

export function bulkDiscountLabel(settings: AppSettings): string {
  return `Bulk discount (${settings.bulk_discount_percent}%)`;
}

export function gstLabel(settings: AppSettings): string {
  return `GST (${settings.gst_percent}%)`;
}

export function bulkDiscountFooterNote(settings: AppSettings, pizzaQty: number): string | undefined {
  if (pizzaQty >= settings.bulk_discount_min_qty) {
    return `${settings.bulk_discount_percent}% bulk discount applied (${settings.bulk_discount_min_qty}+ pizzas).`;
  }
  return undefined;
}

export function normalizeSettingsPatch(body: Record<string, unknown>): Partial<AppSettings> {
  const patch: Partial<AppSettings> = {};

  if (body.bulk_discount_percent != null) {
    const v = Number(body.bulk_discount_percent);
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error('Bulk discount must be between 0 and 100.');
    patch.bulk_discount_percent = v;
  }
  if (body.bulk_discount_min_qty != null) {
    const v = Number(body.bulk_discount_min_qty);
    if (!Number.isInteger(v) || v < 1 || v > 100) throw new Error('Bulk discount minimum quantity must be 1–100.');
    patch.bulk_discount_min_qty = v;
  }
  if (body.default_currency != null) {
    const v = String(body.default_currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(v)) throw new Error('Default currency must be a 3-letter code (e.g. INR).');
    patch.default_currency = v;
  }
  if (body.gst_percent != null) {
    const v = Number(body.gst_percent);
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error('GST percent must be between 0 and 100.');
    patch.gst_percent = v;
  }

  return patch;
}
