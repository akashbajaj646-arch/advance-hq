/**
 * Common shipping types — shared between UPS and EasyPost (USPS) clients.
 *
 * The UI never deals with carrier-specific shapes. It speaks these types.
 * Each carrier client maps to/from these in its own mappers.ts.
 */

export type CarrierKey = 'ups' | 'easypost_usps';

// ────────────────────────────────────────────────────────────────────
// Address
// ────────────────────────────────────────────────────────────────────

export interface Address {
  name?: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;       // 2-letter US state code
  zip: string;
  country?: string;    // 2-letter ISO; defaults to 'US'
  phone?: string;
  email?: string;
  isResidential?: boolean;
}

export type AddressValidationStatus =
  | 'verified'         // exact match
  | 'corrected'        // minor fix applied (zip+4, capitalization, etc)
  | 'undeliverable'    // carrier flat-out can't deliver
  | 'po_box'           // is a PO Box (UPS can't deliver, USPS only)
  | 'apo_fpo';         // military address (USPS only)

export interface AddressValidationResult {
  status: AddressValidationStatus;
  isResidential?: boolean;
  validatedAddress?: Address;
  messages?: string[];
  rawResponse?: unknown;
}

// ────────────────────────────────────────────────────────────────────
// Packages / Boxes
// ────────────────────────────────────────────────────────────────────

export interface Box {
  weightOz: number;     // total weight including contents — required
  length: number;       // inches
  width: number;        // inches
  height: number;       // inches
  reference?: string;   // shipper-side reference string (e.g. PT number)
  insuredValueUsd?: number;
}

// ────────────────────────────────────────────────────────────────────
// Rates
// ────────────────────────────────────────────────────────────────────

export interface RateRequest {
  shipFrom: Address;
  shipTo: Address;
  boxes: Box[];
  serviceCode?: string;   // optional — if set, only return this service
}

export interface RateQuote {
  carrier: CarrierKey;
  serviceCode: string;
  serviceName: string;
  totalUsd: number;
  estimatedDays?: number;
  rawResponse?: unknown;
}

// ────────────────────────────────────────────────────────────────────
// Labels
// ────────────────────────────────────────────────────────────────────

export interface LabelRequest {
  shipFrom: Address;
  shipTo: Address;
  boxes: Box[];
  serviceCode: string;       // mapped from ship_via via shipping_service_map
  reference?: string;        // shows on label as customer ref (e.g. PT number)
  shipDate?: string;         // ISO date; defaults to today
}

export interface BoxLabel {
  trackingNumber: string;
  zpl?: string;              // ZPL label content (preferred for Zebras)
  pdfUrl?: string;           // backup if ZPL not available
  costUsd?: number;
}

export interface LabelResult {
  carrier: CarrierKey;
  serviceCode: string;
  serviceName: string;
  totalCostUsd: number;
  boxes: BoxLabel[];
  carrierShipmentId?: string;  // EasyPost shipment id, used for void
  upsShipmentDigest?: string;  // UPS shipment digest, used for void
  rawResponse?: unknown;
}

// ────────────────────────────────────────────────────────────────────
// Void
// ────────────────────────────────────────────────────────────────────

export interface VoidRequest {
  carrierShipmentId?: string;
  upsShipmentDigest?: string;
  trackingNumbers?: string[];   // some carriers want tracking, some want shipment id
}

export interface VoidResult {
  success: boolean;
  message?: string;
  rawResponse?: unknown;
}

// ────────────────────────────────────────────────────────────────────
// Tracking
// ────────────────────────────────────────────────────────────────────

export interface TrackEvent {
  occurredAt: string;        // ISO timestamp
  code?: string;
  description?: string;
  location?: string;
}

export interface TrackResult {
  trackingNumber: string;
  carrier: CarrierKey;
  status?: string;
  events: TrackEvent[];
  rawResponse?: unknown;
}

// ────────────────────────────────────────────────────────────────────
// Carrier interface — every carrier client implements this surface.
// ────────────────────────────────────────────────────────────────────

export interface CarrierClient {
  readonly key: CarrierKey;
  validateAddress(address: Address): Promise<AddressValidationResult>;
  getRates(req: RateRequest): Promise<RateQuote[]>;
  createLabel(req: LabelRequest): Promise<LabelResult>;
  voidLabel(req: VoidRequest): Promise<VoidResult>;
  track(trackingNumber: string): Promise<TrackResult>;
}
