'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ISSUE_TYPES = [
  { key: 'damaged', label: '🧵 Damaged' },
  { key: 'missing_items', label: '📦 Missing Items' },
  { key: 'wrong_item', label: '🔄 Wrong Item' },
  { key: 'return_request', label: '↩️ Return Request' },
  { key: 'late_delivery', label: '⏰ Late Delivery' },
  { key: 'wrong_address', label: '📍 Wrong Address' },
  { key: 'pricing_dispute', label: '💰 Pricing Dispute' },
  { key: 'other', label: '💬 Other' },
];

export default function NewTicketPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customer_name: '', customer_email: '', invoice_number: '',
    order_number: '', pick_ticket_number: '', description: '',
    submitted_by: '', issue_types: [] as string[],
  });
  const [items, setItems] = useState<any[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  function toggleIssue(key: string) {
    setForm(f => ({
      ...f,
      issue_types: f.issue_types.includes(key) ? f.issue_types.filter(i => i !== key) : [...f.issue_types, key]
    }));
  }

  function addItem() {
    setItems(prev => [...prev, { style_number: '', description: '', color: '', size: '', quantity: 1, issue_type: '', notes: '' }]);
  }

  function updateItem(idx: number, field: string, value: any) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    if (!form.customer_name || !form.customer_email || form.issue_types.length === 0) {
      alert('Please fill in customer name, email, and at least one issue type.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: form, items }),
      });
      const { data, error } = await res.json();
      if (error) throw new Error(error);

      // Upload photos
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('uploaded_by', form.submitted_by || 'Staff');
        await fetch(`/api/tickets/${data.id}/photos`, { method: 'POST', body: fd });
      }

      router.push(`/tickets/${data.id}`);
    } catch (err) {
      alert('Error creating ticket: ' + err);
      setSaving(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <button onClick={() => router.push('/tickets')} className="hover:text-brand-600">Tickets</button>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        <span className="text-gray-700 font-medium">New Ticket</span>
      </div>

      <div className="space-y-6">
        {/* Customer Info */}
        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Customer Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Customer Name *</label>
              <input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                className="input" placeholder="Full name" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Email *</label>
              <input value={form.customer_email} onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))}
                className="input" placeholder="email@example.com" type="email" />
            </div>
          </div>
        </div>

        {/* Order References */}
        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Order Reference</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Invoice # <span className="text-brand-600">(preferred)</span></label>
              <input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))}
                className="input" placeholder="e.g. 12345" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Order #</label>
              <input value={form.order_number} onChange={e => setForm(f => ({ ...f, order_number: e.target.value }))}
                className="input" placeholder="Optional" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Pick Ticket #</label>
              <input value={form.pick_ticket_number} onChange={e => setForm(f => ({ ...f, pick_ticket_number: e.target.value }))}
                className="input" placeholder="Optional" />
            </div>
          </div>
        </div>

        {/* Issue Types */}
        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Issue Types *</h2>
          <div className="grid grid-cols-2 gap-2">
            {ISSUE_TYPES.map(issue => (
              <button key={issue.key} onClick={() => toggleIssue(issue.key)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm text-left transition-colors ${form.issue_types.includes(issue.key) ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                <span>{issue.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Description</h2>
          <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={4} className="input resize-none" placeholder="Describe the issue in detail..." />
        </div>

        {/* Affected Items */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Affected Items</h2>
            <button onClick={addItem} className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              Add Item
            </button>
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No items added. Click "Add Item" to specify affected pieces.</p>
          ) : (
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-3">
                  <div className="grid grid-cols-6 gap-2 mb-2">
                    <input value={item.style_number} onChange={e => updateItem(idx, 'style_number', e.target.value)}
                      className="input text-xs" placeholder="Style #" />
                    <input value={item.color} onChange={e => updateItem(idx, 'color', e.target.value)}
                      className="input text-xs" placeholder="Color" />
                    <input value={item.size} onChange={e => updateItem(idx, 'size', e.target.value)}
                      className="input text-xs" placeholder="Size" />
                    <input value={item.quantity} type="number" min={1} onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value))}
                      className="input text-xs" placeholder="Qty" />
                    <select value={item.issue_type} onChange={e => updateItem(idx, 'issue_type', e.target.value)}
                      className="input text-xs col-span-1">
                      <option value="">Issue type</option>
                      {ISSUE_TYPES.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
                    </select>
                    <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                  </div>
                  <input value={item.notes} onChange={e => updateItem(idx, 'notes', e.target.value)}
                    className="input text-xs w-full" placeholder="Notes for this item..." />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Photos */}
        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Photos</h2>
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center">
            <input type="file" multiple accept="image/*" id="photo-upload" className="hidden"
              onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files || [])])} />
            <label htmlFor="photo-upload" className="cursor-pointer">
              <svg className="w-8 h-8 text-gray-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5M12 3v12" /></svg>
              <p className="text-sm text-gray-500">Click to upload photos</p>
              <p className="text-xs text-gray-400 mt-1">One photo per damaged/missing piece</p>
            </label>
          </div>
          {files.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs text-gray-600">
                  <span>{f.name}</span>
                  <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 ml-1">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submitted By */}
        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Submitted By</h2>
          <input value={form.submitted_by} onChange={e => setForm(f => ({ ...f, submitted_by: e.target.value }))}
            className="input max-w-xs" placeholder="Your name" />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={handleSubmit} disabled={saving}
            className="px-6 py-2.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium disabled:opacity-50 flex items-center gap-2">
            {saving && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            {saving ? 'Creating...' : 'Create Ticket'}
          </button>
          <button onClick={() => router.push('/tickets')} className="px-6 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600">Cancel</button>
        </div>
      </div>
    </div>
  );
}
