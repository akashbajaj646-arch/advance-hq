'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { db } from '@/lib/db';

export type EntityType = 'customer' | 'order' | 'invoice' | 'pick_ticket' | 'shipment';

interface DrawerEntry {
  type: EntityType;
  record: any;
  childData?: Record<string, any[]>;
}

interface DrawerContextType {
  stack: DrawerEntry[];
  open: (type: EntityType, id: string) => Promise<void>;
  close: () => void;
  closeAll: () => void;
  goBack: () => void;
  current: DrawerEntry | null;
}

const DrawerContext = createContext<DrawerContextType>({
  stack: [],
  open: async () => {},
  close: () => {},
  closeAll: () => {},
  goBack: () => {},
  current: null,
});

export function useDrawer() {
  return useContext(DrawerContext);
}

async function fetchEntity(type: EntityType, id: string): Promise<DrawerEntry | null> {
  let record: any = null;
  let childData: Record<string, any[]> = {};

  switch (type) {
    case 'customer': {
      let { data } = await db.from('customers').select('*').eq('am_customer_id', id).limit(1).maybeSingle();
      if (!data) {
        const r = await db.from('customers').select('*').eq('account_number', id).limit(1).maybeSingle();
        data = r.data;
      }
      if (!data) {
        const r = await db.from('customers').select('*').ilike('customer_name', `%${id}%`).limit(1).maybeSingle();
        data = r.data;
      }
      if (!data) return null;
      record = data;

      const { data: orders } = await db.from('orders').select('order_number, apparel_magic_id, order_date, total_amount, order_status, qty, qty_shipped, season, po_number').eq('apparel_magic_customer_id', record.am_customer_id).order('order_date', { ascending: false }).limit(20);
      childData.orders = orders || [];

      const { data: invoices } = await db.from('invoices').select('invoice_number, apparel_magic_id, apparel_magic_order_id, invoice_date, total_amount, balance_due, payment_status, season').eq('apparel_magic_customer_id', record.am_customer_id).order('invoice_date', { ascending: false }).limit(20);
      childData.invoices = invoices || [];
      break;
    }
    case 'order': {
      let { data } = await db.from('orders').select('*').eq('order_number', id).limit(1).maybeSingle();
      if (!data) {
        const r = await db.from('orders').select('*').eq('apparel_magic_id', id).limit(1).maybeSingle();
        data = r.data;
      }
      if (!data) return null;
      record = data;

      const { data: items } = await db.from('order_items').select('*').eq('apparel_magic_order_id', record.apparel_magic_id).order('style_number');
      childData.items = items || [];

      const { data: invoices } = await db.from('invoices').select('invoice_number, apparel_magic_id, invoice_date, total_amount, balance_due, payment_status, season').eq('apparel_magic_order_id', record.order_number).order('invoice_date', { ascending: false }).limit(20);
      childData.invoices = invoices || [];

      const { data: pts } = await db.from('pick_tickets').select('pick_ticket_id, invoice_id, pick_ticket_date, qty, total_amount, wms_status, carton_status, is_void, customer_name').eq('apparel_magic_order_id', record.order_number).order('pick_ticket_date', { ascending: false });
      childData.pick_tickets = pts || [];

      if (pts && pts.length > 0) {
        const ptIds = pts.map((pt: any) => `AM-PT-${pt.pick_ticket_id}`);
        const { data: ships } = await db.from('shipments').select('am_shipment_id, shipstation_id, ship_date, tracking_number, carrier_name, shipment_status, qty, qty_boxes, am_invoice_id, selected_pick_ticket_ids').in('selected_pick_ticket_ids', ptIds);
        childData.shipments = ships || [];
      }
      break;
    }
    case 'invoice': {
      let { data } = await db.from('invoices').select('*').eq('invoice_number', id).limit(1).maybeSingle();
      if (!data) {
        const r = await db.from('invoices').select('*').eq('apparel_magic_id', id).limit(1).maybeSingle();
        data = r.data;
      }
      if (!data) return null;
      record = data;

      const { data: items } = await db.from('invoice_items').select('*').eq('apparel_magic_invoice_id', record.apparel_magic_id).order('style_number');
      childData.items = items || [];

      const { data: pts } = await db.from('pick_tickets').select('pick_ticket_id, apparel_magic_order_id, pick_ticket_date, qty, total_amount, wms_status, carton_status, is_void').eq('invoice_id', record.invoice_number).order('pick_ticket_date', { ascending: false });
      childData.pick_tickets = pts || [];

      const { data: ships } = await db.from('shipments').select('am_shipment_id, shipstation_id, ship_date, tracking_number, carrier_name, shipment_status, qty, qty_boxes, selected_pick_ticket_ids').eq('am_invoice_id', record.invoice_number);
      childData.shipments = ships || [];
      break;
    }
    case 'pick_ticket': {
      const { data } = await db.from('pick_tickets').select('*').eq('pick_ticket_id', id).limit(1).maybeSingle();
      if (!data) return null;
      record = data;

      const { data: items } = await db.from('pick_ticket_items').select('*').eq('pick_ticket_id', id).order('style_number');
      childData.items = items || [];

      const shipId = `AM-PT-${id}`;
      const { data: ships } = await db.from('shipments').select('am_shipment_id, shipstation_id, ship_date, tracking_number, carrier_name, shipment_status, qty, qty_boxes, am_invoice_id').eq('selected_pick_ticket_ids', shipId);
      childData.shipments = ships || [];
      break;
    }
    case 'shipment': {
      let { data } = await db.from('shipments').select('*').eq('am_shipment_id', id).limit(1).maybeSingle();
      if (!data) {
        const r = await db.from('shipments').select('*').eq('shipstation_id', id).limit(1).maybeSingle();
        data = r.data;
      }
      if (!data) return null;
      record = data;

      if (record.am_shipment_id) {
        const { data: b } = await db.from('shipment_boxes').select('*').eq('am_shipment_id', record.am_shipment_id).order('box_number');
        childData.boxes = b || [];
      }
      break;
    }
  }

  return { type, record, childData };
}

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<DrawerEntry[]>([]);

  const open = useCallback(async (type: EntityType, id: string) => {
    const entry = await fetchEntity(type, id);
    if (entry) {
      setStack(prev => [...prev, entry]);
    }
  }, []);

  const close = useCallback(() => {
    setStack([]);
  }, []);

  const closeAll = useCallback(() => {
    setStack([]);
  }, []);

  const goBack = useCallback(() => {
    setStack(prev => prev.length > 1 ? prev.slice(0, -1) : []);
  }, []);

  const current = stack.length > 0 ? stack[stack.length - 1] : null;

  return (
    <DrawerContext.Provider value={{ stack, open, close, closeAll, goBack, current }}>
      {children}
    </DrawerContext.Provider>
  );
}
