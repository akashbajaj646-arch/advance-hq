'use client';

import { useState } from 'react';

const ISSUE_TYPES = [
  { key: 'damaged', label: '🧵 Damaged Product' },
  { key: 'missing_items', label: '📦 Missing Items' },
  { key: 'wrong_item', label: '🔄 Wrong Item Received' },
  { key: 'return_request', label: '↩️ Return Request' },
  { key: 'late_delivery', label: '⏰ Late Delivery' },
  { key: 'wrong_address', label: '📍 Wrong Address' },
  { key: 'pricing_dispute', label: '💰 Pricing Dispute' },
  { key: 'other', label: '💬 Other' },
];

export default function SupportPage() {
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [submitting, setSubmitting] = useState(false);
  const [ticketNumber, setTicketNumber] = useState('');
  const [form, setForm] = useState({
    customer_name: '', customer_email: '', invoice_number: '',
    order_number: '', description: '', issue_types: [] as string[],
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
    setItems(prev => [...prev, { style_number: '', color: '', size: '', quantity: 1, issue_type: '', notes: '' }]);
  }

  function updateItem(idx: number, field: string, value: any) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  async function handleSubmit() {
    if (!form.customer_name || !form.customer_email || form.issue_types.length === 0) {
      alert('Please fill in your name, email, and at least one issue type.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket: { ...form, is_customer_submitted: true, submitted_by: form.customer_name },
          items,
        }),
      });
      const { data, error } = await res.json();
      if (error) throw new Error(error);

      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('uploaded_by', form.customer_name);
        fd.append('is_customer_upload', 'true');
        await fetch(`/api/tickets/${data.id}/photos`, { method: 'POST', body: fd });
      }

      setTicketNumber(data.ticket_number);
      setStep('success');
    } catch (err) {
      alert('Error submitting ticket. Please try again.');
    }
    setSubmitting(false);
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Ticket Submitted!</h1>
          <p className="text-gray-500 mb-4">Your support ticket has been received. Our team will be in touch soon.</p>
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <p className="text-xs text-gray-400 mb-1">Your ticket number</p>
            <p className="text-2xl font-bold text-brand-600">{ticketNumber}</p>
          </div>
          <p className="text-sm text-gray-400">Please save your ticket number for reference. You can reach us at support@advanceapparels.com with any questions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Submit a Support Ticket</h1>
          <p className="text-gray-500 mt-2">Having an issue with your order? Let us know and we'll make it right.</p>
        </div>

        <div className="space-y-6">
          {/* Contact Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Your Information</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Full Name *</label>
                <input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Your name" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email Address *</label>
                <input value={form.customer_email} onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="your@email.com" type="email" />
              </div>
            </div>
          </div>

          {/* Order Reference */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Order Reference</h2>
            <p className="text-xs text-gray-400 mb-4">Enter your invoice number if you have it — this helps us find your order fastest.</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Invoice Number <span className="text-blue-600">(preferred)</span></label>
                <input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 12345" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Order Number</label>
                <input value={form.order_number} onChange={e => setForm(f => ({ ...f, order_number: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional" />
              </div>
            </div>
          </div>

          {/* Issue Types */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">What's the issue? *</h2>
            <div className="grid grid-cols-2 gap-2">
              {ISSUE_TYPES.map(issue => (
                <button key={issue.key} onClick={() => toggleIssue(issue.key)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm text-left transition-colors ${form.issue_types.includes(issue.key) ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {issue.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Describe the Issue</h2>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Please describe the issue in as much detail as possible..." />
          </div>

          {/* Affected Items */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Affected Items</h2>
                <p className="text-xs text-gray-400 mt-0.5">List each affected piece separately</p>
              </div>
              <button onClick={addItem} className="text-sm text-blue-600 hover:text-blue-700 font-medium">+ Add Item</button>
            </div>
            {items.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Click "Add Item" to list specific affected pieces</p>
            ) : (
              <div className="space-y-3">
                {items.map((item, idx) => (
                  <div key={idx} className="border border-gray-200 rounded-lg p-3">
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      <input value={item.style_number} onChange={e => updateItem(idx, 'style_number', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs" placeholder="Style #" />
                      <input value={item.color} onChange={e => updateItem(idx, 'color', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs" placeholder="Color" />
                      <input value={item.size} onChange={e => updateItem(idx, 'size', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs" placeholder="Size" />
                      <input value={item.quantity} type="number" min={1} onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs" placeholder="Qty" />
                    </div>
                    <div className="flex gap-2">
                      <input value={item.notes} onChange={e => updateItem(idx, 'notes', e.target.value)}
                        className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs" placeholder="Additional notes..." />
                      <button onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}
                        className="text-red-400 hover:text-red-600 text-xs px-2">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Photos */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Photos</h2>
            <p className="text-xs text-gray-400 mb-4">For damaged items, please upload one photo per affected piece</p>
            <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center">
              <input type="file" multiple accept="image/*" id="photo-upload" className="hidden"
                onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files || [])])} />
              <label htmlFor="photo-upload" className="cursor-pointer">
                <svg className="w-8 h-8 text-gray-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5M12 3v12" /></svg>
                <p className="text-sm text-gray-500">Click to upload photos</p>
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

          <button onClick={handleSubmit} disabled={submitting}
            className="w-full py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2 text-sm">
            {submitting && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            {submitting ? 'Submitting...' : 'Submit Support Ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}
