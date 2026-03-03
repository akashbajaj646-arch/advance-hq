'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { TemplateBlock, BlockType, PrintTemplate, ENTITY_FIELDS, TABLE_COLUMNS, SPECIAL_BLOCKS } from '@/lib/template-config';

const SCALE = 2.8;
const PAGE_W = 215.9;
const PAGE_H = 279.4;

function makeId(): string {
  return 'blk_' + Math.random().toString(36).slice(2, 10);
}

/* ── Drag-and-drop column reorder list ──────────────────────────── */
function DraggableColumnList({
  allColumns,
  activeColumns,
  onChange,
}: {
  allColumns: { key: string; header: string; align?: string }[];
  activeColumns: { key: string; header: string; align?: string }[];
  onChange: (cols: { key: string; header: string; align?: string }[]) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  function handleToggle(col: { key: string; header: string; align?: string }, checked: boolean) {
    if (checked) {
      onChange([...activeColumns, col]);
    } else {
      onChange(activeColumns.filter(c => c.key !== col.key));
    }
  }

  function handleDragStart(e: React.DragEvent, idx: number) {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverIdx(idx);
  }

  function handleDrop(idx: number) {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    const newCols = [...activeColumns];
    const [moved] = newCols.splice(dragIdx, 1);
    newCols.splice(idx, 0, moved);
    onChange(newCols);
    setDragIdx(null);
    setOverIdx(null);
  }

  function handleDragEnd() {
    setDragIdx(null);
    setOverIdx(null);
  }

  return (
    <div>
      {/* Active columns — drag to reorder */}
      <p className="text-[10px] text-gray-400 mb-1 font-medium">Active — drag to reorder</p>
      <div className="space-y-0.5 mb-3">
        {activeColumns.map((col, idx) => (
          <div
            key={col.key}
            draggable
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={() => handleDrop(idx)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-1 text-xs px-1.5 py-1 rounded cursor-grab active:cursor-grabbing select-none transition-all ${
              overIdx === idx && dragIdx !== null && dragIdx !== idx
                ? 'bg-brand-100 border border-brand-300 border-dashed'
                : 'bg-gray-50 border border-transparent hover:bg-gray-100'
            } ${dragIdx === idx ? 'opacity-30' : ''}`}
          >
            <svg className="w-3 h-3 text-gray-300 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="5" cy="3" r="1.2"/><circle cx="11" cy="3" r="1.2"/>
              <circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/>
              <circle cx="5" cy="13" r="1.2"/><circle cx="11" cy="13" r="1.2"/>
            </svg>
            <span className="flex-1 truncate font-medium text-gray-700">{col.header}</span>
            <button
              onClick={(e) => { e.stopPropagation(); handleToggle(col, false); }}
              className="text-gray-300 hover:text-red-400 flex-shrink-0"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        ))}
        {activeColumns.length === 0 && <p className="text-[10px] text-gray-300 italic py-2 text-center">No columns selected</p>}
      </div>

      {/* Available columns — click to add */}
      {allColumns.filter(c => !activeColumns.some(ac => ac.key === c.key)).length > 0 && (
        <>
          <p className="text-[10px] text-gray-400 mb-1 font-medium">Available — click to add</p>
          <div className="space-y-0.5">
            {allColumns.filter(c => !activeColumns.some(ac => ac.key === c.key)).map(col => (
              <button
                key={col.key}
                onClick={() => handleToggle(col, true)}
                className="w-full flex items-center gap-1 text-xs px-1.5 py-1 rounded text-gray-400 hover:bg-green-50 hover:text-green-700 text-left transition-colors"
              >
                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                <span className="truncate">{col.header}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Main Canvas ──────────────────────────────────────────────── */
interface CanvasProps {
  template: PrintTemplate;
  onChange: (template: PrintTemplate) => void;
}

export default function TemplateCanvas({ template, onChange }: CanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; startX: number; startY: number; startW: number; startH: number } | null>(null);
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const [fieldSearch, setFieldSearch] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);

  const selected = template.blocks.find(b => b.id === selectedId) || null;
  const entityFields = ENTITY_FIELDS[template.entity_type]?.fields || [];

  function updateBlock(id: string, updates: Partial<TemplateBlock>) {
    const newBlocks = template.blocks.map(b => b.id === id ? { ...b, ...updates } : b);
    onChange({ ...template, blocks: newBlocks });
  }

  function deleteBlock(id: string) {
    onChange({ ...template, blocks: template.blocks.filter(b => b.id !== id) });
    if (selectedId === id) setSelectedId(null);
  }

  function addBlock(block: Partial<TemplateBlock>) {
    const newBlock: TemplateBlock = {
      id: makeId(),
      type: block.type || 'text',
      x: 20, y: 20,
      width: block.width || 60, height: block.height || 8,
      fontSize: 9,
      ...block,
    };
    onChange({ ...template, blocks: [...template.blocks, newBlock] });
    setSelectedId(newBlock.id);
  }

  function addFieldBlock(fieldKey: string, fieldLabel: string) {
    addBlock({ type: 'field', fieldKey, fieldLabel, showLabel: true, width: 85, height: 6, fontSize: 8 });
    setFieldPickerOpen(false);
  }

  const handleMouseDown = useCallback((e: React.MouseEvent, blockId: string) => {
    e.stopPropagation(); e.preventDefault();
    setSelectedId(blockId);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const block = template.blocks.find(b => b.id === blockId);
    if (!block) return;
    const mouseX = (e.clientX - rect.left) / SCALE;
    const mouseY = (e.clientY - rect.top) / SCALE;
    setDragging({ id: blockId, offsetX: mouseX - block.x, offsetY: mouseY - block.y });
  }, [template.blocks]);

  const handleResizeDown = useCallback((e: React.MouseEvent, blockId: string) => {
    e.stopPropagation(); e.preventDefault();
    const block = template.blocks.find(b => b.id === blockId);
    if (!block) return;
    setResizing({ id: blockId, startX: e.clientX, startY: e.clientY, startW: block.width, startH: block.height });
  }, [template.blocks]);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (dragging) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const newX = Math.max(0, Math.min(PAGE_W - 10, (e.clientX - rect.left) / SCALE - dragging.offsetX));
        const newY = Math.max(0, Math.min(PAGE_H - 10, (e.clientY - rect.top) / SCALE - dragging.offsetY));
        updateBlock(dragging.id, { x: Math.round(newX * 2) / 2, y: Math.round(newY * 2) / 2 });
      }
      if (resizing) {
        const dx = (e.clientX - resizing.startX) / SCALE;
        const dy = (e.clientY - resizing.startY) / SCALE;
        updateBlock(resizing.id, {
          width: Math.max(10, Math.round((resizing.startW + dx) * 2) / 2),
          height: Math.max(4, Math.round((resizing.startH + dy) * 2) / 2),
        });
      }
    }
    function handleMouseUp() { setDragging(null); setResizing(null); }
    if (dragging || resizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
    }
  }, [dragging, resizing]);

  function renderBlockPreview(block: TemplateBlock) {
    const overflowMode = block.overflow || 'wrap';
    const style: React.CSSProperties = {
      fontSize: `${(block.fontSize || 9) * 0.75}px`, fontWeight: block.fontWeight || 'normal',
      textAlign: (block.textAlign || 'left') as any, color: block.color || '#333',
      lineHeight: 1.3, overflow: 'hidden', width: '100%', height: '100%',
    };
    // Visual cue for truncate/clip modes
    if (overflowMode === 'truncate') {
      style.whiteSpace = 'nowrap';
      style.textOverflow = 'ellipsis';
    }
    const overflowBadge = (block.type === 'field' || block.type === 'text') && overflowMode !== 'wrap'
      ? <span className="absolute bottom-0 right-0 text-[6px] bg-gray-200 text-gray-500 px-0.5 rounded-tl leading-none py-px">{overflowMode === 'shrink' ? '↕' : overflowMode === 'truncate' ? '…' : '✂'}</span>
      : null;

    switch (block.type) {
      case 'field':
        return (<div style={style} className="relative flex items-center gap-1 px-0.5">
          {block.showLabel && <span style={{ color: '#999', fontSize: '0.85em' }}>{block.fieldLabel}:</span>}
          <span style={{ fontWeight: 'bold', color: '#00BCD4' }}>{`{{${block.fieldKey}}}`}</span>
          {overflowBadge}
        </div>);
      case 'text':
        return <div style={style} className="relative px-0.5 whitespace-pre-wrap">{block.content || 'Text'}{overflowBadge}</div>;
      case 'image':
        return <div className="flex items-center justify-center bg-gray-100 rounded h-full text-xs text-gray-400">{block.imageKey === 'logo' ? '[ Logo ]' : '[ Image ]'}</div>;
      case 'table':
        return (<div className="border border-gray-300 rounded h-full flex flex-col">
          <div className="bg-gray-700 text-white text-[7px] px-1 py-0.5 flex gap-1">
            {(block.tableColumns || []).slice(0, 5).map((col, i) => <span key={i} className="flex-1 truncate">{col.header}</span>)}
            {(block.tableColumns || []).length > 5 && <span>...</span>}
          </div>
          <div className="flex-1 flex items-center justify-center text-[7px] text-gray-400">Line items from {block.tableSource}</div>
        </div>);
      case 'line':
        return <div className="w-full" style={{ borderTop: `${block.lineWidth || 1}px solid ${block.lineColor || '#ccc'}`, marginTop: (block.height * SCALE) / 2 }} />;
      case 'rectangle':
        return <div className="w-full h-full rounded" style={{ backgroundColor: block.bgColor || 'transparent', border: `1px solid ${block.lineColor || '#ccc'}` }} />;
      default: return null;
    }
  }

  const filteredFields = entityFields.filter(f =>
    !fieldSearch || f.label.toLowerCase().includes(fieldSearch.toLowerCase()) || f.key.toLowerCase().includes(fieldSearch.toLowerCase())
  );
  const groupedFields: Record<string, typeof entityFields> = {};
  filteredFields.forEach(f => { if (!groupedFields[f.group]) groupedFields[f.group] = []; groupedFields[f.group].push(f); });

  return (
    <div className="flex gap-4 h-full">
      {/* Left: Toolbox */}
      <div className="w-56 flex-shrink-0 bg-white border border-gray-200 rounded-xl p-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        <h3 className="text-xs font-bold text-gray-400 uppercase mb-3">Add Blocks</h3>
        <div className="space-y-1 mb-4">
          {SPECIAL_BLOCKS.map((sb, i) => (
            <button key={i} onClick={() => addBlock({ ...sb })} className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-gray-100 flex items-center gap-2">
              <span className="w-4 text-center text-gray-400">{sb.type === 'image' ? '🖼' : sb.type === 'text' ? '📝' : sb.type === 'line' ? '—' : '▢'}</span>
              {sb.label}
            </button>
          ))}
        </div>

        <h3 className="text-xs font-bold text-gray-400 uppercase mb-2">Line Items Table</h3>
        <button onClick={() => {
          const tableSource = template.entity_type === 'order' ? 'order_items' : template.entity_type === 'invoice' ? 'invoice_items' : template.entity_type === 'pick_ticket' ? 'pick_ticket_items' : 'shipment_boxes';
          addBlock({ type: 'table', width: 180, height: 60, tableSource, tableColumns: (TABLE_COLUMNS[tableSource] || []).slice(0, 7), showTotals: true, fontSize: 8 });
        }} className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-gray-100 flex items-center gap-2 mb-4">
          <span className="w-4 text-center text-gray-400">📊</span>Items Table
        </button>

        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-gray-400 uppercase">Data Fields</h3>
          <button onClick={() => setFieldPickerOpen(!fieldPickerOpen)} className="text-xs text-brand-600 hover:underline">{fieldPickerOpen ? 'Close' : 'Browse'}</button>
        </div>
        {fieldPickerOpen && (
          <div>
            <input type="text" value={fieldSearch} onChange={e => setFieldSearch(e.target.value)} placeholder="Search fields..." className="w-full px-2 py-1 text-xs border border-gray-200 rounded mb-2" />
            {Object.entries(groupedFields).map(([group, fields]) => (
              <div key={group} className="mb-2">
                <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">{group}</p>
                {fields.map(f => (
                  <button key={f.key} onClick={() => addFieldBlock(f.key, f.label)} className="w-full text-left px-2 py-1 text-xs rounded hover:bg-blue-50 hover:text-blue-700 truncate">
                    {f.label} <span className="text-gray-300 text-[9px]">{f.key}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Center: Canvas */}
      <div className="flex-1 overflow-auto bg-gray-100 rounded-xl p-4">
        <div ref={canvasRef} className="relative bg-white shadow-lg mx-auto" style={{ width: PAGE_W * SCALE, height: PAGE_H * SCALE, cursor: dragging ? 'grabbing' : 'default' }} onClick={() => setSelectedId(null)}>
          <svg className="absolute inset-0 pointer-events-none opacity-10" width="100%" height="100%">
            {Array.from({ length: Math.floor(PAGE_W / 10) }).map((_, i) => <line key={`v${i}`} x1={i * 10 * SCALE} y1="0" x2={i * 10 * SCALE} y2="100%" stroke="#999" strokeWidth="0.5" />)}
            {Array.from({ length: Math.floor(PAGE_H / 10) }).map((_, i) => <line key={`h${i}`} x1="0" y1={i * 10 * SCALE} x2="100%" y2={i * 10 * SCALE} stroke="#999" strokeWidth="0.5" />)}
          </svg>
          {template.blocks.map(block => (
            <div key={block.id}
              className={`absolute group ${selectedId === block.id ? 'ring-2 ring-brand-500 z-20' : 'hover:ring-1 hover:ring-gray-300 z-10'}`}
              style={{ left: block.x * SCALE, top: block.y * SCALE, width: block.width * SCALE, height: block.height * SCALE, cursor: dragging?.id === block.id ? 'grabbing' : 'grab' }}
              onMouseDown={e => handleMouseDown(e, block.id)}
              onClick={e => { e.stopPropagation(); setSelectedId(block.id); }}
            >
              {renderBlockPreview(block)}
              {selectedId === block.id && <div className="absolute bottom-0 right-0 w-3 h-3 bg-brand-500 cursor-se-resize rounded-tl" onMouseDown={e => handleResizeDown(e, block.id)} />}
              {selectedId === block.id && <button className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center hover:bg-red-600 z-30" onClick={e => { e.stopPropagation(); deleteBlock(block.id); }}>×</button>}
            </div>
          ))}
        </div>
      </div>

      {/* Right: Properties Panel */}
      <div className="w-60 flex-shrink-0 bg-white border border-gray-200 rounded-xl p-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        {selected ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-400 uppercase">Properties</h3>
              <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">{selected.type}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[10px] text-gray-400">X (mm)</label><input type="number" value={selected.x} onChange={e => updateBlock(selected.id, { x: parseFloat(e.target.value) || 0 })} className="w-full px-2 py-1 text-xs border border-gray-200 rounded" step="0.5" /></div>
              <div><label className="text-[10px] text-gray-400">Y (mm)</label><input type="number" value={selected.y} onChange={e => updateBlock(selected.id, { y: parseFloat(e.target.value) || 0 })} className="w-full px-2 py-1 text-xs border border-gray-200 rounded" step="0.5" /></div>
              <div><label className="text-[10px] text-gray-400">Width</label><input type="number" value={selected.width} onChange={e => updateBlock(selected.id, { width: parseFloat(e.target.value) || 10 })} className="w-full px-2 py-1 text-xs border border-gray-200 rounded" step="0.5" /></div>
              <div><label className="text-[10px] text-gray-400">Height</label><input type="number" value={selected.height} onChange={e => updateBlock(selected.id, { height: parseFloat(e.target.value) || 4 })} className="w-full px-2 py-1 text-xs border border-gray-200 rounded" step="0.5" /></div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[10px] text-gray-400">Font Size</label><input type="number" value={selected.fontSize || 9} onChange={e => updateBlock(selected.id, { fontSize: parseInt(e.target.value) || 9 })} className="w-full px-2 py-1 text-xs border border-gray-200 rounded" min="5" max="36" /></div>
              <div><label className="text-[10px] text-gray-400">Weight</label><select value={selected.fontWeight || 'normal'} onChange={e => updateBlock(selected.id, { fontWeight: e.target.value as any })} className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white"><option value="normal">Normal</option><option value="bold">Bold</option></select></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[10px] text-gray-400">Align</label><select value={selected.textAlign || 'left'} onChange={e => updateBlock(selected.id, { textAlign: e.target.value as any })} className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></div>
              <div><label className="text-[10px] text-gray-400">Color</label><input type="color" value={selected.color || '#333333'} onChange={e => updateBlock(selected.id, { color: e.target.value })} className="w-full h-7 border border-gray-200 rounded cursor-pointer" /></div>
            </div>

            {/* Overflow mode — for field and text blocks */}
            {(selected.type === 'field' || selected.type === 'text') && (
              <div>
                <label className="text-[10px] text-gray-400">Overflow</label>
                <select value={selected.overflow || 'wrap'} onChange={e => updateBlock(selected.id, { overflow: e.target.value as any })} className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white">
                  <option value="wrap">Wrap (may overflow)</option>
                  <option value="clip">Clip to box (…)</option>
                  <option value="shrink">Auto-shrink font</option>
                  <option value="truncate">Single line truncate (…)</option>
                </select>
                <p className="text-[9px] text-gray-400 mt-1">
                  {selected.overflow === 'shrink' ? 'Reduces font size until text fits inside the block' :
                   selected.overflow === 'truncate' ? 'One line only, cuts with … if too long' :
                   selected.overflow === 'clip' ? 'Wraps text but hard clips at block boundary' :
                   'Text wraps at width but may exceed block height'}
                </p>
              </div>
            )}

            {selected.type === 'field' && (
              <div>
                <label className="text-[10px] text-gray-400">Field</label>
                <select value={selected.fieldKey || ''} onChange={e => { const f = entityFields.find(f => f.key === e.target.value); updateBlock(selected.id, { fieldKey: e.target.value, fieldLabel: f?.label || e.target.value }); }} className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white">
                  {entityFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <label className="flex items-center gap-1 mt-2 text-xs"><input type="checkbox" checked={selected.showLabel !== false} onChange={e => updateBlock(selected.id, { showLabel: e.target.checked })} className="rounded border-gray-300" /> Show label</label>
              </div>
            )}

            {selected.type === 'text' && (
              <div>
                <label className="text-[10px] text-gray-400">Content</label>
                <textarea value={selected.content || ''} onChange={e => updateBlock(selected.id, { content: e.target.value })} className="w-full px-2 py-1 text-xs border border-gray-200 rounded resize-none" rows={4} />
                <p className="text-[9px] text-gray-400 mt-1">Use {'{{notes_1}}'} or {'{{notes_2}}'} for custom notes</p>
              </div>
            )}

            {selected.type === 'rectangle' && (
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[10px] text-gray-400">Fill</label><input type="color" value={selected.bgColor || '#FFFFFF'} onChange={e => updateBlock(selected.id, { bgColor: e.target.value })} className="w-full h-7 border border-gray-200 rounded cursor-pointer" /></div>
                <div><label className="text-[10px] text-gray-400">Border</label><input type="color" value={selected.lineColor || '#CCCCCC'} onChange={e => updateBlock(selected.id, { lineColor: e.target.value })} className="w-full h-7 border border-gray-200 rounded cursor-pointer" /></div>
              </div>
            )}

            {selected.type === 'table' && (
              <div>
                <label className="text-[10px] text-gray-400 mb-1 block">Table Columns</label>
                <div className="max-h-56 overflow-y-auto">
                  <DraggableColumnList
                    allColumns={TABLE_COLUMNS[selected.tableSource || ''] || []}
                    activeColumns={selected.tableColumns || []}
                    onChange={(cols: any) => updateBlock(selected.id, { tableColumns: cols })}
                  />
                </div>
                <label className="flex items-center gap-1 mt-2 text-xs"><input type="checkbox" checked={selected.showTotals !== false} onChange={e => updateBlock(selected.id, { showTotals: e.target.checked })} className="rounded border-gray-300" /> Show totals row</label>
              </div>
            )}

            <button onClick={() => deleteBlock(selected.id)} className="w-full text-xs text-red-600 py-1.5 border border-red-200 rounded hover:bg-red-50 mt-2">Delete Block</button>
          </div>
        ) : (
          <div className="text-center text-gray-400 text-xs py-8">
            <p>Click a block to edit its properties</p>
            <p className="mt-2">Drag blocks to reposition</p>
            <p>Drag corner handle to resize</p>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-gray-200">
          <h3 className="text-xs font-bold text-gray-400 uppercase mb-2">Custom Notes</h3>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-gray-400">Note 1 (Bank/Payment/Terms)</label>
              <textarea value={template.notes_1 || ''} onChange={e => onChange({ ...template, notes_1: e.target.value })} className="w-full px-2 py-1 text-xs border border-gray-200 rounded resize-none" rows={3} placeholder="e.g. Wire to: Bank of America, Routing: 123..." />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Note 2 (Custom)</label>
              <textarea value={template.notes_2 || ''} onChange={e => onChange({ ...template, notes_2: e.target.value })} className="w-full px-2 py-1 text-xs border border-gray-200 rounded resize-none" rows={3} placeholder="Any additional notes..." />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
