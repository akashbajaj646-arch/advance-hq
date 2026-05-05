'use client';

/**
 * /shipping/ship/[ptId]
 *
 * Production packing-station UI. The shipper:
 *   1. Lands here from the queue (or "Ship this PT" on the Pick Tickets page)
 *   2. Sees the PT, customer, ship-to, items
 *   3. Reviews the validated address (with side-by-side if corrected)
 *   4. Picks/edits boxes (auto-seeded from PT's num_cartons + presets)
 *   5. Picks ship-via (auto-filled from PT.ship_via if recognized)
 *   6. Optionally clicks "Get rate" to preview cost
 *   7. Clicks "Create label & print"
 *   8. Sees post-print modal: Print packing list? Print invoice? → back to queue
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import AddressValidationCard, {
  AddressShape,
  ValidationStatus,
} from '@/components/AddressValidationCard';
import BoxBuilder, { BoxRow } from '@/components/BoxBuilder';
import PostPrintModal from '@/components/PostPrintModal';

interface PickTicketDetail {
  pick_ticket: any;
  items: any[];
  customer_location: any;
  customer_fallback: any;
  existing_shipments: any[];
}

interface Quote {
  carrier: string;
  serviceCode: string;
  serviceName: string;
  totalUsd: number;
  estimatedDays?: number;
}

interface CreateLabelResponse {
  shipment_id?: string;
  carrier?: string;
  service_code?: string;
  service_name?: string;
  total_cost_usd?: number;
  ups_shipment_digest?: string;
  easypost_shipment_id?: string;
  boxes?: { tracking_number: string; cost_usd?: number; zpl?: string; pdf_url?: string }[];
  error?: string;
}

const SHIP_VIA_OPTIONS = [
  { group: 'UPS', options: ['UPS Ground', 'UPS 2nd Day Air', 'UPS Next Day Air', 'UPS Next Day Air Saver', 'UPS 3 Day Select'] },
  { group: 'USPS', options: ['USPS Priority Mail', 'USPS Ground Advantage', 'USPS Priority Mail Express', 'USPS First Class'] },
];

/**
 * Best-effort guess at our internal ship-via name from the PT's free-form
 * ship_via string. The shipping_service_map table has the authoritative list,
 * but for the UI we just need a reasonable default.
 */
function guessShipVia(ptShipVia: string | null | undefined): string {
  if (!ptShipVia) return 'UPS Ground';
  const lower = ptShipVia.toLowerCase();
  if (lower.includes('ups') && lower.includes('ground')) return 'UPS Ground';
  if (lower.includes('ups') && lower.includes('2nd')) return 'UPS 2nd Day Air';
  if (lower.includes('ups') && lower.includes('next')) return 'UPS Next Day Air';
  if (lower.includes('ups') && lower.includes('3 day')) return 'UPS 3 Day Select';
  if (lower.includes('priority') && lower.includes('express')) return 'USPS Priority Mail Express';
  if (lower.includes('priority')) return 'USPS Priority Mail';
  if (lower.includes('ground advantage') || lower.includes('first class') || lower.includes('first-class')) {
    return 'USPS Ground Advantage';
  }
  if (lower.includes('usps')) return 'USPS Priority Mail';
  if (lower.includes('ups')) return 'UPS Ground';
  return 'UPS Ground';
}

function carrierForShipVia(shipVia: string): 'ups' | 'easypost_usps' {
  return shipVia.startsWith('USPS') ? 'easypost_usps' : 'ups';
}

export default function ShipPickTicketPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const ptId = params?.ptId as string;

  const [detail, setDetail] = useState<PickTicketDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [shipVia, setShipVia] = useState('UPS Ground');
  const [boxes, setBoxes] = useState<BoxRow[]>([]);
  const [decidedAddress, setDecidedAddress] = useState<AddressShape | null>(null);
  const [validationStatus, setValidationStatus] = useState<ValidationStatus>('pending');

  // Action state
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [createdShipment, setCreatedShipment] = useState<CreateLabelResponse | null>(null);
  const [showPostPrintModal, setShowPostPrintModal] = useState(false);

  useEffect(() => {
    void loadPT();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptId]);

  async function loadPT() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/shipping/pick-tickets/${ptId}`);
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data?.error || `HTTP ${res.status}`);
        return;
      }
      setDetail(data);
      // Initialize ship_via from the PT
      if (data.pick_ticket?.ship_via) {
        setShipVia(guessShipVia(data.pick_ticket.ship_via));
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Build the original ship-to address from the PT.
  const originalShipTo: AddressShape | null = useMemo(() => {
    if (!detail?.pick_ticket) return null;
    const pt = detail.pick_ticket;
    const phone =
      detail.customer_location?.phone ||
      detail.customer_fallback?.phone ||
      pt.ship_to_phone ||
      undefined;
    return {
      name: pt.ship_to_name || detail.customer_location?.contact_name || pt.customer_name || undefined,
      company: pt.customer_name || undefined,
      phone,
      email: detail.customer_location?.email || detail.customer_fallback?.email || undefined,
      street1: pt.ship_to_address_1 || '',
      street2: pt.ship_to_address_2 || undefined,
      city: pt.ship_to_city || '',
      state: (pt.ship_to_state || '').toUpperCase(),
      zip: pt.ship_to_zip || '',
      country: pt.ship_to_country || 'US',
    };
  }, [detail]);

  const carrier = carrierForShipVia(shipVia);

  // Reset rate quote when key inputs change
  useEffect(() => {
    setQuotes(null);
    setRateError(null);
  }, [shipVia, boxes, decidedAddress]);

  const canPrint =
    !!decidedAddress &&
    boxes.length > 0 &&
    boxes.every(
      (b) => b.weightOz > 0 && b.length > 0 && b.width > 0 && b.height > 0
    );

  async function handleGetRate() {
    if (!decidedAddress || !detail) return;
    setRateLoading(true);
    setRateError(null);
    setQuotes(null);
    try {
      const res = await fetch('/api/shipping/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouse_id: detail.pick_ticket.warehouse_id || 'leuning',
          ship_via: shipVia,
          ship_to: decidedAddress,
          boxes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRateError(data?.error || `HTTP ${res.status}`);
      } else {
        setQuotes(data.quotes || []);
      }
    } catch (e) {
      setRateError(e instanceof Error ? e.message : String(e));
    } finally {
      setRateLoading(false);
    }
  }

  async function handleCreateLabel() {
    if (!decidedAddress || !detail) return;
    setLabelLoading(true);
    setLabelError(null);
    try {
      const res = await fetch('/api/shipping/labels/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouse_id: detail.pick_ticket.warehouse_id || 'leuning',
          ship_via: shipVia,
          ship_to: decidedAddress,
          boxes,
          pick_ticket_ids: [String(detail.pick_ticket.pick_ticket_id)],
          reference: `PT-${detail.pick_ticket.pick_ticket_id}`,
          created_by_user_id: user?.id,
        }),
      });
      const data: CreateLabelResponse = await res.json();
      if (!res.ok || data.error) {
        setLabelError(data.error || `HTTP ${res.status}`);
        return;
      }
      setCreatedShipment(data);

      // Open the first label PDF or PNG in a new tab so the shipper can print
      // it physically. ZPL goes to a Labelary-rendered PNG; PDF goes direct.
      const firstBox = data.boxes?.[0];
      if (firstBox) {
        if (firstBox.pdf_url) {
          window.open(firstBox.pdf_url, '_blank');
        } else if (firstBox.zpl) {
          // POST the ZPL to Labelary, get back a PNG, open it.
          try {
            const labelaryRes = await fetch(
              'https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/',
              {
                method: 'POST',
                headers: {
                  Accept: 'image/png',
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: firstBox.zpl,
              }
            );
            if (labelaryRes.ok) {
              const blob = await labelaryRes.blob();
              const url = URL.createObjectURL(blob);
              window.open(url, '_blank');
            }
          } catch (e) {
            console.warn('label preview render failed:', e);
          }
        }
      }

      setShowPostPrintModal(true);
    } catch (e) {
      setLabelError(e instanceof Error ? e.message : String(e));
    } finally {
      setLabelLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-48"></div>
          <div className="h-48 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (loadError || !detail) {
    return (
      <div className="p-8">
        <Link href="/shipping/queue" className="text-sm text-brand-600 hover:underline mb-4 inline-block">
          ← Back to queue
        </Link>
        <div className="card text-center py-12">
          <p className="text-gray-400 text-lg">
            {loadError || 'Pick ticket not found'}
          </p>
        </div>
      </div>
    );
  }

  const pt = detail.pick_ticket;
  const ptTotalWeightLbs = parseFloat(pt.weight) || undefined;
  const ptNumCartons = parseInt(String(pt.qty_cartoned || ''), 10) || undefined;

  const existingActiveShipment = detail.existing_shipments?.find(
    (s) => !s.voided_at && s.hq_status !== 'voided'
  );

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/shipping/queue" className="hover:text-brand-600 transition-colors">
          Shipping
        </Link>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <Link href="/shipping/queue" className="hover:text-brand-600 transition-colors">
          Queue
        </Link>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-gray-700 font-medium">PT-{pt.pick_ticket_id}</span>
      </div>

      {/* Existing shipment warning */}
      {existingActiveShipment && (
        <div className="card mb-6 border-amber-200 bg-amber-50/40">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-amber-900">
                This PT already has an active shipment
              </p>
              <p className="text-xs text-amber-800 mt-1">
                Tracking: {existingActiveShipment.tracking_number || '(no tracking)'} ·
                Status: {existingActiveShipment.hq_status}. Void the existing shipment first if
                you need to relabel.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* PT header */}
      <div className="card mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Ship PT-{pt.pick_ticket_id}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {pt.apparel_magic_customer_id ? (
                <Link
                  href={`/customers/${pt.apparel_magic_customer_id}`}
                  className="text-brand-600 hover:underline font-medium"
                >
                  {pt.customer_name}
                </Link>
              ) : (
                pt.customer_name
              )}
              {pt.apparel_magic_order_id && (
                <>
                  {' · Order '}
                  <Link
                    href={`/orders/${pt.apparel_magic_order_id}`}
                    className="text-brand-600 hover:underline"
                  >
                    #{pt.apparel_magic_order_id}
                  </Link>
                </>
              )}
              {pt.invoice_id && (
                <>
                  {' · Invoice '}
                  <Link
                    href={`/invoices/${pt.invoice_id}`}
                    className="text-brand-600 hover:underline"
                  >
                    #{pt.invoice_id}
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400">Warehouse</div>
            <div className="text-sm font-semibold text-gray-700">
              {pt.warehouse_id || '—'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2 mt-4 pt-4 border-t border-gray-100">
          <KV label="Items" value={`${detail.items.length} line${detail.items.length === 1 ? '' : 's'}`} />
          <KV label="Quantity" value={pt.qty || 0} />
          <KV label="Cartons (PT)" value={pt.qty_cartoned || '—'} />
          <KV label="PT weight" value={ptTotalWeightLbs ? `${ptTotalWeightLbs} lbs` : '—'} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT — Address + Items */}
        <div className="lg:col-span-2 space-y-6">
          {/* Address */}
          <section>
            <h2 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wide">
              Ship to
            </h2>
            {originalShipTo ? (
              <AddressValidationCard
                originalAddress={originalShipTo}
                carrier={carrier}
                onAddressDecided={(addr, status) => {
                  setDecidedAddress(addr);
                  setValidationStatus(status);
                }}
                reloadKey={carrier}
              />
            ) : (
              <div className="card text-sm text-red-700 bg-red-50/40 border-red-200">
                This PT is missing a ship-to address. Fix it in ApparelMagic and re-sync.
              </div>
            )}
          </section>

          {/* Items */}
          <section>
            <h2 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wide">
              Items in this PT
            </h2>
            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="border-b border-gray-200">
                    <th className="table-header pb-3 px-4 pt-3">Style</th>
                    <th className="table-header pb-3 px-4 pt-3">Description</th>
                    <th className="table-header pb-3 px-4 pt-3">Color</th>
                    <th className="table-header pb-3 px-4 pt-3">Size</th>
                    <th className="table-header pb-3 px-4 pt-3 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">
                        No items
                      </td>
                    </tr>
                  ) : (
                    detail.items.map((it: any, idx: number) => (
                      <tr key={idx} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-2 font-medium text-gray-900">
                          {it.style_number || '-'}
                        </td>
                        <td className="px-4 py-2 text-gray-700 max-w-[280px] truncate">
                          {it.description || '-'}
                        </td>
                        <td className="px-4 py-2 text-gray-600">{it.attr_2 || it.color || '-'}</td>
                        <td className="px-4 py-2 text-gray-600">{it.size || '-'}</td>
                        <td className="px-4 py-2 text-right text-gray-900">{it.qty || 0}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* RIGHT — Service + Boxes + Actions */}
        <div className="space-y-6">
          {/* Ship via */}
          <section>
            <h2 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wide">
              Service
            </h2>
            <div className="card">
              <label className="text-xs text-gray-600 block mb-1">Ship via</label>
              <select
                value={shipVia}
                onChange={(e) => setShipVia(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none bg-white text-sm"
              >
                {SHIP_VIA_OPTIONS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.options.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {pt.ship_via && (
                <p className="text-xs text-gray-500 mt-2">
                  PT ship via: <span className="font-mono">{pt.ship_via}</span>
                </p>
              )}
            </div>
          </section>

          {/* Boxes */}
          <section>
            <h2 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wide">
              Boxes
            </h2>
            <BoxBuilder
              boxes={boxes}
              onChange={setBoxes}
              ptTotalWeightLbs={ptTotalWeightLbs}
              ptNumCartons={ptNumCartons}
            />
          </section>

          {/* Get rate (optional preview) */}
          <section>
            <button
              onClick={handleGetRate}
              disabled={!canPrint || rateLoading}
              className="w-full px-4 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {rateLoading ? 'Getting rate…' : 'Get rate (preview)'}
            </button>

            {rateError && (
              <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-xs">
                {rateError}
              </div>
            )}

            {quotes && quotes.length > 0 && (
              <div className="mt-3 card bg-gray-50/50">
                {quotes.map((q) => (
                  <div key={q.serviceCode} className="flex items-baseline justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{q.serviceName}</div>
                      <div className="text-xs text-gray-500">
                        {q.estimatedDays ? `${q.estimatedDays} day${q.estimatedDays === 1 ? '' : 's'} in transit` : 'Transit time unavailable'}
                      </div>
                    </div>
                    <div className="text-lg font-bold text-gray-900">
                      ${q.totalUsd.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Print */}
          <section>
            <button
              onClick={handleCreateLabel}
              disabled={!canPrint || labelLoading || !!createdShipment}
              className="w-full px-4 py-3 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {labelLoading
                ? 'Creating label…'
                : createdShipment
                ? '✓ Label created'
                : 'Create label & print →'}
            </button>

            {labelError && (
              <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-xs">
                {labelError}
              </div>
            )}

            {!canPrint && !labelError && (
              <p className="text-xs text-gray-500 mt-2">
                {!decidedAddress && 'Confirm the address above to enable printing.'}
                {decidedAddress && boxes.length === 0 && 'Add at least one box.'}
                {decidedAddress &&
                  boxes.length > 0 &&
                  boxes.some((b) => !b.weightOz || !b.length || !b.width || !b.height) &&
                  'Fill in weight and dimensions for every box.'}
              </p>
            )}
          </section>
        </div>
      </div>

      {/* Post-print modal */}
      {showPostPrintModal && createdShipment?.shipment_id && (
        <PostPrintModal
          shipmentId={createdShipment.shipment_id}
          trackingNumber={createdShipment.boxes?.[0]?.tracking_number || ''}
          carrierName={createdShipment.carrier === 'easypost_usps' ? 'USPS' : 'UPS'}
          serviceName={createdShipment.service_name || ''}
          totalCostUsd={createdShipment.total_cost_usd || 0}
          onDone={() => router.push('/shipping/queue')}
        />
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-medium text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}
