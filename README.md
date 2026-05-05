# Shipping Manager — Week 2 Drop

Week 2 implements the full UPS shipping workflow: rate quotes, label
creation (with ZPL output), and label voiding. After applying these
files, you'll be able to create real (sandbox-fake) UPS labels from
the dev page, preview them as PNGs, download them as `.zpl` files, and
void them.

## What this includes

```
lib/carriers/
  warehouses.ts                 NEW — getShipFromAddress() + Option A logic
  ups/
    mappers.ts                  NEW — Address/Box → UPS API shapes
    client.ts                   UPDATED — getRates, createLabel, voidLabel implemented

app/api/shipping/
  warehouses/route.ts           NEW — GET list of warehouses
  rates/route.ts                NEW — POST /api/shipping/rates
  labels/
    create/route.ts             NEW — POST /api/shipping/labels/create
    void/route.ts               NEW — POST /api/shipping/labels/void
  pick-tickets/queue/route.ts   FIXED — uses correct column names + customer_locations join

app/shipping/dev/page.tsx       UPDATED — Rate + Label + Void panel added

supabase/migrations/
  20260428_shipping_manager_warehouses.sql  NEW — warehouses table + seeds
```

## How to apply

### 1. Drop into project root

```bash
cd /Users/Akash/advance-hq
unzip ~/Downloads/advance-hq-shipping-week2.zip
cp -r week2/* .
rm -rf week2
```

This will overwrite Week 1's `lib/carriers/ups/client.ts` (now with
rate/ship/void implemented) and `app/shipping/dev/page.tsx` (now with the
Rate+Label+Void panel). Your existing app code is untouched.

### 2. Run the warehouse migration

Paste `supabase/migrations/20260428_shipping_manager_warehouses.sql` into
Supabase SQL Editor and click Run. This:

- Creates the `warehouses` table
- Seeds your two real warehouses (Leuning + S State) with real NJ addresses
- Sets up CIE test addresses (CA placeholders) so UPS sandbox accepts API calls
- Seeds 2 default printers (one per warehouse) and 5 packing stations

Idempotent — safe to re-run.

### 3. Restart dev server

```bash
npm run dev
```

### 4. Smoke test

Open http://localhost:3003/shipping/dev and scroll to the new
**"Rate + Create label + Void"** section.

The defaults are pre-filled to work with UPS CIE — Empire State Building
in NY, Box 40 sized, with a TEST-PT-001 reference.

#### Try this flow:

1. Click **Get rate** → you should see a quote like "UPS Ground · 03 · 5 days · $X.XX"
2. Click **Create label** → returns a tracking number, ZPL, and a rendered preview image
3. Click **Download .zpl** → downloads the ZPL as a text file you can open in any editor
4. Click **Void label** → confirms with UPS and marks the shipment voided in DB

#### Try multi-box:

Click "+ Add box" twice. Set 3 different weights/dims. Create label.
You'll get **3 separate tracking numbers and 3 ZPL labels** in one
shipment, all with the same UPS Shipment Digest. That's our wholesale
multi-box use case working.

## Important notes

### CIE address restrictions

The defaults use NY/CA addresses because UPS CIE only accepts those for
address validation. The Shipping API itself works with any state in
sandbox, but if you change the ship-to to NJ and validation fails first,
it won't let you proceed. For dev testing, keep ship-to in NY/CA.

In production (UPS_ENV=production), there's no restriction.

### What's saved to DB on label creation

When you click Create Label, three things happen:

1. UPS creates the label, returns ZPL + tracking
2. A row is inserted into `shipments` with hq_status='labeled'
3. N rows are inserted into `shipment_boxes` with the ZPL stored in `label_zpl`

The ZPL is base64-decoded and stored as plain text in Supabase. About
3-5KB per label. Plenty of room.

### What's left for production

- Address validation hooked into the create-label flow (warning banner if
  address is corrected/undeliverable before printing)
- A real packing-station UI (Week 4) — this is just a dev tool
- USPS via EasyPost (Week 3)
- Notifications on first scan (Week 6-7)
- Print to physical Zebra (Week 5 — PrintNode)
- Push back to ApparelMagic (Week 8)
- COD workflow (v2)

## What might break

- **UPS app permissions.** If the Rating or Shipping product wasn't added
  to your UPS app at developer.ups.com (only Address Validation was added
  earlier), you'll get a 401 from UPS on the first rate call. Fix: My
  Apps → your app → Add Products → Shipping, Rating. Activates instantly
  for sandbox.

- **Shipper account number mismatch.** UPS_ACCOUNT_NUMBER in your
  `.env.local` must match the account associated with your dev app.
  If you get an error like "Shipper number does not match ...", it's this.

## What's next (Week 3)

USPS via EasyPost: rates, label creation, void, address validation
already done. Same dev-page panels, but with USPS service codes
selectable. End of Week 3 = both carriers fully functional.
