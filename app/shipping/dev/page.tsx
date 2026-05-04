'use client';

/**
 * /shipping/dev — internal smoke-test page.
 *
 * Two panels:
 *   1. Health — fires GET /api/shipping/health, shows green/red for each
 *      backing service (UPS OAuth, EasyPost, Supabase service map).
 *   2. Address Validation — type an address, choose a carrier, see the
 *      full validation result including residential flag and corrections.
 *
 * This page is NOT linked from the main nav. Get to it directly via
 * /shipping/dev. Remove or gate behind admin role before going to prod.
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
  const [street1, setStreet1] = useState('1600 Amphitheatre Parkway');
  const [street2, setStreet2] = useState('');
  const [city, setCity] = useState('Mountain View');
  const [stateCode, setStateCode] = useState('CA');
  const [zip, setZip] = useState('94043');
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
            street1,
            street2: street2 || undefined,
            city,
            state: stateCode,
            zip,
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

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Shipping Manager — Dev Tools</h1>
        <p className="text-sm text-gray-600 mt-1">
          Internal smoke tests for the shipping infrastructure. Not user-facing.
        </p>
      </div>

      {/* Health panel */}
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
              UPS env: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{health.ups_env}</code>
              {' · '}
              EasyPost env: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{health.easypost_env}</code>
              {' · '}
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
                {Object.entries(health.checks).map(([name, c]) => (
                  <tr key={name} className="border-b">
                    <td className="py-2 px-3 font-mono text-xs">{name}</td>
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

      {/* Validation panel */}
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
            <input
              value={street1}
              onChange={(e) => setStreet1(e.target.value)}
              className="w-full border rounded px-2 py-1.5"
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-600 block mb-1">Street 2</label>
            <input
              value={street2}
              onChange={(e) => setStreet2(e.target.value)}
              className="w-full border rounded px-2 py-1.5"
            />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">City</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full border rounded px-2 py-1.5"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-600 block mb-1">State</label>
              <input
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value.toUpperCase())}
                maxLength={2}
                className="w-full border rounded px-2 py-1.5"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">ZIP</label>
              <input
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                className="w-full border rounded px-2 py-1.5"
              />
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
                  {val.cached && (
                    <span className="text-xs text-gray-500 italic">(from cache)</span>
                  )}
                  {val.isResidential !== undefined && (
                    <span className="text-gray-700">
                      {val.isResidential ? 'Residential' : 'Commercial'}
                    </span>
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

                {val.messages && val.messages.length > 0 && (
                  <ul className="text-sm text-amber-800 list-disc list-inside">
                    {val.messages.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </section>
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
  return (
    <span className={`px-2 py-1 rounded text-xs font-semibold ${cls}`}>
      {status ?? 'unknown'}
    </span>
  );
}
