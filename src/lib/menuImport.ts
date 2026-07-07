import fs from 'fs';
import path from 'path';
import {
  INPUT_DATA_MENU_FILES,
  type MenuImportCategory,
} from './menuImportUtils';

export * from './menuImportUtils';

export const INPUT_DATA_DIR = path.join(process.cwd(), 'input_data');

export function readInputDataMenuFile(fileName: string): { ok: true; text: string } | { ok: false; error: string } {
  const filePath = path.join(INPUT_DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `File not found: input_data/${fileName}` };
  }
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    if (!text.trim()) {
      return { ok: false, error: `File is empty: input_data/${fileName}` };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, error: `Could not read input_data/${fileName}` };
  }
}

export function readInputDataMenuFileEntry(
  entry: (typeof INPUT_DATA_MENU_FILES)[number]
): { ok: true; text: string; resolvedFile: string } | { ok: false; error: string; attempted: string[] } {
  const attempted: string[] = [];
  const primary = readInputDataMenuFile(entry.fileName);
  attempted.push(entry.fileName);
  if (primary.ok) return { ok: true, text: primary.text, resolvedFile: entry.fileName };

  if (entry.fallbackFileName) {
    const fallback = readInputDataMenuFile(entry.fallbackFileName);
    attempted.push(entry.fallbackFileName);
    if (fallback.ok) return { ok: true, text: fallback.text, resolvedFile: entry.fallbackFileName };
  }

  return {
    ok: false,
    error: primary.error,
    attempted,
  };
}

export type { MenuImportCategory };
