/**
 * UPS carrier client. Implements the CarrierClient interface end-to-end
 * for Week 2: validateAddress, getRates, createLabel, voidLabel.
 * track() lands in Week 7 with the webhook ingestion path.
 *
 * UPS API surface used:
 *   - POST /api/addressvalidation/v2/3     (already implemented in Week 1)
 *   - POST /api/rating/v2403/Rate
 *   - POST /api/shipments/v2403/ship
 *   - DELETE /api/shipments/v1/void/cancel/{shipmentidentificationnumber}
 *
 * UPS bumped the API to v2403 (year+month versioning) in 2024. Earlier
 * versions like v1 still work but lack newer features. We use v2403.
 *
 * Note: Rating expects "PackagingType" while Shipping expects "Packaging"
 * for the same field. boxToUpsPackage() takes an apiSurface flag for this.
 *
 * Per-package vs per-shipment options:
 *   - COD: per-package only. In 'per_box' mode, each package gets its own
 *     COD amount. In 'per_shipment' mode, only the first (control) package
 *     gets COD with the full total — boxes 2..N have no COD attached.
 *   - Signature: per-package, applied uniformly to every package when set.
 *   - Saturday Delivery: shipment-level only (ShipmentServiceOptions).
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
import { getUpsToken, upsBaseUrl } from './auth';
import {
  addressToShipFromBlock,
  addressToShipToBlock,
  addressToShipperBlock,
  boxToUpsPackage,
  COD_FUNDS_CODE,
  UpsPackageOptions,
} from './mappers';

const NOT_IMPLEMENTED = 'Not implemented yet';

// ── Service code → human name (mirrors shipping_service_map) ──────────
const SERVICE_NAMES: Record<string, string> = {
  '01': 'UPS Next Day Air',
  '02': 'UPS 2nd Day Air',
  '03': 'UPS Ground',
  '07': 'UPS Worldwide Express',
  '08': 'UPS Worldwide Expedited',
  '11': 'UPS Standard',
  '12': 'UPS 3 Day Select',
  '13': 'UPS Next Day Air Saver',
  '14': 'UPS Next Day Air Early',
  '54': 'UPS Worldwide Express Plus',
  '59': 'UPS 2nd Day Air A.M.',
  '65': 'UPS Worldwide Saver',
};

function serviceName(code: string): string {
  return SERVICE_NAMES[code] || `UPS Service ${code}`;
}

function shipperNumber(): string {
  const num = process.env.UPS_ACCOUNT_NUMBER;
  if (!num) throw new Error('UPS_ACCOUNT_NUMBER not set in environment');
  return num;
}

async function upsFetch(path: string, init: RequestInit) {
  const token = await getUpsToken();
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  headers.set('transId', `hq-${Date.now()}`);
  headers.set('transactionSrc', 'AdvanceHQ');

  const res = await fetch(`${upsBaseUrl()}${path}`, { ...init, headers });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`UPS returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  return { res, json };
}

function extractUpsError(json: any, fallback: string): string {
  const errs = json?.response?.errors;
  if (Array.isArray(errs) && errs.length > 0) {
    return errs.map((e: any) => `${e.code}: ${e.message}`).join('; ');
  }
  return json?.response?.message || fallback;
}

/**
 * Compute the UpsPackageOptions for each package given a RateRequest or
 * LabelRequest. Same logic for both surfaces, factored out so rates and
 * labels stay in lockstep.
 *
 * Returns an array of length boxes.length — one options object per box,
 * indexed by position.
 */
function buildPackageOptionsForBoxes(
  req: RateRequest | LabelRequest
): UpsPackageOptions[] {
  const fundsCode = req.cod?.enabled
    ? COD_FUNDS_CODE[req.cod.payment_type]
    : undefined;

  return req.boxes.map((_, idx) => {
    let codAmount: number | undefined;
    if (req.cod?.enabled) {
      if (req.cod.mode === 'per_box') {
        codAmount = req.cod.per_box_amounts?.[idx];
      } else {
        // per_shipment: only the first box (the "control" package) gets COD
        // with the full total amount. Boxes 2..N have no COD attached.
        codAmount = idx === 0 ? req.cod.total_amount : undefined;
      }
    }

    return {
      codAmount,
      codFundsCode: fundsCode,
      signatureRequired: !!req.signature_required,
    };
  });
}

export class UpsClient implements CarrierClient {
  readonly key: CarrierKey = 'ups';

  // ── Address validation (Week 1) ─────────────────────────────────────

  async validateAddress(address: Address): Promise<AddressValidationResult> {
    const path =
      `/api/addressvalidation/v2/3` +
      `?regionalrequestindicator=1&maximumcandidatelistsize=1`;

    const body = {
      XAVRequest: {
        AddressKeyFormat: {
          AddressLine: [address.street1, address.street2].filter(Boolean) as string[],
          PoliticalDivision2: address.city,
          PoliticalDivision1: address.state,
          PostcodePrimaryLow: address.zip,
          CountryCode: address.country || 'US',
        },
      },
    };

    const { res, json } = await upsFetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`UPS AVS failed: ${extractUpsError(json, `HTTP ${res.status}`)}`);
    }

    const xav = json?.XAVResponse;
    if (!xav) throw new Error('UPS AVS: missing XAVResponse');

    if (xav.NoCandidatesIndicator !== undefined) {
      return {
        status: 'undeliverable',
        messages: ['UPS could not match this address'],
        rawResponse: json,
      };
    }

    const candidate = Array.isArray(xav.Candidate) ? xav.Candidate[0] : xav.Candidate;
    if (!candidate) {
      return {
        status: 'undeliverable',
        messages: ['UPS returned no address candidates'],
        rawResponse: json,
      };
    }

    const akf = candidate.AddressKeyFormat || {};
    const lines: string[] = Array.isArray(akf.AddressLine)
      ? akf.AddressLine
      : akf.AddressLine
      ? [akf.AddressLine]
      : [];

    const validated: Address = {
      ...address,
      street1: lines[0] || address.street1,
      street2: lines[1] || undefined,
      city: akf.PoliticalDivision2 || address.city,
      state: akf.PoliticalDivision1 || address.state,
      zip:
        akf.PostcodePrimaryLow && akf.PostcodeExtendedLow
          ? `${akf.PostcodePrimaryLow}-${akf.PostcodeExtendedLow}`
          : akf.PostcodePrimaryLow || address.zip,
      country: akf.CountryCode || address.country || 'US',
    };

    const isResidential = candidate.AddressClassification?.Code === '2';
    validated.isResidential = isResidential;

    const differs =
      validated.street1.toUpperCase() !== address.street1.toUpperCase() ||
      (validated.street2 || '').toUpperCase() !== (address.street2 || '').toUpperCase() ||
      validated.city.toUpperCase() !== address.city.toUpperCase() ||
      validated.state.toUpperCase() !== address.state.toUpperCase() ||
      validated.zip.split('-')[0] !== address.zip.split('-')[0];

    const status: AddressValidationStatus =
      xav.AmbiguousAddressIndicator !== undefined
        ? 'corrected'
        : differs
        ? 'corrected'
        : 'verified';

    return { status, isResidential, validatedAddress: validated, rawResponse: json };
  }

  // ── Rating (Week 2) ─────────────────────────────────────────────────

  async getRates(req: RateRequest): Promise<RateQuote[]> {
    const requestOption = req.serviceCode ? 'Rate' : 'Shop';
    const path = `/api/rating/v2403/${requestOption}`;

    // INTENTIONAL: We do NOT pass COD / signature / Saturday options to the
    // Rating endpoint. UPS CIE's Rating API rejects these accessories with
    //   "111262: The accessory is not valid with the selected option"
    // even when the corresponding Shipping API call (label creation) accepts
    // them just fine for the same shipment.
    //
    // Net effect: rate preview shows the BASE shipping cost without
    // accessory surcharges (COD ~$15-19, signature ~$5.55, Saturday ~$16).
    // Label creation still sends the full options and prints the correct
    // total. The actual cost reflected back in the post-print modal is
    // authoritative — the rate preview is just a sanity check.
    //
    // If/when UPS fixes CIE Rating's accessory validation (or in production
    // where it may behave differently), we can restore the full options
    // here by re-introducing buildPackageOptionsForBoxes(req).
    const shipment: any = {
      Shipper: addressToShipperBlock(req.shipFrom, shipperNumber()),
      ShipTo: addressToShipToBlock(req.shipTo),
      ShipFrom: addressToShipFromBlock(req.shipFrom),
      // Rating uses 'PackagingType' field. No package options on Rating.
      Package: req.boxes.map((b, i) =>
        boxToUpsPackage(b, `box-${i + 1}`, 'rating')
      ),
    };

    if (req.serviceCode) {
      shipment.Service = { Code: req.serviceCode, Description: serviceName(req.serviceCode) };
    }

    const body = {
      RateRequest: {
        Request: {
          TransactionReference: { CustomerContext: 'AdvanceHQ rate' },
          SubVersion: '2403',
        },
        Shipment: shipment,
      },
    };

    const { res, json } = await upsFetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`UPS Rating failed: ${extractUpsError(json, `HTTP ${res.status}`)}`);
    }

    const ratedShipments = json?.RateResponse?.RatedShipment;
    if (!ratedShipments) {
      throw new Error('UPS Rating: empty RatedShipment in response');
    }
    const arr = Array.isArray(ratedShipments) ? ratedShipments : [ratedShipments];

    return arr.map((rs: any) => {
      const code = rs?.Service?.Code || '';
      const totalStr =
        rs?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ||
        rs?.TotalCharges?.MonetaryValue ||
        '0';
      const days = rs?.GuaranteedDelivery?.BusinessDaysInTransit;
      return {
        carrier: 'ups' as CarrierKey,
        serviceCode: code,
        serviceName: serviceName(code),
        totalUsd: parseFloat(totalStr) || 0,
        estimatedDays: days ? parseInt(days, 10) : undefined,
        rawResponse: rs,
      };
    });
  }

  // ── Shipping / Label creation (Week 2) ──────────────────────────────

  async createLabel(req: LabelRequest): Promise<LabelResult> {
    const path = `/api/shipments/v2403/ship`;

    const pkgOpts = buildPackageOptionsForBoxes(req);

    const shipment: any = {
      Description: 'Apparel',
      Shipper: addressToShipperBlock(req.shipFrom, shipperNumber()),
      ShipTo: addressToShipToBlock(req.shipTo),
      ShipFrom: addressToShipFromBlock(req.shipFrom),
      PaymentInformation: {
        ShipmentCharge: {
          Type: '01',
          BillShipper: { AccountNumber: shipperNumber() },
        },
      },
      Service: {
        Code: req.serviceCode,
        Description: serviceName(req.serviceCode),
      },
      // Shipping uses 'Packaging' field (not 'PackagingType')
      Package: req.boxes.map((b, i) =>
        boxToUpsPackage(b, b.reference || req.reference || `box-${i + 1}`, 'shipping', pkgOpts[i])
      ),
    };

    if (req.saturday_delivery) {
      shipment.ShipmentServiceOptions = {
        ...(shipment.ShipmentServiceOptions || {}),
        SaturdayDelivery: '', // empty string = enable
      };
    }

    const body = {
      ShipmentRequest: {
        Request: {
          TransactionReference: {
            CustomerContext: req.reference || 'AdvanceHQ ship',
          },
          SubVersion: '2403',
          RequestOption: 'nonvalidate',
        },
        Shipment: shipment,
        LabelSpecification: {
          LabelImageFormat: { Code: 'ZPL', Description: 'ZPL' },
          LabelStockSize: { Height: '6', Width: '4' },
        },
      },
    };

    const { res, json } = await upsFetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`UPS Shipping failed: ${extractUpsError(json, `HTTP ${res.status}`)}`);
    }

    const shipResp = json?.ShipmentResponse?.ShipmentResults;
    if (!shipResp) throw new Error('UPS Shipping: missing ShipmentResults');

    const digest = shipResp.ShipmentDigest;

    const totalStr =
      shipResp.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ||
      shipResp.ShipmentCharges?.TotalCharges?.MonetaryValue ||
      '0';
    const totalCostUsd = parseFloat(totalStr) || 0;

    const pkgArr = shipResp.PackageResults
      ? Array.isArray(shipResp.PackageResults)
        ? shipResp.PackageResults
        : [shipResp.PackageResults]
      : [];

    const boxes: BoxLabel[] = pkgArr.map((pr: any) => {
      const tracking = pr.TrackingNumber || '';
      const labelBase64 =
        pr.ShippingLabel?.GraphicImage || pr.ShippingLabel?.HTMLImage || '';
      const zpl = labelBase64
        ? Buffer.from(labelBase64, 'base64').toString('utf8')
        : undefined;
      const cost = parseFloat(
        pr.NegotiatedCharges?.TotalCharge?.MonetaryValue ||
          pr.BaseServiceCharge?.MonetaryValue ||
          '0'
      );
      return {
        trackingNumber: tracking,
        zpl,
        costUsd: isFinite(cost) ? cost : undefined,
      };
    });

    return {
      carrier: 'ups',
      serviceCode: req.serviceCode,
      serviceName: serviceName(req.serviceCode),
      totalCostUsd,
      boxes,
      upsShipmentDigest: digest,
      rawResponse: json,
    };
  }

  // ── Void (Week 2) ───────────────────────────────────────────────────

  async voidLabel(req: VoidRequest): Promise<VoidResult> {
    const shipmentId = req.upsShipmentDigest;
    if (!shipmentId) {
      throw new Error('voidLabel: upsShipmentDigest is required for UPS voids');
    }

    let path = `/api/shipments/v1/void/cancel/${encodeURIComponent(shipmentId)}`;
    if (req.trackingNumbers && req.trackingNumbers.length > 0) {
      const params = req.trackingNumbers
        .map((t) => `trackingnumber=${encodeURIComponent(t)}`)
        .join('&');
      path += `?${params}`;
    }

    const { res, json } = await upsFetch(path, { method: 'DELETE' });

    if (!res.ok) {
      return {
        success: false,
        message: extractUpsError(json, `HTTP ${res.status}`),
        rawResponse: json,
      };
    }

    const status = json?.VoidShipmentResponse?.SummaryResult?.Status?.Code;
    return {
      success: status === '1',
      message: json?.VoidShipmentResponse?.SummaryResult?.Status?.Description,
      rawResponse: json,
    };
  }

  // ── Track (Week 7) ──────────────────────────────────────────────────

  async track(_trackingNumber: string): Promise<TrackResult> {
    throw new Error(`${NOT_IMPLEMENTED} (Week 7)`);
  }
}

export const upsClient = new UpsClient();
