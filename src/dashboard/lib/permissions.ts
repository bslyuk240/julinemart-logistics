import type { ElementType } from 'react';
import {
  Home,
  LayoutDashboard,
  Package,
  MapPin,
  Truck,
  DollarSign,
  BarChart3,
  Users,
  RotateCcw,
  Settings,
  Percent,
  Megaphone,
  Ticket,
  BellRing,
  Search,
  ClipboardCheck,
  Star,
  LayoutGrid,
  Plus,
  Store,
  Wallet,
  TrendingUp,
  Headphones,
  Activity,
  AlertCircle,
  ShoppingBag,
  Tag,
  FolderTree,
  Send,
} from 'lucide-react';
import type { User } from '../contexts/AuthContext';

// catalog_access flag on an agent grants access to catalog nav items
export type NavItem = {
  name: string;
  href: string;
  icon: ElementType;
  roles: string[];
  requireCatalogAccess?: boolean;
};

export type NavSection = {
  id: string;
  label: string | null;
  items: NavItem[];
};

// Single source of truth for admin navigation — both the desktop sidebar
// (DashboardLayout) and the mobile shell (TabBar, MoreMenu) read from this,
// so role visibility can't drift between the two surfaces.
export const navigationSections: NavSection[] = [
  {
    id: 'overview',
    label: null,
    items: [
      { name: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard, roles: ['admin', 'agent', 'manager', 'viewer'] },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { name: 'Orders', href: '/admin/orders', icon: Package, roles: ['admin', 'agent', 'manager', 'viewer'] },
      { name: 'Manual Shipments', href: '/admin/manual-shipments', icon: Send, roles: ['admin', 'agent', 'manager', 'viewer'] },
      { name: 'Hub Dispatch', href: '/admin/dispatch/hub', icon: Truck, roles: ['admin', 'agent', 'viewer'] },
      { name: 'Live Support', href: '/admin/support', icon: Headphones, roles: ['admin', 'agent', 'manager', 'viewer'] },
      { name: 'Refunds', href: '/admin/refunds', icon: RotateCcw, roles: ['admin', 'agent', 'manager', 'viewer'] },
    ],
  },
  {
    id: 'catalog',
    label: 'Catalog',
    items: [
      { name: 'Add Product', href: '/admin/products/upload', icon: Plus, roles: ['admin', 'shop_manager', 'manager'], requireCatalogAccess: true },
      { name: 'Product Moderation', href: '/admin/products/moderation', icon: ClipboardCheck, roles: ['admin', 'shop_manager', 'manager'], requireCatalogAccess: true },
      { name: 'Product Reviews', href: '/admin/products/reviews', icon: Star, roles: ['admin', 'shop_manager', 'manager'], requireCatalogAccess: true },
      { name: 'Global Sourcing', href: '/admin/global-sourcing', icon: Search, roles: ['admin', 'shop_manager', 'manager'], requireCatalogAccess: true },
      { name: 'Homepage Content', href: '/admin/homepage-content', icon: LayoutGrid, roles: ['admin'] },
      { name: 'Tags', href: '/admin/tags', icon: Tag, roles: ['admin'] },
      { name: 'Categories', href: '/admin/categories', icon: FolderTree, roles: ['admin'] },
    ],
  },
  {
    id: 'vendors',
    label: 'Vendors',
    items: [
      { name: 'Vendors', href: '/admin/vendors', icon: Store, roles: ['admin', 'manager'] },
      { name: 'Vendor Payouts', href: '/admin/vendor-withdrawals', icon: Wallet, roles: ['admin', 'manager'] },
      { name: 'Vendor Debits', href: '/admin/vendor-debits', icon: AlertCircle, roles: ['admin', 'manager'] },
      { name: 'Vendor Locations', href: '/admin/vendor-locations', icon: MapPin, roles: ['admin', 'manager'] },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    items: [
      { name: 'Campaigns', href: '/admin/campaigns', icon: Megaphone, roles: ['admin', 'manager', 'social_media_manager'] },
      { name: 'Vouchers', href: '/admin/vouchers', icon: Ticket, roles: ['admin'] },
      { name: 'Shipping Discounts', href: '/admin/discounts', icon: Percent, roles: ['admin'] },
      { name: 'Influencers', href: '/admin/influencers', icon: Megaphone, roles: ['admin'] },
      { name: 'Meta Ads', href: '/admin/meta-ads', icon: TrendingUp, roles: ['admin', 'manager', 'social_media_manager'] },
      { name: 'Google Ads', href: '/admin/google-ads', icon: Search, roles: ['admin', 'manager', 'social_media_manager'] },
    ],
  },
  {
    id: 'network',
    label: 'Network',
    items: [
      { name: 'Hubs', href: '/admin/hubs', icon: MapPin, roles: ['admin'] },
      { name: 'Couriers', href: '/admin/couriers', icon: Truck, roles: ['admin'] },
      { name: 'Shipping Rates', href: '/admin/rates', icon: DollarSign, roles: ['admin', 'agent', 'manager', 'viewer'] },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { name: 'Finance', href: '/admin/finance', icon: TrendingUp, roles: ['admin'] },
      { name: 'Settlements', href: '/admin/settlements', icon: DollarSign, roles: ['admin'] },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { name: 'Users', href: '/admin/users', icon: Users, roles: ['admin'] },
      { name: 'Customers', href: '/admin/customers', icon: ShoppingBag, roles: ['admin', 'manager'] },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { name: 'Analytics', href: '/admin/analytics', icon: BarChart3, roles: ['admin'] },
      { name: 'PWA Monitoring', href: '/admin/pwa-monitoring', icon: Activity, roles: ['admin'] },
      { name: 'Activity Logs', href: '/admin/activity-logs', icon: Activity, roles: ['admin'] },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { name: 'Settings', href: '/admin/settings', icon: Settings, roles: ['admin'] },
      { name: 'Notifications', href: '/admin/notifications', icon: BellRing, roles: ['admin'] },
    ],
  },
];

export function canAccessNavItem(item: NavItem, user: User | null | undefined): boolean {
  if (!item.roles) return true;
  if (item.roles.includes(user?.role || '')) return true;
  // Agents need catalog_access for catalog nav; manager/admin/shop_manager are in roles already
  if (item.requireCatalogAccess && user?.catalog_access && user?.role === 'agent') return true;
  return false;
}

// Role-filter items, then drop empty sections so labels don't float alone
export function getFilteredSections(user: User | null | undefined): NavSection[] {
  return navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessNavItem(item, user)),
    }))
    .filter((section) => section.items.length > 0);
}

// The mobile tab bar's first slot. Points at the same route the desktop
// logo/landing does — AdminLanding already redirects social_media_manager
// to Meta Ads from here, so no per-role branching is needed in the tab itself.
export const HOME_TAB: NavItem = {
  name: 'Home',
  href: '/admin/dashboard',
  icon: Home,
  roles: ['admin', 'agent', 'shop_manager', 'manager', 'viewer', 'social_media_manager'],
};

// Fixed middle tabs matching the mobile design spec — Orders, Dispatch, Support.
// Filtered per-role via canAccessNavItem; anything else lives under More.
export const MOBILE_PRIMARY_TABS: NavItem[] = [
  { name: 'Orders', href: '/admin/orders', icon: Package, roles: ['admin', 'agent', 'manager', 'viewer'] },
  { name: 'Dispatch', href: '/admin/dispatch/hub', icon: Truck, roles: ['admin', 'agent', 'viewer'] },
  { name: 'Support', href: '/admin/support', icon: Headphones, roles: ['admin', 'agent', 'manager', 'viewer'] },
];

export function getMobileTabItems(user: User | null | undefined): NavItem[] {
  return MOBILE_PRIMARY_TABS.filter((item) => canAccessNavItem(item, user));
}
