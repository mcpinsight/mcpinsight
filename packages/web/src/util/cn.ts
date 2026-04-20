import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn/ui class-name helper. Merges Tailwind class strings and resolves
 * conflicts so later tokens win — the standard primitive used by every
 * generated shadcn component (`components/ui/*`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
