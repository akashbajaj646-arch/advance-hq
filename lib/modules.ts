// Canonical module registry for Advance HQ.
// Module keys deliberately match the `key` fields in components/SidebarNav.tsx NAV_ITEMS.
// Edge-safe: no imports, used by middleware.
//
// Access model:
//   - role === 'admin'              -> full access to everything, always
//   - permissions = string[]        -> explicit allowlist of module keys (set in Settings > Users)
//   - permissions == null           -> role default (ROLE_DEFAULT_MODULES), or full access if the role has none
//   - 'settings'                    -> always accessible (My Account / password; Users page is admin-gated)
//
// Enforcement lives in middleware.ts. Pages are matched by `prefixes`, APIs by `apiPrefixes`.
// Only list an apiPrefix when that API is used by this module alone, otherwise
// restricting the module would break other pages that call it.

export type AppUser = {
  role?: string | null;
  permissions?: string[] | null;
};

export type ModuleDef = {
  key: string;
  label: string;
  /** Where the sidebar link goes; used as a landing page after a denied redirect */
  href: string;
  /** Page route prefixes owned by this module */
  prefixes: string[];
  /** API route prefixes owned by this module (server-side enforcement) */
  apiPrefixes?: string[];
  /** false = always accessible, never shown as a checkbox */
  selectable?: boolean;
};

export const MODULES: ModuleDef[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/', prefixes: ['/'] },
  { key: 'products', label: 'Products', href: '/products', prefixes: ['/products'] },
  { key: 'descriptions', label: 'Descriptions', href: '/descriptions', prefixes: ['/descriptions'], apiPrefixes: ['/api/descriptions'] },
  { key: 'automations', label: 'Automations', href: '/automations', prefixes: ['/automations'], apiPrefixes: ['/api/automations'] },
  { key: 'samples', label: 'Samples (PLM)', href: '/samples', prefixes: ['/samples'], apiPrefixes: ['/api/plm'] },
  { key: 'inventory', label: 'Inventory', href: '/inventory', prefixes: ['/inventory'] },
  { key: 'adjustments', label: 'Adjustments', href: '/adjustments', prefixes: ['/adjustments'] },
  { key: 'catalog', label: 'Catalog', href: '/catalog', prefixes: ['/catalog'] },
  { key: 'customers', label: 'Customers', href: '/customers', prefixes: ['/customers'] },
  { key: 'orders', label: 'Orders', href: '/orders', prefixes: ['/orders'] },
  { key: 'invoices', label: 'Invoices', href: '/invoices', prefixes: ['/invoices'] },
  { key: 'tickets', label: 'Tickets', href: '/tickets', prefixes: ['/tickets'] },
  { key: 'payments', label: 'Payments', href: '/payments', prefixes: ['/payments'] },
  { key: 'payment-links', label: 'Payment Links', href: '/payment-links', prefixes: ['/payment-links'] },
  { key: 'wholesale-approvals', label: 'Wholesale Applications', href: '/wholesale-applications', prefixes: ['/wholesale-applications', '/wholesale-approvals'] },
  { key: 'purchase-orders', label: 'Purchase Orders', href: '/purchase-orders', prefixes: ['/purchase-orders'] },
  { key: 'shipments', label: 'Shipments', href: '/shipments', prefixes: ['/shipments'] },
  { key: 'shipping', label: 'Shipping Module', href: '/shipping/queue', prefixes: ['/shipping'] },
  { key: 'pick-tickets', label: 'Pick Tickets', href: '/pick-tickets', prefixes: ['/pick-tickets'] },
  { key: 'rfid', label: 'RFID Scans', href: '/rfid', prefixes: ['/rfid'] },
  { key: 'warehouse', label: 'Warehouse', href: '/warehouse', prefixes: ['/warehouse'], apiPrefixes: ['/api/warehouse'] },
  { key: 'box-location-update', label: 'Box Location Update', href: '/warehouse/location-scan', prefixes: ['/warehouse/location-scan'], apiPrefixes: ['/api/warehouse/location-scan'] },
  { key: 'reports', label: 'Reports', href: '/reports', prefixes: ['/reports'] },
  { key: 'sync', label: 'Sync Center', href: '/sync', prefixes: ['/sync'] },
  { key: 'activity', label: 'Activity', href: '/activity', prefixes: ['/activity'] },
  { key: 'ai-assistant', label: 'AI Assistant', href: '/ai-assistant', prefixes: ['/ai-assistant'] },
  { key: 'settings', label: 'Settings', href: '/settings', prefixes: ['/settings'], selectable: false },
];

/** Modules that can be granted/revoked per user (excludes settings) */
export const SELECTABLE_MODULES = MODULES.filter(m => m.selectable !== false);
export const SELECTABLE_KEYS = SELECTABLE_MODULES.map(m => m.key);

/** What a role gets when the user has no explicit allowlist. Roles not listed get everything. */
export const ROLE_DEFAULT_MODULES: Record<string, string[]> = {
  warehouse: ['warehouse', 'box-location-update', 'rfid'],
};

export function isValidModuleKey(key: unknown): key is string {
  return typeof key === 'string' && SELECTABLE_KEYS.includes(key);
}

export function isAlwaysAllowed(moduleKey: string): boolean {
  const m = MODULES.find(x => x.key === moduleKey);
  return !!m && m.selectable === false;
}

/** 'all' = unrestricted, otherwise the list of module keys the user can open. */
export function effectiveModules(user: AppUser | null | undefined): 'all' | string[] {
  if (!user) return [];
  if (user.role === 'admin') return 'all';
  if (Array.isArray(user.permissions)) return user.permissions;
  const roleDefault = ROLE_DEFAULT_MODULES[user.role ?? ''];
  return roleDefault ?? 'all';
}

export function isRestricted(user: AppUser | null | undefined): boolean {
  return effectiveModules(user) !== 'all';
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

/** Resolve an /api/* pathname to its owning module key. Null = unowned. */
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
  const eff = effectiveModules(user);
  return eff === 'all' || eff.includes(moduleKey);
}

/** Landing page for a user who hit something they can't open. */
export function firstAllowedHref(user: AppUser | null | undefined): string {
  for (const m of SELECTABLE_MODULES) {
    if (hasModuleAccess(user, m.key)) return m.href;
  }
  return '/settings';
}
