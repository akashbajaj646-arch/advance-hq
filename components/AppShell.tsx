'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import SidebarNav from '@/components/SidebarNav';
import UserMenu from '@/components/UserMenu';

const COLLAPSE_KEY = 'advancehq-sidebar-collapsed';

function Hamburger() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false); // desktop only
  const pathname = usePathname();

  // Load saved desktop collapse preference after mount (avoids hydration mismatch).
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true);
    } catch {}
  }, []);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed(prev => {
      try { localStorage.setItem(COLLAPSE_KEY, prev ? '0' : '1'); } catch {}
      return !prev;
    });
  }

  return (
    <div className="flex h-screen">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar: off-canvas drawer on mobile, static (collapsible) on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 flex flex-col transform transition-transform duration-200 md:static md:transform-none md:transition-none ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'md:hidden' : 'md:flex'}`}
      >
        {/* Logo */}
        <div className="p-6 border-b border-gray-200 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-brand-600">Advance HQ</h1>
            <p className="text-xs text-gray-500 mt-1">Command Center</p>
          </div>
          {/* Close (mobile) */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden text-gray-400 hover:text-gray-600 p-1 -m-1"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {/* Collapse (desktop) */}
          <button
            onClick={toggleCollapsed}
            className="hidden md:block text-gray-400 hover:text-gray-600 p-1 -m-1"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 4.5l-7.5 7.5 7.5 7.5m-6-15L5.25 12l7.5 7.5" />
            </svg>
          </button>
        </div>

        {/* Navigation (reorderable — see components/SidebarNav.tsx) */}
        <SidebarNav />

        {/* Quick Links */}
        <div className="p-4 border-t border-gray-200">
          <p className="text-xs font-medium text-gray-400 uppercase mb-3">Quick Links</p>
          <div className="space-y-2">
            <a href="http://localhost:3001" target="_blank" className="flex items-center gap-2 text-sm text-gray-600 hover:text-brand-600">
              <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
              Team Inbox
            </a>
            <a href="http://localhost:3002" target="_blank" className="flex items-center gap-2 text-sm text-gray-600 hover:text-brand-600">
              <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
              Product Catalog (Public)
            </a>
          </div>
        </div>

        {/* User Menu */}
        <UserMenu />
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gray-50">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-20 flex items-center gap-3 bg-white border-b border-gray-200 px-4 h-12 md:hidden">
          <button onClick={() => setMobileOpen(true)} className="text-gray-600 p-1 -m-1" aria-label="Open menu">
            <Hamburger />
          </button>
          <span className="font-bold text-brand-600">Advance HQ</span>
        </div>

        {/* Desktop reopen button when collapsed */}
        {collapsed && (
          <button
            onClick={toggleCollapsed}
            className="hidden md:flex fixed top-3 left-3 z-20 items-center justify-center w-9 h-9 bg-white border border-gray-200 rounded-lg shadow-sm text-gray-600 hover:text-brand-600"
            aria-label="Open sidebar"
            title="Open sidebar"
          >
            <Hamburger />
          </button>
        )}

        {children}
      </main>
    </div>
  );
}
