import './globals.css';
import type { Metadata } from 'next';
import SidebarNav from '@/components/SidebarNav';
import Providers from '@/components/Providers';
import UserMenu from '@/components/UserMenu';

export const metadata: Metadata = {
  title: 'Advance HQ',
  description: 'Central command center for Advance Apparels',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="flex h-screen">
            {/* Sidebar */}
            <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
              {/* Logo */}
              <div className="p-6 border-b border-gray-200">
                <h1 className="text-xl font-bold text-brand-600">Advance HQ</h1>
                <p className="text-xs text-gray-500 mt-1">Command Center</p>
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
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
