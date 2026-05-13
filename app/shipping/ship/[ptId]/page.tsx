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
 *   6. Optionally toggles Advanced options for signature / Saturday / COD
 *   7. Optionally clicks "Get rate" to preview cost
 *   8. Clicks "Create label & print"
 *   9. Sees post-print modal: Print packing list? Print invoice? → back to queue
 *
 * Advanced options:
 *   - Signature confirmation (independent toggle, default off)
 *   - Saturday Delivery (independent toggle, default off)
 *   - COD (Collect on Delivery): per_box (default) or per_shipment, with
 *     payment type required. Toggling COD on auto-checks signature (since
 *     COD requires a recipient present). Toggling COD off unlocks signature.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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

type CodMode = 'per_box' | 'per_shipment';
type CodPaymentType = '' | 'cashiers_check' | 'any_check' | 'cash';

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

/**
 * Estimated UPS accessory surcharges. These are real-money figures published
 * by UPS for 2026 — they update annually so revisit this when UPS announces
 * the next GRI (typically mid-December). Sources: UPS public rate guides
 * cross-referenced with industry trackers.
 *
 * Note: actual billed amounts may differ based on negotiated contract rates,
 * fuel surcharge multipliers, and zone-specific adjustments. We label these
 * as estimates in the UI for that reason.
 */
const UPS_SURCHARGE_2026 = {
  /**
   * COD: $22.50 per package as of 2026 (UPS Capital). Plus an additional 1%
   * for collection amounts over $1000. Min $9.45, max $317.50.
   */
  COD_BASE_PER_PACKAGE: 22.5,
  COD_HIGH_VALUE_THRESHOLD: 1000,
  COD_HIGH_VALUE_RATE: 0.01,
  COD_MIN: 9.45,
  COD_MAX: 317.5,
  /** Direct Signature Required: $7.70 per package (2026). */
  SIGNATURE_PER_PACKAGE: 7.7,
  /** Saturday Delivery: $24.00 per shipment (typical estimate). */
  SATURDAY_DELIVERY: 24.0,
};

interface EstimatedSurcharges {
  cod: number;
  signature: number;
  saturday: number;
  total: number;
}

/**
 * Estimate UPS accessory surcharges based on the advanced options selected.
 * Returns a breakdown so the UI can display each line item separately.
 *
 * COD math: each PACKAGE with COD gets the per-package surcharge. In per_box
 * mode that's all N boxes; in per_shipment mode it's just box 1.
 *
 * Signature: only billed when COD is OFF. When COD is on, signature is
 * implicit and not separately charged.
 *
 * Saturday: flat shipment-level surcharge.
 */
function estimateUpsSurcharges(opts: {
  carrier: 'ups' | 'easypost_usps';
  codEnabled: boolean;
  codMode: 'per_box' | 'per_shipment';
  codAmounts: number[];
  codTotalAmount: number;
  signatureRequired: boolean;
  saturdayDelivery: boolean;
  boxCount: number;
}): EstimatedSurcharges {
  // Only UPS surcharges are estimated; USPS via EasyPost is rated server-side.
  if (opts.carrier !== 'ups') {
    return { cod: 0, signature: 0, saturday: 0, total: 0 };
  }

  let cod = 0;
  if (opts.codEnabled) {
    const codBoxes =
      opts.codMode === 'per_box'
        ? opts.codAmounts.filter((a) => a > 0)
        : opts.codTotalAmount > 0
        ? [opts.codTotalAmount]
        : [];

    cod = codBoxes.reduce((sum, amount) => {
      let charge = UPS_SURCHARGE_2026.COD_BASE_PER_PACKAGE;
      if (amount > UPS_SURCHARGE_2026.COD_HIGH_VALUE_THRESHOLD) {
        charge += amount * UPS_SURCHARGE_2026.COD_HIGH_VALUE_RATE;
      }
      charge = Math.max(UPS_SURCHARGE_2026.COD_MIN, Math.min(UPS_SURCHARGE_2026.COD_MAX, charge));
      return sum + charge;
    }, 0);
  }

  // Signature is implicit with COD — UPS doesn't double-bill.
  const signature =
    opts.signatureRequired && !opts.codEnabled
      ? UPS_SURCHARGE_2026.SIGNATURE_PER_PACKAGE * opts.boxCount
      : 0;

  const saturday = opts.saturdayDelivery ? UPS_SURCHARGE_2026.SATURDAY_DELIVERY : 0;

  return {
    cod,
    signature,
    saturday,
    total: cod + signature + saturday,
  };
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

  // Editable ship-to. Seeded from the PT defaults via originalShipTo. The
  // shipping module is decoupled from PT/order/invoice — manual edits only
  // affect the shipment row that gets persisted via labels/create. The
  // upstream PT in ApparelMagic is never touched.
  const [shipTo, setShipTo] = useState<AddressShape | null>(null);
  const [addressManuallyEdited, setAddressManuallyEdited] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [editForm, setEditForm] = useState<AddressShape | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Advanced options state
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [signatureRequired, setSignatureRequired] = useState(false);
  const [saturdayDelivery, setSaturdayDelivery] = useState(false);
  const [codEnabled, setCodEnabled] = useState(false);
  const [codMode, setCodMode] = useState<CodMode>('per_box');
  const [codAmounts, setCodAmounts] = useState<number[]>([]);
  const [codTotalAmount, setCodTotalAmount] = useState<number>(0);
  const [codPaymentType, setCodPaymentType] = useState<CodPaymentType>('');

  // Action state
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [createdShipment, setCreatedShipment] = useState<CreateLabelResponse | null>(null);
  const [showPostPrintModal, setShowPostPrintModal] = useState(false);

  // Draft persistence: when the shipper is mid-PT and gets interrupted, we
  // save their work to localStorage so they can resume after navigating away,
  // refreshing, or even closing the tab. Drafts are cleared when the label
  // is successfully created. Stale drafts (>7 days) are ignored.
  const [draftRestored, setDraftRestored] = useState(false);
  const draftRestoredRef = useRef(false);
  const draftKey = ptId ? `ahq-ship-draft-${ptId}` : null;
  const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  useEffect(() => {
    void loadPT();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptId]);

  // When COD is toggled on, auto-require signature. We don't auto-uncheck
  // signature when COD is toggled off — the shipper may have explicitly
  // wanted signature regardless of COD.
  useEffect(() => {
    if (codEnabled) setSignatureRequired(true);
  }, [codEnabled]);

  // Keep codAmounts array length in sync with the number of boxes. Preserve
  // existing amounts when boxes are added/removed; pad with 0 for new boxes.
  useEffect(() => {
    setCodAmounts((prev) => {
      const next = prev.slice(0, boxes.length);
      while (next.length < boxes.length) next.push(0);
      return next;
    });
  }, [boxes.length]);

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

  // Restore draft from localStorage once the PT detail has loaded.
  //
  // We restore exactly once — guarded by draftRestoredRef so re-renders of
  // detail don't keep clobbering the user's edits. After restoring, the
  // separate save effect below keeps localStorage in sync with subsequent
  // edits.
  useEffect(() => {
    if (!detail || !draftKey || draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    let restoredShipTo = false;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        const savedAt = typeof draft.savedAt === 'number' ? draft.savedAt : 0;
        if (Date.now() - savedAt > DRAFT_TTL_MS) {
          localStorage.removeItem(draftKey);
        } else {
          // Apply each piece. Use defensive checks because the localStorage
          // schema can drift if we ship a new version that adds fields.
          if (typeof draft.shipVia === 'string') setShipVia(draft.shipVia);
          if (Array.isArray(draft.boxes) && draft.boxes.length > 0) {
            setBoxes(draft.boxes);
          }
          if (typeof draft.signatureRequired === 'boolean') {
            setSignatureRequired(draft.signatureRequired);
          }
          if (typeof draft.saturdayDelivery === 'boolean') {
            setSaturdayDelivery(draft.saturdayDelivery);
          }
          if (typeof draft.codEnabled === 'boolean') {
            setCodEnabled(draft.codEnabled);
          }
          if (draft.codMode === 'per_box' || draft.codMode === 'per_shipment') {
            setCodMode(draft.codMode);
          }
          if (Array.isArray(draft.codAmounts)) {
            setCodAmounts(draft.codAmounts);
          }
          if (typeof draft.codTotalAmount === 'number') {
            setCodTotalAmount(draft.codTotalAmount);
          }
          if (
            draft.codPaymentType === '' ||
            draft.codPaymentType === 'cashiers_check' ||
            draft.codPaymentType === 'any_check' ||
            draft.codPaymentType === 'cash'
          ) {
            setCodPaymentType(draft.codPaymentType);
          }
          if (typeof draft.advancedOpen === 'boolean') {
            setAdvancedOpen(draft.advancedOpen);
          }
          if (
            draft.shipTo &&
            typeof draft.shipTo === 'object' &&
            typeof draft.shipTo.street1 === 'string'
          ) {
            setShipTo(draft.shipTo as AddressShape);
            restoredShipTo = true;
          }
          if (typeof draft.addressManuallyEdited === 'boolean') {
            setAddressManuallyEdited(draft.addressManuallyEdited);
          }
          setDraftRestored(true);
        }
      }
    } catch (e) {
      console.warn('Failed to restore shipping draft:', e);
    }
    // Seed shipTo from the PT defaults if the draft didn't already supply
    // one. Without this, shipTo stays null and the validation card never
    // renders.
    if (!restoredShipTo && originalShipTo) {
      setShipTo(originalShipTo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, draftKey]);

  // When the ship-to address changes (manual edit, draft restore, PT
  // re-seed, residential override) clear any previously-decided address so
  // the user can't accidentally print with stale validation context. The
  // AddressValidationCard re-emits onAddressDecided as soon as the new
  // validation completes.
  useEffect(() => {
    setDecidedAddress(null);
    setValidationStatus('pending');
  }, [
    shipTo?.street1,
    shipTo?.street2,
    shipTo?.city,
    shipTo?.state,
    shipTo?.zip,
    shipTo?.country,
  ]);

  // Save draft on any relevant state change. We debounce by 300ms so that
  // typing into a box weight field doesn't fire a localStorage write per
  // keystroke. localStorage writes are sync and fast, so this is more about
  // hygiene than performance.
  useEffect(() => {
    if (!draftKey || createdShipment) return;
    if (!draftRestoredRef.current) return;
    const handle = setTimeout(() => {
      try {
        const draft = {
          shipVia,
          boxes,
          signatureRequired,
          saturdayDelivery,
          codEnabled,
          codMode,
          codAmounts,
          codTotalAmount,
          codPaymentType,
          advancedOpen,
          shipTo,
          addressManuallyEdited,
          savedAt: Date.now(),
        };
        localStorage.setItem(draftKey, JSON.stringify(draft));
      } catch (e) {
        // Out of space, in private mode, etc — non-fatal. The user just won't
        // get persistence for this session.
        console.warn('Failed to save shipping draft:', e);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [
    draftKey,
    createdShipment,
    shipVia,
    boxes,
    signatureRequired,
    saturdayDelivery,
    codEnabled,
    codMode,
    codAmounts,
    codTotalAmount,
    codPaymentType,
    advancedOpen,
    shipTo,
    addressManuallyEdited,
  ]);

  // Clear the draft once the label has been successfully created.
  useEffect(() => {
    if (createdShipment && draftKey) {
      try {
        localStorage.removeItem(draftKey);
      } catch {}
    }
  }, [createdShipment, draftKey]);

  // Manual "clear & start over" — discards the draft and resets the form.
  function clearDraft() {
    if (draftKey) {
      try {
        localStorage.removeItem(draftKey);
      } catch {}
    }
    setBoxes([]);
    setSignatureRequired(false);
    setSaturdayDelivery(false);
    setCodEnabled(false);
    setCodMode('per_box');
    setCodAmounts([]);
    setCodTotalAmount(0);
    setCodPaymentType('');
    setAdvancedOpen(false);
    setDraftRestored(false);
    // Reset address to the PT defaults
    if (originalShipTo) setShipTo(originalShipTo);
    setAddressManuallyEdited(false);
    setEditingAddress(false);
    setEditForm(null);
    setEditError(null);
    // Restore default ship_via from PT
    if (detail?.pick_ticket?.ship_via) {
      setShipVia(guessShipVia(detail.pick_ticket.ship_via));
    } else {
      setShipVia('UPS Ground');
    }
  }

  // ── Address edit helpers ──────────────────────────────────────────────
  function openAddressEditor() {
    setEditForm({
      name: shipTo?.name || '',
      company: shipTo?.company || '',
      phone: shipTo?.phone || '',
      email: shipTo?.email || '',
      street1: shipTo?.street1 || '',
      street2: shipTo?.street2 || '',
      city: shipTo?.city || '',
      state: shipTo?.state || '',
      zip: shipTo?.zip || '',
      country: shipTo?.country || 'US',
    });
    setEditError(null);
    setEditingAddress(true);
  }

  function saveAddressEdit() {
    if (!editForm) return;
    if (
      !editForm.street1.trim() ||
      !editForm.city.trim() ||
      !editForm.state.trim() ||
      !editForm.zip.trim()
    ) {
      setEditError('Street, city, state, and zip are required.');
      return;
    }
    const cleaned: AddressShape = {
      name: editForm.name?.trim() || undefined,
      company: editForm.company?.trim() || undefined,
      phone: editForm.phone?.trim() || undefined,
      email: editForm.email?.trim() || undefined,
      street1: editForm.street1.trim(),
      street2: editForm.street2?.trim() || undefined,
      city: editForm.city.trim(),
      state: editForm.state.trim().toUpperCase(),
      zip: editForm.zip.trim(),
      country: (editForm.country || 'US').trim().toUpperCase(),
    };
    setShipTo(cleaned);
    setAddressManuallyEdited(true);
    setEditingAddress(false);
    setEditError(null);
  }

  function cancelAddressEdit() {
    setEditingAddress(false);
    setEditForm(null);
    setEditError(null);
  }

  function revertAddressToPt() {
    if (!originalShipTo) return;
    setShipTo(originalShipTo);
    setAddressManuallyEdited(false);
    setEditingAddress(false);
    setEditForm(null);
    setEditError(null);
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

  // Reset rate quote when key inputs change. Note: when advanced options
  // change, rate also needs a refresh because Saturday / COD / signature
  // can affect the carrier's quoted price.
  useEffect(() => {
    setQuotes(null);
    setRateError(null);
  }, [
    shipVia,
    boxes,
    decidedAddress,
    signatureRequired,
    saturdayDelivery,
    codEnabled,
    codMode,
    codAmounts,
    codTotalAmount,
    codPaymentType,
  ]);

  /**
   * Validate the advanced options. Returns null if everything checks out, or
   * a human-readable error string. Run this before any rate or label call.
   */
  function validateAdvancedOptions(): string | null {
    if (!codEnabled) return null;
    if (!codPaymentType) return 'Please select a COD payment type';
    if (codMode === 'per_shipment') {
      if (!codTotalAmount || codTotalAmount <= 0) {
        return 'COD total amount must be greater than $0';
      }
    } else {
      if (codAmounts.length !== boxes.length) {
        return 'COD per-box amounts are out of sync with boxes';
      }
      if (!codAmounts.every((a) => a > 0)) {
        return 'Each box must have a COD amount greater than $0';
      }
    }
    return null;
  }

  /**
   * Build the shared {signature_required, saturday_delivery, cod} payload
   * that goes on both /rates and /labels/create requests.
   */
  function buildAdvancedPayload() {
    const cod = codEnabled
      ? {
          enabled: true,
          mode: codMode,
          payment_type: codPaymentType,
          total_amount: codMode === 'per_shipment' ? codTotalAmount : undefined,
          per_box_amounts: codMode === 'per_box' ? codAmounts : undefined,
        }
      : undefined;
    return {
      signature_required: signatureRequired,
      saturday_delivery: saturdayDelivery,
      cod,
    };
  }

  const canPrint =
    !!decidedAddress &&
    boxes.length > 0 &&
    boxes.every(
      (b) => b.weightOz > 0 && b.length > 0 && b.width > 0 && b.height > 0
    );

  async function handleGetRate() {
    if (!decidedAddress || !detail) return;
    const advancedErr = validateAdvancedOptions();
    if (advancedErr) {
      setRateError(advancedErr);
      return;
    }
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
          ...buildAdvancedPayload(),
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
    const advancedErr = validateAdvancedOptions();
    if (advancedErr) {
      setLabelError(advancedErr);
      return;
    }
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
          ...buildAdvancedPayload(),
        }),
      });
      const data: CreateLabelResponse = await res.json();
      if (!res.ok || data.error) {
        setLabelError(data.error || `HTTP ${res.status}`);
        return;
      }
      setCreatedShipment(data);

      // Open every label, not just the first one. UPS returns one ZPL per
      // package and EasyPost returns one URL per parcel, so a multi-box
      // shipment has N labels to print.
      //
      // Rendering strategy:
      //   - PDFs (EasyPost USPS) just open as URLs.
      //   - ZPLs (UPS) need to be rendered to PNG via Labelary first.
      //
      // We render all of them sequentially, then open every URL in a tight
      // loop so the window.open() calls all happen within one click context.
      // This keeps the browser's popup blocker from eating tabs 2..N.
      //
      // If the blocker still eats some, the labels are still saved in
      // createdShipment.boxes — the user can re-open them from the post-print
      // modal or the shipment detail page.
      const labelBoxes = data.boxes || [];
      const urlsToOpen: string[] = [];

      for (const box of labelBoxes) {
        if (box.pdf_url) {
          urlsToOpen.push(box.pdf_url);
        } else if (box.zpl) {
          try {
            const labelaryRes = await fetch(
              'https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/',
              {
                method: 'POST',
                headers: {
                  Accept: 'image/png',
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: box.zpl,
              }
            );
            if (labelaryRes.ok) {
              const blob = await labelaryRes.blob();
              urlsToOpen.push(URL.createObjectURL(blob));
            }
          } catch (e) {
            console.warn('label preview render failed:', e);
          }
        }
      }

      // Open every URL. The first call almost always works; subsequent calls
      // may be blocked by the popup blocker depending on browser settings.
      for (const url of urlsToOpen) {
        window.open(url, '_blank');
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

  const codBoxTotal = codAmounts.reduce((s, n) => s + (n || 0), 0);

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
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                Ship to
              </h2>
              {!editingAddress && (
                <button
                  type="button"
                  onClick={openAddressEditor}
                  className="text-xs text-brand-600 hover:underline"
                >
                  {shipTo ? 'Edit address' : 'Add address'}
                </button>
              )}
            </div>

            {editingAddress && editForm ? (
              <div className="card border-brand-200 bg-brand-50/30 space-y-3">
                <p className="text-xs font-medium text-gray-700">
                  Edit ship-to address for this shipment only. Saving will re-run
                  UPS validation. The pick ticket, order, and invoice are not
                  changed.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <AddressField
                    label="Name"
                    value={editForm.name || ''}
                    onChange={(v) => setEditForm({ ...editForm, name: v })}
                  />
                  <AddressField
                    label="Company"
                    value={editForm.company || ''}
                    onChange={(v) => setEditForm({ ...editForm, company: v })}
                  />
                  <AddressField
                    label="Phone"
                    value={editForm.phone || ''}
                    onChange={(v) => setEditForm({ ...editForm, phone: v })}
                  />
                  <AddressField
                    label="Email"
                    value={editForm.email || ''}
                    onChange={(v) => setEditForm({ ...editForm, email: v })}
                  />
                </div>
                <AddressField
                  label="Street"
                  required
                  value={editForm.street1}
                  onChange={(v) => setEditForm({ ...editForm, street1: v })}
                />
                <AddressField
                  label="Street line 2"
                  value={editForm.street2 || ''}
                  onChange={(v) => setEditForm({ ...editForm, street2: v })}
                />
                <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_140px] gap-2">
                  <AddressField
                    label="City"
                    required
                    value={editForm.city}
                    onChange={(v) => setEditForm({ ...editForm, city: v })}
                  />
                  <AddressField
                    label="State"
                    required
                    value={editForm.state}
                    onChange={(v) =>
                      setEditForm({ ...editForm, state: v.toUpperCase().slice(0, 2) })
                    }
                  />
                  <AddressField
                    label="Zip"
                    required
                    value={editForm.zip}
                    onChange={(v) => setEditForm({ ...editForm, zip: v })}
                  />
                </div>
                {editError && (
                  <p className="text-xs text-red-700">{editError}</p>
                )}
                <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={saveAddressEdit}
                    className="px-3 py-1.5 text-xs font-medium bg-brand-600 text-white rounded hover:bg-brand-700"
                  >
                    Save &amp; re-validate
                  </button>
                  <button
                    type="button"
                    onClick={cancelAddressEdit}
                    className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  {addressManuallyEdited && originalShipTo && (
                    <button
                      type="button"
                      onClick={revertAddressToPt}
                      className="ml-auto text-xs text-gray-500 hover:text-gray-700 hover:underline"
                    >
                      Revert to PT address
                    </button>
                  )}
                </div>
              </div>
            ) : shipTo ? (
              <>
                {addressManuallyEdited && (
                  <div className="flex items-center gap-2 mb-2 text-xs text-amber-800 bg-amber-50/60 border border-amber-200 rounded px-2 py-1.5">
                    <svg
                      className="w-3.5 h-3.5 flex-shrink-0"
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
                    <span>
                      Manually edited — this shipment will use the address below.
                      The PT, order, and invoice are unchanged.
                    </span>
                    {originalShipTo && (
                      <button
                        type="button"
                        onClick={revertAddressToPt}
                        className="ml-auto underline hover:text-amber-900 whitespace-nowrap"
                      >
                        Revert
                      </button>
                    )}
                  </div>
                )}
                <AddressValidationCard
                  originalAddress={shipTo}
                  carrier={carrier}
                  onAddressDecided={(addr, status) => {
                    setDecidedAddress(addr);
                    setValidationStatus(status);
                  }}
                  reloadKey={`${carrier}|${shipTo.street1}|${shipTo.zip}`}
                />
              </>
            ) : (
              <div className="card text-sm text-red-700 bg-red-50/40 border-red-200">
                This PT is missing a ship-to address. Click <span className="font-semibold">Add address</span> above to enter one for this shipment.
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

        {/* RIGHT — Service + Boxes + Advanced + Actions */}
        <div className="space-y-6">
          {/* Draft restored indicator */}
          {draftRestored && !createdShipment && (
            <div className="card border-blue-200 bg-blue-50/40">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <svg
                    className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0"
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
                  <div className="text-xs">
                    <p className="font-medium text-blue-900">Draft restored</p>
                    <p className="text-blue-800 mt-0.5">
                      Your previous boxes and options were saved automatically.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        'Discard saved draft and start over with a blank form?'
                      )
                    ) {
                      clearDraft();
                    }
                  }}
                  className="text-xs text-blue-700 hover:underline whitespace-nowrap"
                >
                  Start over
                </button>
              </div>
            </div>
          )}

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

          {/* Advanced options — collapsed by default. 95%+ of shipments
              never need this section. */}
          <section>
            <div className="card">
              <button
                onClick={() => setAdvancedOpen((o) => !o)}
                className="w-full flex items-center justify-between text-sm text-gray-700 hover:text-gray-900"
                type="button"
              >
                <span className="font-medium">Advanced options</span>
                <span className="flex items-center gap-2 text-xs text-gray-500">
                  {(signatureRequired || saturdayDelivery || codEnabled) && (
                    <span className="badge badge-gray text-[10px]">
                      {[
                        signatureRequired && 'sig',
                        saturdayDelivery && 'sat',
                        codEnabled && 'COD',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                  <svg
                    className={`w-4 h-4 transition-transform ${advancedOpen ? 'rotate-90' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>

              {advancedOpen && (
                <div className="mt-4 space-y-4 pt-4 border-t border-gray-100">
                  {/* Signature */}
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={signatureRequired}
                      disabled={codEnabled}
                      onChange={(e) => setSignatureRequired(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                    />
                    <div className="flex-1">
                      <span className="text-sm text-gray-900">
                        Require signature on delivery
                      </span>
                      {codEnabled && (
                        <span className="block text-xs text-gray-500">
                          Required for COD shipments
                        </span>
                      )}
                    </div>
                  </label>

                  {/* Saturday */}
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saturdayDelivery}
                      onChange={(e) => setSaturdayDelivery(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="text-sm text-gray-900">Saturday delivery</span>
                  </label>

                  {/* COD */}
                  <div className="border-t border-gray-100 pt-4">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={codEnabled}
                        onChange={(e) => setCodEnabled(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="text-sm font-medium text-gray-900">
                        Collect on Delivery (COD)
                      </span>
                    </label>

                    {codEnabled && (
                      <div className="mt-4 ml-6 space-y-4">
                        {/* Mode picker */}
                        <div className="flex flex-col gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="codMode"
                              checked={codMode === 'per_box'}
                              onChange={() => setCodMode('per_box')}
                              className="text-brand-600 focus:ring-brand-500"
                            />
                            <span className="text-sm text-gray-700">
                              COD per box
                            </span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="codMode"
                              checked={codMode === 'per_shipment'}
                              onChange={() => setCodMode('per_shipment')}
                              className="text-brand-600 focus:ring-brand-500"
                            />
                            <span className="text-sm text-gray-700">
                              One COD for entire shipment
                            </span>
                          </label>
                        </div>

                        {/* Amount inputs */}
                        {codMode === 'per_shipment' ? (
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">
                              Total amount
                            </label>
                            <div className="flex items-center max-w-[200px]">
                              <span className="px-3 py-1.5 bg-gray-100 border border-gray-300 rounded-l text-sm text-gray-600">
                                $
                              </span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={codTotalAmount || ''}
                                onChange={(e) =>
                                  setCodTotalAmount(parseFloat(e.target.value) || 0)
                                }
                                className="flex-1 px-3 py-1.5 border border-l-0 border-gray-300 rounded-r outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                                placeholder="0.00"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {boxes.map((_, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <span className="text-xs text-gray-600 w-14">
                                  Box {idx + 1}
                                </span>
                                <span className="px-2 py-1 bg-gray-100 border border-gray-300 rounded-l text-xs text-gray-600">
                                  $
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={codAmounts[idx] || ''}
                                  onChange={(e) => {
                                    const next = [...codAmounts];
                                    next[idx] = parseFloat(e.target.value) || 0;
                                    setCodAmounts(next);
                                  }}
                                  className="flex-1 px-2 py-1 border border-l-0 border-gray-300 rounded-r outline-none focus:ring-2 focus:ring-brand-500 text-sm max-w-[120px]"
                                  placeholder="0.00"
                                />
                              </div>
                            ))}
                            <div className="text-xs text-gray-500 pl-16">
                              Total: <span className="font-medium text-gray-700">
                                ${codBoxTotal.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Payment type */}
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">
                            Payment type <span className="text-red-500">*</span>
                          </label>
                          <select
                            value={codPaymentType}
                            onChange={(e) =>
                              setCodPaymentType(e.target.value as CodPaymentType)
                            }
                            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg outline-none bg-white text-sm focus:ring-2 focus:ring-brand-500"
                          >
                            <option value="">— select —</option>
                            <option value="cashiers_check">
                              Cashier&apos;s check or money order
                            </option>
                            <option value="any_check">
                              Any check (cashier&apos;s, business, personal)
                            </option>
                            <option value="cash">Cash</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
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
              <div className="mt-3 card bg-gray-50/50 space-y-2">
                {quotes.map((q) => {
                  const surcharges = estimateUpsSurcharges({
                    carrier,
                    codEnabled,
                    codMode,
                    codAmounts,
                    codTotalAmount,
                    signatureRequired,
                    saturdayDelivery,
                    boxCount: boxes.length,
                  });
                  const grandTotal = q.totalUsd + surcharges.total;
                  const hasAnySurcharge = surcharges.total > 0;

                  return (
                    <div key={q.serviceCode}>
                      <div className="flex items-baseline justify-between">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {q.serviceName}
                          </div>
                          <div className="text-xs text-gray-500">
                            Transportation only
                            {q.estimatedDays
                              ? ` · ${q.estimatedDays} day${q.estimatedDays === 1 ? '' : 's'} in transit`
                              : ''}
                          </div>
                        </div>
                        <div className="text-sm font-medium text-gray-900">
                          ${q.totalUsd.toFixed(2)}
                        </div>
                      </div>

                      {hasAnySurcharge && (
                        <div className="mt-2 pt-2 border-t border-gray-200 space-y-1">
                          {surcharges.cod > 0 && (
                            <div className="flex items-baseline justify-between text-sm">
                              <span className="text-gray-700">
                                COD
                                {codMode === 'per_box' && boxes.length > 1 && (
                                  <span className="text-xs text-gray-500 ml-1">
                                    ({boxes.length} packages)
                                  </span>
                                )}
                              </span>
                              <span className="text-gray-900">
                                ${surcharges.cod.toFixed(2)}
                              </span>
                            </div>
                          )}
                          {surcharges.signature > 0 && (
                            <div className="flex items-baseline justify-between text-sm">
                              <span className="text-gray-700">
                                Signature
                                {boxes.length > 1 && (
                                  <span className="text-xs text-gray-500 ml-1">
                                    ({boxes.length} packages)
                                  </span>
                                )}
                              </span>
                              <span className="text-gray-900">
                                ${surcharges.signature.toFixed(2)}
                              </span>
                            </div>
                          )}
                          {surcharges.saturday > 0 && (
                            <div className="flex items-baseline justify-between text-sm">
                              <span className="text-gray-700">Saturday delivery</span>
                              <span className="text-gray-900">
                                ${surcharges.saturday.toFixed(2)}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-2 pt-2 border-t border-gray-300 flex items-baseline justify-between">
                        <span className="text-sm font-semibold text-gray-900">
                          {hasAnySurcharge ? 'Total estimated' : 'Total'}
                        </span>
                        <span className="text-lg font-bold text-gray-900">
                          ${grandTotal.toFixed(2)}
                        </span>
                      </div>

                      {hasAnySurcharge && (
                        <div className="mt-2 text-xs text-gray-500">
                          Surcharges are estimated based on UPS published 2026
                          rates. Actual billed amounts may differ based on contract
                          and fuel surcharges. Final cost confirmed after the label
                          is printed.
                        </div>
                      )}
                    </div>
                  );
                })}
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

function AddressField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-600 block mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 border border-gray-300 rounded outline-none bg-white text-sm focus:ring-2 focus:ring-brand-500"
      />
    </label>
  );
}
