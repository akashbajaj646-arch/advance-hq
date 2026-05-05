/**
 * Mappers between our generic shipping types and UPS's API shapes.
 *
 * Kept separate from client.ts so the HTTP-call code stays readable, and so
 * the mappings are easy to find/test in isolation.
 *
 * UPS API quirks worth knowing:
 *   - Phone numbers: digits-only, 10 chars. UPS rejects "212-481-7246".
 *   - Weight: UPS wants pounds (LBS), we store ounces. Convert and round up.
 *   - Dimensions: UPS wants inches as strings.
 *   - Address lines: AddressLine is an array of strings, max 3 entries.
 *   - Country: 2-letter ISO ('US', not 'USA').
 *   - Service codes: '03' = Ground, '02' = 2nd Day Air, '01' = Next Day Air, etc.
 *
 *   - Package type field name DIFFERS between APIs (real UPS inconsistency):
 *       * Rating API uses "PackagingType"
 *       * Shipping API uses "Packaging"
 *     boxToUpsPackage() takes an `apiSurface` flag to pick the right one.
 */

import { Address, Box } from '../types';

export type UpsApiSurface = 'rating' | 'shipping';

export function digitsOnlyPhone(phone: string | undefined): string {
  if (!phone) return '5555555555';
  const digits = phone.replace(/\D/g, '');
  // UPS wants 10 digits — strip country code if 11 starting with 1
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits || '5555555555';
}

export function ozToLbs(weightOz: number): string {
  // UPS expects weight in LBS as a decimal string with at least 0.1 precision.
  // Round up to nearest 0.1 lb to avoid under-declaring.
  const lbs = Math.max(0.1, Math.ceil((weightOz / 16) * 10) / 10);
  return lbs.toFixed(1);
}

/**
 * Maps our Address to UPS's ShipperAddress / ShipToAddress / ShipFromAddress
 * structure (they're all the same shape).
 */
export function addressToUpsAddress(addr: Address) {
  const lines: string[] = [];
  if (addr.street1) lines.push(addr.street1);
  if (addr.street2) lines.push(addr.street2);

  return {
    AddressLine: lines,
    City: addr.city,
    StateProvinceCode: addr.state,
    PostalCode: addr.zip,
    CountryCode: addr.country || 'US',
  };
}

export function addressToShipperBlock(addr: Address, shipperNumber: string) {
  return {
    Name: (addr.company || addr.name || 'Shipper').slice(0, 35),
    AttentionName: (addr.name || addr.company || 'Shipping').slice(0, 35),
    ShipperNumber: shipperNumber,
    Phone: { Number: digitsOnlyPhone(addr.phone) },
    Address: addressToUpsAddress(addr),
  };
}

export function addressToShipToBlock(addr: Address) {
  return {
    Name: (addr.company || addr.name || 'Recipient').slice(0, 35),
    AttentionName: (addr.name || addr.company || 'Recipient').slice(0, 35),
    Phone: { Number: digitsOnlyPhone(addr.phone) },
    Address: {
      ...addressToUpsAddress(addr),
      // UPS requires this for residential pricing.
      ResidentialAddressIndicator: addr.isResidential ? '' : undefined,
    },
  };
}

export function addressToShipFromBlock(addr: Address) {
  return {
    Name: (addr.company || addr.name || 'Shipper').slice(0, 35),
    AttentionName: (addr.name || addr.company || 'Shipping').slice(0, 35),
    Phone: { Number: digitsOnlyPhone(addr.phone) },
    Address: addressToUpsAddress(addr),
  };
}

/**
 * Maps a Box to a UPS Package object. UPS treats each carton as one
 * "Package" — a multi-box shipment is a Shipment with a Package array.
 *
 * PackagingType '02' = Customer Supplied Package (i.e., not a UPS Express Box).
 *
 * `apiSurface` chooses the field name UPS expects:
 *   - 'rating'   → uses "PackagingType" (Rating API)
 *   - 'shipping' → uses "Packaging" (Shipping API)
 * Yes, these really do differ in UPS's REST API. Not a typo.
 */
export function boxToUpsPackage(
  box: Box,
  reference?: string,
  apiSurface: UpsApiSurface = 'rating'
) {
  const packageTypeBlock = { Code: '02', Description: 'Customer Supplied Package' };

  const pkg: any = {
    Description: 'Apparel',
    Dimensions: {
      UnitOfMeasurement: { Code: 'IN', Description: 'Inches' },
      Length: String(Math.round(box.length)),
      Width: String(Math.round(box.width)),
      Height: String(Math.round(box.height)),
    },
    PackageWeight: {
      UnitOfMeasurement: { Code: 'LBS', Description: 'Pounds' },
      Weight: ozToLbs(box.weightOz),
    },
  };

  if (apiSurface === 'rating') {
    pkg.PackagingType = packageTypeBlock;
  } else {
    pkg.Packaging = packageTypeBlock;
  }

  if (reference || box.reference) {
    pkg.ReferenceNumber = [
      { Code: '01', Value: (box.reference || reference || '').slice(0, 35) },
    ];
  }

  if (box.insuredValueUsd && box.insuredValueUsd > 0) {
    pkg.PackageServiceOptions = {
      DeclaredValue: {
        CurrencyCode: 'USD',
        MonetaryValue: box.insuredValueUsd.toFixed(2),
      },
    };
  }

  return pkg;
}
