'use client';

import { useState, useEffect, useCallback } from 'react';
import { stripTrailingFacts, composeHtml, htmlToText, SEO_TITLE_MAX, SEO_DESC_MAX } from '@/lib/copy-format';

type Bullet = { id: string; group_name: string; text: string; sort: number; active: boolean };

function groupBank(bank: Bullet[]): { group: string; items: Bullet[] }[] {
  const out: { group: string; items: Bullet[] }[] = [];
  for (const b of bank) {
    let g = out.find(x => x.group === b.group_name);
    if (!g) { g = { group: b.group_name, items: [] }; out.push(g); }
    g.items.push(b);
  }
  return out;
}

type CopyRow = {
  product_id: string;
  style_number: string | null;
  category: string | null;
  image_url: string | null;
  images: string[] | null;
  current_description: string | null;
  current_web_title: string | null;
  current_web_description: string | null;
  missing_copy: boolean;
  all_caps: boolean;
  status: string;
  keywords: string | null;
  draft_description: string | null;
  draft_web_title: string | null;
  draft_web_description: string | null;
  generation_error: string | null;
  push_error: string | null;
  pushed_at: string | null;
  quick_facts: string[] | null;
  seo_keywords: string | null;
  draft_seo_title: string | null;
  draft_seo_meta_description: string | null;
  seo_pushed_at: string | null;
  seo_push_error: string | null;
  qty_inventory: number | null;
  qty_avail_sell: number | null;
};

const TABS = [
  { key: 'pending', label: 'Needs Copy' },
  { key: 'drafted', label: 'Drafted' },
  { key: 'pushed', label: 'Pushed' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'ok', label: 'Has Copy' },
  { key: 'guidelines', label: 'Settings' },
];

function wordCount(s: string) {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export default function DescriptionsPage() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState<CopyRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState('active');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterInvField, setFilterInvField] = useState('any');
  const [filterInvMin, setFilterInvMin] = useState('5');
  const [sortBy, setSortBy] = useState<'newest' | 'style'>('newest');
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<CopyRow | null>(null);

  // Drawer edit state
  const [dKeywords, setDKeywords] = useState('');
  const [dDesc, setDDesc] = useState('');
  const [dTitle, setDTitle] = useState('');
  const [dWebDesc, setDWebDesc] = useState('');
  const [dFacts, setDFacts] = useState<string[]>([]);
  const [dSeoKw, setDSeoKw] = useState('');
  const [dSeoTitle, setDSeoTitle] = useState('');
  const [dSeoDesc, setDSeoDesc] = useState('');
  const [drawerBusy, setDrawerBusy] = useState('');
  const [drawerMsg, setDrawerMsg] = useState('');

  // Guidelines state
  const [gGlobal, setGGlobal] = useState('');
  const [gRules, setGRules] = useState<any[]>([]);
  const [gCategories, setGCategories] = useState<string[]>([]);
  const [gNewCat, setGNewCat] = useState('');
  const [gNewText, setGNewText] = useState('');
  const [gSaving, setGSaving] = useState(false);
  const [gMsg, setGMsg] = useState('');

  // Style rules + examples state
  const [sBan, setSBan] = useState(true);
  const [sFacts, setSFacts] = useState(true);
  const [sRules, setSRules] = useState<string[]>([]);
  const [sNewRule, setSNewRule] = useState('');
  const [sExamples, setSExamples] = useState<{ title: string; body: string }[]>(
    Array.from({ length: 5 }, () => ({ title: '', body: '' }))
  );
  const [sMsg, setSMsg] = useState('');

  // Bullet bank
  const [bank, setBank] = useState<Bullet[]>([]);
  const [bNewGroup, setBNewGroup] = useState('');
  const [bNewText, setBNewText] = useState('');
  const [bMsg, setBMsg] = useState('');

  const loadBank = useCallback(async () => {
    try {
      const res = await fetch('/api/descriptions/bullets');
      const data = await res.json();
      if (Array.isArray(data.bullets)) setBank(data.bullets);
    } catch { /* bank is optional */ }
  }, []);

  useEffect(() => { loadBank(); }, [loadBank]);

  async function bankCall(method: 'POST' | 'DELETE', body?: any, id?: string) {
    setBMsg('');
    const res = await fetch(id ? `/api/descriptions/bullets?id=${encodeURIComponent(id)}` : '/api/descriptions/bullets', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.bullets)) setBank(data.bullets);
    else setBMsg(data.error || `Failed (${res.status})`);
    return res.ok;
  }

  const loadList = useCallback(async (which = tab, q = search, act = filterActive, cat = filterCategory) => {
    if (which === 'guidelines') return;
    setLoading(true);
    try {
      const invParams = filterInvField !== 'any' ? `&inv_field=${filterInvField}&inv_min=${encodeURIComponent(filterInvMin || '0')}` : '';
      const res = await fetch(`/api/descriptions/list?status=${which}&search=${encodeURIComponent(q)}&active=${act}&category=${encodeURIComponent(cat)}${invParams}&sort=${sortBy}&limit=200`);
      const data = await res.json();
      setRows(data.rows || []);
      setCounts(data.counts || {});
      if (Array.isArray(data.categories)) setCategories(data.categories);
    } finally {
      setLoading(false);
    }
  }, [tab, search, filterActive, filterCategory, filterInvField, filterInvMin, sortBy]);

  const loadGuidelines = useCallback(async () => {
    const [gRes, sRes] = await Promise.all([
      fetch('/api/descriptions/guidelines'),
      fetch('/api/descriptions/settings'),
    ]);
    const data = await gRes.json();
    setGGlobal(data.global || '');
    setGRules(data.rules || []);
    setGCategories(data.categories || []);
    const st = await sRes.json();
    setSBan(st.ban_em_dashes !== false);
    setSFacts(st.quick_facts_enabled !== false);
    setSRules(Array.isArray(st.rules) ? st.rules : []);
    const ex = Array.isArray(st.examples) ? st.examples : [];
    setSExamples(Array.from({ length: 5 }, (_, i) => ex[i] ? { title: ex[i].title || '', body: ex[i].body || '' } : { title: '', body: '' }));
  }, []);

  useEffect(() => {
    if (tab === 'guidelines') loadGuidelines();
    else loadList(tab);
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filterActive, filterCategory, filterInvField, filterInvMin, sortBy]);

  function openDrawer(row: CopyRow) {
    setOpen(row);
    setDKeywords(row.keywords || '');
    setDDesc(row.draft_description || '');
    setDTitle(row.draft_web_title || '');
    const facts = Array.isArray(row.quick_facts) ? row.quick_facts : [];
    setDFacts(facts);
    setDWebDesc(stripTrailingFacts(htmlToText(row.draft_web_description || ''), [...bank.map(b => b.text), ...facts]));
    setDSeoKw(row.seo_keywords || '');
    setDSeoTitle(row.draft_seo_title || '');
    setDSeoDesc(row.draft_seo_meta_description || '');
    setDrawerMsg('');
  }

  function toggleFact(text: string) {
    setDFacts(prev => {
      if (prev.some(f => f.toLowerCase() === text.toLowerCase())) return prev.filter(f => f.toLowerCase() !== text.toLowerCase());
      // Keep bank order: rebuild from bank order, then any custom (non-bank) facts
      const next = [...prev, text];
      const bankOrder = bank.map(b => b.text.toLowerCase());
      return next.sort((a, b) => {
        const ia = bankOrder.indexOf(a.toLowerCase()); const ib = bankOrder.indexOf(b.toLowerCase());
        return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
      });
    });
  }

  function drawerUpdates(): any {
    return {
      keywords: dKeywords,
      draft_description: dDesc,
      draft_web_title: dTitle,
      draft_web_description: dWebDesc,
      quick_facts: dFacts,
      seo_keywords: dSeoKw,
      draft_seo_title: dSeoTitle,
      draft_seo_meta_description: dSeoDesc,
    };
  }

  async function refreshFromAM() {
    setBusy(true);
    let lastId: string | null = null;
    let pageNum = 0;
    let total = 0;
    try {
      // Client-driven loop with AM's last_id cursor (page numbers are ignored by AM)
      // eslint-disable-next-line no-constant-condition
      while (true) {
        pageNum++;
        setProgress(`Refreshing from ApparelMagic, batch ${pageNum} (${total} products so far)...`);
        const url: string = lastId
          ? `/api/descriptions/refresh?last_id=${encodeURIComponent(lastId)}`
          : '/api/descriptions/refresh';
        const res = await fetch(url, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) { setProgress(`Refresh failed on batch ${pageNum}: ${data.error || res.status}`); return; }
        total += data.products_upserted || 0;
        if (!data.next_last_id || pageNum > 200) break;
        lastId = String(data.next_last_id);
      }
      setProgress(`Refresh complete, ${total} products scanned across ${pageNum} batch(es).`);
      await loadList();
    } finally {
      setBusy(false);
    }
  }

  async function generateSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBusy(true);
    const errors: string[] = [];
    try {
      for (let i = 0; i < ids.length; i++) {
        setProgress(`Generating drafts — ${i + 1} of ${ids.length}...`);
        const res = await fetch('/api/descriptions/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: ids[i] }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          errors.push(`${ids[i]}: ${data.error || res.status}`);
        }
      }
      setProgress(errors.length
        ? `Done with ${errors.length} error(s): ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`
        : `Generated ${ids.length} draft(s) — review them in the Drafted tab.`);
      setSelected(new Set());
      await loadList();
    } finally {
      setBusy(false);
    }
  }

  async function drawerGenerate() {
    if (!open) return;
    setDrawerBusy('generate');
    setDrawerMsg('');
    try {
      const res = await fetch('/api/descriptions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: open.product_id, keywords: dKeywords, seo_keywords: dSeoKw }),
      });
      const data = await res.json();
      if (res.ok) {
        setDDesc(data.drafts.draft_description);
        setDTitle(data.drafts.draft_web_title);
        setDWebDesc(data.drafts.draft_web_description);
        setDFacts(Array.isArray(data.drafts.quick_facts) ? data.drafts.quick_facts : []);
        setDSeoTitle(data.drafts.draft_seo_title || '');
        setDSeoDesc(data.drafts.draft_seo_meta_description || '');
        setDrawerMsg('Draft generated. Edit as needed, then Approve & Push.');
        await loadList();
      } else {
        setDrawerMsg(`Generation failed: ${data.error}${data.detail ? ` — ${data.detail}` : ''}`);
      }
    } finally {
      setDrawerBusy('');
    }
  }

  async function drawerSave(statusChange?: 'skipped' | 'pending') {
    if (!open) return;
    setDrawerBusy('save');
    setDrawerMsg('');
    try {
      const updates: any = drawerUpdates();
      if (statusChange) updates.status = statusChange;
      const res = await fetch('/api/descriptions/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: open.product_id, updates }),
      });
      if (res.ok) {
        setDrawerMsg(statusChange === 'skipped' ? 'Skipped.' : 'Saved.');
        if (statusChange) setOpen(null);
        await loadList();
      } else {
        const data = await res.json().catch(() => ({}));
        setDrawerMsg(`Save failed: ${data.error || res.status}`);
      }
    } finally {
      setDrawerBusy('');
    }
  }

  async function drawerApprove() {
    if (!open) return;
    setDrawerBusy('approve');
    setDrawerMsg('');
    try {
      // Persist any edits first, then push
      await fetch('/api/descriptions/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: open.product_id,
          updates: drawerUpdates(),
        }),
      });
      const res = await fetch('/api/descriptions/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: open.product_id }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.warning) {
          setDrawerMsg(`Pushed to ApparelMagic. ${data.warning}`);
        } else {
          setDrawerMsg(`✅ Pushed to ApparelMagic${data.seo === 'pushed' ? ' and SEO to DTC' : ''}.`);
          setOpen(null);
        }
        await loadList();
      } else {
        setDrawerMsg(`Push failed: ${data.error}${data.detail ? ` — ${data.detail}` : ''}`);
      }
    } finally {
      setDrawerBusy('');
    }
  }

  async function drawerSeoGenerate() {
    if (!open) return;
    setDrawerBusy('seo');
    setDrawerMsg('');
    try {
      // Save current edits so SEO is written from what's on screen
      await fetch('/api/descriptions/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: open.product_id, updates: drawerUpdates() }),
      });
      const res = await fetch('/api/descriptions/seo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: open.product_id, action: 'generate', seo_keywords: dSeoKw }),
      });
      const data = await res.json();
      if (res.ok) {
        setDSeoTitle(data.seo_title || '');
        setDSeoDesc(data.seo_description || '');
        setDrawerMsg('SEO regenerated.');
      } else {
        setDrawerMsg(`SEO generation failed: ${data.error}${data.detail ? `. ${data.detail}` : ''}`);
      }
    } finally {
      setDrawerBusy('');
    }
  }

  async function drawerSeoPush() {
    if (!open) return;
    setDrawerBusy('seopush');
    setDrawerMsg('');
    try {
      await fetch('/api/descriptions/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: open.product_id, updates: { seo_keywords: dSeoKw, draft_seo_title: dSeoTitle, draft_seo_meta_description: dSeoDesc } }),
      });
      const res = await fetch('/api/descriptions/seo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: open.product_id, action: 'push' }),
      });
      const data = await res.json();
      setDrawerMsg(res.ok ? '✅ SEO pushed to DTC Shopify.' : `SEO push failed: ${data.error}${data.detail ? `. ${data.detail}` : ''}`);
      await loadList();
    } finally {
      setDrawerBusy('');
    }
  }

  async function saveSettings(partial: any) {
    setGSaving(true);
    setSMsg('');
    try {
      const res = await fetch('/api/descriptions/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      if (res.ok) {
        setSMsg('Saved.');
        await loadGuidelines();
      } else {
        const data = await res.json().catch(() => ({}));
        setSMsg(`Save failed: ${data.error || res.status}`);
      }
    } finally {
      setGSaving(false);
    }
  }

  async function saveGuideline(scope: 'global' | 'category', category: string | null, guidelines: string) {
    setGSaving(true);
    setGMsg('');
    try {
      const res = await fetch('/api/descriptions/guidelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, category, guidelines }),
      });
      if (res.ok) {
        setGMsg('Saved.');
        await loadGuidelines();
      } else {
        const data = await res.json().catch(() => ({}));
        setGMsg(`Save failed: ${data.error || res.status}`);
      }
    } finally {
      setGSaving(false);
    }
  }

  const isDrafted = open?.status === 'drafted' || !!dWebDesc;

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Descriptions</h1>
          <p className="text-gray-500 mt-1">Generate, review, and push product copy to ApparelMagic (→ Shopify)</p>
        </div>
        <button
          onClick={refreshFromAM}
          disabled={busy}
          className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? 'Working...' : 'Refresh from AM'}
        </button>
      </div>

      {progress && (
        <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-sm mb-4">{progress}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${
              tab === t.key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}{t.key !== 'guidelines' && counts[t.key] != null ? ` (${counts[t.key]})` : ''}
          </button>
        ))}
      </div>

      {tab === 'guidelines' ? (
        <div className="space-y-6 max-w-3xl">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Brand Voice (global)</h2>
            <p className="text-sm text-gray-400 mb-3">Applied to every generated description. Tune this whenever the output isn't matching what you want.</p>
            <textarea
              value={gGlobal}
              onChange={e => setGGlobal(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-mono"
              placeholder={"e.g.\n- Warm, confident tone. Write for boutique owners buying wholesale.\n- Web descriptions: 60–100 words, one paragraph.\n- Always mention fabric content and made-in when known.\n- Never mention specific colors (styles come in many colorways).\n- No exclamation marks. Sentence case, not ALL CAPS."}
            />
            <div className="flex items-center gap-3 mt-3">
              <button onClick={() => saveGuideline('global', null, gGlobal)} disabled={gSaving} className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                Save Brand Voice
              </button>
              {gMsg && <span className="text-sm text-gray-500">{gMsg}</span>}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Style Rules</h2>
            <p className="text-sm text-gray-400 mb-4">Hard requirements injected into every generation. The em-dash ban is also enforced server-side on every draft, edit, and push, so banned characters can never reach AM.</p>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={sBan}
                onChange={e => { setSBan(e.target.checked); saveSettings({ ban_em_dashes: e.target.checked }); }}
                className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              Ban em dashes (hard-enforced: stripped automatically everywhere)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={sFacts}
                onChange={e => { setSFacts(e.target.checked); saveSettings({ quick_facts_enabled: e.target.checked }); }}
                className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              Append selected bullets under every web description (composed at push, so edits to the prose never lose them)
            </label>
            <div className="space-y-2 mb-3">
              {sRules.map((rule, i) => (
                <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-700 flex-1">{rule}</span>
                  <button
                    onClick={() => { const next = sRules.filter((_, j) => j !== i); setSRules(next); saveSettings({ rules: next }); }}
                    className="text-gray-300 hover:text-red-500 text-sm leading-none"
                  >✕</button>
                </div>
              ))}
              {sRules.length === 0 && <p className="text-sm text-gray-300">No rules yet.</p>}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={sNewRule}
                onChange={e => setSNewRule(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && sNewRule.trim()) { const next = [...sRules, sNewRule.trim()]; setSRules(next); setSNewRule(''); saveSettings({ rules: next }); } }}
                placeholder='e.g. "Never mention price." or "Keep web titles under 8 words."'
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
              />
              <button
                onClick={() => { if (sNewRule.trim()) { const next = [...sRules, sNewRule.trim()]; setSRules(next); setSNewRule(''); saveSettings({ rules: next }); } }}
                disabled={gSaving || !sNewRule.trim()}
                className="bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >Add Rule</button>
            </div>
            {sMsg && <p className="text-sm text-gray-500 mt-2">{sMsg}</p>}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Bullet Bank</h2>
            <p className="text-sm text-gray-400 mb-4">Bullets that go under the AI description. On generate, Claude pre-selects the ones that are true for the product (one per group); you adjust with checkboxes in the review drawer. Inactive bullets are hidden from new generations.</p>
            <div className="space-y-4 mb-4">
              {groupBank(bank).map(g => (
                <div key={g.group}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{g.group}</p>
                  <div className="space-y-1">
                    {g.items.map(b => (
                      <div key={b.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5">
                        <span className={`text-sm flex-1 ${b.active ? 'text-gray-700' : 'text-gray-300 line-through'}`}>{b.text}</span>
                        <button onClick={() => bankCall('POST', { id: b.id, active: !b.active })} className="text-xs text-gray-400 hover:text-gray-700">{b.active ? 'Deactivate' : 'Activate'}</button>
                        <button onClick={() => { if (confirm(`Delete "${b.text}"?`)) bankCall('DELETE', undefined, b.id); }} className="text-gray-300 hover:text-red-500 text-sm leading-none">✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {bank.length === 0 && <p className="text-sm text-gray-300">No bullets yet. Until you add some, Claude writes the bullets freely.</p>}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                list="bullet-groups"
                value={bNewGroup}
                onChange={e => setBNewGroup(e.target.value)}
                placeholder="Group (e.g. Fabric)"
                className="w-40 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <datalist id="bullet-groups">
                {groupBank(bank).map(g => <option key={g.group} value={g.group} />)}
              </datalist>
              <input
                type="text"
                value={bNewText}
                onChange={e => setBNewText(e.target.value)}
                onKeyDown={async e => { if (e.key === 'Enter' && bNewGroup.trim() && bNewText.trim()) { if (await bankCall('POST', { group_name: bNewGroup, text: bNewText })) setBNewText(''); } }}
                placeholder='Bullet text (e.g. "100% Linen")'
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <button
                onClick={async () => { if (await bankCall('POST', { group_name: bNewGroup, text: bNewText })) setBNewText(''); }}
                disabled={!bNewGroup.trim() || !bNewText.trim()}
                className="bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >Add Bullet</button>
            </div>
            {bMsg && <p className="text-sm text-red-500 mt-2">{bMsg}</p>}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Example Descriptions</h2>
            <p className="text-sm text-gray-400 mb-4">Up to 5 descriptions you love. Generation matches their tone, structure, and quality without copying their content. Paste your best existing copy here.</p>
            <div className="space-y-4">
              {sExamples.map((ex, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-3">
                  <input
                    type="text"
                    value={ex.title}
                    onChange={e => setSExamples(prev => prev.map((p2, j) => j === i ? { ...p2, title: e.target.value } : p2))}
                    placeholder={`Example ${i + 1} label (optional, e.g. "Dashiki tone reference")`}
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm mb-2"
                  />
                  <textarea
                    value={ex.body}
                    onChange={e => setSExamples(prev => prev.map((p2, j) => j === i ? { ...p2, body: e.target.value } : p2))}
                    rows={3}
                    placeholder="Paste an example description…"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
              ))}
            </div>
            <button
              onClick={() => saveSettings({ examples: sExamples.filter(e2 => e2.body.trim()) })}
              disabled={gSaving}
              className="mt-3 bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >Save Examples</button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Category Rules</h2>
            <p className="text-sm text-gray-400 mb-4">Standing rules applied on top of the brand voice when the product matches the category.</p>

            {gRules.map(rule => (
              <CategoryRule key={rule.id} rule={rule} onSave={(text) => saveGuideline('category', rule.category, text)} saving={gSaving} />
            ))}

            <div className="border border-dashed border-gray-300 rounded-lg p-4 mt-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Add a category rule</p>
              <select value={gNewCat} onChange={e => setGNewCat(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white mb-2">
                <option value="">Select category…</option>
                {gCategories.filter(c => !gRules.some(r => r.category === c)).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <textarea
                value={gNewText}
                onChange={e => setGNewText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                placeholder="e.g. Always mention 100% cotton and made in India. Mention one-size-fits-most sizing."
              />
              <button
                onClick={async () => { if (gNewCat && gNewText.trim()) { await saveGuideline('category', gNewCat, gNewText); setGNewCat(''); setGNewText(''); } }}
                disabled={gSaving || !gNewCat || !gNewText.trim()}
                className="mt-2 bg-brand-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                Add Rule
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-3 mb-4">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadList(tab, search)}
              placeholder="Search style # or category…"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:ring-2 focus:ring-brand-500 outline-none"
            />
            <button onClick={() => loadList(tab, search)} className="text-sm text-gray-500 hover:text-gray-700">Search</button>
            <select
              value={filterActive}
              onChange={e => setFilterActive(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="active">Active products</option>
              <option value="inactive">Inactive products</option>
              <option value="all">All products</option>
            </select>
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white max-w-[220px]"
            >
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={filterInvField}
              onChange={e => setFilterInvField(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="any">Any inventory</option>
              <option value="qty_inventory">Qty inventory ≥</option>
              <option value="qty_avail_sell">Avail to sell ≥</option>
            </select>
            {filterInvField !== 'any' && (
              <input
                type="number"
                min="0"
                value={filterInvMin}
                onChange={e => setFilterInvMin(e.target.value)}
                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            )}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'newest' | 'style')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="newest">Newest first</option>
              <option value="style">Style #</option>
            </select>
            {tab === 'pending' && (
              <button
                onClick={generateSelected}
                disabled={busy || selected.size === 0}
                className="ml-auto bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? 'Working…' : `Generate Drafts (${selected.size})`}
              </button>
            )}
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  {tab === 'pending' && (
                    <th className="py-2 px-3 w-8">
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && selected.size === rows.length}
                        onChange={e => setSelected(e.target.checked ? new Set(rows.map(r => r.product_id)) : new Set())}
                      />
                    </th>
                  )}
                  <th className="text-left py-2 px-3 font-medium text-gray-500 w-14"></th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Style</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Category</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Flags</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-500 whitespace-nowrap">Inv / ATS</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">{tab === 'drafted' ? 'Draft Web Description' : 'Current Web Description'}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400">Nothing here. {tab === 'pending' ? 'Hit "Refresh from AM" to scan for products needing copy.' : ''}</td></tr>
                ) : rows.map(r => (
                  <tr key={r.product_id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => openDrawer(r)}>
                    {tab === 'pending' && (
                      <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(r.product_id)}
                          onChange={e => {
                            const next = new Set(selected);
                            e.target.checked ? next.add(r.product_id) : next.delete(r.product_id);
                            setSelected(next);
                          }}
                        />
                      </td>
                    )}
                    <td className="py-2 px-3">
                      {r.image_url
                        ? <img src={r.image_url} alt="" className="w-10 h-10 object-cover rounded" />
                        : <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center text-gray-300 text-xs">—</div>}
                    </td>
                    <td className="py-2 px-3 font-medium text-gray-900">{r.style_number || r.product_id}</td>
                    <td className="py-2 px-3 text-gray-600">{r.category || '—'}</td>
                    <td className="py-2 px-3">
                      <div className="flex gap-1 flex-wrap">
                        {r.missing_copy && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">Missing</span>}
                        {r.all_caps && <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">ALL CAPS</span>}
                        {r.generation_error && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium" title={r.generation_error}>Gen error</span>}
                        {r.push_error && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium" title={r.push_error}>Push error</span>}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 text-xs whitespace-nowrap">
                      {(r.qty_inventory ?? 0)} / {(r.qty_avail_sell ?? 0)}
                    </td>
                    <td className="py-2 px-3 text-gray-500 max-w-md truncate">
                      {htmlToText((tab === 'drafted' ? r.draft_web_description : r.current_web_description) || '') || <span className="text-gray-300">empty</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Review drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/30" onClick={() => setOpen(null)} />
          <div className="w-full max-w-2xl bg-white h-full overflow-y-auto shadow-xl p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Style {open.style_number || open.product_id}</h2>
                <p className="text-sm text-gray-500">{open.category || 'Uncategorized'} · AM product {open.product_id} · status: {open.status}</p>
              </div>
              <button onClick={() => setOpen(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            {/* Images */}
            {open.images && open.images.length > 0 && (
              <div className="flex gap-2 mb-4 overflow-x-auto">
                {open.images.slice(0, 6).map((u, i) => (
                  <img key={i} src={u} alt="" className="w-28 h-28 object-cover rounded-lg border border-gray-200 shrink-0" />
                ))}
              </div>
            )}

            {/* Current copy */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4 text-sm">
              <p className="font-medium text-gray-700 mb-1">Current copy in AM</p>
              <p className="text-gray-500"><span className="text-gray-400">Description:</span> {open.current_description || <em>empty</em>}</p>
              <p className="text-gray-500"><span className="text-gray-400">Web title:</span> {open.current_web_title || <em>empty</em>}</p>
              <p className="text-gray-500"><span className="text-gray-400">Web description:</span> {open.current_web_description ? htmlToText(open.current_web_description).replace(/\s*\n\s*/g, ' · ') : <em>empty</em>}</p>
            </div>

            {/* Keywords */}
            <label className="block text-sm font-medium text-gray-700 mb-1">Keywords / features to highlight (optional)</label>
            <input
              type="text"
              value={dKeywords}
              onChange={e => setDKeywords(e.target.value)}
              placeholder="e.g. breathable, festival wear, matching headwrap included"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-brand-500 outline-none"
            />

            {/* Drafts */}
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description (max 5 words) <span className={`text-xs ${wordCount(dDesc) > 5 ? 'text-red-500' : 'text-gray-400'}`}>{wordCount(dDesc)}/5 words</span>
                </label>
                <input type="text" value={dDesc} onChange={e => setDDesc(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shopify Web Title</label>
                <input type="text" value={dTitle} onChange={e => setDTitle(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shopify Web Description <span className="text-xs text-gray-400">(prose only, bullets are added below)</span></label>
                <textarea value={dWebDesc} onChange={e => setDWebDesc(e.target.value)} rows={6} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>

            {/* Bullets */}
            <div className="border border-gray-200 rounded-lg p-4 mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Bullets</p>
              {bank.filter(b => b.active).length === 0 && dFacts.length === 0 && (
                <p className="text-sm text-gray-400">Bullet bank is empty. Add bullets in Settings.</p>
              )}
              <div className="space-y-2">
                {groupBank(bank.filter(b => b.active || dFacts.some(f => f.toLowerCase() === b.text.toLowerCase()))).map(g => (
                  <div key={g.group} className="flex items-start gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 w-16 pt-1 shrink-0">{g.group}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {g.items.map(b => {
                        const on = dFacts.some(f => f.toLowerCase() === b.text.toLowerCase());
                        return (
                          <button
                            key={b.id}
                            onClick={() => toggleFact(b.text)}
                            className={`px-2 py-1 rounded-md text-xs border ${on ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'}`}
                          >{b.text}</button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {dFacts.filter(f => !bank.some(b => b.text.toLowerCase() === f.toLowerCase())).length > 0 && (
                  <div className="flex items-start gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 w-16 pt-1 shrink-0">Other</span>
                    <div className="flex flex-wrap gap-1.5">
                      {dFacts.filter(f => !bank.some(b => b.text.toLowerCase() === f.toLowerCase())).map(f => (
                        <button key={f} onClick={() => toggleFact(f)} title="Not in the bank. Click to remove." className="px-2 py-1 rounded-md text-xs border bg-amber-50 border-amber-300 text-amber-800">{f} ✕</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {dWebDesc && (
                <div className="mt-3 bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-1">What gets pushed</p>
                  <div
                    className="text-sm text-gray-600 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-0.5"
                    dangerouslySetInnerHTML={{ __html: composeHtml(dWebDesc, dFacts, bank.map(b => b.text)) }}
                  />
                </div>
              )}
            </div>

            {/* SEO (DTC only) */}
            <div className="border border-gray-200 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">SEO <span className="text-xs text-gray-400">(DTC Shopify only)</span></p>
                {open.seo_pushed_at && !open.seo_push_error && <span className="text-xs text-green-600">Pushed {new Date(open.seo_pushed_at).toLocaleDateString()}</span>}
                {open.seo_push_error && <span className="text-xs text-red-500 max-w-xs truncate" title={open.seo_push_error}>Push error</span>}
              </div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Target keywords <span className="text-gray-400">(comma separated, first is primary)</span></label>
              <input
                type="text"
                value={dSeoKw}
                onChange={e => setDSeoKw(e.target.value)}
                placeholder="e.g. african print maxi dress, ankara dress"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3"
              />
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Meta title <span className={dSeoTitle.length > SEO_TITLE_MAX ? 'text-red-500' : 'text-gray-400'}>{dSeoTitle.length}/{SEO_TITLE_MAX}</span>
              </label>
              <input type="text" value={dSeoTitle} onChange={e => setDSeoTitle(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3" />
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Meta description <span className={dSeoDesc.length > SEO_DESC_MAX ? 'text-red-500' : 'text-gray-400'}>{dSeoDesc.length}/{SEO_DESC_MAX}</span>
              </label>
              <textarea value={dSeoDesc} onChange={e => setDSeoDesc(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3" />
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={drawerSeoGenerate} disabled={!!drawerBusy} className="bg-white border border-brand-600 text-brand-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-brand-50 disabled:opacity-50">
                  {drawerBusy === 'seo' ? 'Writing…' : 'Regenerate SEO'}
                </button>
                {(open.status === 'pushed' || open.status === 'ok') ? (
                  <button onClick={drawerSeoPush} disabled={!!drawerBusy || (!dSeoTitle && !dSeoDesc)} className="bg-brand-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-brand-700 disabled:opacity-50">
                    {drawerBusy === 'seopush' ? 'Pushing…' : 'Push SEO to DTC'}
                  </button>
                ) : (
                  <span className="text-xs text-gray-400">Pushes to DTC with Approve &amp; Push.</span>
                )}
              </div>
            </div>

            {drawerMsg && <div className="bg-blue-50 text-blue-700 px-3 py-2 rounded-lg text-sm mb-4">{drawerMsg}</div>}

            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={drawerGenerate} disabled={!!drawerBusy} className="bg-white border border-brand-600 text-brand-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-50 disabled:opacity-50">
                {drawerBusy === 'generate' ? 'Generating…' : (isDrafted ? 'Regenerate' : 'Generate Draft')}
              </button>
              <button onClick={() => drawerSave()} disabled={!!drawerBusy} className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                {drawerBusy === 'save' ? 'Saving…' : 'Save Edits'}
              </button>
              <button onClick={drawerApprove} disabled={!!drawerBusy || !dTitle || !dWebDesc} className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                {drawerBusy === 'approve' ? 'Pushing…' : (open.status === 'pushed' ? 'Re-push to AM' : 'Approve & Push to AM')}
              </button>
              {open.status !== 'pushed' && open.status !== 'skipped' && (
                <button onClick={() => drawerSave('skipped')} disabled={!!drawerBusy} className="ml-auto text-sm text-gray-400 hover:text-gray-600">Skip</button>
              )}
              {open.status === 'skipped' && (
                <button onClick={() => drawerSave('pending')} disabled={!!drawerBusy} className="ml-auto text-sm text-gray-400 hover:text-gray-600">Re-queue</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryRule({ rule, onSave, saving }: { rule: any; onSave: (text: string) => void; saving: boolean }) {
  const [text, setText] = useState(rule.guidelines || '');
  const [dirty, setDirty] = useState(false);
  return (
    <div className="border border-gray-200 rounded-lg p-4 mb-3">
      <p className="text-sm font-medium text-gray-800 mb-2">{rule.category}</p>
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setDirty(true); }}
        rows={3}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
      />
      <div className="flex gap-3 mt-2">
        <button onClick={() => { onSave(text); setDirty(false); }} disabled={saving || !dirty} className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-40">Save</button>
        <button onClick={() => { onSave(''); }} disabled={saving} className="text-xs text-red-400 hover:text-red-600">Delete rule</button>
      </div>
    </div>
  );
}
