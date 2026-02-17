'use client';

import { DrawerProvider } from '@/context/DrawerContext';
import RecordDrawer from '@/components/RecordDrawer';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DrawerProvider>
      {children}
      <RecordDrawer />
    </DrawerProvider>
  );
}
