'use client';

import { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/db';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = ['in_development', 'approved', 'rejected', 'archived'];
const OPERATIONS = ['cut', 'print', 'dye', 'stitch', 'finish', 'qc', 'pack'];
const CURRENCIES = ['INR', 'USD', 'THB'];
const MATERIAL_TYPES = ['fabric', 'trim', 'packaging', 'carton', 'label'];
const STANDARD_MILESTONES = ['sample_requested', 'fit_approved', 'bom_locked', 'promoted'];

function statusClass(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'approved') return 'bg-green-100 text-green-700';
  if (s === 'in_development') return 'bg-blue-100 text-blue-700';
  if (s === 'rejected') return 'bg-red-100 text-red-700';
  if (s === 'archived') return 'bg-gray-100 text-gray-600';
  if (s === 'presented') return 'bg-yellow-100 text-yellow-700';
  if (s === 'draft') return 'bg-gray-100 text-gray-600';
  if (s === 'superseded') return 'bg-gray-100 text-gray-400';
  return 'bg-gray-100 text-gray-600';
}

function fmtStatus(s: string): string {
  return (s || '-').replace(/_/g, ' ');
}

function fmtDate(value: any): string {
  if (!value) return '-';
  try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return String(value); }
}

function fmtDateTime(value: any): string {
  if (!value) return '-';
  try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return String(value); }
}

const EVENT_ICONS: Record<string, string> = {
  note: '📝', image: '🖼️', video: '🎬', voice: '🎤',
  version_bump: '🔁', status_change: '🏷️', measurement_update: '📐',
};

export default function SamplesPage() {
  const [samples, setSamples] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [partners, setPartners] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);

  // Detail drawer state
  const [selected, setSelected] = useState<any | null>(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [versions, setVersions] = useState<any[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [events, setEvents] = useState<any[]>([]);
  const [measurements, setMeasurements] = useState<any[]>([]);
  const [bom, setBom] = useState<any[]>([]);
  const [routing, setRouting] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // New-sample modal
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<any>({ sample_code: '', name: '', description: '', category: '', collection: '', colorway: '', print_notes: '', source_type: 'internal_factory', source_id: '' });

  // Media state
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Inline add forms
  const [noteText, setNoteText] = useState('');
  const [measForm, setMeasForm] = useState<any>({ size: '', point_of_measure: '', target_value: '', unit: 'in' });
  const [bomForm, setBomForm] = useState<any>({ material_id: '', consumption_net: '', wastage_pct: '0', cost_per_unit: '', currency: 'INR', notes: '' });
  const [newMatForm, setNewMatForm] = useState<any>({ show: false, name: '', material_type: 'fabric', unit: 'meters' });
  const [routeForm, setRouteForm] = useState<any>({ operation: 'cut', owner_type: 'in_house', owner_id: '' });
  const [msForm, setMsForm] = useState<any>({ milestone: 'sample_requested', due_date: '', owner: '' });

  useEffect(() => { setPage(0); }, [search, statusFilter]);
  useEffect(() => { loadSamples(); }, [page, search, statusFilter]);
  useEffect(() => { loadLookups(); }, []);

  async function loadLookups() {
    const [{ data: p }, { data: m }] = await Promise.all([
      db.from('partners').select('*').eq('is_active', true).order('name'),
      db.from('raw_materials').select('*').eq('is_active', true).order('name'),
    ]);
    setPartners(p || []);
    setMaterials(m || []);
  }

  async function loadSamples() {
    setLoading(true);
    let query = db.from('samples').select('*', { count: 'exact' });
    if (search) query = query.or(`sample_code.ilike.%${search}%,name.ilike.%${search}%,colorway.ilike.%${search}%,category.ilike.%${search}%`);
    if (statusFilter) query = query.eq('status', statusFilter);
    const { data, count } = await query.order('updated_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data) { setSamples(data); setTotalCount(count || 0); }
    setLoading(false);
  }

  async function openDetail(sample: any) {
    setSelected(sample);
    setDetailTab('overview');
    setErrorMsg('');
    await reloadDetail(sample.id, null);
  }

  async function reloadDetail(sampleId: string, versionId: string | null) {
    const [{ data: v }, { data: ev }, { data: rt }, { data: ms }] = await Promise.all([
      db.from('sample_versions').select('*').eq('sample_id', sampleId).order('version_number', { ascending: false }),
      db.from('sample_timeline_events').select('*').eq('sample_id', sampleId).order('created_at', { ascending: false }).limit(200),
      db.from('routing_steps').select('*').eq('sample_id', sampleId).order('sequence'),
      db.from('sample_milestones').select('*').eq('sample_id', sampleId).order('due_date'),
    ]);
    setVersions(v || []);
    setEvents(ev || []);
    setRouting(rt || []);
    setMilestones(ms || []);
    signMedia(ev || []);
    const vid = versionId || (v && v.length > 0 ? v[0].id : '');
    setSelectedVersionId(vid);
    if (vid) await loadVersionData(vid);
    else { setMeasurements([]); setBom([]); }
  }

  async function loadVersionData(versionId: string) {
    const [{ data: mm }, { data: bb }] = await Promise.all([
      db.from('tech_pack_measurements').select('*').eq('sample_version_id', versionId).order('sort_order').order('point_of_measure'),
      db.from('sample_bom').select('*').eq('sample_version_id', versionId).order('created_at'),
    ]);
    setMeasurements(mm || []);
    setBom(bb || []);
  }

  async function refreshSelected() {
    if (!selected) return;
    const { data } = await db.from('samples').select('*').eq('id', selected.id).maybeSingle();
    if (data) setSelected(data);
    loadSamples();
  }

  async function logEvent(sampleId: string, versionId: string | null, eventType: string, body: string) {
    await db.insert('sample_timeline_events', { sample_id: sampleId, version_id: versionId || null, event_type: eventType, body });
  }

  async function signMedia(evs: any[]) {
    const paths = evs.filter(e => e.media_url).map(e => e.media_url);
    if (paths.length === 0) return;
    try {
      const res = await fetch('/api/plm/media', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sign', paths }),
      });
      const json = await res.json();
      if (json.data) setMediaUrls(prev => ({ ...prev, ...json.data }));
    } catch {}
  }

  async function uploadMedia(file: File, eventType: 'image' | 'video' | 'voice') {
    if (!selected) return;
    setUploading(true); setErrorMsg('');
    try {
      // 1. Get a signed upload URL (file goes straight to storage, not through Vercel)
      const res1 = await fetch('/api/plm/media', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-upload', sample_id: selected.id, filename: file.name, content_type: file.type }),
      });
      const j1 = await res1.json();
      if (j1.error) throw new Error(j1.error);
      // 2. Upload directly to Supabase Storage
      const putRes = await fetch(j1.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
      // 3. Record the timeline event
      const res3 = await fetch('/api/plm/media', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', sample_id: selected.id, version_id: selectedVersionId || null, path: j1.path, event_type: eventType, body: file.name }),
      });
      const j3 = await res3.json();
      if (j3.error) throw new Error(j3.error);
      await reloadDetail(selected.id, selectedVersionId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Upload failed');
    }
    setUploading(false);
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const type = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'voice' : 'image';
    uploadMedia(file, type as any);
    e.target.value = '';
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        const ext = mime.includes('webm') ? 'webm' : 'm4a';
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: mime });
        uploadMedia(file, 'voice');
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setErrorMsg('Microphone access denied — allow it in your browser to record voice notes');
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  // ---------- Actions ----------

  async function createSample() {
    if (!newForm.sample_code.trim()) { setErrorMsg('Sample code is required'); return; }
    setSaving(true); setErrorMsg('');
    const payload: any = { ...newForm };
    if (!payload.source_id) delete payload.source_id;
    if (!payload.collection) delete payload.collection;
    const res: any = await db.insert('samples', payload);
    if (res.error) { setErrorMsg(res.error); setSaving(false); return; }
    const sample = res.data?.[0];
    if (sample) {
      const vres: any = await db.insert('sample_versions', { sample_id: sample.id, version_number: 1, status: 'draft', change_summary: 'Initial version' });
      const v1 = vres.data?.[0];
      await logEvent(sample.id, v1?.id || null, 'version_bump', 'Sample created — v1');
      setShowNew(false);
      setNewForm({ sample_code: '', name: '', description: '', category: '', collection: '', colorway: '', print_notes: '', source_type: 'internal_factory', source_id: '' });
      loadSamples();
      openDetail(sample);
    }
    setSaving(false);
  }

  async function newVersion() {
    if (!selected) return;
    setSaving(true);
    const nextNum = (versions[0]?.version_number || selected.current_version || 0) + 1;
    if (versions[0]) {
      await db.update('sample_versions', { status: 'superseded' }, [{ op: 'eq', col: 'id', val: versions[0].id }]);
    }
    const vres: any = await db.insert('sample_versions', { sample_id: selected.id, version_number: nextNum, status: 'draft' });
    const nv = vres.data?.[0];
    await db.update('samples', { current_version: nextNum }, [{ op: 'eq', col: 'id', val: selected.id }]);
    await logEvent(selected.id, nv?.id || null, 'version_bump', `Version ${nextNum} started`);
    await refreshSelected();
    await reloadDetail(selected.id, nv?.id || null);
    setSaving(false);
  }

  async function setSampleStatus(status: string) {
    if (!selected) return;
    setSaving(true);
    const patch: any = { status };
    if (status === 'approved') patch.approved_at = new Date().toISOString();
    await db.update('samples', patch, [{ op: 'eq', col: 'id', val: selected.id }]);
    if (status === 'approved' && selectedVersionId) {
      await db.update('sample_versions', { status: 'approved' }, [{ op: 'eq', col: 'id', val: selectedVersionId }]);
    }
    await logEvent(selected.id, selectedVersionId || null, 'status_change', `Status changed to ${fmtStatus(status)}`);
    await refreshSelected();
    await reloadDetail(selected.id, selectedVersionId);
    setSaving(false);
  }

  async function addNote() {
    if (!selected || !noteText.trim()) return;
    setSaving(true);
    await logEvent(selected.id, selectedVersionId || null, 'note', noteText.trim());
    setNoteText('');
    await reloadDetail(selected.id, selectedVersionId);
    setSaving(false);
  }

  async function addMeasurement() {
    if (!selected || !selectedVersionId || !measForm.size.trim() || !measForm.point_of_measure.trim()) return;
    setSaving(true);
    await db.insert('tech_pack_measurements', {
      sample_version_id: selectedVersionId,
      size: measForm.size.trim(),
      point_of_measure: measForm.point_of_measure.trim(),
      target_value: measForm.target_value === '' ? null : parseFloat(measForm.target_value),
      unit: measForm.unit,
    });
    await logEvent(selected.id, selectedVersionId, 'measurement_update', `${measForm.point_of_measure} (${measForm.size}) = ${measForm.target_value} ${measForm.unit}`);
    setMeasForm({ ...measForm, point_of_measure: '', target_value: '' });
    await loadVersionData(selectedVersionId);
    setSaving(false);
  }

  async function deleteMeasurement(id: string) {
    setSaving(true);
    await db.delete('tech_pack_measurements', [{ op: 'eq', col: 'id', val: id }]);
    if (selectedVersionId) await loadVersionData(selectedVersionId);
    setSaving(false);
  }

  async function quickCreateMaterial() {
    if (!newMatForm.name.trim()) return;
    setSaving(true);
    const res: any = await db.insert('raw_materials', { name: newMatForm.name.trim(), material_type: newMatForm.material_type, unit: newMatForm.unit });
    const mat = res.data?.[0];
    await loadLookups();
    if (mat) setBomForm({ ...bomForm, material_id: mat.id });
    setNewMatForm({ show: false, name: '', material_type: 'fabric', unit: 'meters' });
    setSaving(false);
  }

  async function addBomLine() {
    if (!selected || !selectedVersionId || !bomForm.material_id) return;
    setSaving(true);
    const mat = materials.find(m => m.id === bomForm.material_id);
    await db.insert('sample_bom', {
      sample_version_id: selectedVersionId,
      material_id: bomForm.material_id,
      material_type: mat?.material_type || null,
      consumption_net: bomForm.consumption_net === '' ? null : parseFloat(bomForm.consumption_net),
      wastage_pct: bomForm.wastage_pct === '' ? 0 : parseFloat(bomForm.wastage_pct),
      unit: mat?.unit || null,
      cost_per_unit: bomForm.cost_per_unit === '' ? null : parseFloat(bomForm.cost_per_unit),
      currency: bomForm.currency,
      notes: bomForm.notes || null,
    });
    setBomForm({ material_id: '', consumption_net: '', wastage_pct: '0', cost_per_unit: '', currency: bomForm.currency, notes: '' });
    await loadVersionData(selectedVersionId);
    setSaving(false);
  }

  async function deleteBomLine(id: string) {
    setSaving(true);
    await db.delete('sample_bom', [{ op: 'eq', col: 'id', val: id }]);
    if (selectedVersionId) await loadVersionData(selectedVersionId);
    setSaving(false);
  }

  async function addRoutingStep() {
    if (!selected) return;
    setSaving(true);
    const nextSeq = routing.length > 0 ? Math.max(...routing.map(r => r.sequence)) + 10 : 10;
    await db.insert('routing_steps', {
      sample_id: selected.id,
      sequence: nextSeq,
      operation: routeForm.operation,
      owner_type: routeForm.owner_type,
      owner_id: routeForm.owner_id || null,
    });
    setRouteForm({ operation: 'cut', owner_type: 'in_house', owner_id: '' });
    await reloadDetail(selected.id, selectedVersionId);
    setSaving(false);
  }

  async function toggleRoutingStep(step: any) {
    setSaving(true);
    await db.update('routing_steps', { is_active: !step.is_active }, [{ op: 'eq', col: 'id', val: step.id }]);
    if (selected) await reloadDetail(selected.id, selectedVersionId);
    setSaving(false);
  }

  async function deleteRoutingStep(id: string) {
    setSaving(true);
    await db.delete('routing_steps', [{ op: 'eq', col: 'id', val: id }]);
    if (selected) await reloadDetail(selected.id, selectedVersionId);
    setSaving(false);
  }

  async function addMilestone() {
    if (!selected || !msForm.milestone) return;
    setSaving(true);
    await db.insert('sample_milestones', {
      sample_id: selected.id,
      milestone: msForm.milestone,
      due_date: msForm.due_date || null,
      owner: msForm.owner || null,
    });
    setMsForm({ milestone: 'sample_requested', due_date: '', owner: '' });
    if (selected) await reloadDetail(selected.id, selectedVersionId);
    setSaving(false);
  }

  async function toggleMilestone(ms: any) {
    setSaving(true);
    await db.update('sample_milestones', { completed_at: ms.completed_at ? null : new Date().toISOString() }, [{ op: 'eq', col: 'id', val: ms.id }]);
    if (selected) await reloadDetail(selected.id, selectedVersionId);
    setSaving(false);
  }

  // ---------- Derived ----------

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const partnerName = (id: string) => partners.find(p => p.id === id)?.name || '-';
  const materialName = (id: string) => materials.find(m => m.id === id)?.name || '-';
  const selectedVersion = versions.find(v => v.id === selectedVersionId);
  const outsourcePartners = (op: string) => partners.filter(p => p.partner_type === 'external_vendor' && (p.capabilities || []).includes(op));
  const internalFactories = partners.filter(p => p.partner_type === 'internal_factory');

  function milestoneState(ms: any): { label: string; cls: string } {
    if (ms.completed_at) return { label: 'Done', cls: 'bg-green-100 text-green-700' };
    if (!ms.due_date) return { label: 'Open', cls: 'bg-gray-100 text-gray-600' };
    const due = new Date(ms.due_date); const now = new Date();
    const days = (due.getTime() - now.getTime()) / 86400000;
    if (days < 0) return { label: 'Late', cls: 'bg-red-100 text-red-700' };
    if (days <= 3) return { label: 'At risk', cls: 'bg-yellow-100 text-yellow-700' };
    return { label: 'On time', cls: 'bg-blue-100 text-blue-700' };
  }

  const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-sm';

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Samples</h1>
          <p className="text-gray-500 mt-1">{totalCount.toLocaleString()} samples in development — PLM</p>
        </div>
        <button onClick={() => { setShowNew(true); setErrorMsg(''); }} className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium">+ New Sample</button>
      </div>

      <div className="card mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <input type="text" placeholder="Search by code, name, colorway, category..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg outline-none bg-white">
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{fmtStatus(s)}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        {loading ? <div className="text-center py-8 text-gray-500">Loading...</div> : samples.length === 0 ? <div className="text-center py-8 text-gray-500">No samples yet — create your first one</div> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-200">
                  <th className="table-header pb-3 whitespace-nowrap">Code</th>
                  <th className="table-header pb-3 whitespace-nowrap">Name</th>
                  <th className="table-header pb-3 whitespace-nowrap">Status</th>
                  <th className="table-header pb-3 whitespace-nowrap">Version</th>
                  <th className="table-header pb-3 whitespace-nowrap">Category</th>
                  <th className="table-header pb-3 whitespace-nowrap">Colorway</th>
                  <th className="table-header pb-3 whitespace-nowrap">Source</th>
                  <th className="table-header pb-3 whitespace-nowrap">Updated</th>
                </tr></thead>
                <tbody>
                  {samples.map(s => (
                    <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => openDetail(s)}>
                      <td className="table-cell text-sm"><span className="font-medium text-brand-600">{s.sample_code}</span></td>
                      <td className="table-cell text-sm max-w-[220px] truncate">{s.name || '-'}</td>
                      <td className="table-cell text-sm"><span className={`px-2 py-0.5 rounded text-xs font-medium ${statusClass(s.status)}`}>{fmtStatus(s.status)}</span></td>
                      <td className="table-cell text-sm">v{s.current_version}</td>
                      <td className="table-cell text-sm">{s.category || '-'}</td>
                      <td className="table-cell text-sm">{s.colorway || '-'}</td>
                      <td className="table-cell text-sm">{s.source_id ? partnerName(s.source_id) : (s.source_type ? fmtStatus(s.source_type) : '-')}</td>
                      <td className="table-cell text-sm whitespace-nowrap">{fmtDate(s.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-500">Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}</p>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Previous</button>
                <span className="px-3 py-1 text-sm text-gray-500">Page {page + 1} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* New sample modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">New Sample</h2>
              <button onClick={() => setShowNew(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            {errorMsg && <div className="mb-4 px-3 py-2 bg-red-50 text-red-700 text-sm rounded-lg">{errorMsg}</div>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><p className="text-xs text-gray-400 mb-1">Sample code *</p><input className={`w-full ${inputCls}`} value={newForm.sample_code} onChange={e => setNewForm({ ...newForm, sample_code: e.target.value })} placeholder="e.g. SMP-0001" /></div>
              <div><p className="text-xs text-gray-400 mb-1">Name</p><input className={`w-full ${inputCls}`} value={newForm.name} onChange={e => setNewForm({ ...newForm, name: e.target.value })} /></div>
              <div><p className="text-xs text-gray-400 mb-1">Category</p><input className={`w-full ${inputCls}`} value={newForm.category} onChange={e => setNewForm({ ...newForm, category: e.target.value })} /></div>
              <div><p className="text-xs text-gray-400 mb-1">Collection (optional)</p><input className={`w-full ${inputCls}`} value={newForm.collection} onChange={e => setNewForm({ ...newForm, collection: e.target.value })} /></div>
              <div><p className="text-xs text-gray-400 mb-1">Colorway</p><input className={`w-full ${inputCls}`} value={newForm.colorway} onChange={e => setNewForm({ ...newForm, colorway: e.target.value })} /></div>
              <div><p className="text-xs text-gray-400 mb-1">Print notes</p><input className={`w-full ${inputCls}`} value={newForm.print_notes} onChange={e => setNewForm({ ...newForm, print_notes: e.target.value })} /></div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Source type</p>
                <select className={`w-full ${inputCls} bg-white`} value={newForm.source_type} onChange={e => setNewForm({ ...newForm, source_type: e.target.value, source_id: '' })}>
                  <option value="internal_factory">Internal factory</option>
                  <option value="external_supplier">External supplier</option>
                </select>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Source</p>
                <select className={`w-full ${inputCls} bg-white`} value={newForm.source_id} onChange={e => setNewForm({ ...newForm, source_id: e.target.value })}>
                  <option value="">— select —</option>
                  {partners.filter(p => newForm.source_type === 'internal_factory' ? p.partner_type === 'internal_factory' : p.partner_type === 'external_vendor').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="md:col-span-2"><p className="text-xs text-gray-400 mb-1">Description</p><textarea className={`w-full ${inputCls}`} rows={3} value={newForm.description} onChange={e => setNewForm({ ...newForm, description: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={createSample} disabled={saving} className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium disabled:opacity-50">{saving ? 'Creating...' : 'Create Sample'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selected.sample_code}{selected.name ? ` — ${selected.name}` : ''}</h2>
                  <div className="flex gap-3 mt-2 items-center flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusClass(selected.status)}`}>{fmtStatus(selected.status)}</span>
                    <span className="text-sm text-gray-500">v{selected.current_version}</span>
                    {selected.category && <span className="text-sm text-gray-500">{selected.category}</span>}
                    {selected.source_id && <span className="text-sm text-gray-500">{partnerName(selected.source_id)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selected.status === 'in_development' && (
                    <>
                      <button onClick={newVersion} disabled={saving} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50">+ New Version</button>
                      <button onClick={() => setSampleStatus('approved')} disabled={saving} className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium disabled:opacity-50">Approve</button>
                      <button onClick={() => setSampleStatus('rejected')} disabled={saving} className="px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 font-medium disabled:opacity-50">Reject</button>
                    </>
                  )}
                  {selected.status !== 'in_development' && selected.status !== 'archived' && (
                    <button onClick={() => setSampleStatus('in_development')} disabled={saving} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50">Reopen</button>
                  )}
                  <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-2">×</button>
                </div>
              </div>

              {selected.status === 'approved' && !selected.promoted_product_id && (
                <div className="mb-4 px-3 py-2 bg-yellow-50 text-yellow-800 text-sm rounded-lg">Approved — product promotion &amp; AM push not yet wired (coming in the next build).</div>
              )}

              <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
                {['overview', 'versions', 'timeline', 'techpack', 'bom', 'routing', 'milestones'].map(key => (
                  <button key={key} onClick={() => setDetailTab(key)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${detailTab === key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                    {key === 'overview' ? 'Overview' : key === 'versions' ? `Versions (${versions.length})` : key === 'timeline' ? `Timeline (${events.length})` : key === 'techpack' ? `Tech Pack (${measurements.length})` : key === 'bom' ? `BOM (${bom.length})` : key === 'routing' ? `Routing (${routing.length})` : `Milestones (${milestones.length})`}
                  </button>
                ))}
              </div>

              {/* Version selector shown on version-scoped tabs */}
              {(detailTab === 'techpack' || detailTab === 'bom') && versions.length > 0 && (
                <div className="mb-4 flex items-center gap-2">
                  <span className="text-xs text-gray-400">Version:</span>
                  <select className={`${inputCls} bg-white`} value={selectedVersionId} onChange={async e => { setSelectedVersionId(e.target.value); await loadVersionData(e.target.value); }}>
                    {versions.map(v => <option key={v.id} value={v.id}>v{v.version_number} ({fmtStatus(v.status)})</option>)}
                  </select>
                </div>
              )}

              {detailTab === 'overview' && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    ['Sample code', selected.sample_code], ['Name', selected.name], ['Status', fmtStatus(selected.status)],
                    ['Current version', `v${selected.current_version}`], ['Category', selected.category], ['Collection', selected.collection],
                    ['Colorway', selected.colorway], ['Print notes', selected.print_notes], ['Source type', fmtStatus(selected.source_type || '')],
                    ['Source', selected.source_id ? partnerName(selected.source_id) : '-'], ['Approved at', fmtDateTime(selected.approved_at)],
                    ['AM style #', selected.am_style_number], ['Created', fmtDateTime(selected.created_at)], ['Updated', fmtDateTime(selected.updated_at)],
                    ['Description', selected.description],
                  ].map(([label, value]) => (
                    <div key={label as string} className="rounded-lg p-3 bg-gray-50">
                      <p className="text-xs text-gray-400 mb-1">{label}</p>
                      <p className={`text-sm font-medium ${value ? 'text-gray-900' : 'text-gray-300'}`}>{(value as string) || '-'}</p>
                    </div>
                  ))}
                </div>
              )}

              {detailTab === 'versions' && (
                <div className="space-y-2">
                  {versions.map(v => (
                    <div key={v.id} className="flex items-center justify-between border border-gray-200 rounded-lg p-3">
                      <div>
                        <span className="font-medium text-gray-900">v{v.version_number}</span>
                        <span className={`ml-3 px-2 py-0.5 rounded text-xs font-medium ${statusClass(v.status)}`}>{fmtStatus(v.status)}</span>
                        {v.change_summary && <p className="text-sm text-gray-500 mt-1">{v.change_summary}</p>}
                      </div>
                      <span className="text-xs text-gray-400">{fmtDateTime(v.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}

              {detailTab === 'timeline' && (
                <div>
                  <div className="flex gap-2 mb-2">
                    <input className={`flex-1 ${inputCls}`} placeholder="Add a note to the timeline..." value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNote(); }} />
                    <button onClick={addNote} disabled={saving || !noteText.trim()} className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium disabled:opacity-50">Post</button>
                  </div>
                  <div className="flex items-center gap-2 mb-4">
                    <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={onFilePicked} />
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploading || recording} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50">📎 Photo / Video</button>
                    {!recording ? (
                      <button onClick={startRecording} disabled={uploading} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50">🎤 Record Voice Note</button>
                    ) : (
                      <button onClick={stopRecording} className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium animate-pulse">■ Stop &amp; Post</button>
                    )}
                    {uploading && <span className="text-xs text-gray-500">Uploading...</span>}
                    {errorMsg && <span className="text-xs text-red-600">{errorMsg}</span>}
                  </div>
                  <div className="space-y-3">
                    {events.map(ev => {
                      const ver = versions.find(v => v.id === ev.version_id);
                      return (
                        <div key={ev.id} className="flex gap-3">
                          <div className="text-lg leading-none pt-0.5">{EVENT_ICONS[ev.event_type] || '•'}</div>
                          <div className="flex-1 border border-gray-100 rounded-lg p-3 bg-gray-50/50">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-gray-500">{fmtStatus(ev.event_type)}{ver ? ` · v${ver.version_number}` : ''}{ev.author ? ` · ${ev.author}` : ''}</span>
                              <span className="text-xs text-gray-400">{fmtDateTime(ev.created_at)}</span>
                            </div>
                            {ev.body && <p className="text-sm text-gray-900 mt-1">{ev.body}</p>}
                            {ev.media_url && mediaUrls[ev.media_url] && (
                              <div className="mt-2">
                                {ev.event_type === 'image' && <img src={mediaUrls[ev.media_url]} alt={ev.body || 'Sample photo'} className="max-h-64 rounded-lg border border-gray-200" />}
                                {ev.event_type === 'video' && <video src={mediaUrls[ev.media_url]} controls className="max-h-64 rounded-lg border border-gray-200" />}
                                {ev.event_type === 'voice' && <audio src={mediaUrls[ev.media_url]} controls className="w-full max-w-md" />}
                              </div>
                            )}
                            {ev.media_url && !mediaUrls[ev.media_url] && <p className="text-xs text-gray-400 mt-1">Loading media...</p>}
                          </div>
                        </div>
                      );
                    })}
                    {events.length === 0 && <p className="text-gray-400 text-center py-6">No events yet</p>}
                  </div>
                </div>
              )}

              {detailTab === 'techpack' && (
                <div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4 items-end">
                    <div><p className="text-xs text-gray-400 mb-1">Size</p><input className={`w-full ${inputCls}`} placeholder="M" value={measForm.size} onChange={e => setMeasForm({ ...measForm, size: e.target.value })} /></div>
                    <div className="md:col-span-2"><p className="text-xs text-gray-400 mb-1">Point of measure</p><input className={`w-full ${inputCls}`} placeholder="Chest width" value={measForm.point_of_measure} onChange={e => setMeasForm({ ...measForm, point_of_measure: e.target.value })} /></div>
                    <div><p className="text-xs text-gray-400 mb-1">Target</p><input type="number" className={`w-full ${inputCls}`} value={measForm.target_value} onChange={e => setMeasForm({ ...measForm, target_value: e.target.value })} /></div>
                    <div className="flex gap-2">
                      <select className={`${inputCls} bg-white`} value={measForm.unit} onChange={e => setMeasForm({ ...measForm, unit: e.target.value })}><option value="in">in</option><option value="cm">cm</option></select>
                      <button onClick={addMeasurement} disabled={saving} className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium disabled:opacity-50">Add</button>
                    </div>
                  </div>
                  {measurements.length === 0 ? <p className="text-gray-400 text-center py-6">No measurements for this version</p> : (
                    <table className="w-full text-sm">
                      <thead><tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Point of measure</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Size</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Target</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Unit</th>
                        <th className="px-3 py-2"></th>
                      </tr></thead>
                      <tbody>
                        {measurements.map(m => (
                          <tr key={m.id} className="border-b border-gray-100">
                            <td className="px-3 py-2 font-medium">{m.point_of_measure}</td>
                            <td className="px-3 py-2">{m.size}</td>
                            <td className="px-3 py-2 text-right">{m.target_value ?? '-'}</td>
                            <td className="px-3 py-2">{m.unit}</td>
                            <td className="px-3 py-2 text-right"><button onClick={() => deleteMeasurement(m.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {detailTab === 'bom' && (
                <div>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-2 items-end">
                    <div className="md:col-span-2">
                      <p className="text-xs text-gray-400 mb-1">Material</p>
                      <select className={`w-full ${inputCls} bg-white`} value={bomForm.material_id} onChange={e => setBomForm({ ...bomForm, material_id: e.target.value })}>
                        <option value="">— select —</option>
                        {materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.material_type})</option>)}
                      </select>
                    </div>
                    <div><p className="text-xs text-gray-400 mb-1">Consumption</p><input type="number" className={`w-full ${inputCls}`} placeholder="net / unit" value={bomForm.consumption_net} onChange={e => setBomForm({ ...bomForm, consumption_net: e.target.value })} /></div>
                    <div><p className="text-xs text-gray-400 mb-1">Wastage %</p><input type="number" className={`w-full ${inputCls}`} value={bomForm.wastage_pct} onChange={e => setBomForm({ ...bomForm, wastage_pct: e.target.value })} /></div>
                    <div><p className="text-xs text-gray-400 mb-1">Cost / unit</p><input type="number" className={`w-full ${inputCls}`} value={bomForm.cost_per_unit} onChange={e => setBomForm({ ...bomForm, cost_per_unit: e.target.value })} /></div>
                    <div className="flex gap-2">
                      <select className={`${inputCls} bg-white`} value={bomForm.currency} onChange={e => setBomForm({ ...bomForm, currency: e.target.value })}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
                      <button onClick={addBomLine} disabled={saving || !bomForm.material_id} className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium disabled:opacity-50">Add</button>
                    </div>
                  </div>
                  <button onClick={() => setNewMatForm({ ...newMatForm, show: !newMatForm.show })} className="text-xs text-brand-600 hover:text-brand-700 mb-4">+ Quick-create material</button>
                  {newMatForm.show && (
                    <div className="flex gap-2 mb-4 items-end">
                      <div className="flex-1"><p className="text-xs text-gray-400 mb-1">Material name</p><input className={`w-full ${inputCls}`} value={newMatForm.name} onChange={e => setNewMatForm({ ...newMatForm, name: e.target.value })} /></div>
                      <select className={`${inputCls} bg-white`} value={newMatForm.material_type} onChange={e => setNewMatForm({ ...newMatForm, material_type: e.target.value, unit: e.target.value === 'fabric' ? 'meters' : 'pieces' })}>{MATERIAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
                      <select className={`${inputCls} bg-white`} value={newMatForm.unit} onChange={e => setNewMatForm({ ...newMatForm, unit: e.target.value })}><option value="meters">meters</option><option value="pieces">pieces</option><option value="kg">kg</option></select>
                      <button onClick={quickCreateMaterial} disabled={saving || !newMatForm.name.trim()} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50">Create</button>
                    </div>
                  )}
                  {bom.length === 0 ? <p className="text-gray-400 text-center py-6">No BOM lines for this version</p> : (
                    <table className="w-full text-sm">
                      <thead><tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Material</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Type</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Consumption</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Wastage %</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Cost</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Curr</th>
                        <th className="px-3 py-2"></th>
                      </tr></thead>
                      <tbody>
                        {bom.map(b => (
                          <tr key={b.id} className="border-b border-gray-100">
                            <td className="px-3 py-2 font-medium">{materialName(b.material_id)}</td>
                            <td className="px-3 py-2">{b.material_type || '-'}</td>
                            <td className="px-3 py-2 text-right">{b.consumption_net ?? '-'} {b.unit || ''}</td>
                            <td className="px-3 py-2 text-right">{b.wastage_pct ?? 0}%</td>
                            <td className="px-3 py-2 text-right">{b.cost_per_unit ?? '-'}</td>
                            <td className="px-3 py-2">{b.currency || '-'}</td>
                            <td className="px-3 py-2 text-right"><button onClick={() => deleteBomLine(b.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {detailTab === 'routing' && (
                <div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 items-end">
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Operation</p>
                      <select className={`w-full ${inputCls} bg-white`} value={routeForm.operation} onChange={e => setRouteForm({ ...routeForm, operation: e.target.value, owner_id: '' })}>{OPERATIONS.map(o => <option key={o} value={o}>{o}</option>)}</select>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Owner type</p>
                      <select className={`w-full ${inputCls} bg-white`} value={routeForm.owner_type} onChange={e => setRouteForm({ ...routeForm, owner_type: e.target.value, owner_id: '' })}>
                        <option value="in_house">In-house</option>
                        <option value="outsourced">Outsourced</option>
                      </select>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Owner</p>
                      <select className={`w-full ${inputCls} bg-white`} value={routeForm.owner_id} onChange={e => setRouteForm({ ...routeForm, owner_id: e.target.value })}>
                        <option value="">— select —</option>
                        {(routeForm.owner_type === 'in_house' ? internalFactories : outsourcePartners(routeForm.operation)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <button onClick={addRoutingStep} disabled={saving} className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium disabled:opacity-50">Add Step</button>
                  </div>
                  {routing.length === 0 ? <p className="text-gray-400 text-center py-6">No routing steps — add the operation sequence for this style</p> : (
                    <div className="space-y-2">
                      {routing.map((r, i) => (
                        <div key={r.id} className={`flex items-center justify-between border rounded-lg p-3 ${r.is_active ? 'border-gray-200' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                          <div className="flex items-center gap-3">
                            <span className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-500">{i + 1}</span>
                            <span className="font-medium text-gray-900 capitalize">{r.operation}</span>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.owner_type === 'outsourced' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{r.owner_type === 'outsourced' ? 'Outsourced' : 'In-house'}</span>
                            <span className="text-sm text-gray-500">{r.owner_id ? partnerName(r.owner_id) : '—'}</span>
                            {!r.is_active && <span className="text-xs text-gray-400">(skipped)</span>}
                          </div>
                          <div className="flex gap-3">
                            <button onClick={() => toggleRoutingStep(r)} className="text-xs text-gray-500 hover:text-gray-700">{r.is_active ? 'Skip' : 'Activate'}</button>
                            <button onClick={() => deleteRoutingStep(r.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {detailTab === 'milestones' && (
                <div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 items-end">
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Milestone</p>
                      <select className={`w-full ${inputCls} bg-white`} value={msForm.milestone} onChange={e => setMsForm({ ...msForm, milestone: e.target.value })}>
                        {STANDARD_MILESTONES.map(m => <option key={m} value={m}>{fmtStatus(m)}</option>)}
                      </select>
                    </div>
                    <div><p className="text-xs text-gray-400 mb-1">Due date</p><input type="date" className={`w-full ${inputCls}`} value={msForm.due_date} onChange={e => setMsForm({ ...msForm, due_date: e.target.value })} /></div>
                    <div><p className="text-xs text-gray-400 mb-1">Owner</p><input className={`w-full ${inputCls}`} placeholder="Who's responsible" value={msForm.owner} onChange={e => setMsForm({ ...msForm, owner: e.target.value })} /></div>
                    <button onClick={addMilestone} disabled={saving} className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium disabled:opacity-50">Add</button>
                  </div>
                  {milestones.length === 0 ? <p className="text-gray-400 text-center py-6">No milestones — add the T&amp;A calendar for this sample</p> : (
                    <div className="space-y-2">
                      {milestones.map(ms => {
                        const st = milestoneState(ms);
                        return (
                          <div key={ms.id} className="flex items-center justify-between border border-gray-200 rounded-lg p-3">
                            <div className="flex items-center gap-3">
                              <input type="checkbox" checked={!!ms.completed_at} onChange={() => toggleMilestone(ms)} className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                              <span className={`font-medium ${ms.completed_at ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{fmtStatus(ms.milestone)}</span>
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${st.cls}`}>{st.label}</span>
                              {ms.owner && <span className="text-sm text-gray-500">{ms.owner}</span>}
                            </div>
                            <span className="text-xs text-gray-400">{ms.due_date ? `Due ${fmtDate(ms.due_date)}` : 'No due date'}{ms.completed_at ? ` · Done ${fmtDate(ms.completed_at)}` : ''}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
