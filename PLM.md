# PLM.md — Product Lifecycle Management module

Institutional reference for the PLM vertical in Advance HQ. Every PLM feature builds
against the model and decisions recorded here. Companion to `CLAUDE.md`.

---

## Scope: three layers, three deliverables

What was specced spans three industry layers, and HQ implements all three because we own
the factories:

- **PLM** (product development) — sample dev, versions, tech pack, BOM, costing, the
  image/video/voice timeline, T&A calendar. → **Phase A**
- **ERP** (already in HQ) — inventory, orders, invoices, shipping. The PLM plugs into this;
  `products` is the pivot table.
- **MES** (shop-floor execution) — the "X units in cutting" view, WIP, outsourcing. → **Phase C**

Raw-material inventory sits between A and C as **Phase B**.

Treat A / B / C as three separate go-lives, not one module.

---

## Data model

All PLM tables are **HQ-native** (authored here, not synced from AM). They use `uuid`
primary keys and standard CRUD through `/api/data/route.ts` — **not** the sync-route
pattern. The only outbound integration is the one-time AM product create at approval.

Migrations live in `plm/migrations/` and run in order:

| File | Phase | Tables |
|------|-------|--------|
| `001_plm_foundation.sql` | Foundation | `partners`, `raw_materials` |
| `002_plm_phase_a_samples.sql` | A | `samples`, `sample_versions`, `sample_timeline_events`, `tech_pack_measurements`, `sample_bom`, `routing_steps`, `sample_milestones` |
| `003_plm_phase_b_inventory.sql` | B | `raw_material_stock`, `stock_movements`, view `v_available_to_cut` |
| `004_plm_phase_c_manufacturing.sql` | C | `manufacturing_pos`, `manufacturing_po_lines`, `wip_status`, `outsource_dispatches`, `outsource_receipts`, views `v_outsource_open`, `v_vendor_performance` |

### The three seams that make it one system

1. **`sample_bom.material_id → raw_materials.id`** (hard FK). The BOM points at real
   material rows, so fabric consumption is computable.
2. **`manufacturing_pos → stock_movements`** (soft ref via `ref_type`/`ref_id`). A PO writes
   `reserve` rows at issue and `consume` rows at cut. `stock_movements` doubles as the manual
   adjustment ledger and the automated reserve/consume trail — one audit history.
3. **`samples → products`** (soft ref, `promoted_product_id`). The one-time promotion.
   Optional both ways: a sample may never be approved; a product may predate this system.

---

## Key modeling decisions

- **BOM and tech pack hang off `sample_versions`, not `samples`.** Each revision owns its own
  material list and measurement set, so "v1 specs vs v2 specs" is real history, not an
  overwrite. Promotion reads from the **approved version**.
- **Routing is defined once per sample and inherited by every PO** for the promoted product.
  A PO does **not** carry its own routing copy. Resolution:
  `manufacturing_pos.product_id → samples.promoted_product_id → routing_steps`.
  Revisit if a PO ever needs to deviate from the style's standard route.
- **`partners` is the single home for internal factories and external vendors.** Every
  `owner_id` / `producer_id` / `factory_id` / `vendor_id` FKs here. `capabilities[]` filters
  which vendor can run an outsourced step.
- **Soft references (no hard FK) to AM-synced `products` and to template-config.** `products`
  is upserted/deleted by sync with text keys; a hard FK would cascade or block PLM rows.
  Store `product_id` (AM id) and `style_number` as text.
- **Fabric: reserve-at-PO, consume-at-cut.** PO issue writes `reserve` (drops
  `qty_available`); cutting-done converts to `consume` (drops `qty_on_hand`); PO cancel writes
  `release`. Reserved = `consumption_net * (1 + wastage_pct/100)`. Multi-fabric BOMs deduct
  per line. Fabric in **meters**, no roll- or dye-lot tracking.
- **FX locked per PO.** `fx_rate_locked` = issue-date rate, immutable, for costing history.
  Actual settlement (live USD on pay day) is intentionally off-system for now.
- **QC = final pre-ship only.** No inbound checkpoint, so per-vendor tracking is
  speed/turnaround only, not quality. (Quality attribution would need an inbound QC step —
  deferred, easy to add later.)
- **Outsourced steps: send/receive with partial receipts.** `outsource_dispatches` (qty sent
  + date) and `outsource_receipts` (each return is its own row). Turnaround and open qty are
  computed in `v_outsource_open`; per-vendor rollup in `v_vendor_performance`. Stitch and dye
  go out; anything with `owner_type='outsourced'` uses this path.
- **`group`/`class` renamed** to `product_group`/`product_class` (Postgres reserved-word
  friction). Map back to AM's `group`/`class` at push.

---

## Phasing plan

**A → B → C.** A is the biggest and most valuable and ships first.

- **Phase A — Sample → Product.** Samples with versioning, the timeline (Supabase Storage for
  media), tech pack, BOM authoring, routing definition, milestones/T&A, and the
  approval → product promotion + AM push. The BOM's `material_id` needs `raw_materials` to
  exist, which is why the master table is created in the foundation. BOM consumption authored
  here only *activates* against inventory once B exists.
  **T&A calendar is in v1 of this phase** — "which samples are late" is the first transparency
  felt, well before the floor view exists.
- **Phase B — Raw materials.** `raw_material_stock` (balance) + `stock_movements` (ledger) +
  the manual adjustment screen + `v_available_to_cut`. Must precede C (C's reserve/consume
  logic reads these tables).
- **Phase C — Manufacturing.** Vendor PO with size×color matrix and packing-template select,
  the manual PO×style×stage WIP view, outsource dispatch/receipt, vendor performance. Wires
  the reserve/consume movements into B.

Each phase follows the established vertical shape: migration → API wiring
(`ALLOWED_TABLES` + `/api/data/route.ts`) → UI list page + detail drawer. Delivery as full-file
replacements in a ZIP with backup-and-install scripts.

---

## Integration points

- **`ALLOWED_TABLES` whitelist** in `/api/data/route.ts` must gain the new tables before the UI
  can read them (list below).
- **AM push** at approval creates a `products` row from the approved sample version
  (`style_number`, `description`, `product_group`→group, `product_class`→class, `collection`,
  `content`, `weight`, `box_size`, `care_instructions`, `unit_of_measure`, plus `prepacks`,
  `bill_of_materials` from `sample_bom`, `processes` from `routing_steps`), then fires the
  one-time AM create and writes `am_style_number` back.
- **Product PO tab** = a view over `manufacturing_pos` + sales orders filtered to that
  `product_id`, shown as a size×color breakdown.
- **Media** goes to a Supabase Storage bucket; `sample_timeline_events.media_url` holds the URL.

### `ALLOWED_TABLES` additions
```
partners
raw_materials
samples
sample_versions
sample_timeline_events
tech_pack_measurements
sample_bom
routing_steps
sample_milestones
raw_material_stock
stock_movements
manufacturing_pos
manufacturing_po_lines
wip_status
outsource_dispatches
outsource_receipts
```

---

## Open items / gates

- **AM product-create write access is unconfirmed.** The one-time push depends on it. Same
  open question as the migration work — confirm with the AM account rep / in-instance API docs
  before building the push. Everything else in the PLM is self-contained and has no external
  dependency.
- **`factory_id` on POs.** The fabric auto-deduct needs to know *which* factory's stock to pull
  from. `manufacturing_pos.producer_id` covers internal factories; confirm the deduct reads
  stock at `producer_id` when `producer_type='internal_factory'`.
- **Vendor / factory logins deferred to Phase 2.** For v1, partners are records, not users; the
  HQ team enters all WIP. Permissions collapse to internal roles. The product side is never
  exposed to partners regardless.

---

## Conventions

- **RLS: enabled, service-role-only.** RLS is ON with no anon/authenticated policies. The
  `service_role` key bypasses RLS, so only server code (service-role client in
  `/api/data/route.ts`) reads/writes. Never touch these tables with the anon key — silent
  failures.
- **Stock ledger vs balance.** `stock_movements` is the append-only source of truth;
  `raw_material_stock` is the running balance, maintained in **app logic** (reserve/consume
  fire from the manufacturing-PO handlers), matching HQ's explicit-route pattern. Optional
  hardening: a trigger on `stock_movements` insert that recomputes the balance — single source
  of truth, but adds hidden magic against the explicit-route style. Defaulted to app-maintained.
- **`updated_at`** is maintained by the shared `set_updated_at()` trigger on every table that
  has the column.
- **`qty_available`** on `raw_material_stock` is a generated column (`on_hand - reserved`) — the
  "available to cut" number. Do not write to it.
