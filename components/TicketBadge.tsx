'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function TicketBadge() {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    loadCount();
    const interval = setInterval(loadCount, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  async function loadCount() {
    try {
      const res = await fetch('/api/tickets/count');
      const { count } = await res.json();
      setCount(count || 0);
    } catch {}
  }

  const isActive = pathname?.startsWith('/tickets');

  return (
    <Link href="/tickets" className={`sidebar-link relative ${isActive ? 'sidebar-link-active' : ''}`}>
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
      </svg>
      Tickets
      {count > 0 && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
