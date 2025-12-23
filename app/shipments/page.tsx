'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Shipment {
  id: string;
  tracking_number: string | null;
  carrier_name: string | null;
  carrier_code: string | null;
  pick_ticket_id: string | null;
  ship_date: string | null;
  ship_to_name: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  tracking_url: string | null;
  shipment_status: string | null;
}

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadShipments();
  }, []);

  useEffect(() => {
    const debounce = setTimeout(() => {
      loadShipments();
    }, 300);
    return () => clearTimeout(debounce);
  }, [search]);

  async function loadShipments() {
    setLoading(true);
    let query = supabase
      .from('shipments')
      .select('*')
      .order('ship_date', { ascending: false })
      .limit(100);

    if (search) {
      query = query.or(`tracking_number.ilike.%${search}%,pick_ticket_id.ilike.%${search}%,ship_to_name.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (!error) {
      setShipments(data || []);
    }
    setLoading(false);
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Shipments</h1>
        <p className="text-gray-500 mt-1">Track shipments from ShipStation</p>
      </div>

      <div className="card">
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search by tracking #, pick ticket #, or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input max-w-md"
          />
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : shipments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No shipments found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="table-header pb-3">Tracking #</th>
                  <th className="table-header pb-3">Carrier</th>
                  <th className="table-header pb-3">Pick Ticket #</th>
                  <th className="table-header pb-3">Ship To</th>
                  <th className="table-header pb-3">Ship Date</th>
                  <th className="table-header pb-3">Status</th>
                  <th className="table-header pb-3"></th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((shipment) => (
                  <tr key={shipment.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="table-cell">
                      <p className="font-medium text-gray-900">{shipment.tracking_number || 'N/A'}</p>
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${
                        shipment.carrier_code === 'ups' ? 'badge-yellow' :
                        shipment.carrier_code === 'fedex' ? 'badge-blue' :
                        shipment.carrier_code === 'usps' ? 'badge-green' : 'badge-gray'
                      }`}>
                        {shipment.carrier_name || shipment.carrier_code || 'Unknown'}
                      </span>
                    </td>
                    <td className="table-cell">{shipment.pick_ticket_id || 'N/A'}</td>
                    <td className="table-cell">
                      <p>{shipment.ship_to_name || 'N/A'}</p>
                      <p className="text-xs text-gray-500">
                        {shipment.ship_to_city && shipment.ship_to_state 
                          ? `${shipment.ship_to_city}, ${shipment.ship_to_state}` 
                          : ''}
                      </p>
                    </td>
                    <td className="table-cell">
                      {shipment.ship_date 
                        ? new Date(shipment.ship_date).toLocaleDateString() 
                        : 'N/A'}
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${
                        shipment.shipment_status === 'delivered' ? 'badge-green' :
                        shipment.shipment_status === 'shipped' ? 'badge-blue' :
                        shipment.shipment_status === 'voided' ? 'badge-red' : 'badge-gray'
                      }`}>
                        {shipment.shipment_status || 'unknown'}
                      </span>
                    </td>
                    <td className="table-cell text-right">
                      {shipment.tracking_url ? (
                        <a
                          href={shipment.tracking_url}
                          target="_blank"
                          className="text-brand-600 hover:text-brand-700 text-sm font-medium"
                        >
                          Track →
                        </a>
                      ) : (
                        <span className="text-gray-400 text-sm">No link</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
