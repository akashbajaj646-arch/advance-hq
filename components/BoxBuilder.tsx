'use client';

/**
 * BoxBuilder
 *
 * Lets the shipper add/remove/edit cartons for a shipment. Pulls from
 * package_presets table for one-click "Box 54", "Box 50", etc.
 *
 * Each row has weight + dims. Tare weight from the preset is added to
 * actual product weight to get total package weight.
 *
 * UNITS:
 *   The BoxRow type stores weight in OUNCES (`weightOz`) — this matches
 *   the package_presets table, the EasyPost USPS mapper (which sends raw
 *   oz to USPS), and the rest of the carrier pipeline. The UI displays
 *   and accepts weight in POUNDS — we convert at the input boundary so
 *   the shipper enters intuitive numbers without changing the internal
 *   data model.
 */

import { useEffect, useState } from 'react';

export interface BoxRow {
  /** Total package weight in OUNCES, including tare. UI shows lbs but
   *  this field is the canonical storage unit consumed by mappers. */
  weightOz: number;
  length: number;
  width: number;
  height: number;
  /** Optional - which preset filled this row, for display only. */
  presetName?: string;
}

interface PackagePreset {
  id: string;
  name: string;
  length_in: number;
  width_in: number;
  height_in: number;
  tare_weight_oz: number;
  is_default: boolean;
}

interface Props {
  boxes: BoxRow[];
  onChange: (boxes: BoxRow[]) => void;
  /**
   * The line-item weight from the PT (in lbs). Used to suggest a default
   * weight for new boxes when no preset is chosen.
   */
  ptTotalWeightLbs?: number;
  /**
   * The PT's num_cartons hint, if available. We auto-create that many
   * empty boxes on first render.
   */
  ptNumCartons?: number;
}

// ─── Unit conversion helpers ────────────────────────────────────────
// All storage is in ounces. UI shows lbs. These two helpers convert at
// the boundary. We keep oz as integers (the canonical unit) and lbs at
// 0.1 precision (UPS's minimum granularity).
function ozToDisplayLbs(oz: number): number {
  if (!oz || oz <= 0) return 0;
  return Math.round((oz / 16) * 10) / 10;
}
function displayLbsToOz(lbs: number): number {
  if (!lbs || lbs <= 0) return 0;
  return Math.max(1, Math.round(lbs * 16));
}

export default function BoxBuilder({
  boxes,
  onChange,
  ptTotalWeightLbs,
  ptNumCartons,
}: Props) {
  const [presets, setPresets] = useState<PackagePreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);

  // Load presets once
  useEffect(() => {
    fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: 'package_presets',
        query: {
          select: '*',
          filters: [{ op: 'eq', col: 'is_active', val: true }],
          order: [{ col: 'sort_order', asc: true }, { col: 'name', asc: true }],
        },
      }),
    })
      .then((r) => r.json())
      .then((d) => setPresets(d?.data ?? []))
      .catch(() => setPresets([]))
      .finally(() => setPresetsLoaded(true));
  }, []);

  // Auto-seed first box(es) once we know how many cartons the PT has.
  useEffect(() => {
    if (!presetsLoaded) return;
    if (boxes.length > 0) return;

    const target = Math.max(1, Math.min(ptNumCartons ?? 1, 20));
    const defaultPreset = presets.find((p) => p.is_default) || presets[0];
    const seeded: BoxRow[] = [];
    for (let i = 0; i < target; i++) {
      seeded.push(boxFromPreset(defaultPreset, ptTotalWeightLbs, target));
    }
    onChange(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetsLoaded]);

  function boxFromPreset(
    preset: PackagePreset | undefined,
    totalLbs: number | undefined,
    splitInto: number
  ): BoxRow {
    if (!preset) {
      return {
        weightOz: 32, // = 2 lbs default
        length: 16,
        width: 14,
        height: 10,
      };
    }
    // Distribute total weight evenly across boxes; add tare.
    const productOzPerBox =
      totalLbs && totalLbs > 0
        ? Math.round((totalLbs * 16) / splitInto)
        : 32 - preset.tare_weight_oz;
    const weightOz = Math.max(1, productOzPerBox + preset.tare_weight_oz);
    return {
      weightOz,
      length: preset.length_in,
      width: preset.width_in,
      height: preset.height_in,
      presetName: preset.name,
    };
  }

  function applyPresetToRow(idx: number, preset: PackagePreset) {
    const next = [...boxes];
    next[idx] = boxFromPreset(preset, ptTotalWeightLbs, boxes.length || 1);
    onChange(next);
  }

  function updateField(idx: number, field: keyof BoxRow, value: number) {
    const next = [...boxes];
    next[idx] = { ...next[idx], [field]: value, presetName: undefined };
    onChange(next);
  }

  function addBox() {
    const defaultPreset = presets.find((p) => p.is_default) || presets[0];
    onChange([...boxes, boxFromPreset(defaultPreset, ptTotalWeightLbs, boxes.length + 1)]);
  }

  function removeBox(idx: number) {
    onChange(boxes.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Boxes</h3>
          <p className="text-xs text-gray-500">
            {boxes.length} box{boxes.length === 1 ? '' : 'es'}
            {ptNumCartons ? ` · PT lists ${ptNumCartons} carton${ptNumCartons === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <button
          onClick={addBox}
          className="text-xs text-brand-600 hover:underline"
          disabled={!presetsLoaded}
        >
          + Add box
        </button>
      </div>

      {boxes.length === 0 && presetsLoaded && (
        <div className="card text-center py-6 text-sm text-gray-500">
          No boxes yet. Click "Add box" or pick a preset below.
        </div>
      )}

      {boxes.map((box, i) => (
        <div key={i} className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-gray-700">Box {i + 1}</span>
              {box.presetName && (
                <span className="badge badge-gray text-[10px]">{box.presetName}</span>
              )}
            </div>
            {boxes.length > 1 && (
              <button
                onClick={() => removeBox(i)}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            )}
          </div>

          {/* Preset chips */}
          {presets.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPresetToRow(i, p)}
                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                    box.presetName === p.name
                      ? 'bg-brand-50 border-brand-300 text-brand-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                  title={`${p.length_in}×${p.width_in}×${p.height_in} · ${p.tare_weight_oz}oz tare`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}

          {/* Numeric inputs */}
          <div className="grid grid-cols-4 gap-3">
            <NumField
              label="Weight (lbs)"
              value={ozToDisplayLbs(box.weightOz)}
              onChange={(v) => updateField(i, 'weightOz', displayLbsToOz(v))}
            />
            <NumField
              label="Length (in)"
              value={box.length}
              onChange={(v) => updateField(i, 'length', v)}
            />
            <NumField
              label="Width (in)"
              value={box.width}
              onChange={(v) => updateField(i, 'width', v)}
            />
            <NumField
              label="Height (in)"
              value={box.height}
              onChange={(v) => updateField(i, 'height', v)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-xs text-gray-600 block mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full px-3 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-sm"
        step="0.1"
        min="0"
      />
    </div>
  );
}
