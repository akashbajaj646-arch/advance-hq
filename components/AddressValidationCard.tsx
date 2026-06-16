'use client';

/**
 * AddressValidationCard
 *
 * Three-tier display:
 *   - verified  → green silent badge with residential/commercial classification
 *   - corrected → yellow card with original-vs-corrected side-by-side, requires
 *                 user click to confirm which version to use
 *   - undeliverable / po_box / apo_fpo → red blocking card with optional override
 *
 * Always shows a residential/commercial classification chip + manual override
 * checkbox so the shipper can correct UPS when it misclassifies an address.
 * The isResidential flag is passed through every onAddressDecided call so
 * downstream rate/label requests include the residential surcharge correctly.
 *
 * Parent owns the address state. This component owns the validation state
 * (classification, decided choice, override flag).
 */

import { useEffect, useState } from 'react';

export type ValidationStatus =
  | 'pending'
  | 'verified'
  | 'corrected'
  | 'undeliverable'
  | 'po_box'
  | 'apo_fpo';

export interface AddressShape {
  name?: string;
  company?: string;
  phone?: string;
  email?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
  isResidential?: boolean;
}

interface Props {
  /** The original address as the user typed/imported it. */
  originalAddress: AddressShape;
  /** Carrier to validate with: 'ups' or 'easypost_usps'. */
  carrier: 'ups' | 'easypost_usps';
  /** Called whenever the "address to use" changes and is acceptable to print with. */
  onAddressDecided: (addr: AddressShape, status: ValidationStatus) => void;
  /** Re-trigger validation when this changes (e.g., user manually edits the address). */
  reloadKey?: any;
}

function formatLines(a: AddressShape): string[] {
  const out: string[] = [];
  if (a.name) out.push(a.name);
  if (a.street1) out.push(a.street1);
  if (a.street2) out.push(a.street2);
  out.push(`${a.city}, ${a.state} ${a.zip}`);
  if (a.country && a.country !== 'US') out.push(a.country);
  return out;
}

export default function AddressValidationCard({
  originalAddress,
  carrier,
  onAddressDecided,
  reloadKey,
}: Props) {
  const [status, setStatus] = useState<ValidationStatus>('pending');
  const [validated, setValidated] = useState<AddressShape | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [decided, setDecided] = useState<'original' | 'corrected' | null>(null);
  const [forced, setForced] = useState(false);

  // Carrier-reported classification. We keep what UPS/USPS told us
  // separately from what the user finally chose, so the manual-override
  // toggle reads from one state, and the rate request uses the toggle's
  // current value rather than re-reading the carrier's classification.
  const [carrierResidential, setCarrierResidential] = useState<boolean | null>(null);
  const [overrideResidential, setOverrideResidential] = useState<boolean | null>(null);

  // The effective classification — manual override beats carrier report.
  const effectiveResidential =
    overrideResidential !== null ? overrideResidential : !!carrierResidential;

  // Re-validate when inputs change
  useEffect(() => {
    setStatus('pending');
    setValidated(null);
    setMessages([]);
    setDecided(null);
    setForced(false);
    setCarrierResidential(null);
    setOverrideResidential(null);
    void runValidation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    originalAddress.street1,
    originalAddress.street2,
    originalAddress.city,
    originalAddress.state,
    originalAddress.zip,
    originalAddress.country,
    carrier,
    reloadKey,
  ]);

  // When the user toggles the manual override AFTER an address was already
  // decided, re-fire onAddressDecided with the new flag so the parent
  // re-fetches rates with the corrected residential indicator.
  useEffect(() => {
    if (overrideResidential === null) return;
    if (decided === null && !forced) return;

    // Figure out which address is currently the "decided" one and re-emit.
    const baseAddr =
      decided === 'corrected' && validated
        ? validated
        : originalAddress;
    onAddressDecided(
      { ...baseAddr, isResidential: overrideResidential },
      forced ? status : decided === 'corrected' ? 'corrected' : status === 'verified' ? 'verified' : 'corrected'
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideResidential]);

  async function runValidation() {
    if (
      !originalAddress.street1 ||
      !originalAddress.city ||
      !originalAddress.state ||
      !originalAddress.zip
    ) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/shipping/validate-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier, address: originalAddress }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus('undeliverable');
        setMessages([data?.error || `HTTP ${res.status}`]);
        return;
      }

      const s = (data?.status as ValidationStatus) || 'undeliverable';
      const isRes = !!data?.isResidential;

      setStatus(s);
      setValidated(data?.validatedAddress || null);
      setMessages(data?.messages || []);
      setCarrierResidential(isRes);

      // For verified addresses we silently accept the original so parent
      // can proceed without an extra click. Always merge the carrier's
      // residential flag in.
      if (s === 'verified') {
        const addrToUse: AddressShape = {
          ...originalAddress,
          isResidential: isRes,
        };
        setDecided('original');
        onAddressDecided(addrToUse, s);
      }
    } catch (e) {
      setStatus('undeliverable');
      setMessages([e instanceof Error ? e.message : String(e)]);
    } finally {
      setLoading(false);
    }
  }

  // ── Tiny classification chip used by every render path ──
  function ClassificationChip() {
    if (carrierResidential === null && overrideResidential === null) return null;
    const isRes = effectiveResidential;
    const overridden = overrideResidential !== null && overrideResidential !== !!carrierResidential;
    return (
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-200">
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            isRes
              ? 'bg-orange-100 text-orange-800'
              : 'bg-blue-100 text-blue-800'
          }`}
        >
          {isRes ? 'Residential' : 'Commercial'}
        </span>
        {overridden && (
          <span className="text-[10px] text-gray-500 italic">manually set</span>
        )}
        <label className="flex items-center gap-1.5 text-xs text-gray-600 ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={isRes}
            onChange={(e) => setOverrideResidential(e.target.checked)}
            className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <span>Residential delivery</span>
        </label>
      </div>
    );
  }

  // ── Pending / loading ──
  if (loading || status === 'pending') {
    return (
      <div className="card">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" />
          <span className="text-sm text-gray-600">Validating address…</span>
        </div>
      </div>
    );
  }

  // ── Verified — silent green with classification chip ──
  if (status === 'verified') {
    return (
      <div className="card border-green-200 bg-green-50/30">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <svg
                className="w-5 h-5 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-900">Address verified</p>
              <p className="text-xs text-green-800 mt-0.5">
                {carrier === 'ups' ? 'UPS' : 'USPS'} confirmed
              </p>
            </div>
          </div>
        </div>
        <ClassificationChip />
      </div>
    );
  }

  // ── Corrected — needs a click ──
  if (status === 'corrected' && validated) {
    return (
      <div className="card border-yellow-200 bg-yellow-50/40">
        <div className="flex items-start gap-3 mb-4">
          <svg
            className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <div>
            <p className="text-sm font-semibold text-yellow-900">
              {carrier === 'ups' ? 'UPS' : 'USPS'} suggested a correction
            </p>
            <p className="text-xs text-yellow-800 mt-0.5">
              Pick which version to print. The carrier auto-corrects sometimes incorrectly — review
              before confirming.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={() => {
              setDecided('original');
              onAddressDecided(
                { ...originalAddress, isResidential: effectiveResidential },
                'corrected'
              );
            }}
            className={`text-left rounded-lg p-3 border transition-colors ${
              decided === 'original'
                ? 'border-brand-500 bg-white shadow-sm ring-2 ring-brand-200'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500 uppercase">As entered</span>
              {decided === 'original' && (
                <span className="text-xs text-brand-600 font-semibold">✓ Selected</span>
              )}
            </div>
            <div className="text-sm text-gray-700 font-mono leading-relaxed">
              {formatLines(originalAddress).map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          </button>

          <button
            onClick={() => {
              setDecided('corrected');
              onAddressDecided(
                { ...validated, isResidential: effectiveResidential },
                'corrected'
              );
            }}
            className={`text-left rounded-lg p-3 border transition-colors ${
              decided === 'corrected'
                ? 'border-brand-500 bg-white shadow-sm ring-2 ring-brand-200'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500 uppercase">Carrier suggests</span>
              {decided === 'corrected' && (
                <span className="text-xs text-brand-600 font-semibold">✓ Selected</span>
              )}
            </div>
            <div className="text-sm text-gray-700 font-mono leading-relaxed">
              {formatLines(validated).map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          </button>
        </div>

        {decided === null && (
          <p className="text-xs text-yellow-800 mt-3 italic">
            Click one of the addresses above to continue.
          </p>
        )}

        <ClassificationChip />
      </div>
    );
  }

  // ── Undeliverable / PO Box / APO/FPO — blocking with override ──
  return (
    <div className="card border-red-200 bg-red-50/40">
      <div className="flex items-start gap-3 mb-3">
        <svg
          className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
        <div>
          <p className="text-sm font-semibold text-red-900">
            {status === 'po_box'
              ? 'PO Box detected'
              : status === 'apo_fpo'
              ? 'APO/FPO address detected'
              : 'Address could not be verified'}
          </p>
          {messages.length > 0 && (
            <ul className="text-xs text-red-800 mt-1 list-disc list-inside">
              {messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
          {status === 'po_box' && carrier === 'ups' && (
            <p className="text-xs text-red-800 mt-1">
              UPS doesn't deliver to PO Boxes. Switch to USPS or get a street address.
            </p>
          )}
        </div>
      </div>

      <div className="bg-white rounded p-3 mb-3 text-sm text-gray-700 font-mono leading-relaxed">
        {formatLines(originalAddress).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => void runValidation()}
          className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50"
        >
          Re-validate
        </button>
        {!forced ? (
          <button
            onClick={() => {
              setForced(true);
              onAddressDecided(
                { ...originalAddress, isResidential: effectiveResidential },
                status
              );
            }}
            className="px-3 py-1.5 text-xs border border-red-300 text-red-700 rounded hover:bg-red-50"
          >
            Force ship anyway
          </button>
        ) : (
          <span className="text-xs text-red-700 font-semibold">
            ✓ Override active — printing will use the address as entered
          </span>
        )}
      </div>

      {/* Manual classification chip works even on undeliverable, in case
          the shipper knows what kind of address it is and wants the rate
          to reflect that. Only show when force-ship is engaged. */}
      {forced && <ClassificationChip />}
    </div>
  );
}
