// Canonical module registry for Advance HQ.
// Module keys deliberately match the `key` fields in components/SidebarNav.tsx NAV_ITEMS.
//
// Access model:
//   - role === 'admin'            -> full access to everything, always
//   - permissions == null         -> full access (all existing users, and invites created with "All modules")
//   - permissions = string[]      -> allowlist of module keys
//   - 'dashboard' and 'settings'  -> always accessible to every logged-in user
//     (settings = My Account / password; the Users & Invites page inside it is already admin-gated)

export type AppUser = {
  role?: string | null;
  permissions?: string[] | null;
};

export type ModuleDef = {
  key: string;
  label: string;
  /** Page route prefixes owned by this module */
  prefixes: string[];
  /** API route prefixes owned by this module (server-side enforcement) */
  apiPrefixes?: string[];
  /** false = always accessible, never shown as a checkbox */
  selectable?: boolean;
};

export const MODULES: ModuleDef[] = [
  { key: 'dashboard', label: 'Dashboard', prefixes: ['/'], selectable: false },
  { key: 'products', label: 'Products', prefixes: ['/products'] },
  { key: 'descriptions', label: 'Descriptions', prefixes: ['/descriptions'], apiPrefixes: ['/api/descriptions'] },
  { key: 'automations', label: 'Automations', prefixes: ['/automations'], apiPrefixes: ['/api/automations'] },
  { key: 'samples', label: 'Samples (PLM)', prefixes: ['/samples'], apiPrefixes: ['/api/data'] },
  { key: 'inventory', label: 'Inventory', prefixes: ['/inventory'] },
  { key: 'catalog', label: 'Catalog', prefixes: ['/catalog'] },
  { key: 'customers', label: 'Customers', prefixes: ['/customers'] },
  { key: 'orders', label: 'Orders', prefixes: ['/orders'] },
  { key: 'invoices', label: 'Invoices', prefixes: ['/invoices'] },
  { key: 'tickets', label: 'Tickets', prefixes: ['/tickets'] },
  { key: 'payments', label: 'Payments', prefixes: ['/payments'] },
  { key: 'payment-links', label: 'Payment Links', prefixes: ['/payment-links'] },
  { key: 'wholesale-approvals', label: 'Wholesale Approvals', prefixes: ['/wholesale-approvals'] },
  { key: 'purchase-orders', label: 'Purchase Orders', prefixes: ['/purchase-orders'] },
  { key: 'shipments', label: 'Shipments', prefixes: ['/shipments'] },
  { key: 'shipping', label: 'Shipping Module', prefixes: ['/shipping'] },
  { key: 'pick-tickets', label: 'Pick Tickets', prefixes: ['/pick-tickets'] },
  { key: 'warehouse', label: 'Warehouse', prefixes: ['/warehouse'], apiPrefixes: ['/api/warehouse'] },
  { key: 'reports', label: 'Reports', prefixes: ['/reports'] },
  { key: 'sync', label: 'Sync Center', prefixes: ['/sync'] },
  { key: 'activity', label: 'Activity', prefixes: ['/activity'] },
  { key: 'ai-assistant', label: 'AI Assistant', prefixes: ['/ai-assistant'] },
  { key: 'settings', label: 'Settings', prefixes: ['/settings'], selectable: false },
];

/** Modules that can be granted/revoked per user (excludes dashboard + settings) */
export const SELECTABLE_MODULES = MODULES.filter(m => m.selectable !== false);

export function isAlwaysAllowed(moduleKey: string): boolean {
  const m = MODULES.find(x => x.key === moduleKey);
  return !!m && m.selectable === false;
}

function prefixMatches(pathname: string, prefix: string): boolean {
  if (prefix === '/') return pathname === '/';
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

/** Resolve a page pathname to its owning module key (longest prefix wins). Null = unowned route. */
export function moduleForPath(pathname: string): string | null {
  let best: { key: string; len: number } | null = null;
  for (const m of MODULES) {
    for (const p of m.prefixes) {
      if (prefixMatches(pathname, p) && (!best || p.length > best.len)) {
        best = { key: m.key, len: p.length };
      }
    }
  }
  return best?.key ?? null;
}

/** Resolve an /api/* pathname to its owning module key. Null = unowned (session-gated only). */
export function moduleForApiPath(pathname: string): string | null {
  let best: { key: string; len: number } | null = null;
  for (const m of MODULES) {
    for (const p of m.apiPrefixes ?? []) {
      if (prefixMatches(pathname, p) && (!best || p.length > best.len)) {
        best = { key: m.key, len: p.length };
      }
    }
  }
  return best?.key ?? null;
}

/** Core access check. Safe to call with a partial/loading user object. */
export function hasModuleAccess(user: AppUser | null | undefined, moduleKey: string): boolean {
  if (isAlwaysAllowed(moduleKey)) return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.permissions == null) return true; // null/undefined = legacy full access
  return Array.isArray(user.permissions) && user.permissions.includes(moduleKey);
}
