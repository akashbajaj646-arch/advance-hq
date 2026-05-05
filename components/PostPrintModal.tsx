'use client';

/**
 * PostPrintModal
 *
 * Shown after a label is successfully created. Offers buttons to:
 *   - Print packing list (uses generateShipmentPDF + shipment_boxes data)
 *   - Print invoice (uses generateInvoicePDF + invoice_items)
 *   - Done — returns to the queue
 *
 * Pulls all data fresh from /api/shipping/shipments/[id]/data so the PDFs
 * reflect what's actually in the DB after label creation, not stale UI state.
 */

import { useEffect, useState } from 'react';
import { generateShipmentPDF, generateInvoicePDF } from '@/lib/pdf-generator';

interface Props {
  shipmentId: string;
  trackingNumber: string;
  carrierName: string;
  serviceName: string;
  totalCostUsd: number;
  onDone: () => void;
}

export default function PostPrintModal({
  shipmentId,
  trackingNumber,
  carrierName,
  serviceName,
  totalCostUsd,
  onDone,
}: Props) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'packing' | 'invoice' | null>(null);

  useEffect(() => {
    fetch(`/api/shipping/shipments/${shipmentId}/data`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [shipmentId]);

  function handlePackingList() {
    if (!data?.shipment) return;
    setBusy('packing');
    try {
      generateShipmentPDF(data.shipment, data.boxes ?? [], 'print', []);
    } finally {
      setTimeout(() => setBusy(null), 800);
    }
  }

  function handleInvoice() {
    if (!data?.invoice) return;
    setBusy('invoice');
    try {
      generateInvoicePDF(data.invoice, data.invoice_items ?? [], 'print', []);
    } finally {
      setTimeout(() => setBusy(null), 800);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-lg w-full p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
            <svg
              className="w-6 h-6 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-gray-900">Label printed</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {carrierName} {serviceName} ·{' '}
              <span className="font-mono text-xs">{trackingNumber}</span>
              {totalCostUsd > 0 && ` · $${totalCostUsd.toFixed(2)}`}
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm mb-4">
            Couldn't load shipment data: {error}
          </div>
        )}

        <p className="text-sm text-gray-700 mb-4">
          Anything else you'd like to print for this shipment?
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={handlePackingList}
            disabled={!data?.shipment || busy !== null}
            className="flex flex-col items-center justify-center gap-2 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg
              className="w-6 h-6 text-gray-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
              />
            </svg>
            <span className="text-sm font-medium text-gray-900">
              {busy === 'packing' ? 'Printing…' : 'Print packing list'}
            </span>
          </button>

          <button
            onClick={handleInvoice}
            disabled={!data?.invoice || busy !== null}
            className="flex flex-col items-center justify-center gap-2 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={!data?.invoice ? 'No invoice linked to this shipment' : ''}
          >
            <svg
              className="w-6 h-6 text-gray-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"
              />
            </svg>
            <span className="text-sm font-medium text-gray-900">
              {busy === 'invoice' ? 'Printing…' : 'Print invoice'}
            </span>
            {!data?.invoice && data && (
              <span className="text-[10px] text-gray-400">No invoice linked</span>
            )}
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onDone}
            className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700"
          >
            Done — back to queue
          </button>
        </div>
      </div>
    </div>
  );
}
