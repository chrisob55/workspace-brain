import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: number | undefined): string {
  return value === undefined
    ? '—'
    : new Intl.NumberFormat('en-GB').format(value);
}

export function shortHash(hash: string, length = 12): string {
  return hash.slice(0, length);
}
