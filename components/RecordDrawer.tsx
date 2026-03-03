'use client';

import { useDrawer, EntityType } from '@/context/DrawerContext';
import PrintButton from '@/components/PrintButton';
import { generateOrderPDF, generateInvoicePDF, generatePickTicketPDF, generateShipmentPDF } from '@/lib/pdf-generator';
import { useRouter } from 'next/navigation';

// ── Clickable entity link component ──
export function EntityLink({ type, id, label, className = '' }: { type: EntityType; id: string; label?: string; className?: string }) {
  const { open } = useDrawer();
  if (!id || id === '-') return <span className="text-gray-300">-</span>;
  return (
    <button onClick={(e) => { e.stopPropagation(); open(type, id); }} className={`text-brand-600 hover:text-brand-800 hover:underline font-medium cursor-pointer ${className}`}>
      {label || id}
    </button>
  );
}

function fmt(key: string, value: any): string {
  if (value === null || value === undefined || value === '') return '-';
  if (key.match(/total_amount|subtotal|discount_amount|shipping_amount|tax_amount|amount_paid|balance_due|amount_|cost|freight/)) {
    const n = parseFloat(value);
    return isNaN(n) ? String(value) : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }
  if (key.match(/pct_discount|tax_rate/)) return `${parseFloat(value).toFixed(2)}%`;
  if (key.includes('synced_at') || key.includes('created_at') || key.includes('modified_time')) {
    try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return String(value); }
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === 'true') return 'Yes';
  if (value === 'false') return 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function StatusBadge({ value, type }: { value: string; type: 'order' | 'payment' | 'wms' | 'shipment' }) {
  if (!value) return <span className="text-gray-300">-</span>;
  let color = 'bg-gray-100 text-gray-600';
  if (type === 'order') {
    if (value === 'shipped') color = 'bg-green-100 text-green-700';
    else if (value === 'open') color = 'bg-blue-100 text-blue-700';
    else if (value === 'cancelled') color = 'bg-red-100 text-red-700';
  } else if (type === 'payment') {
    if (value === 'paid') color = 'bg-green-100 text-green-700';
    else if (value === 'partial') color = 'bg-yellow-100 text-yellow-700';
    else if (value === 'unpaid') color = 'bg-red-100 text-red-700';
  } else if (type === 'wms') {
    if (value === 'shipped' || value === 'completed') color = 'bg-green-100 text-green-700';
    else if (value === 'picked') color = 'bg-blue-100 text-blue-700';
    else color = 'bg-yellow-100 text-yellow-700';
  } else if (type === 'shipment') {
    if (value === 'shipped') color = 'bg-green-100 text-green-700';
    else if (value === 'voided') color = 'bg-red-100 text-red-700';
  }
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>{value}</span>;
}

function FieldGrid({ record, fields }: { record: any; fields: { key: string; label: string; link?: { type: EntityType; idKey?: string } }[] }) {
  const { open } = useDrawer();
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {fields.map(f => {
        const value = record[f.key];
        const hasValue = value !== null && value !== undefined && value !== '' && value !== 0 && value !== '0' && value !== false;
        return (
          <div key={f.key} className={`rounded-lg p-3 ${hasValue ? 'bg-gray-50' : 'bg-gray-50/50'}`}>
            <p className="text-xs text-gray-400 mb-1">{f.label}</p>
            {f.link && hasValue ? (
              <button onClick={() => open(f.link!.type, String(f.link!.idKey ? record[f.link!.idKey] : value))} className="text-sm font-medium text-brand-600 hover:text-brand-800 hover:underline">
                {String(value)}
              </button>
            ) : (
              <p className={`text-sm font-medium ${hasValue ? 'text-gray-900' : 'text-gray-300'}`}>{fmt(f.key, value)}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Helper: Navigate to product page ──
function StyleLink({ styleNumber }: { styleNumber: string | null | undefined }) {
  const router = useRouter();
  const { closeAll } = useDrawer();
  if (!styleNumber) return <span className="text-gray-300">-</span>;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        closeAll();
        router.push(`/products?style=${encodeURIComponent(styleNumber)}`);
      }}
      className="font-medium text-brand-600 hover:underline"
    >
      {styleNumber}
    </button>
  );
}

// ── Entity-specific detail renderers ──

function CustomerDetail({ entry }: { entry: any }) {
  const { record, childData } = entry;
  const tabs = ['overview', 'orders', 'invoices'];
  const [tab, setTab] = __useState('overview');

  const overviewFields = [
    { key: 'customer_name', label: 'Name' }, { key: 'first_name', label: 'First Name' }, { key: 'last_name', label: 'Last Name' },
    { key: 'account_number', label: 'Account #' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
    { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'country', label: 'Country' },
    { key: 'category', label: 'Category' }, { key: 'price_group', label: 'Price Group' }, { key: 'credit_limit', label: 'Credit Limit' },
    { key: 'terms_id', label: 'Terms' }, { key: 'is_active', label: 'Active' }, { key: 'date_created', label: 'Date Created' },
  ];

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'overview' ? 'Overview' : t === 'orders' ? `Orders (${childData?.orders?.length || 0})` : `Invoices (${childData?.invoices?.length || 0})`}
          </button>
        ))}
      </div>
      {tab === 'overview' && <FieldGrid record={record} fields={overviewFields} />}
      {tab === 'orders' && <RelatedOrdersTable orders={childData?.orders || []} />}
      {tab === 'invoices' && <RelatedInvoicesTable invoices={childData?.invoices || []} />}
    </div>
  );
}

function OrderDetail({ entry }: { entry: any }) {
  const { record, childData } = entry;
  const tabs = ['overview', 'items', 'invoices', 'pick_tickets', 'shipments'];
  const [tab, setTab] = __useState('overview');

  const overviewFields = [
    { key: 'order_number', label: 'Order #' },
    { key: 'customer_name', label: 'Customer', link: { type: 'customer' as EntityType, idKey: 'apparel_magic_customer_id' } },
    { key: 'apparel_magic_customer_id', label: 'Customer ID', link: { type: 'customer' as EntityType } },
    { key: 'po_number', label: 'PO #' }, { key: 'order_date', label: 'Order Date' }, { key: 'ship_date', label: 'Ship Date' },
    { key: 'cancel_date', label: 'Cancel Date' }, { key: 'order_status', label: 'Status' }, { key: 'season', label: 'Season' },
    { key: 'total_amount', label: 'Total' }, { key: 'qty', label: 'Qty' }, { key: 'qty_shipped', label: 'Qty Shipped' },
    { key: 'qty_open', label: 'Qty Open' }, { key: 'sales_rep', label: 'Sales Rep' }, { key: 'warehouse_id', label: 'Warehouse' },
  ];

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {tabs.map(t => {
          const count = t === 'items' ? childData?.items?.length : t === 'invoices' ? childData?.invoices?.length : t === 'pick_tickets' ? childData?.pick_tickets?.length : t === 'shipments' ? childData?.shipments?.length : 0;
          const label = t === 'overview' ? 'Overview' : t === 'items' ? `Items (${count})` : t === 'invoices' ? `Invoices (${count})` : t === 'pick_tickets' ? `Pick Tickets (${count})` : `Shipments (${count || 0})`;
          return <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{label}</button>;
        })}
      </div>
      {tab === 'overview' && <FieldGrid record={record} fields={overviewFields} />}
      {tab === 'items' && <OrderItemsTable items={childData?.items || []} />}
      {tab === 'invoices' && <RelatedInvoicesTable invoices={childData?.invoices || []} />}
      {tab === 'pick_tickets' && <RelatedPickTicketsTable pickTickets={childData?.pick_tickets || []} />}
      {tab === 'shipments' && <RelatedShipmentsTable shipments={childData?.shipments || []} />}
    </div>
  );
}

function InvoiceDetail({ entry }: { entry: any }) {
  const { record, childData } = entry;
  const tabs = ['overview', 'items', 'pick_tickets', 'shipments'];
  const [tab, setTab] = __useState('overview');

  const overviewFields = [
    { key: 'invoice_number', label: 'Invoice #' },
    { key: 'apparel_magic_order_id', label: 'Order #', link: { type: 'order' as EntityType } },
    { key: 'apparel_magic_customer_id', label: 'Customer ID', link: { type: 'customer' as EntityType } },
    { key: 'pick_ticket_id', label: 'Pick Ticket', link: { type: 'pick_ticket' as EntityType } },
    { key: 'invoice_date', label: 'Date' }, { key: 'due_date', label: 'Due Date' }, { key: 'payment_status', label: 'Payment' },
    { key: 'total_amount', label: 'Total' }, { key: 'amount_paid', label: 'Paid' }, { key: 'balance_due', label: 'Balance' },
    { key: 'qty', label: 'Qty' }, { key: 'season', label: 'Season' }, { key: 'salesperson', label: 'Salesperson' },
    { key: 'customer_po', label: 'Customer PO' }, { key: 'warehouse_id', label: 'Warehouse' },
  ];

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {tabs.map(t => {
          const count = t === 'items' ? childData?.items?.length : t === 'pick_tickets' ? childData?.pick_tickets?.length : t === 'shipments' ? childData?.shipments?.length : 0;
          const label = t === 'overview' ? 'Overview' : t === 'items' ? `Items (${count})` : t === 'pick_tickets' ? `Pick Tickets (${count})` : `Shipments (${count || 0})`;
          return <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{label}</button>;
        })}
      </div>
      {tab === 'overview' && <FieldGrid record={record} fields={overviewFields} />}
      {tab === 'items' && <InvoiceItemsTable items={childData?.items || []} />}
      {tab === 'pick_tickets' && <RelatedPickTicketsTable pickTickets={childData?.pick_tickets || []} />}
      {tab === 'shipments' && <RelatedShipmentsTable shipments={childData?.shipments || []} />}
    </div>
  );
}

function PickTicketDetail({ entry }: { entry: any }) {
  const { record, childData } = entry;
  const tabs = ['overview', 'items', 'shipments'];
  const [tab, setTab] = __useState('overview');

  const overviewFields = [
    { key: 'pick_ticket_id', label: 'PT #' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'apparel_magic_order_id', label: 'Order #', link: { type: 'order' as EntityType } },
    { key: 'invoice_id', label: 'Invoice #', link: { type: 'invoice' as EntityType } },
    { key: 'pick_ticket_date', label: 'Date' }, { key: 'date_due', label: 'Due Date' },
    { key: 'qty', label: 'Qty' }, { key: 'total_amount', label: 'Total' },
    { key: 'wms_status', label: 'WMS Status' }, { key: 'carton_status', label: 'Carton Status' },
    { key: 'is_void', label: 'Void' }, { key: 'salesperson', label: 'Salesperson' },
    { key: 'warehouse_id', label: 'Warehouse' }, { key: 'customer_po', label: 'Customer PO' },
  ];

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {tabs.map(t => {
          const count = t === 'items' ? childData?.items?.length : t === 'shipments' ? childData?.shipments?.length : 0;
          const label = t === 'overview' ? 'Overview' : t === 'items' ? `Items (${count})` : `Shipments (${count || 0})`;
          return <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{label}</button>;
        })}
      </div>
      {tab === 'overview' && <FieldGrid record={record} fields={overviewFields} />}
      {tab === 'items' && <PTItemsTable items={childData?.items || []} />}
      {tab === 'shipments' && <RelatedShipmentsTable shipments={childData?.shipments || []} />}
    </div>
  );
}

function ShipmentDetail({ entry }: { entry: any }) {
  const { record, childData } = entry;
  const [tab, setTab] = __useState('overview');

  const overviewFields = [
    { key: 'am_shipment_id', label: 'Shipment #' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'am_invoice_id', label: 'Invoice #', link: { type: 'invoice' as EntityType } },
    { key: 'selected_pick_ticket_ids', label: 'Pick Ticket' },
    { key: 'ship_date', label: 'Ship Date' }, { key: 'shipment_status', label: 'Status' },
    { key: 'tracking_number', label: 'Tracking' }, { key: 'carrier_name', label: 'Carrier' },
    { key: 'ship_via', label: 'Ship Via' }, { key: 'qty', label: 'Qty' },
    { key: 'qty_boxes', label: 'Boxes' }, { key: 'weight', label: 'Weight' },
    { key: 'ship_to_name', label: 'Ship To' }, { key: 'ship_to_city', label: 'City' },
    { key: 'ship_to_state', label: 'State' }, { key: 'warehouse_id', label: 'Warehouse' },
  ];

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        <button onClick={() => setTab('overview')} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${tab === 'overview' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Overview</button>
        <button onClick={() => setTab('boxes')} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${tab === 'boxes' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Boxes ({childData?.boxes?.length || 0})</button>
      </div>
      {tab === 'overview' && <FieldGrid record={record} fields={overviewFields} />}
      {tab === 'boxes' && (
        <div>{(childData?.boxes || []).length === 0 ? <p className="text-gray-400 text-center py-8">No box data</p> : (childData.boxes.map((box: any, i: number) => (
          <div key={i} className="border border-gray-200 rounded-lg p-3 mb-3">
            <div className="flex justify-between text-sm"><span className="font-medium">Box #{box.box_number || i + 1}</span><span className="text-gray-500">Qty: {box.qty || 0} · {box.weight || 0} lbs</span></div>
            {box.tracking_number && <p className="text-xs text-blue-600 mt-1">{box.tracking_number}</p>}
          </div>
        )))}
      </div>
      )}
    </div>
  );
}

// ── Related entity tables with clickable links ──

function RelatedOrdersTable({ orders }: { orders: any[] }) {
  const { open } = useDrawer();
  if (!orders.length) return <p className="text-gray-400 text-center py-8">No orders</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-gray-50 border-b border-gray-200">
        <th className="px-3 py-2 text-left font-medium text-gray-500">Order #</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Total</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Season</th>
      </tr></thead>
      <tbody>{orders.map((o, i) => (
        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => open('order', o.order_number)}>
          <td className="px-3 py-2 font-medium text-brand-600 hover:underline">{o.order_number}</td>
          <td className="px-3 py-2">{o.order_date || '-'}</td>
          <td className="px-3 py-2 text-right">{fmt('total_amount', o.total_amount)}</td>
          <td className="px-3 py-2 text-right">{o.qty || 0}</td>
          <td className="px-3 py-2"><StatusBadge value={o.order_status} type="order" /></td>
          <td className="px-3 py-2 text-gray-500">{o.season || '-'}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function RelatedInvoicesTable({ invoices }: { invoices: any[] }) {
  const { open } = useDrawer();
  if (!invoices.length) return <p className="text-gray-400 text-center py-8">No invoices</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-gray-50 border-b border-gray-200">
        <th className="px-3 py-2 text-left font-medium text-gray-500">Invoice #</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Total</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Balance</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Payment</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Season</th>
      </tr></thead>
      <tbody>{invoices.map((inv, i) => (
        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => open('invoice', inv.invoice_number)}>
          <td className="px-3 py-2 font-medium text-brand-600 hover:underline">{inv.invoice_number}</td>
          <td className="px-3 py-2">{inv.invoice_date || '-'}</td>
          <td className="px-3 py-2 text-right">{fmt('total_amount', inv.total_amount)}</td>
          <td className="px-3 py-2 text-right">{fmt('balance_due', inv.balance_due)}</td>
          <td className="px-3 py-2"><StatusBadge value={inv.payment_status} type="payment" /></td>
          <td className="px-3 py-2 text-gray-500">{inv.season || '-'}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function RelatedPickTicketsTable({ pickTickets }: { pickTickets: any[] }) {
  const { open } = useDrawer();
  if (!pickTickets.length) return <p className="text-gray-400 text-center py-8">No pick tickets</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-gray-50 border-b border-gray-200">
        <th className="px-3 py-2 text-left font-medium text-gray-500">PT #</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Total</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">WMS</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Carton</th>
      </tr></thead>
      <tbody>{pickTickets.map((pt, i) => (
        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => open('pick_ticket', pt.pick_ticket_id)}>
          <td className="px-3 py-2 font-medium text-brand-600 hover:underline">PT-{pt.pick_ticket_id}</td>
          <td className="px-3 py-2">{pt.pick_ticket_date || '-'}</td>
          <td className="px-3 py-2 text-right">{pt.qty || 0}</td>
          <td className="px-3 py-2 text-right">{fmt('total_amount', pt.total_amount)}</td>
          <td className="px-3 py-2"><StatusBadge value={pt.wms_status} type="wms" /></td>
          <td className="px-3 py-2 text-gray-500">{pt.carton_status || '-'}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function RelatedShipmentsTable({ shipments }: { shipments: any[] }) {
  const { open } = useDrawer();
  if (!shipments.length) return <p className="text-gray-400 text-center py-8">No shipments</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-gray-50 border-b border-gray-200">
        <th className="px-3 py-2 text-left font-medium text-gray-500">Shipment</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Boxes</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Carrier</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Tracking</th>
      </tr></thead>
      <tbody>{shipments.map((s, i) => (
        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => open('shipment', s.am_shipment_id || s.shipstation_id)}>
          <td className="px-3 py-2 font-medium text-brand-600 hover:underline">{s.am_shipment_id || s.shipstation_id || '-'}</td>
          <td className="px-3 py-2">{s.ship_date || '-'}</td>
          <td className="px-3 py-2 text-right">{s.qty || 0}</td>
          <td className="px-3 py-2 text-right">{s.qty_boxes || 0}</td>
          <td className="px-3 py-2 text-gray-500">{s.carrier_name || '-'}</td>
          <td className="px-3 py-2">{s.tracking_number ? <span className="text-blue-600 text-xs">{s.tracking_number}</span> : '-'}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

// ── Item tables with CLICKABLE style numbers → navigates to Products page ──

function OrderItemsTable({ items }: { items: any[] }) {
  if (!items.length) return <p className="text-gray-400 text-center py-8">No items</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-gray-50 border-b border-gray-200">
        <th className="px-3 py-2 text-left font-medium text-gray-500">Style</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Color</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Size</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Shipped</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Open</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Price</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Amount</th>
      </tr></thead>
      <tbody>{items.map((item, i) => (
        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
          <td className="px-3 py-2"><StyleLink styleNumber={item.style_number} /></td>
          <td className="px-3 py-2">{item.color || item.attr_2 || '-'}</td>
          <td className="px-3 py-2">{item.size || '-'}</td>
          <td className="px-3 py-2 text-right">{item.quantity_ordered || item.qty || 0}</td>
          <td className="px-3 py-2 text-right">{item.quantity_shipped || item.qty_shipped_am || 0}</td>
          <td className="px-3 py-2 text-right">{item.qty_open || 0}</td>
          <td className="px-3 py-2 text-right">${(item.unit_price || 0).toFixed(2)}</td>
          <td className="px-3 py-2 text-right">${(item.line_total || item.amount || 0).toFixed(2)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function InvoiceItemsTable({ items }: { items: any[] }) {
  if (!items.length) return <p className="text-gray-400 text-center py-8">No items</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-gray-50 border-b border-gray-200">
        <th className="px-3 py-2 text-left font-medium text-gray-500">Style</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Description</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Color</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Size</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Price</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Amount</th>
      </tr></thead>
      <tbody>{items.map((item, i) => (
        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
          <td className="px-3 py-2"><StyleLink styleNumber={item.style_number} /></td>
          <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{item.description || '-'}</td>
          <td className="px-3 py-2">{item.attr_2 || '-'}</td>
          <td className="px-3 py-2">{item.size || '-'}</td>
          <td className="px-3 py-2 text-right">{item.qty || 0}</td>
          <td className="px-3 py-2 text-right">${(item.unit_price || 0).toFixed(2)}</td>
          <td className="px-3 py-2 text-right">${(item.amount || 0).toFixed(2)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function PTItemsTable({ items }: { items: any[] }) {
  if (!items.length) return <p className="text-gray-400 text-center py-8">No items</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-gray-50 border-b border-gray-200">
        <th className="px-3 py-2 text-left font-medium text-gray-500">Style</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Description</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Color</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Size</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Location</th>
        <th className="px-3 py-2 text-left font-medium text-gray-500">Bin Location</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Price</th>
        <th className="px-3 py-2 text-right font-medium text-gray-500">Amount</th>
      </tr></thead>
      <tbody>{items.map((item, i) => (
        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
          <td className="px-3 py-2"><StyleLink styleNumber={item.style_number} /></td>
          <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{item.description || '-'}</td>
          <td className="px-3 py-2">{item.attr_2 || '-'}</td>
          <td className="px-3 py-2">{item.size || '-'}</td>
          <td className="px-3 py-2 font-medium text-gray-700">{item.location || '-'}</td>
          <td className="px-3 py-2 text-gray-600">{item.bin_location || '-'}</td>
          <td className="px-3 py-2 text-right">{item.qty || 0}</td>
          <td className="px-3 py-2 text-right">${(item.unit_price || 0).toFixed(2)}</td>
          <td className="px-3 py-2 text-right">${(item.amount || 0).toFixed(2)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

// useState wrapper to use inside non-component functions
import { useState } from 'react';
const __useState = useState;

// ── Entity title helpers ──
function getEntityTitle(entry: any): { title: string; subtitle: string } {
  const { type, record } = entry;
  switch (type) {
    case 'customer': return { title: record.customer_name || 'Customer', subtitle: [record.email, record.phone].filter(Boolean).join(' · ') || record.am_customer_id || '' };
    case 'order': return { title: `Order #${record.order_number}`, subtitle: record.customer_name || '' };
    case 'invoice': return { title: `Invoice #${record.invoice_number}`, subtitle: `Order #${record.apparel_magic_order_id || '-'}` };
    case 'pick_ticket': return { title: `Pick Ticket PT-${record.pick_ticket_id}`, subtitle: record.customer_name || '' };
    case 'shipment': return { title: `Shipment ${record.am_shipment_id || record.shipstation_id}`, subtitle: record.customer_name || '' };
    default: return { title: 'Record', subtitle: '' };
  }
}

function getEntityIcon(type: EntityType): string {
  switch (type) {
    case 'customer': return '👤';
    case 'order': return '📋';
    case 'invoice': return '💰';
    case 'pick_ticket': return '📦';
    case 'shipment': return '🚚';
  }
}

// ── Main RecordDrawer component ──
export default function RecordDrawer() {
  const { stack, current, close, goBack } = useDrawer();

  if (!current) return null;

  const { title, subtitle } = getEntityTitle(current);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={close}>
      <div className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-start gap-3">
              {stack.length > 1 && (
                <button onClick={goBack} className="mt-1 text-gray-400 hover:text-gray-600 flex items-center gap-1 text-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                  Back
                </button>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{getEntityIcon(current.type)}</span>
                  <h2 className="text-xl font-bold text-gray-900">{title}</h2>
                </div>
                {subtitle && <p className="text-gray-500 mt-0.5">{subtitle}</p>}
                {stack.length > 1 && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                    {stack.map((entry, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span>›</span>}
                        <span>{getEntityIcon(entry.type)} {getEntityTitle(entry).title}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">{(current.type === 'order' || current.type === 'invoice' || current.type === 'pick_ticket' || current.type === 'shipment') && (<PrintButton entityType={current.type as any} onDownload={() => { const r = current.record; const c = current.childData; if (current.type === 'order') generateOrderPDF(r, c?.items || [], 'download', []); else if (current.type === 'invoice') generateInvoicePDF(r, c?.items || [], 'download', []); else if (current.type === 'pick_ticket') generatePickTicketPDF(r, c?.items || [], 'download', []); else if (current.type === 'shipment') generateShipmentPDF(r, c?.boxes || [], 'download', []); }} onPrint={() => { const r = current.record; const c = current.childData; if (current.type === 'order') generateOrderPDF(r, c?.items || [], 'print', []); else if (current.type === 'invoice') generateInvoicePDF(r, c?.items || [], 'print', []); else if (current.type === 'pick_ticket') generatePickTicketPDF(r, c?.items || [], 'print', []); else if (current.type === 'shipment') generateShipmentPDF(r, c?.boxes || [], 'print', []); }} />)}<button onClick={close} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button></div>
          </div>

          {/* Detail content */}
          {current.type === 'customer' && <CustomerDetail entry={current} />}
          {current.type === 'order' && <OrderDetail entry={current} />}
          {current.type === 'invoice' && <InvoiceDetail entry={current} />}
          {current.type === 'pick_ticket' && <PickTicketDetail entry={current} />}
          {current.type === 'shipment' && <ShipmentDetail entry={current} />}
        </div>
      </div>
    </div>
  );
}
