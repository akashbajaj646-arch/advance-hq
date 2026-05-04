-- =====================================================================
-- Shipping Manager Week 2 — Warehouses + label cost columns
-- =====================================================================
-- Idempotent: safe to run multiple times.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Warehouses table — one row per physical location.
--    Holds both the real address (for production) and a CIE test address
--    (for sandbox dev, since UPS CIE only validates NY/CA addresses).
--    The shipping client picks based on UPS_ENV.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
  id            text PRIMARY KEY,
  display_name  text NOT NULL,
  is_active     boolean DEFAULT true,

  -- Real (production) shipper-of-record address
  company_name  text NOT NULL,
  contact_name  text,
  phone         text NOT NULL,
  email         text,
  street1       text NOT NULL,
  street2       text,
  city          text NOT NULL,
  state         text NOT NULL,
  zip           text NOT NULL,
  country       text NOT NULL DEFAULT 'US',

  -- CIE test address (only used when UPS_ENV='cie')
  cie_company_name  text,
  cie_contact_name  text,
  cie_phone         text,
  cie_street1       text,
  cie_street2       text,
  cie_city          text,
  cie_state         text,
  cie_zip           text,
  cie_country       text DEFAULT 'US',

  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_warehouses ON warehouses;
CREATE POLICY authenticated_read_warehouses
  ON warehouses FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------
-- 2. Seed the two warehouses.
--    Real addresses from the production shipper-of-record details.
--    CIE test addresses are placeholder CA addresses for UPS sandbox —
--    they don't have to correspond to anything real.
-- ---------------------------------------------------------------------
INSERT INTO warehouses (
  id, display_name, company_name, phone, street1, street2, city, state, zip,
  cie_company_name, cie_phone, cie_street1, cie_city, cie_state, cie_zip
) VALUES
  (
    'leuning',
    'Leuning St',
    'Advance Apparels',
    '212-481-7246',
    '89 Leuning St',
    'Unit A2/A3',
    'South Hackensack',
    'NJ',
    '07606',
    'Advance Apparels (TEST)',
    '555-555-0001',
    '100 Test St',
    'San Francisco',
    'CA',
    '94102'
  ),
  (
    'state',
    'S State St',
    'Advance Apparels',
    '212-481-7246',
    '105-111 S State St',
    NULL,
    'Hackensack',
    'NJ',
    '07601',
    'Advance Apparels (TEST)',
    '555-555-0002',
    '200 Test St',
    'Los Angeles',
    'CA',
    '90001'
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Add a default warehouse_id to printers and packing_stations seed
--    rows so the dev UI has something to choose from. Skip if anything
--    already exists for these warehouses.
-- ---------------------------------------------------------------------
INSERT INTO printers (warehouse_id, name, is_default)
SELECT * FROM (VALUES
  ('leuning', 'Leuning St — Default Zebra', true),
  ('state',   'S State St — Default Zebra', true)
) AS v(warehouse_id, name, is_default)
WHERE NOT EXISTS (
  SELECT 1 FROM printers p WHERE p.warehouse_id = v.warehouse_id
);

INSERT INTO packing_stations (warehouse_id, name)
SELECT * FROM (VALUES
  ('leuning', 'Leuning Station 1'),
  ('leuning', 'Leuning Station 2'),
  ('leuning', 'Leuning Station 3'),
  ('state',   'S State Station 1'),
  ('state',   'S State Station 2')
) AS v(warehouse_id, name)
WHERE NOT EXISTS (
  SELECT 1 FROM packing_stations ps WHERE ps.warehouse_id = v.warehouse_id AND ps.name = v.name
);

-- =====================================================================
-- DONE.
-- =====================================================================
