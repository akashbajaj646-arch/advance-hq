/**
 * Mappers between our generic shipping types and EasyPost's API shapes.
 *
 * EasyPost API quirks worth knowing:
 *   - Auth: HTTP Basic with API key as username, empty password.
 *   - Content-Type: form-encoded (application/x-www-form-urlencoded), not JSON.
 *     We use URLSearchParams for that. The shape is "shipment[parcel][weight]=10"
 *     style nested form params.
 *   - Weight: EasyPost wants ounces (matches our internal unit). No conversion.
 *   - Dimensions: inches as numbers (or numeric strings — both work).
 *   - One shipment = one parcel. Multi-box = N shipments.
 *   - Phone: any format works, no strict 10-digit requirement like UPS.
 *   - Service code: "Priority", "GroundAdvantage", "First", "PriorityExpress" etc.
 *     Different from UPS's numeric codes.
 *   - Label format: PNG by default. Request ZPL via options[label_format]=ZPL,
 *     and the URL appears at postage_label.label_zpl_url.
 */

import { Address, Box } from '../types';

/**
 * Append a flat or nested object to URLSearchParams using EasyPost's bracket
 * convention. Skips null/undefined values cleanly.
 *
 * Example: appendFormParams(params, 'shipment', { parcel: { weight: 10 } })
 *   → "shipment[parcel][weight]=10"
 */
export function appendFormParams(
  params: URLSearchParams,
  prefix: string,
  obj: Record<string, any>
): void {
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    const fullKey = `${prefix}[${key}]`;
    if (typeof value === 'object' && !Array.isArray(value)) {
      appendFormParams(params, fullKey, value);
    } else {
      params.set(fullKey, String(value));
    }
  }
}

export function addressToEasypostFields(addr: Address): Record<string, any> {
  return {
    name: addr.name || addr.company || undefined,
    company: addr.company || undefined,
    street1: addr.street1,
    street2: addr.street2 || undefined,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
    country: addr.country || 'US',
    phone: addr.phone || undefined,
    email: addr.email || undefined,
  };
}

export function boxToEasypostParcel(box: Box): Record<string, any> {
  return {
    length: box.length,
    width: box.width,
    height: box.height,
    weight: box.weightOz,
  };
}

/**
 * Map our service codes (from shipping_service_map) to EasyPost's USPS service strings.
 * EasyPost is case-sensitive on these.
 */
const SERVICE_CODE_MAP: Record<string, string> = {
  Priority: 'Priority',
  GroundAdvantage: 'GroundAdvantage',
  PriorityExpress: 'PriorityExpress',
  First: 'First',
  ParcelSelect: 'ParcelSelect',
  LibraryMail: 'LibraryMail',
  MediaMail: 'MediaMail',
};

export function serviceCodeForEasypost(code: string): string {
  return SERVICE_CODE_MAP[code] || code;
}

const SERVICE_NAMES: Record<string, string> = {
  Priority: 'USPS Priority Mail',
  GroundAdvantage: 'USPS Ground Advantage',
  PriorityExpress: 'USPS Priority Mail Express',
  First: 'USPS First Class Package',
  ParcelSelect: 'USPS Parcel Select',
  LibraryMail: 'USPS Library Mail',
  MediaMail: 'USPS Media Mail',
};

export function easypostServiceName(code: string): string {
  return SERVICE_NAMES[code] || `USPS ${code}`;
}
