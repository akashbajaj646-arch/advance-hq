'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface PickTicket {
  id: string;
  pick_ticket_id: string;
  apparel_magic_order_id: string;
  tracking_number: string | null;
  ship_via: string | null;
  ship_to_name: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  pick_ticket_date: string | null;
  total_amount: number | null;
  is_void: boolean;
}

export default function PickTicketsPage() {
  const [pickTickets, setPickTickets] = useState<PickTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadPickTickets();
  }, []);

  useEffect(() => {
    const debounce = setTimeout(() => {
      loadPickTickets();
    }, 300);
    return () => clearTimeout(debounce);
  }, [search]);

  async function loadPickTickets() {
    setLoading(true);
    let query = supabase
      .from('pick_tickets')
      .select('*')
      .order('pick_ticket_date', { ascending: false })
      .limit(100);

    if (search) {
      query = query.or(`pick_ticket_id.ilike.%${search}%,apparel_magic_order_id.ilike.%${search}%,tracking_number.ilike.%${search}%,ship_to_name.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (!error) {
      setPickTickets(data || []);
    }
    setLoading(false);
  }

  // Find tracking URL based on tracking number pattern
  function getTrackingUrl(trackingNumber: string | null): string | null {
    if (!trackingNumber) return null;
    
    if (trackingNumber.startsWith('1Z')) {
      return `https://www.ups.com/track?tracknum=${trackingNumber}`;
    } else if (trackingNumber.match(/^\d{12,22}$/)) {
      return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
    } else if (trackingNumber.match(/^\d{20,22}$/) || trackingNumber.startsWith('94')) {
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
    }
    return null;
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pick Tickets</h1>
        <p className="text-gray-500 mt-1">View pick tickets and tracking numbers</p>
      </div>

      <div className="card">
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search by PT #, order #, tracking #, or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input max-w-md"
          />
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : pickTickets.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No pick tickets found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="table-header pb-3">Pick Ticket #</th>
                  <th className="table-header pb-3">Order #</th>
                  <th className="table-header pb-3">Ship To</th>
                  <th className="table-header pb-3">Date</th>
                  <th className="table-header pb-3">Tracking #</th>
                  <th className="table-header pb-3 text-right">Amount</th>
                  <th className="table-header pb-3">Status</th>
                  <th className="table-header pb-3"></th>
                </tr>
              </thead>
              <tbody>
                {pickTickets.map((pt) => {
                  const trackingUrl = getTrackingUrl(pt.tracking_number);
                  return (
                    <tr key={pt.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="table-cell font-medium">AM-PT-{pt.pick_ticket_id}</td>
                      <td className="table-cell">{pt.apparel_magic_order_id || 'N/A'}</td>
                      <td className="table-cell">
                        <p>{pt.ship_to_name || 'N/A'}</p>
                        <p className="text-xs text-gray-500">
                          {pt.ship_to_city && pt.ship_to_state 
                            ? `${pt.ship_to_city}, ${pt.ship_to_state}` 
                            : ''}
                        </p>
                      </td>
                      <td className="table-cell">
                        {pt.pick_ticket_date 
                          ? new Date(pt.pick_ticket_date).toLocaleDateString() 
                          : 'N/A'}
                      </td>
                      <td className="table-cell">
                        <p className="font-mono text-sm">{pt.tracking_number || '-'}</p>
                      </td>
                      <td className="table-cell text-right">
                        ${parseFloat(String(pt.total_amount || 0)).toFixed(2)}
                      </td>
                      <td className="table-cell">
                        <span className={`badge ${pt.is_void ? 'badge-red' : pt.tracking_number ? 'badge-green' : 'badge-yellow'}`}>
                          {pt.is_void ? 'Void' : pt.tracking_number ? 'Shipped' : 'Pending'}
                        </span>
                      </td>
                      <td className="table-cell text-right">
                        {trackingUrl ? (
                          <a
                            href={trackingUrl}
                            target="_blank"
                            className="text-brand-600 hover:text-brand-700 text-sm font-medium"
                          >
                            Track →
                          </a>
                        ) : pt.tracking_number ? (
                          <span className="text-gray-400 text-sm">No link</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
