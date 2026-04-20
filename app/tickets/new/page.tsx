'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ISSUE_TYPES = [
  { key: 'damaged', label: 'Damaged' },
  { key: 'missing_items', label: 'Missing Items' },
  { key: 'wrong_item', label: 'Wrong Item' },
  { key: 'return_request', label: 'Return Request' },
  { key: 'late_delivery', label: 'Late Delivery' },
  { key: 'wrong_address', label: 'Wrong Address' },
  { key: 'pricing_dispute', label: 'Pricing Dispute' },
  { key: 'other', label: 'Other' },
];

export default function NewTicketPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customer_name: '', customer_email: '', invoice_number: '',
    order_number: '', pick_ticket_number: '', description: '',
    submitted_by: '', issue_types: [] as string[],
  });
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState('');
  const [lineIssues, setLineIssues] = useState<Record<string, { qty: number; issue_type: string; notes: string }>>({});
  const [files, setFiles] = useState<File[]>([]);

  function toggleIssue(key: string) {
    setForm(f => ({
      ...f,
      issue_types: f.issue_types.includes(key)
        ? f.issue_types.filter(i => i !== key)
        : [...f.issue_types, key]
    }));
  }

  async function lookupInvoice() {
    if (!form.invoice_number.trim()) return;
    setInvoiceLoading(true);
    setInvoiceError('');
    setInvoiceItems([]);
    setLineIssues({});
    const res = await fetch(`/api/tickets/invoice-items?invoice_number=${form.invoice_number.trim()}`);
    const { data, error } = await res.json();
    if (error || !data?.length) {
      setInvoiceError('No items found for this invoice number.');
    } else {
      setInvoiceItems(data);
    }
    setInvoiceLoading(false);
  }

  function updateLineIssue(itemId: string, field: string, value: any) {
    setLineIssues(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || { qty: 0, issue_type: "", notes: "" }), [field]: value }
    }));
  }

  // Build affected items from invoice lines that have an issue type selected
  function buildAffectedItems() {
    return invoiceItems
      .filter(item => lineIssues[item.id]?.issue_type)
      .map(item => ({
        style_number: item.style_number,
        description: item.description,
        color: item.attr_2,
        size: item.size,
        quantity: lineIssues[item.id]?.qty || 1,
        issue_type: lineIssues[item.id]?.issue_type,
        notes: lineIssues[item.id]?.notes || '',
      }));
  }

  // Auto-set issue_types from line items
  function getIssueTypesFromLines() {
    const types = new Set(
      Object.values(lineIssues)
        .map(l => l.issue_type)
        .filter(Boolean)
    );
    return Array.from(types);
  }

  async function handleSubmit() {
    if (!form.customer_name || !form.customer_email) {
      alert('Please fill in customer name and email.');
      return;
    }
    const affectedItems = buildAffectedItems();
    const issueTypes = form.issue_types.length > 0 ? form.issue_types : getIssueTypesFromLines();
    if (issueTypes.length === 0) {
      alert('Please select at least one issue type or mark an issue on an invoice line item.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket: { ...form, issue_types: issueTypes },
          items: affectedItems,
        }),
      });
      const { data, error } = await res.json();
      if (error) throw new Error(error);

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
    <div className="p-8 max-w-4xl mx-auto">
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

        {/* Invoice Lookup */}
        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Invoice Lookup</h2>
          <p className="text-xs text-gray-400 mb-4">Enter an invoice number to load all line items — then mark which ones have issues.</p>
          <div className="flex gap-3">
            <div className="flex-1">
              <input value={form.invoice_number}
                onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && lookupInvoice()}
                className="input" placeholder="Invoice number e.g. 12345" />
            </div>
            <button onClick={lookupInvoice} disabled={invoiceLoading || !form.invoice_number.trim()}
              className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2">
              {invoiceLoading && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
              {invoiceLoading ? 'Loading...' : 'Load Items'}
            </button>
          </div>
          {invoiceError && <p className="text-sm text-red-500 mt-2">{invoiceError}</p>}

          {/* Invoice Line Items */}
          {invoiceItems.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-500 mb-2">
                {invoiceItems.length} items found — select issue type for affected items only
              </p>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Style</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Description</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Color</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Size</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Inv Qty</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-500 w-8">Affected Qty</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Issue Type</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceItems.map(item => {
                      const hasIssue = !!lineIssues[item.id]?.issue_type;
                      return (
                        <tr key={item.id} className={`border-b border-gray-100 ${hasIssue ? 'bg-red-50' : ''}`}>
                          <td className="px-3 py-2 font-medium text-gray-900">{item.style_number || '-'}</td>
                          <td className="px-3 py-2 text-gray-600 text-xs max-w-[140px] truncate">{item.description || '-'}</td>
                          <td className="px-3 py-2 text-gray-600">{item.attr_2 || '-'}</td>
                          <td className="px-3 py-2 text-gray-600">{item.size || '-'}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{item.qty}</td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min={0} max={item.qty}
                              value={lineIssues[item.id]?.qty || ''}
                              onChange={e => updateLineIssue(item.id, 'qty', parseInt(e.target.value) || 0)}
                              placeholder="0"
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={lineIssues[item.id]?.issue_type || ''}
                              onChange={e => updateLineIssue(item.id, 'issue_type', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brand-500">
                              <option value="">No issue</option>
                              {ISSUE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={lineIssues[item.id]?.notes || ''}
                              onChange={e => updateLineIssue(item.id, 'notes', e.target.value)}
                              placeholder="Optional notes..."
                              className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {Object.values(lineIssues).filter(l => l.issue_type).length > 0 && (
                <p className="text-xs text-brand-600 mt-2 font-medium">
                  ✓ {Object.values(lineIssues).filter(l => l.issue_type).length} item(s) marked with issues
                </p>
              )}
            </div>
          )}

          {/* Manual order/PT fields */}
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Order # (auto-filled from invoice)</label>
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

        {/* Additional Issue Types */}
        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Additional Issue Types</h2>
          <p className="text-xs text-gray-400 mb-4">Select if the issue applies to the whole order rather than specific items (e.g. late delivery, wrong address).</p>
          <div className="grid grid-cols-2 gap-2">
            {ISSUE_TYPES.map(issue => (
              <button key={issue.key} onClick={() => toggleIssue(issue.key)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm text-left transition-colors ${form.issue_types.includes(issue.key) ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {issue.label}
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

        {/* Photos */}
        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Photos</h2>
          <p className="text-xs text-gray-400 mb-4">One photo per damaged or affected piece recommended.</p>
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

        {/* Submitted By */}
        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Submitted By</h2>
          <input value={form.submitted_by} onChange={e => setForm(f => ({ ...f, submitted_by: e.target.value }))}
            className="input max-w-xs" placeholder="Your name" />
        </div>

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
