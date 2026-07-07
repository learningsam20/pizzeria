import { parseMenuFileRow } from './inputValidation';
import type { MenuItem } from '../types';

/** Primary semicolon-separated .txt files; CSV names used as fallback if .txt is missing. */
export const INPUT_DATA_MENU_FILES = [
  { fileName: 'Types_of_Base.txt', fallbackFileName: 'bases.csv', category: 'base' as const },
  { fileName: 'Types_of_Pizza.txt', fallbackFileName: 'pizzas.csv', category: 'pizza' as const },
  { fileName: 'Types_of_Toppings.txt', fallbackFileName: 'toppings.csv', category: 'topping' as const },
] as const;

export type MenuImportCategory = (typeof INPUT_DATA_MENU_FILES)[number]['category'];

export interface ParsedMenuRow {
  code: string;
  category: MenuImportCategory;
  name: string;
  price_inr: number;
  currency: string;
  description: string | null;
  is_active: boolean;
}

export function parseDelimitedRows(text: string): Record<string, unknown>[] {
  const rawLines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  if (rawLines.length === 0) return [];

  const firstLine = rawLines[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';
  const firstRowCells = firstLine.split(delimiter).map(cell => cell.trim());
  const knownHeaders = new Set([
    'code', 'id', 'item_code', 'sku', 'category', 'type', 'item_type',
    'name', 'dish', 'title', 'item_name', 'price', 'price_inr', 'cost',
    'description', 'details', 'note', 'is_active',
  ]);
  const normalizedFirstCells = firstRowCells.map(cell => cell.toLowerCase());
  const headerMatches = normalizedFirstCells.filter(cell => knownHeaders.has(cell)).length;
  const hasHeaderRow =
    headerMatches >= 2 ||
    normalizedFirstCells.includes('code') ||
    normalizedFirstCells.includes('name');

  const rows: Record<string, unknown>[] = [];
  const headers = hasHeaderRow
    ? normalizedFirstCells
    : (firstRowCells.length === 3
        ? ['code', 'name', 'price_inr']
        : (firstRowCells.length === 4 ? ['code', 'name', 'price_inr', 'description'] : normalizedFirstCells));

  const dataLines = hasHeaderRow ? rawLines.slice(1) : rawLines;
  for (const line of dataLines) {
    const values = line.split(delimiter).map(v => v.trim());
    if (values.every(v => v.length === 0)) continue;
    if (values.length !== headers.length) continue;
    const rowObj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = values[idx];
    });
    rows.push(rowObj);
  }

  return rows;
}

export function parseMenuFileContent(
  text: string,
  category: MenuImportCategory,
  defaultCurrency: string
): { items: ParsedMenuRow[]; errors: string[] } {
  const items: ParsedMenuRow[] = [];
  const errors: string[] = [];

  try {
    const rows = parseDelimitedRows(text);
    if (rows.length === 0) {
      errors.push('No data rows found (check delimiter and headers).');
      return { items, errors };
    }

    rows.forEach((row, idx) => {
      const parsed = parseMenuFileRow(row, idx + 1);
      if (!parsed.ok) {
        errors.push(parsed.error);
        return;
      }
      items.push({
        code: parsed.code.toUpperCase(),
        category,
        name: parsed.name,
        price_inr: parsed.price_inr,
        currency: defaultCurrency,
        description: parsed.description,
        is_active: String(row.is_active ?? 'true').toLowerCase() !== 'false',
      });
    });
  } catch {
    errors.push('Could not parse file contents.');
  }

  return { items, errors };
}

export type MenuUpsertPayload = Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>;

export function normalizeMenuItemName(name: string): string {
  return name.trim().toLowerCase();
}

/** Find same display name reused with different codes within one category. */
export function findMenuNameConflicts(
  items: Array<{ name: string; code: string; category: string }>
): string[] {
  const groups = new Map<string, { label: string; codes: Set<string> }>();
  for (const item of items) {
    const key = `${item.category}::${normalizeMenuItemName(item.name)}`;
    const code = item.code.trim().toUpperCase();
    if (!groups.has(key)) {
      groups.set(key, { label: item.name.trim(), codes: new Set() });
    }
    groups.get(key)!.codes.add(code);
  }
  const errors: string[] = [];
  for (const { label, codes } of groups.values()) {
    if (codes.size > 1) {
      errors.push(`"${label}" appears with multiple codes: ${[...codes].join(', ')}`);
    }
  }
  return errors;
}

export function checkMenuNameConflict(
  existing: Array<{ id?: number; name: string; code: string; category: string }>,
  candidate: { name: string; code: string; category: string; id?: number }
): string | null {
  const norm = normalizeMenuItemName(candidate.name);
  const code = candidate.code.trim().toUpperCase();
  for (const item of existing) {
    if (candidate.id != null && item.id === candidate.id) continue;
    if (item.category !== candidate.category) continue;
    if (normalizeMenuItemName(item.name) === norm && item.code.trim().toUpperCase() !== code) {
      return `"${candidate.name.trim()}" already exists as code ${item.code}. Each name must map to one code per category.`;
    }
  }
  return null;
}
