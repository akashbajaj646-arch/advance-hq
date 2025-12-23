'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Customer {
  id: string;
  am_customer_id: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  is_active: boolean;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerOrders, setCustomerOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  useEffect(() => {
    loadCustomers();
  }, []);

  useEffect(() => {
    const debounce = setTimeout(() => {
      loadCustomers();
    }, 300);
    return () => clearTimeout(debounce);
  }, [search]);

  async function loadCustomers() {
    setLoading(true);
    let query = supabase
      .from('customers')
      .select('id, am_customer_id, customer_name, email, phone, city, state, is_active')
      .order('customer_name', { ascending: true })
      .limit(50);

    if (search) {
      query = query.or(`customer_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (!error) {
      setCustomers(data || []);
    }
    setLoading(false);
  }

  async function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setLoadingOrders(true);

    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .eq('apparel_magic_customer_id', customer.am_customer_id)
      .order('order_date', { ascending: false })
      .limit(20);

    setCustomerOrders(orders || []);
    setLoadingOrders(false);
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        <p className="text-gray-500 mt-1">Search and view customer details</p>
      </div>

      <div className="flex gap-6">
        <div className="w-1/2">
          <div className="card">
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search by name, email, or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input"
              />
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {loading ? (
                <div className="text-center py-8 text-gray-500">Loading...</div>
              ) : customers.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No customers found</div>
              ) : (
                customers.map((customer) => (
                  <button
                    key={customer.id}
                    onClick={() => selectCustomer(customer)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedCustomer?.id === customer.id
                        ? 'bg-brand-50 border border-brand-200'
                        : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{customer.customer_name}</p>
                        <p className="text-sm text-gray-500">
                          {customer.city && customer.state ? `${customer.city}, ${customer.state}` : 'No location'}
                        </p>
                      </div>
                      <span className={`badge ${customer.is_active ? 'badge-green' : 'badge-gray'}`}>
                        {customer.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="w-1/2">
          {selectedCustomer ? (
            <div className="space-y-6">
              <div className="card">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">{selectedCustomer.customer_name}</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Email</p>
                    <p className="font-medium">{selectedCustomer.email || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Phone</p>
                    <p className="font-medium">{selectedCustomer.phone || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Location</p>
                    <p className="font-medium">
                      {selectedCustomer.city && selectedCustomer.state
                        ? `${selectedCustomer.city}, ${selectedCustomer.state}`
                        : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Customer ID</p>
                    <p className="font-medium">{selectedCustomer.am_customer_id}</p>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Order History</h3>
                {loadingOrders ? (
                  <div className="text-center py-4 text-gray-500">Loading orders...</div>
                ) : customerOrders.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">No orders found</div>
                ) : (
                  <div className="space-y-3">
                    {customerOrders.map((order) => (
                      <div key={order.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                        <div>
                          <p className="font-medium text-gray-900">Order #{order.order_number}</p>
                          <p className="text-sm text-gray-500">
                            {order.order_date ? new Date(order.order_date).toLocaleDateString() : 'N/A'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-gray-900">
                            ${parseFloat(order.total_amount || 0).toFixed(2)}
                          </p>
                          <span className={`badge ${order.order_status === 'shipped' ? 'badge-green' : 'badge-yellow'}`}>
                            {order.order_status || 'open'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card h-full flex items-center justify-center">
              <p className="text-gray-500">Select a customer to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
