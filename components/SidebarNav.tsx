'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import TicketBadge from '@/components/TicketBadge';

type NavItem = {
  key: string;
  label: string;
  href: string;
  paths: string[];        // svg path "d" strings
  isTicketBadge?: boolean; // renders <TicketBadge/> in normal mode
};

// Canonical menu. Order here is the DEFAULT; users can reorder and we persist it.
// To add a menu item in future, just add an entry — it auto-appends to the end of
// any saved custom order (see mergeOrder below).
const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/', paths: ['M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z'] },
  { key: 'products', label: 'Products', href: '/products', paths: ['M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z'] },
  { key: 'inventory', label: 'Inventory', href: '/inventory', paths: ['M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z'] },
  { key: 'catalog', label: 'Catalog', href: '/catalog', paths: ['M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V5.25a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z'] },
  { key: 'customers', label: 'Customers', href: '/customers', paths: ['M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z'] },
  { key: 'orders', label: 'Orders', href: '/orders', paths: ['M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z'] },
  { key: 'invoices', label: 'Invoices', href: '/invoices', paths: ['M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z'] },
  { key: 'tickets', label: 'Tickets', href: '/tickets', isTicketBadge: true, paths: ['M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z'] },
  { key: 'payments', label: 'Payments', href: '/payments', paths: ['M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z'] },
  { key: 'purchase-orders', label: 'Purchase Orders', href: '/purchase-orders', paths: ['M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z'] },
  { key: 'shipments', label: 'Shipments', href: '/shipments', paths: ['M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12'] },
  { key: 'shipping', label: 'Shipping Module', href: '/shipping/queue', paths: ['M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9'] },
  { key: 'pick-tickets', label: 'Pick Tickets', href: '/pick-tickets', paths: ['M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z'] },
  { key: 'reports', label: 'Reports', href: '/reports', paths: ['M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z'] },
  { key: 'sync', label: 'Sync Center', href: '/sync', paths: ['M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99'] },
  { key: 'activity', label: 'Activity', href: '/activity', paths: ['M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z'] },
  { key: 'ai-assistant', label: 'AI Assistant', href: '/ai-assistant', paths: ['M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z'] },
  { key: 'settings', label: 'Settings', href: '/settings', paths: ['M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z', 'M15 12a3 3 0 11-6 0 3 3 0 016 0z'] },
];

const STORAGE_KEY = 'advancehq-sidebar-order';
const DEFAULT_ORDER = NAV_ITEMS.map(i => i.key);
const ITEM_BY_KEY: Record<string, NavItem> = Object.fromEntries(NAV_ITEMS.map(i => [i.key, i]));

// Merge a saved order with the canonical list: keep saved keys that still exist
// (in saved order), then append any new keys not present in the saved order.
function mergeOrder(saved: string[]): string[] {
  const valid = saved.filter(k => k in ITEM_BY_KEY);
  const missing = DEFAULT_ORDER.filter(k => !valid.includes(k));
  return [...valid, ...missing];
}

function Icon({ paths }: { paths: string[] }) {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      {paths.map((d, i) => <path key={i} strokeLinecap="round" strokeLinejoin="round" d={d} />)}
    </svg>
  );
}

export default function SidebarNav() {
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [editMode, setEditMode] = useState(false);
  const orderRef = useRef<string[]>(DEFAULT_ORDER);
  const dragKey = useRef<string | null>(null);
  const [, force] = useState(0); // re-render trigger for drag visuals

  orderRef.current = order;

  // Load saved order after mount (avoids SSR/hydration mismatch).
  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) setOrder(mergeOrder(JSON.parse(s)));
    } catch {}
  }, []);

  function persist(next: string[]) {
    setOrder(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  }

  function handleDragStart(key: string) { dragKey.current = key; force(n => n + 1); }
  function handleDragOver(e: React.DragEvent, overKey: string) {
    e.preventDefault();
    const from = dragKey.current;
    if (!from || from === overKey) return;
    const cur = orderRef.current;
    const next = cur.filter(k => k !== from);
    const idx = next.indexOf(overKey);
    if (idx === -1) return;
    next.splice(idx, 0, from);
    persist(next);
  }
  function handleDragEnd() { dragKey.current = null; force(n => n + 1); }

  function resetOrder() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setOrder(DEFAULT_ORDER);
  }

  return (
    <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
      <div className="flex items-center justify-between px-1 pb-2">
        {editMode ? (
          <>
            <span className="text-xs text-gray-400">Drag to reorder</span>
            <div className="flex gap-2">
              <button onClick={resetOrder} className="text-xs text-gray-500 hover:text-gray-700">Reset</button>
              <button onClick={() => setEditMode(false)} className="text-xs font-medium text-brand-600 hover:text-brand-700">Done</button>
            </div>
          </>
        ) : (
          <button onClick={() => setEditMode(true)} className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" /></svg>
            Customize
          </button>
        )}
      </div>

      {order.map(key => {
        const item = ITEM_BY_KEY[key];
        if (!item) return null;

        if (editMode) {
          const dragging = dragKey.current === key;
          return (
            <div
              key={key}
              draggable
              onDragStart={() => handleDragStart(key)}
              onDragOver={(e) => handleDragOver(e, key)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-sm cursor-grab active:cursor-grabbing select-none ${dragging ? 'border-brand-400 bg-brand-50 opacity-60' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
            >
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" /></svg>
              <Icon paths={item.paths} />
              <span className="text-gray-700">{item.label}</span>
            </div>
          );
        }

        if (item.isTicketBadge) return <TicketBadge key={key} />;

        return (
          <Link key={key} href={item.href} className="sidebar-link">
            <Icon paths={item.paths} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
