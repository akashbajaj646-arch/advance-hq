/**
 * UPS carrier client. Implements the CarrierClient interface.
 *
 * Week 1: validateAddress is implemented end-to-end (lightest API call,
 * perfect smoke test). The other methods are stubbed and throw — they get
 * filled in during Week 2.
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
import { getUpsToken, upsBaseUrl } from './auth';

const NOT_IMPLEMENTED = 'Not implemented yet — Week 2';

export class UpsClient implements CarrierClient {
  readonly key: CarrierKey = 'ups';

  /**
   * UPS Address Validation Street Level (XAV) — verifies an address is
   * deliverable, classifies residential vs commercial, and returns any
   * corrections (zip+4, capitalization, abbreviation normalization).
   *
   * regionalrequestindicator = "1" gets us the most permissive lookup that
   * still tells us residential/commercial. maximumcandidatelistsize = "1"
   * keeps us fast — we only care about the top match.
   */
  async validateAddress(address: Address): Promise<AddressValidationResult> {
    const token = await getUpsToken();

    const url =
      `${upsBaseUrl()}/api/addressvalidation/v2/1` +
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

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        transId: `hq-${Date.now()}`,
        transactionSrc: 'AdvanceHQ',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`UPS AVS returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
    }

    if (!res.ok) {
      const errMsg =
        json?.response?.errors?.[0]?.message ??
        json?.response?.errors?.map((e: any) => `${e.code}: ${e.message}`).join('; ') ??
        `UPS AVS HTTP ${res.status}`;
      throw new Error(`UPS AVS failed: ${errMsg}`);
    }

    const xav = json?.XAVResponse;
    if (!xav) {
      throw new Error('UPS AVS: missing XAVResponse in response body');
    }

    // Indicators present → undeliverable / no candidates / etc.
    if (xav.NoCandidatesIndicator !== undefined) {
      return {
        status: 'undeliverable',
        messages: ['UPS could not match this address'],
        rawResponse: json,
      };
    }

    // Build the validated/corrected address from the top candidate.
    const candidate = Array.isArray(xav.Candidate) ? xav.Candidate[0] : xav.Candidate;
    if (!candidate) {
      // Valid response with no candidates — treat as undeliverable.
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

    // Decide status: if anything in `validated` differs from input, mark corrected.
    const differs =
      validated.street1.toUpperCase() !== address.street1.toUpperCase() ||
      (validated.street2 || '').toUpperCase() !== (address.street2 || '').toUpperCase() ||
      validated.city.toUpperCase() !== address.city.toUpperCase() ||
      validated.state.toUpperCase() !== address.state.toUpperCase() ||
      // Compare zip5 only — extension is informational, not "corrected"
      validated.zip.split('-')[0] !== address.zip.split('-')[0];

    const status: AddressValidationStatus =
      xav.AmbiguousAddressIndicator !== undefined
        ? 'corrected'
        : differs
        ? 'corrected'
        : 'verified';

    return {
      status,
      isResidential,
      validatedAddress: validated,
      rawResponse: json,
    };
  }

  // ── Stubs for Week 2 ────────────────────────────────────────────────

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

export const upsClient = new UpsClient();
