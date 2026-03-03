'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/db';
import { PrintTemplate, getDefaultTemplate, ENTITY_FIELDS } from '@/lib/template-config';
import TemplateCanvas from '@/components/TemplateCanvas';

const ENTITY_TYPES = ['order', 'invoice', 'pick_ticket', 'shipment'] as const;
const ICONS: Record<string, string> = { order: '📋', invoice: '💰', pick_ticket: '📦', shipment: '🚚' };

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [editing, setEditing] = useState<PrintTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState('');

  useEffect(() => { loadTemplates(); }, []);

  async function loadTemplates() {
    setLoading(true);
    const { data } = await db
      .from('print_templates')
      .select('*')
      .order('entity_type')
      .order('is_default', { ascending: false })
      .order('name');

    if (data && data.length > 0) {
      setTemplates(data.map((t: any) => ({
        ...t,
        blocks: typeof t.blocks === 'string' ? JSON.parse(t.blocks) : t.blocks,
        margins: typeof t.margins === 'string' ? JSON.parse(t.margins) : t.margins,
      })));
    } else {
      setTemplates([]);
    }
    setLoading(false);
  }

  async function saveTemplate(tmpl: PrintTemplate) {
    setSaving(true);
    setSaveMsg('');

    const payload = {
      name: tmpl.name,
      entity_type: tmpl.entity_type,
      page_size: tmpl.page_size,
      orientation: tmpl.orientation,
      margins: tmpl.margins,
      blocks: tmpl.blocks,
      notes_1: tmpl.notes_1 || '',
      notes_2: tmpl.notes_2 || '',
      is_default: tmpl.is_default || false,
      updated_at: new Date().toISOString(),
    };

    if (tmpl.id) {
      const { error } = await db.update('print_templates', payload, [{ op: 'eq', col: 'id', val: tmpl.id }]);
      if (error) { setSaveMsg('Error: ' + error.message); }
      else { setSaveMsg('Template saved'); await loadTemplates(); }
    } else {
      // If this is the first template for this entity type, make it default
      const existingForType = templates.filter(t => t.entity_type === tmpl.entity_type);
      if (existingForType.length === 0) payload.is_default = true;

      const { data, error } = await db.from('print_templates').insert({ ...payload, created_at: new Date().toISOString() }).select().single();
      if (error) { setSaveMsg('Error: ' + error.message); }
      else { setSaveMsg('Template created'); setEditing({ ...tmpl, id: data.id }); await loadTemplates(); }
    }
    setSaving(false);
    setTimeout(() => setSaveMsg(''), 3000);
  }

  async function setAsDefault(tmpl: PrintTemplate) {
    // Unset all others for this entity type
    const others = templates.filter(t => t.entity_type === tmpl.entity_type && t.id !== tmpl.id && t.is_default);
    for (const o of others) {
      if (o.id) await db.update('print_templates', { is_default: false }, [{ op: 'eq', col: 'id', val: o.id }]);
    }
    if (tmpl.id) {
      await db.update('print_templates', { is_default: true }, [{ op: 'eq', col: 'id', val: tmpl.id }]);
    }
    await loadTemplates();
    if (editing?.id === tmpl.id) setEditing({ ...editing, is_default: true });
  }

  async function deleteTemplate(tmpl: PrintTemplate) {
    if (!tmpl.id) return;
    if (!confirm(`Delete "${tmpl.name}"? This cannot be undone.`)) return;
    await db.delete('print_templates', [{ op: 'eq', col: 'id', val: tmpl.id }]);
    setEditing(null);
    await loadTemplates();
  }

  async function duplicateTemplate(tmpl: PrintTemplate) {
    const dup: PrintTemplate = {
      ...tmpl,
      id: undefined,
      name: tmpl.name + ' (Copy)',
      is_default: false,
      created_at: undefined,
      updated_at: undefined,
    };
    setEditing(dup);
  }

  function createNewTemplate(entityType: string) {
    const existing = templates.filter(t => t.entity_type === entityType);
    const def = getDefaultTemplate(entityType);
    def.name = `${ENTITY_FIELDS[entityType]?.label || entityType} Template ${existing.length + 1}`;
    def.is_default = existing.length === 0;
    setEditing(def);
  }

  function resetToDefault() {
    if (!editing) return;
    const def = getDefaultTemplate(editing.entity_type);
    def.id = editing.id;
    def.name = editing.name;
    def.is_default = editing.is_default;
    setEditing(def);
  }

  if (loading) return <div className="text-gray-400">Loading templates...</div>;

  /* ── Editor view ─────────────────────────────────────────── */
  if (editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div>
              {renaming ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={renameName}
                    onChange={e => setRenameName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { setEditing({ ...editing, name: renameName }); setRenaming(false); } if (e.key === 'Escape') setRenaming(false); }}
                    className="text-lg font-semibold border-b-2 border-brand-400 outline-none bg-transparent"
                  />
                  <button onClick={() => { setEditing({ ...editing, name: renameName }); setRenaming(false); }} className="text-xs text-brand-600">Save</button>
                </div>
              ) : (
                <h2 className="text-lg font-semibold text-gray-900 cursor-pointer hover:text-brand-600" onClick={() => { setRenameName(editing.name); setRenaming(true); }}>
                  {editing.name}
                  <svg className="w-3.5 h-3.5 inline ml-1.5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                </h2>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-xs text-gray-400">{editing.entity_type.replace('_', ' ')} template</p>
                {editing.is_default && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Default</span>}
                {!editing.is_default && editing.id && (
                  <button onClick={() => setAsDefault(editing)} className="text-[10px] text-brand-600 hover:underline">Set as default</button>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saveMsg && <span className={`text-xs ${saveMsg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{saveMsg}</span>}
            <button onClick={resetToDefault} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">Reset Layout</button>
            {editing.id && (
              <button onClick={() => duplicateTemplate(editing)} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">Duplicate</button>
            )}
            {editing.id && !editing.is_default && (
              <button onClick={() => deleteTemplate(editing)} className="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50">Delete</button>
            )}
            <button onClick={() => saveTemplate(editing)} disabled={saving} className="px-4 py-1.5 text-xs bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 font-medium">
              {saving ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </div>

        <div style={{ height: 'calc(100vh - 250px)' }}>
          <TemplateCanvas template={editing} onChange={setEditing} />
        </div>
      </div>
    );
  }

  /* ── List view ───────────────────────────────────────────── */
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Print Templates</h2>
        <p className="text-sm text-gray-500">Create multiple templates per document type. The default template is used when printing, or you can select a specific one.</p>
      </div>

      {ENTITY_TYPES.map(entityType => {
        const label = ENTITY_FIELDS[entityType]?.label || entityType;
        const typeTemplates = templates.filter(t => t.entity_type === entityType);

        return (
          <div key={entityType} className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">{ICONS[entityType]}</span>
                <h3 className="font-semibold text-gray-900">{label} Templates</h3>
                <span className="text-xs text-gray-400">{typeTemplates.length} template{typeTemplates.length !== 1 ? 's' : ''}</span>
              </div>
              <button
                onClick={() => createNewTemplate(entityType)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-brand-600 border border-brand-200 rounded-lg hover:bg-brand-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                New Template
              </button>
            </div>

            {typeTemplates.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-sm">
                <p>No templates yet.</p>
                <button onClick={() => createNewTemplate(entityType)} className="text-brand-600 hover:underline mt-1">Create your first {label.toLowerCase()} template</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {typeTemplates.map(tmpl => (
                  <div key={tmpl.id} className="border border-gray-150 rounded-lg p-3 hover:shadow-sm transition-shadow group relative">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-sm font-medium text-gray-800 truncate">{tmpl.name}</h4>
                          {tmpl.is_default && <span className="text-[9px] bg-green-100 text-green-700 px-1 py-0.5 rounded font-medium flex-shrink-0">Default</span>}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{tmpl.blocks?.length || 0} blocks</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2.5">
                      <button
                        onClick={() => setEditing(tmpl)}
                        className="flex-1 px-2 py-1 text-xs font-medium text-brand-600 border border-brand-200 rounded hover:bg-brand-50 transition-colors"
                      >
                        Edit
                      </button>
                      {!tmpl.is_default && (
                        <button
                          onClick={() => setAsDefault(tmpl)}
                          className="px-2 py-1 text-xs text-gray-500 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
                          title="Set as default"
                        >
                          Set Default
                        </button>
                      )}
                      <button
                        onClick={() => duplicateTemplate(tmpl)}
                        className="px-2 py-1 text-xs text-gray-400 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
                        title="Duplicate"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
