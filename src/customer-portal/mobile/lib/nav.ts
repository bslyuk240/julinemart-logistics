import { Calculator, Home, Mail } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type CustomerTab = {
  name: string;
  hrefSuffix: string;
  icon: LucideIcon;
};

export const CUSTOMER_TABS: CustomerTab[] = [
  { name: 'Track', hrefSuffix: '', icon: Home },
  { name: 'Estimate', hrefSuffix: '/estimate', icon: Calculator },
  { name: 'Contact', hrefSuffix: '/contact', icon: Mail },
];

/** Standalone portal uses `/`; unified app uses `/customer`. */
export function customerBaseFromPath(pathname: string): string {
  return pathname.startsWith('/customer') ? '/customer' : '';
}

export function customerTabHref(base: string, suffix: string): string {
  if (!suffix) return base || '/';
  return `${base}${suffix}`;
}

const TAB_BAR_ROUTES = new Set(['/', '/customer', '/estimate', '/contact', '/customer/estimate', '/customer/contact']);

export function shouldShowCustomerTabBar(pathname: string): boolean {
  const normalized = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  return TAB_BAR_ROUTES.has(normalized);
}
