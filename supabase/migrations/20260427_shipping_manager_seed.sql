-- =====================================================================
-- Shipping Manager v1 — Seed Data
-- =====================================================================
-- Idempotent. Run after the schema migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Package presets — visible at both warehouses (warehouse_id = NULL means
-- "global"). Each warehouse can override or add their own later.
-- ---------------------------------------------------------------------
INSERT INTO package_presets (name, length, width, height, tare_weight_oz, is_default)
SELECT * FROM (VALUES
  ('Box 54',  24, 18, 18, 32, false),
  ('Box 50',  20, 16, 15, 24, false),
  ('Box 40',  16, 14, 10, 16, true),
  ('Box 40x', 16,  5,  5,  8, false)
) AS v(name, length, width, height, tare_weight_oz, is_default)
WHERE NOT EXISTS (
  SELECT 1 FROM package_presets pp WHERE pp.name = v.name
);

-- ---------------------------------------------------------------------
-- Default notification templates (admin can edit / disable in Week 6 UI)
-- ---------------------------------------------------------------------

-- First-scan SMS
INSERT INTO notification_templates (
  name, trigger_event, channel, subject, body_template,
  send_delay_seconds, fallback_after_seconds, is_active
)
SELECT
  'Default — First scan SMS',
  'first_scan',
  'sms',
  NULL,
  'Hi {{customer_name}}, your order from Advance Apparels is on its way! Track: {{tracking_url}}',
  0,
  86400,         -- fallback to send anyway after 24h if no scan
  true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE name = 'Default — First scan SMS'
);

-- First-scan email
INSERT INTO notification_templates (
  name, trigger_event, channel, subject, body_template,
  send_delay_seconds, fallback_after_seconds, is_active
)
SELECT
  'Default — First scan Email',
  'first_scan',
  'email',
  'Your Advance Apparels order has shipped',
  E'Hi {{customer_name}},\n\nYour order from Advance Apparels is on its way.\n\nTracking: {{tracking_number}}\n{{tracking_url}}\n\nCarrier: {{carrier}}\nService: {{service_name}}\n\nThanks for your business.\n— Advance Apparels',
  0,
  86400,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE name = 'Default — First scan Email'
);

-- Delivered email (off by default — admin can enable in v2)
INSERT INTO notification_templates (
  name, trigger_event, channel, subject, body_template,
  send_delay_seconds, fallback_after_seconds, is_active
)
SELECT
  'Default — Delivered Email',
  'delivered',
  'email',
  'Your Advance Apparels order has been delivered',
  E'Hi {{customer_name}},\n\nYour order has been delivered.\n\nTracking: {{tracking_number}}\n\nThanks for your business.\n— Advance Apparels',
  0,
  NULL,
  false
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE name = 'Default — Delivered Email'
);

-- =====================================================================
-- DONE.
-- =====================================================================
