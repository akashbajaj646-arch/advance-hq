'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Invoice {
  id: string;
  invoice_number: string;
  apparel_magic_customer_id: string;
  apparel_magic_order_id: string;
  invoice_date: string | null;
  due_date: string | null;
  total_amount: number | null;
  amount_paid: number | null;
  balance_due: number | null;
  payment_status: string | null;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'partial' | 'paid'>('all');

  useEffect(() => {
    loadInvoices();
  }, [filter]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      loadInvoices();
    }, 300);
    return () => clearTimeout(debounce);
  }, [search]);

  async function loadInvoices() {
    setLoading(true);
    let query = supabase
      .from('invoices')
      .select('*')
      .order('invoice_date', { ascending: false })
      .limit(100);

    if (search) {
      query = query.or(`invoice_number.ilike.%${search}%,apparel_magic_order_id.ilike.%${search}%`);
    }

    if (filter !== 'all') {
      query = query.eq('payment_status', filter);
    }

    const { data, error } = await query;
    if (!error) {
      setInvoices(data || []);
    }
    setLoading(false);
  }

  // Calculate totals
  const totalUnpaid = invoices
    .filter(i => i.payment_status !== 'paid')
    .reduce((sum, i) => sum + (parseFloat(String(i.balance_due)) || 0), 0);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <p className="text-gray-500 mt-1">View and manage invoices</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <button
          onClick={() => setFilter('all')}
          className={`stat-card text-left ${filter === 'all' ? 'ring-2 ring-brand-500' : ''}`}
        >
          <p className="stat-label">All Invoices</p>
          <p className="stat-value text-2xl">{invoices.length}</p>
        </button>
        <button
          onClick={() => setFilter('unpaid')}
          className={`stat-card text-left ${filter === 'unpaid' ? 'ring-2 ring-red-500' : ''}`}
        >
          <p className="stat-label">Unpaid</p>
          <p className="stat-value text-2xl text-red-600">
            {invoices.filter(i => i.payment_status === 'unpaid').length}
          </p>
        </button>
        <button
          onClick={() => setFilter('partial')}
          className={`stat-card text-left ${filter === 'partial' ? 'ring-2 ring-yellow-500' : ''}`}
        >
          <p className="stat-label">Partial</p>
          <p className="stat-value text-2xl text-yellow-600">
            {invoices.filter(i => i.payment_status === 'partial').length}
          </p>
        </button>
        <button
          onClick={() => setFilter('paid')}
          className={`stat-card text-left ${filter === 'paid' ? 'ring-2 ring-green-500' : ''}`}
        >
          <p className="stat-label">Paid</p>
          <p className="stat-value text-2xl text-green-600">
            {invoices.filter(i => i.payment_status === 'paid').length}
          </p>
        </button>
      </div>

      <div className="card">
        {/* Search and Filter */}
        <div className="flex gap-4 mb-6">
          <input
            type="text"
            placeholder="Search by invoice # or order #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input max-w-md"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="input w-40"
          >
            <option value="all">All Status</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
          </select>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No invoices found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="table-header pb-3">Invoice #</th>
                  <th className="table-header pb-3">Order #</th>
                  <th className="table-header pb-3">Date</th>
                  <th className="table-header pb-3">Due Date</th>
                  <th className="table-header pb-3 text-right">Total</th>
                  <th className="table-header pb-3 text-right">Paid</th>
                  <th className="table-header pb-3 text-right">Balance</th>
                  <th className="table-header pb-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const isOverdue = invoice.due_date && 
                    new Date(invoice.due_date) < new Date() && 
                    invoice.payment_status !== 'paid';
                  
                  return (
                    <tr key={invoice.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="table-cell font-medium">{invoice.invoice_number}</td>
                      <td className="table-cell">{invoice.apparel_magic_order_id || 'N/A'}</td>
                      <td className="table-cell">
                        {invoice.invoice_date 
                          ? new Date(invoice.invoice_date).toLocaleDateString() 
                          : 'N/A'}
                      </td>
                      <td className={`table-cell ${isOverdue ? 'text-red-600 font-medium' : ''}`}>
                        {invoice.due_date 
                          ? new Date(invoice.due_date).toLocaleDateString() 
                          : 'N/A'}
                        {isOverdue && <span className="ml-1">⚠️</span>}
                      </td>
                      <td className="table-cell text-right">
                        ${parseFloat(String(invoice.total_amount || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="table-cell text-right text-green-600">
                        ${parseFloat(String(invoice.amount_paid || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="table-cell text-right font-medium">
                        <span className={parseFloat(String(invoice.balance_due || 0)) > 0 ? 'text-red-600' : 'text-green-600'}>
                          ${parseFloat(String(invoice.balance_due || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="table-cell">
                        <span className={`badge ${
                          invoice.payment_status === 'paid' ? 'badge-green' :
                          invoice.payment_status === 'partial' ? 'badge-yellow' :
                          'badge-red'
                        }`}>
                          {invoice.payment_status || 'unpaid'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50">
                  <td colSpan={6} className="table-cell font-semibold text-right">
                    Total Outstanding:
                  </td>
                  <td className="table-cell text-right font-bold text-red-600">
                    ${totalUnpaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
