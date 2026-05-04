/**
 * EasyPost (USPS) carrier client. Implements the CarrierClient interface
 * end-to-end after Week 3: validateAddress (Week 1), getRates, createLabel,
 * voidLabel.
 *
 * EasyPost's shipment model is "one shipment = one parcel". For multi-box
 * sends, we create N shipments — each gets its own tracking number.
 * Conceptually equivalent to UPS's "one shipment, many packages" model from
 * the user's perspective, but the carrier API surface differs.
 *
 * EasyPost endpoints used:
 *   POST /v2/addresses                   (Week 1 — address validation)
 *   POST /v2/shipments                   (creates shipment, returns rates[])
 *   POST /v2/shipments/{id}/buy          (purchases the chosen rate, returns label)
 *   POST /v2/shipments/{id}/refund       (void / refund the postage)
 *   GET  /v2/trackers/{id}               (tracking — Week 7)
 */

import {
  Address,
  AddressValidationResult,
  AddressValidationStatus,
  BoxLabel,
  CarrierClient,
  CarrierKey,
  LabelRequest,
  LabelResult,
  RateQuote,
  RateRequest,
  TrackResult,
  VoidRequest,
  VoidResult,
} from '../types';
import {
  addressToEasypostFields,
  appendFormParams,
  boxToEasypostParcel,
  easypostServiceName,
  serviceCodeForEasypost,
} from './mappers';

const NOT_IMPLEMENTED = 'Not implemented yet';
const EASYPOST_BASE = 'https://api.easypost.com/v2';

function easypostKey(): string {
  const key =
    process.env.EASYPOST_ENV === 'production'
      ? process.env.EASYPOST_API_KEY
      : process.env.EASYPOST_TEST_API_KEY;
  if (!key) {
    throw new Error(
      `EasyPost key not set for env=${process.env.EASYPOST_ENV ?? 'undefined'}. ` +
        `Set EASYPOST_TEST_API_KEY (test) or EASYPOST_API_KEY (production).`
    );
  }
  return key;
}

function easypostAuthHeader(): string {
  const basic = Buffer.from(`${easypostKey()}:`).toString('base64');
  return `Basic ${basic}`;
}

async function easypostFetch(
  path: string,
  init: RequestInit & { form?: URLSearchParams }
): Promise<{ res: Response; json: any }> {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', easypostAuthHeader());
  if (init.form) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
  }

  const fetchInit: RequestInit = {
    ...init,
    headers,
    body: init.form ? init.form.toString() : init.body,
  };
  delete (fetchInit as any).form;

  const res = await fetch(`${EASYPOST_BASE}${path}`, fetchInit);
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`EasyPost returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  return { res, json };
}

function extractEasypostError(json: any, fallback: string): string {
  if (json?.error?.message) {
    const errs = json.error.errors;
    if (Array.isArray(errs) && errs.length > 0) {
      return errs.map((e: any) => `${e.field || ''}: ${e.message}`).join('; ');
    }
    return json.error.message;
  }
  return fallback;
}

export class EasyPostClient implements CarrierClient {
  readonly key: CarrierKey = 'easypost_usps';

  // ── Address validation (Week 1) ─────────────────────────────────────

  async validateAddress(address: Address): Promise<AddressValidationResult> {
    const params = new URLSearchParams();
    appendFormParams(params, 'address', addressToEasypostFields(address));
    params.append('address[verify][]', 'delivery');

    const { res, json } = await easypostFetch('/addresses', {
      method: 'POST',
      form: params,
    });

    if (!res.ok) {
      throw new Error(`EasyPost AVS failed: ${extractEasypostError(json, `HTTP ${res.status}`)}`);
    }

    const street1Upper = (json.street1 || '').toUpperCase();
    const isPoBox = /\bP\.?\s*O\.?\s*BOX\b/.test(street1Upper);
    const isApoFpo =
      /\b(APO|FPO|DPO)\b/.test(street1Upper) ||
      ['AA', 'AE', 'AP'].includes((json.state || '').toUpperCase());

    const verifications = json.verifications?.delivery;
    const success: boolean = verifications?.success === true;
    const errors: any[] = verifications?.errors || [];

    if (!success && errors.length > 0) {
      return {
        status: isPoBox ? 'po_box' : isApoFpo ? 'apo_fpo' : 'undeliverable',
        messages: errors.map((e) => e.message || 'Validation error'),
        rawResponse: json,
      };
    }

    const isResidential =
      typeof json.residential === 'boolean'
        ? json.residential
        : verifications?.details?.is_residential;

    const validated: Address = {
      ...address,
      street1: json.street1 || address.street1,
      street2: json.street2 || undefined,
      city: json.city || address.city,
      state: json.state || address.state,
      zip: json.zip || address.zip,
      country: json.country || address.country || 'US',
      isResidential,
    };

    const differs =
      validated.street1.toUpperCase() !== address.street1.toUpperCase() ||
      (validated.street2 || '').toUpperCase() !== (address.street2 || '').toUpperCase() ||
      validated.city.toUpperCase() !== address.city.toUpperCase() ||
      validated.state.toUpperCase() !== address.state.toUpperCase() ||
      validated.zip.split('-')[0] !== address.zip.split('-')[0];

    let status: AddressValidationStatus = differs ? 'corrected' : 'verified';
    if (isPoBox) status = 'po_box';
    if (isApoFpo) status = 'apo_fpo';

    return {
      status,
      isResidential,
      validatedAddress: validated,
      rawResponse: json,
    };
  }

  // ── Rating (Week 3) ─────────────────────────────────────────────────

  /**
   * Get USPS rates for a shipment. EasyPost's model means we create one
   * shipment object with one parcel and read the rates[] array off the
   * response.
   *
   * For multi-box, we use the FIRST box only for rate quoting — this gives
   * a per-box rate that we'll multiply at the UI level. Actual purchase
   * still creates N shipments and sums the actual costs. This mirrors how
   * USPS pricing works (per-package).
   *
   * If serviceCode is set, we filter to that one service.
   */
  async getRates(req: RateRequest): Promise<RateQuote[]> {
    if (!req.boxes.length) throw new Error('getRates: no boxes');
    const firstBox = req.boxes[0];

    const params = new URLSearchParams();
    appendFormParams(params, 'shipment[to_address]', addressToEasypostFields(req.shipTo));
    appendFormParams(params, 'shipment[from_address]', addressToEasypostFields(req.shipFrom));
    appendFormParams(params, 'shipment[parcel]', boxToEasypostParcel(firstBox));

    const { res, json } = await easypostFetch('/shipments', {
      method: 'POST',
      form: params,
    });

    if (!res.ok) {
      throw new Error(`EasyPost rating failed: ${extractEasypostError(json, `HTTP ${res.status}`)}`);
    }

    const rates: any[] = Array.isArray(json.rates) ? json.rates : [];
    const filterCode = req.serviceCode ? serviceCodeForEasypost(req.serviceCode) : null;

    const quotes: RateQuote[] = rates
      .filter((r) => r.carrier === 'USPS')
      .filter((r) => (filterCode ? r.service === filterCode : true))
      .map((r) => ({
        carrier: 'easypost_usps' as CarrierKey,
        serviceCode: r.service,
        serviceName: easypostServiceName(r.service),
        totalUsd: parseFloat(r.rate) || 0,
        estimatedDays: r.delivery_days ?? r.est_delivery_days ?? undefined,
        rawResponse: r,
      }));

    // For multi-box, multiply the rate quote by the number of boxes (USPS
    // rates are per-package). Actual purchase will sum real costs.
    if (req.boxes.length > 1) {
      return quotes.map((q) => ({
        ...q,
        totalUsd: q.totalUsd * req.boxes.length,
      }));
    }

    return quotes;
  }

  // ── Shipping / Label creation (Week 3) ──────────────────────────────

  /**
   * Create labels for N boxes by creating N EasyPost shipments and buying
   * each one with the matching service. Each box gets its own tracking
   * number, ZPL label, and cost.
   *
   * EasyPost's model is one parcel per shipment, so we issue parallel
   * create+buy pairs for each box. Calls happen in series for clarity
   * (parallel could starve test-mode rate limits at higher box counts).
   */
  async createLabel(req: LabelRequest): Promise<LabelResult> {
    const serviceCode = serviceCodeForEasypost(req.serviceCode);

    const boxLabels: BoxLabel[] = [];
    const easypostShipmentIds: string[] = [];
    let totalCost = 0;

    for (const [i, box] of req.boxes.entries()) {
      // 1. Create the shipment
      const createParams = new URLSearchParams();
      appendFormParams(
        createParams,
        'shipment[to_address]',
        addressToEasypostFields(req.shipTo)
      );
      appendFormParams(
        createParams,
        'shipment[from_address]',
        addressToEasypostFields(req.shipFrom)
      );
      appendFormParams(createParams, 'shipment[parcel]', boxToEasypostParcel(box));

      // Reference info for our own audit
      const ref = box.reference || req.reference || `box-${i + 1}`;
      createParams.set('shipment[reference]', ref);

      // Request ZPL output. PNG remains the default but ZPL URL appears
      // when this option is set.
      createParams.set('shipment[options][label_format]', 'ZPL');
      createParams.set('shipment[options][label_size]', '4x6');

      const { res: createRes, json: createJson } = await easypostFetch('/shipments', {
        method: 'POST',
        form: createParams,
      });
      if (!createRes.ok) {
        throw new Error(
          `EasyPost shipment create failed (box ${i + 1}): ${extractEasypostError(createJson, `HTTP ${createRes.status}`)}`
        );
      }

      const shipmentId = createJson.id;
      if (!shipmentId) throw new Error(`EasyPost: no shipment id returned for box ${i + 1}`);

      // 2. Find the chosen rate
      const rates: any[] = Array.isArray(createJson.rates) ? createJson.rates : [];
      const chosenRate = rates.find(
        (r) => r.carrier === 'USPS' && r.service === serviceCode
      );
      if (!chosenRate) {
        const available = rates.map((r) => `${r.carrier}/${r.service}`).join(', ');
        throw new Error(
          `EasyPost: service '${serviceCode}' not available for box ${i + 1}. ` +
            `Available rates: ${available || '(none)'}`
        );
      }

      // 3. Buy the rate (= purchase the label)
      const buyParams = new URLSearchParams();
      buyParams.set('rate[id]', chosenRate.id);

      const { res: buyRes, json: buyJson } = await easypostFetch(
        `/shipments/${encodeURIComponent(shipmentId)}/buy`,
        { method: 'POST', form: buyParams }
      );
      if (!buyRes.ok) {
        throw new Error(
          `EasyPost shipment buy failed (box ${i + 1}): ${extractEasypostError(buyJson, `HTTP ${buyRes.status}`)}`
        );
      }

      const tracking = buyJson.tracking_code || '';
      const cost = parseFloat(buyJson.selected_rate?.rate || chosenRate.rate || '0') || 0;
      totalCost += cost;

      // 4. Fetch the ZPL contents from the URL.
      // EasyPost returns label_zpl_url as a CDN URL — we GET the ZPL text and store
      // it directly so we don't have to re-fetch every time we want to print/preview.
      const zplUrl = buyJson.postage_label?.label_zpl_url;
      let zpl: string | undefined = undefined;
      let pdfUrl: string | undefined = buyJson.postage_label?.label_url || undefined;
      if (zplUrl) {
        try {
          const zplRes = await fetch(zplUrl);
          if (zplRes.ok) zpl = await zplRes.text();
        } catch (e) {
          console.warn(`[easypost] failed to fetch ZPL for box ${i + 1}:`, e);
        }
      }

      easypostShipmentIds.push(shipmentId);
      boxLabels.push({
        trackingNumber: tracking,
        zpl,
        pdfUrl,
        costUsd: cost,
      });
    }

    return {
      carrier: 'easypost_usps',
      serviceCode: req.serviceCode,
      serviceName: easypostServiceName(serviceCode),
      totalCostUsd: totalCost,
      boxes: boxLabels,
      // Comma-separated list of EasyPost shipment ids — needed for void.
      // Each ID can be voided/refunded independently.
      carrierShipmentId: easypostShipmentIds.join(','),
    };
  }

  // ── Void / Refund (Week 3) ──────────────────────────────────────────

  /**
   * Refund all or specific EasyPost shipments. carrierShipmentId may be a
   * comma-separated list (multi-box). We refund each one and return success
   * only if all succeed.
   *
   * EasyPost refunds:
   *   - In test mode, refunds are instant
   *   - In production, USPS refunds enter "submitted" status and take 14-28
   *     days to be approved. EasyPost handles the approval workflow.
   */
  async voidLabel(req: VoidRequest): Promise<VoidResult> {
    if (!req.carrierShipmentId) {
      throw new Error('voidLabel: carrierShipmentId is required for EasyPost voids');
    }

    const ids = req.carrierShipmentId.split(',').filter(Boolean);
    if (ids.length === 0) throw new Error('voidLabel: empty carrierShipmentId');

    const results: { id: string; success: boolean; status?: string; error?: string }[] = [];
    for (const id of ids) {
      const { res, json } = await easypostFetch(
        `/shipments/${encodeURIComponent(id)}/refund`,
        { method: 'POST' }
      );
      if (!res.ok) {
        results.push({
          id,
          success: false,
          error: extractEasypostError(json, `HTTP ${res.status}`),
        });
        continue;
      }
      const status = json?.refund_status || 'submitted';
      results.push({
        id,
        success: status !== 'rejected',
        status,
      });
    }

    const allSuccess = results.every((r) => r.success);
    const message = results
      .map((r) => `${r.id}: ${r.success ? r.status || 'ok' : r.error}`)
      .join('; ');

    return {
      success: allSuccess,
      message,
      rawResponse: results,
    };
  }

  // ── Track (Week 7) ──────────────────────────────────────────────────

  async track(_trackingNumber: string): Promise<TrackResult> {
    throw new Error(`${NOT_IMPLEMENTED} (Week 7)`);
  }
}

export const easypostClient = new EasyPostClient();
