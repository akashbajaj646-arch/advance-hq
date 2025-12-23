'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Order {
  id: string;
  order_number: string;
  apparel_magic_customer_id: string;
  ship_to_name: string | null;
  order_date: string | null;
  order_status: string | null;
  total_amount: number | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
}

interface OrderItem {
  id: string;
  style_number: string;
  color: string | null;
  size: string | null;
  quantity_ordered: number;
  quantity_shipped: number;
  unit_price: number;
  line_total: number;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    const debounce = setTimeout(() => {
      loadOrders();
    }, 300);
    return () => clearTimeout(debounce);
  }, [search]);

  async function loadOrders() {
    setLoading(true);
    let query = supabase
      .from('orders')
      .select('id, order_number, apparel_magic_customer_id, ship_to_name, order_date, order_status, total_amount, ship_to_city, ship_to_state')
      .order('order_date', { ascending: false })
      .limit(50);

    if (search) {
      query = query.or(`order_number.ilike.%${search}%,ship_to_name.ilike.%${search}%,po_number.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (!error) {
      setOrders(data || []);
    }
    setLoading(false);
  }

  async function selectOrder(order: Order) {
    setSelectedOrder(order);
    setLoadingDetails(true);

    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .eq('apparel_magic_order_id', order.order_number)
      .order('style_number', { ascending: true });

    setOrderItems(items || []);

    // Get pick tickets for this order
    const { data: pickTicketsData } = await supabase
      .from('pick_tickets')
      .select('pick_ticket_id')
      .eq('apparel_magic_order_id', order.order_number);

    // Get shipments for those pick tickets (ShipStation uses AM-PT- prefix)
    if (pickTicketsData && pickTicketsData.length > 0) {
      const ptIds = pickTicketsData.map(pt => `AM-PT-${pt.pick_ticket_id}`);
      const { data: shipmentData } = await supabase
        .from('shipments')
        .select('*')
        .in('pick_ticket_id', ptIds);
      setShipments(shipmentData || []);
    } else {
      setShipments([]);
    }

    setLoadingDetails(false);
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
        <p className="text-gray-500 mt-1">View and search orders</p>
      </div>

      <div className="flex gap-6">
        <div className="w-1/2">
          <div className="card">
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search by order #, customer, or PO..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input"
              />
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {loading ? (
                <div className="text-center py-8 text-gray-500">Loading...</div>
              ) : orders.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No orders found</div>
              ) : (
                orders.map((order) => (
                  <button
                    key={order.id}
                    onClick={() => selectOrder(order)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedOrder?.id === order.id
                        ? 'bg-brand-50 border border-brand-200'
                        : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">Order #{order.order_number}</p>
                        <p className="text-sm text-gray-500">{order.ship_to_name || 'N/A'}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-gray-900">
                          ${parseFloat(String(order.total_amount || 0)).toFixed(2)}
                        </p>
                        <span className={`badge ${
                          order.order_status === 'shipped' ? 'badge-green' : 
                          order.order_status === 'cancelled' ? 'badge-red' : 'badge-yellow'
                        }`}>
                          {order.order_status || 'open'}
                        </span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="w-1/2">
          {selectedOrder ? (
            <div className="space-y-6">
              <div className="card">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Order #{selectedOrder.order_number}</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Customer</p>
                    <p className="font-medium">{selectedOrder.ship_to_name || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Order Date</p>
                    <p className="font-medium">
                      {selectedOrder.order_date ? new Date(selectedOrder.order_date).toLocaleDateString() : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Ship To</p>
                    <p className="font-medium">
                      {selectedOrder.ship_to_city && selectedOrder.ship_to_state
                        ? `${selectedOrder.ship_to_city}, ${selectedOrder.ship_to_state}`
                        : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Total</p>
                    <p className="font-medium text-lg">
                      ${parseFloat(String(selectedOrder.total_amount || 0)).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>

              {shipments.length > 0 && (
                <div className="card">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Shipments</h3>
                  <div className="space-y-3">
                    {shipments.map((shipment) => (
                      <div key={shipment.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                        <div>
                          <p className="font-medium text-gray-900">{shipment.tracking_number}</p>
                          <p className="text-sm text-gray-500">{shipment.carrier_name}</p>
                        </div>
                        <div className="text-right">
                          {shipment.tracking_url ? (
                            <a
                              href={shipment.tracking_url}
                              target="_blank"
                              className="text-brand-600 hover:text-brand-700 text-sm font-medium"
                            >
                              Track Package →
                            </a>
                          ) : (
                            <span className="text-gray-500 text-sm">No tracking URL</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Items</h3>
                {loadingDetails ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : orderItems.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">No items found</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="table-header pb-2">Style</th>
                          <th className="table-header pb-2">Color</th>
                          <th className="table-header pb-2">Size</th>
                          <th className="table-header pb-2 text-right">Qty</th>
                          <th className="table-header pb-2 text-right">Price</th>
                          <th className="table-header pb-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderItems.map((item) => (
                          <tr key={item.id} className="border-b border-gray-100">
                            <td className="table-cell font-medium">{item.style_number}</td>
                            <td className="table-cell">{item.color || '-'}</td>
                            <td className="table-cell">{item.size || '-'}</td>
                            <td className="table-cell text-right">{item.quantity_ordered}</td>
                            <td className="table-cell text-right">${parseFloat(String(item.unit_price || 0)).toFixed(2)}</td>
                            <td className="table-cell text-right font-medium">${parseFloat(String(item.line_total || 0)).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card h-full flex items-center justify-center">
              <p className="text-gray-500">Select an order to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
