/**
 * EasyPost (USPS) carrier client. Implements the CarrierClient interface.
 *
 * Week 1: validateAddress is implemented end-to-end. Other methods stubbed
 * for Week 3.
 *
 * EasyPost uses HTTP Basic auth: the API key is the username, password is
 * empty. We pick the test or production key based on EASYPOST_ENV.
 */

import {
  Address,
  AddressValidationResult,
  AddressValidationStatus,
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

const NOT_IMPLEMENTED = 'Not implemented yet — Week 3';
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

export class EasyPostClient implements CarrierClient {
  readonly key: CarrierKey = 'easypost_usps';

  /**
   * EasyPost address verification — `verify` strictness checks deliverability,
   * `verify_strict` rejects anything not 100% match. We use `verify` so we
   * still get a result with corrections for slightly-off addresses.
   *
   * EasyPost returns is_residential under verifications.delivery.details for
   * USPS-verified addresses; we surface it the same way as UPS does.
   */
  async validateAddress(address: Address): Promise<AddressValidationResult> {
    const params = new URLSearchParams();
    params.set('address[street1]', address.street1);
    if (address.street2) params.set('address[street2]', address.street2);
    params.set('address[city]', address.city);
    params.set('address[state]', address.state);
    params.set('address[zip]', address.zip);
    params.set('address[country]', address.country || 'US');
    if (address.name) params.set('address[name]', address.name);
    if (address.company) params.set('address[company]', address.company);
    if (address.phone) params.set('address[phone]', address.phone);
    if (address.email) params.set('address[email]', address.email);
    params.append('address[verify][]', 'delivery');

    const res = await fetch(`${EASYPOST_BASE}/addresses`, {
      method: 'POST',
      headers: {
        Authorization: easypostAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`EasyPost AVS returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
    }

    if (!res.ok) {
      const errMsg =
        json?.error?.message ??
        json?.error?.errors?.map((e: any) => e.message).join('; ') ??
        `EasyPost AVS HTTP ${res.status}`;
      throw new Error(`EasyPost AVS failed: ${errMsg}`);
    }

    // PO Box detection (USPS allows, UPS doesn't — we surface this so the
    // station UI can warn if ship_via is UPS).
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

  // ── Stubs for Week 3 ────────────────────────────────────────────────

  async getRates(_req: RateRequest): Promise<RateQuote[]> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async createLabel(_req: LabelRequest): Promise<LabelResult> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async voidLabel(_req: VoidRequest): Promise<VoidResult> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async track(_trackingNumber: string): Promise<TrackResult> {
    throw new Error(NOT_IMPLEMENTED);
  }
}

export const easypostClient = new EasyPostClient();
