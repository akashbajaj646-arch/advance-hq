'use client';

/**
 * /shipping/dev — internal smoke-test page.
 *
 * Three panels:
 *   1. Health check
 *   2. Address validation (UPS or USPS via EasyPost)
 *   3. Rate + Create label + Void (UPS Ground/Air or USPS Priority/Ground Advantage/etc)
 */

import { useEffect, useState } from 'react';

interface HealthResponse {
  ok: boolean;
  ups_env?: string;
  easypost_env?: string;
  checks: Record<string, { ok: boolean; detail?: string; ms?: number }>;
}

interface ValidationResponse {
  cached?: boolean;
  status?: string;
  isResidential?: boolean;
  validatedAddress?: any;
  messages?: string[];
  error?: string;
}

interface Warehouse {
  id: string;
  display_name: string;
  company_name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
}

interface BoxRow {
  weightOz: number;
  length: number;
  width: number;
  height: number;
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
  // UPS
  'UPS Ground',
  'UPS 2nd Day Air',
  'UPS Next Day Air',
  'UPS Next Day Air Saver',
  'UPS 3 Day Select',
  // USPS via EasyPost
  'USPS Priority Mail',
  'USPS Ground Advantage',
  'USPS Priority Mail Express',
  'USPS First Class',
];

export default function ShippingDevPage() {
  // ── Health panel ──────────────────────────────────────────────────
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  async function runHealth() {
    setHealthLoading(true);
    try {
      const res = await fetch('/api/shipping/health');
      setHealth(await res.json());
    } finally {
      setHealthLoading(false);
    }
  }

  useEffect(() => {
    runHealth();
  }, []);

  // ── Validation panel ──────────────────────────────────────────────
  const [carrier, setCarrier] = useState<'ups' | 'easypost_usps'>('ups');
  const [vStreet1, setVStreet1] = useState('1 Dr Carlton B Goodlett Pl');
  const [vStreet2, setVStreet2] = useState('');
  const [vCity, setVCity] = useState('San Francisco');
  const [vState, setVState] = useState('CA');
  const [vZip, setVZip] = useState('94102');
  const [val, setVal] = useState<ValidationResponse | null>(null);
  const [valLoading, setValLoading] = useState(false);

  async function runValidation() {
    setValLoading(true);
    setVal(null);
    try {
      const res = await fetch('/api/shipping/validate-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier,
          address: {
            street1: vStreet1,
            street2: vStreet2 || undefined,
            city: vCity,
            state: vState,
            zip: vZip,
            country: 'US',
          },
        }),
      });
      setVal(await res.json());
    } catch (e) {
      setVal({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setValLoading(false);
    }
  }

  // ── Label creation panel ──────────────────────────────────────────
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('leuning');
  const [shipVia, setShipVia] = useState('UPS Ground');
  const [name, setName] = useState('Test Recipient');
  const [phone, setPhone] = useState('5551234567');
  const [street1, setStreet1] = useState('350 5th Ave');
  const [street2, setStreet2] = useState('');
  const [city, setCity] = useState('New York');
  const [state, setState] = useState('NY');
  const [zip, setZip] = useState('10118');
  const [reference, setReference] = useState('TEST-PT-001');

  const [boxes, setBoxes] = useState<BoxRow[]>([
    { weightOz: 32, length: 16, width: 14, height: 10 },
  ]);

  const [rateLoading, setRateLoading] = useState(false);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);

  const [labelLoading, setLabelLoading] = useState(false);
  const [label, setLabel] = useState<CreateLabelResponse | null>(null);
  const [voidLoading, setVoidLoading] = useState(false);
  const [voidResult, setVoidResult] = useState<{ success?: boolean; message?: string; error?: string } | null>(null);

  useEffect(() => {
    fetch('/api/shipping/warehouses')
      .then((r) => r.json())
      .then((d) => setWarehouses(d?.warehouses ?? []))
      .catch(() => {});
  }, []);

  // When user switches between UPS and USPS ship_via, swap defaults so they
  // don't have to fight CIE state restrictions for UPS testing.
  useEffect(() => {
    const isUsps = shipVia.startsWith('USPS');
    if (isUsps) {
      // USPS: use the user's real NJ warehouse address as a realistic ship-to
      // (EasyPost validates real addresses including NJ).
      setStreet1('388 Townsend St');
      setCity('San Francisco');
      setState('CA');
      setZip('94107');
    }
    // (UPS defaults already set in initial state — leave them.)
  }, [shipVia]);

  function buildShipTo() {
    return {
      name,
      company: name,
      phone,
      street1,
      street2: street2 || undefined,
      city,
      state,
      zip,
      country: 'US',
    };
  }

  async function runRate() {
    setRateLoading(true);
    setQuotes(null);
    setRateError(null);
    try {
      const res = await fetch('/api/shipping/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouse_id: warehouseId,
          ship_via: shipVia,
          ship_to: buildShipTo(),
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

  async function runCreateLabel() {
    setLabelLoading(true);
    setLabel(null);
    setVoidResult(null);
    try {
      const res = await fetch('/api/shipping/labels/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouse_id: warehouseId,
          ship_via: shipVia,
          ship_to: buildShipTo(),
          boxes,
          reference,
        }),
      });
      const data = await res.json();
      if (!res.ok) setLabel({ error: data?.error || `HTTP ${res.status}` });
      else setLabel(data);
    } catch (e) {
      setLabel({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLabelLoading(false);
    }
  }

  async function runVoid() {
    if (!label?.shipment_id) return;
    setVoidLoading(true);
    setVoidResult(null);
    try {
      const res = await fetch('/api/shipping/labels/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: label.shipment_id }),
      });
      const data = await res.json();
      setVoidResult(data);
    } catch (e) {
      setVoidResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setVoidLoading(false);
    }
  }

  function downloadZpl(zpl: string, filename: string) {
    const blob = new Blob([zpl], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Shipping Manager — Dev Tools</h1>
        <p className="text-sm text-gray-600 mt-1">
          Internal smoke tests for the shipping infrastructure. Not user-facing.
        </p>
      </div>

      {/* Health */}
      <section className="border rounded-lg p-4 bg-white">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Health check</h2>
          <button
            onClick={runHealth}
            disabled={healthLoading}
            className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50"
          >
            {healthLoading ? 'Checking…' : 'Re-run'}
          </button>
        </div>
        {!health ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="space-y-2">
            <div className="text-sm text-gray-600">
              UPS env: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{health.ups_env}</code>{' · '}
              EasyPost env: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{health.easypost_env}</code>{' · '}
              Overall:{' '}
              <span className={health.ok ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold'}>
                {health.ok ? 'OK' : 'FAIL'}
              </span>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b bg-gray-50">
                  <th className="py-2 px-3 font-medium">Check</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 px-3 font-medium">Time</th>
                  <th className="py-2 px-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(health.checks).map(([n, c]) => (
                  <tr key={n} className="border-b">
                    <td className="py-2 px-3 font-mono text-xs">{n}</td>
                    <td className="py-2 px-3">
                      <span
                        className={
                          'inline-block px-2 py-0.5 rounded text-xs font-semibold ' +
                          (c.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800')
                        }
                      >
                        {c.ok ? 'OK' : 'FAIL'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-600">{c.ms != null ? `${c.ms}ms` : '—'}</td>
                    <td className="py-2 px-3 text-gray-700 break-all">{c.detail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Validation */}
      <section className="border rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-3">Address validation</h2>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="col-span-2">
            <label className="text-xs text-gray-600 block mb-1">Carrier</label>
            <select
              value={carrier}
              onChange={(e) => setCarrier(e.target.value as any)}
              className="w-full border rounded px-2 py-1.5"
            >
              <option value="ups">UPS</option>
              <option value="easypost_usps">USPS (via EasyPost)</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-600 block mb-1">Street 1</label>
            <input value={vStreet1} onChange={(e) => setVStreet1(e.target.value)} className="w-full border rounded px-2 py-1.5" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-600 block mb-1">Street 2</label>
            <input value={vStreet2} onChange={(e) => setVStreet2(e.target.value)} className="w-full border rounded px-2 py-1.5" />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">City</label>
            <input value={vCity} onChange={(e) => setVCity(e.target.value)} className="w-full border rounded px-2 py-1.5" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-600 block mb-1">State</label>
              <input value={vState} onChange={(e) => setVState(e.target.value.toUpperCase())} maxLength={2} className="w-full border rounded px-2 py-1.5" />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">ZIP</label>
              <input value={vZip} onChange={(e) => setVZip(e.target.value)} className="w-full border rounded px-2 py-1.5" />
            </div>
          </div>
        </div>
        <button
          onClick={runValidation}
          disabled={valLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {valLoading ? 'Validating…' : 'Validate'}
        </button>
        {val && (
          <div className="mt-4 space-y-2">
            {val.error ? (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
                <strong>Error:</strong> {val.error}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 text-sm">
                  <StatusBadge status={val.status} />
                  {val.cached && <span className="text-xs text-gray-500 italic">(from cache)</span>}
                  {val.isResidential !== undefined && (
                    <span className="text-gray-700">{val.isResidential ? 'Residential' : 'Commercial'}</span>
                  )}
                </div>
                {val.validatedAddress && (
                  <div className="p-3 bg-gray-50 border rounded text-sm font-mono whitespace-pre-wrap">
                    {[
                      val.validatedAddress.street1,
                      val.validatedAddress.street2,
                      `${val.validatedAddress.city}, ${val.validatedAddress.state} ${val.validatedAddress.zip}`,
                      val.validatedAddress.country,
                    ]
                      .filter(Boolean)
                      .join('\n')}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* Rate + Label + Void */}
      <section className="border rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-3">Rate + Create label + Void</h2>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-gray-600 block mb-1">Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full border rounded px-2 py-1.5">
              {warehouses.length === 0 ? (
                <option value={warehouseId}>{warehouseId}</option>
              ) : (
                warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.display_name} ({w.id})
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Ship via</label>
            <select value={shipVia} onChange={(e) => setShipVia(e.target.value)} className="w-full border rounded px-2 py-1.5">
              <optgroup label="UPS">
                {SHIP_VIA_OPTIONS.filter((s) => s.startsWith('UPS')).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </optgroup>
              <optgroup label="USPS (via EasyPost)">
                {SHIP_VIA_OPTIONS.filter((s) => s.startsWith('USPS')).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-gray-600 block mb-1">Recipient name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border rounded px-2 py-1.5" />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Recipient phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border rounded px-2 py-1.5" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-600 block mb-1">Street 1</label>
            <input value={street1} onChange={(e) => setStreet1(e.target.value)} className="w-full border rounded px-2 py-1.5" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-600 block mb-1">Street 2</label>
            <input value={street2} onChange={(e) => setStreet2(e.target.value)} className="w-full border rounded px-2 py-1.5" />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">City</label>
            <input value={city} onChange={(e) => setCity(e.target.value)} className="w-full border rounded px-2 py-1.5" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-600 block mb-1">State</label>
              <input value={state} onChange={(e) => setState(e.target.value.toUpperCase())} maxLength={2} className="w-full border rounded px-2 py-1.5" />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">ZIP</label>
              <input value={zip} onChange={(e) => setZip(e.target.value)} className="w-full border rounded px-2 py-1.5" />
            </div>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-600 block mb-1">Reference (e.g. PT number)</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className="w-full border rounded px-2 py-1.5" />
          </div>
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">Boxes</h3>
            <button
              onClick={() => setBoxes([...boxes, { weightOz: 32, length: 16, width: 14, height: 10 }])}
              className="text-xs text-blue-600 hover:underline"
            >
              + Add box
            </button>
          </div>
          <div className="space-y-2">
            {boxes.map((b, i) => (
              <div key={i} className="grid grid-cols-5 gap-2 items-end">
                <NumField label="Weight (oz)" value={b.weightOz} onChange={(v) => updateBox(i, 'weightOz', v)} />
                <NumField label="Length" value={b.length} onChange={(v) => updateBox(i, 'length', v)} />
                <NumField label="Width" value={b.width} onChange={(v) => updateBox(i, 'width', v)} />
                <NumField label="Height" value={b.height} onChange={(v) => updateBox(i, 'height', v)} />
                <button
                  onClick={() => setBoxes(boxes.filter((_, j) => j !== i))}
                  disabled={boxes.length <= 1}
                  className="text-xs text-red-600 hover:underline disabled:text-gray-400 pb-1"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={runRate}
            disabled={rateLoading}
            className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-800 disabled:opacity-50"
          >
            {rateLoading ? 'Getting rate…' : 'Get rate'}
          </button>
          <button
            onClick={runCreateLabel}
            disabled={labelLoading}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {labelLoading ? 'Creating label…' : 'Create label'}
          </button>
        </div>

        {rateError && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
            <strong>Rate error:</strong> {rateError}
          </div>
        )}
        {quotes && quotes.length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Rate quotes</h4>
            <table className="w-full text-sm border">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="py-2 px-3 font-medium">Service</th>
                  <th className="py-2 px-3 font-medium">Code</th>
                  <th className="py-2 px-3 font-medium">Days</th>
                  <th className="py-2 px-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.serviceCode} className="border-t">
                    <td className="py-2 px-3">{q.serviceName}</td>
                    <td className="py-2 px-3 font-mono text-xs">{q.serviceCode}</td>
                    <td className="py-2 px-3">{q.estimatedDays ?? '—'}</td>
                    <td className="py-2 px-3 font-semibold">${q.totalUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {label && (
          <div className="mt-4 space-y-3">
            {label.error ? (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
                <strong>Label error:</strong> {label.error}
              </div>
            ) : (
              <>
                <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
                  <div className="font-semibold text-green-900">Label created</div>
                  <div className="text-green-800 mt-1">
                    {label.carrier} · {label.service_name} ({label.service_code}) · Total: ${label.total_cost_usd?.toFixed(2)}
                  </div>
                  <div className="text-xs text-green-700 mt-1 font-mono break-all">
                    Shipment: {label.shipment_id}
                    {label.ups_shipment_digest && <> · UPS digest: {label.ups_shipment_digest}</>}
                    {label.easypost_shipment_id && <> · EasyPost id: {label.easypost_shipment_id}</>}
                  </div>
                </div>
                {label.boxes?.map((b, i) => (
                  <BoxLabelView
                    key={i}
                    idx={i + 1}
                    tracking={b.tracking_number}
                    cost={b.cost_usd}
                    zpl={b.zpl}
                    pdfUrl={b.pdf_url}
                    onDownload={downloadZpl}
                  />
                ))}
                <div className="flex gap-2 items-center pt-2">
                  <button
                    onClick={runVoid}
                    disabled={voidLoading}
                    className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                  >
                    {voidLoading ? 'Voiding…' : 'Void label'}
                  </button>
                  {voidResult && (
                    <span className={`text-sm ${voidResult.success ? 'text-green-700' : 'text-red-700'}`}>
                      {voidResult.success
                        ? `✓ ${voidResult.message || 'Voided'}`
                        : `✗ ${voidResult.error || voidResult.message}`}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );

  function updateBox(i: number, field: keyof BoxRow, val: number) {
    const next = [...boxes];
    next[i] = { ...next[i], [field]: val };
    setBoxes(next);
  }
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs text-gray-600 block mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full border rounded px-2 py-1.5"
        step="0.1"
      />
    </div>
  );
}

function BoxLabelView({
  idx,
  tracking,
  cost,
  zpl,
  pdfUrl,
  onDownload,
}: {
  idx: number;
  tracking: string;
  cost?: number;
  zpl?: string;
  pdfUrl?: string;
  onDownload: (zpl: string, filename: string) => void;
}) {
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!zpl) return;
    const ctrl = new AbortController();
    fetch('https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/', {
      method: 'POST',
      headers: { Accept: 'image/png', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: zpl,
      signal: ctrl.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Labelary HTTP ${r.status}`);
        const blob = await r.blob();
        setPngUrl(URL.createObjectURL(blob));
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setPreviewError(e.message || 'preview failed');
      });
    return () => ctrl.abort();
  }, [zpl]);

  return (
    <div className="border rounded p-3 bg-gray-50">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-semibold">Box {idx}</div>
          <div className="text-xs font-mono text-gray-700">{tracking}</div>
          {cost != null && <div className="text-xs text-gray-600">${cost.toFixed(2)}</div>}
        </div>
        <div className="flex gap-3">
          {zpl && (
            <button
              onClick={() => onDownload(zpl, `${tracking}.zpl`)}
              className="text-xs text-blue-600 hover:underline"
            >
              Download .zpl
            </button>
          )}
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              Open PDF
            </a>
          )}
        </div>
      </div>
      {pngUrl ? (
        <img src={pngUrl} alt={`Label ${idx}`} className="border bg-white" style={{ width: 240 }} />
      ) : previewError ? (
        <div className="text-xs text-amber-700">Preview unavailable: {previewError}</div>
      ) : zpl ? (
        <div className="text-xs text-gray-500">Rendering preview…</div>
      ) : pdfUrl ? (
        <div className="text-xs text-gray-500">No ZPL — use the PDF link above</div>
      ) : (
        <div className="text-xs text-gray-500">No label data returned</div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const styles: Record<string, string> = {
    verified: 'bg-green-100 text-green-800',
    corrected: 'bg-amber-100 text-amber-800',
    undeliverable: 'bg-red-100 text-red-800',
    po_box: 'bg-purple-100 text-purple-800',
    apo_fpo: 'bg-blue-100 text-blue-800',
  };
  const cls = (status && styles[status]) || 'bg-gray-100 text-gray-800';
  return <span className={`px-2 py-1 rounded text-xs font-semibold ${cls}`}>{status ?? 'unknown'}</span>;
}
