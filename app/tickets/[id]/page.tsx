'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const STATUSES = ['open', 'in_review', 'pending_customer', 'resolved', 'closed'];
const STATUS_LABELS: Record<string, string> = {
  open: 'Open', in_review: 'In Review', pending_customer: 'Pending Customer',
  resolved: 'Resolved', closed: 'Closed'
};
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-100 text-red-700', in_review: 'bg-yellow-100 text-yellow-700',
  pending_customer: 'bg-blue-100 text-blue-700', resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
};
const ISSUE_LABELS: Record<string, string> = {
  damaged: 'Damaged', missing_items: 'Missing Items', wrong_item: 'Wrong Item',
  return_request: 'Return Request', late_delivery: 'Late Delivery',
  wrong_address: 'Wrong Address', pricing_dispute: 'Pricing Dispute', other: 'Other',
};
const RESOLUTION_TYPES = ['credit_memo', 'replacement_shipment', 'refund', 'no_action'];
const RESOLUTION_LABELS: Record<string, string> = {
  credit_memo: 'Credit Memo', replacement_shipment: 'Replacement Shipment',
  refund: 'Refund', no_action: 'No Action Required',
};

export default function TicketDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [ticket, setTicket] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [photos, setPhotos] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [commentAuthor, setCommentAuthor] = useState('');
  const [savingComment, setSavingComment] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [resolution, setResolution] = useState({ type: '', credit_memo_number: '', return_shipping: '', notes: '' });
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => { loadTicket(); }, [params.id]);

  async function loadTicket() {
    setLoading(true);
    const res = await fetch(`/api/tickets/${params.id}`);
    const data = await res.json();
    setTicket(data.ticket);
    setItems(data.items || []);
    setPhotos(data.photos || []);
    setComments(data.comments || []);
    if (data.ticket) {
      setResolution({
        type: data.ticket.resolution_type || '',
        credit_memo_number: data.ticket.credit_memo_number || '',
        return_shipping: data.ticket.return_shipping_responsibility || '',
        notes: data.ticket.resolution_notes || '',
      });
    }
    for (const photo of data.photos || []) {
      const { data: urlData } = await supabase.storage.from('ticket-photos').createSignedUrl(photo.storage_path, 3600);
      if (urlData) setPhotoUrls(prev => ({ ...prev, [photo.id]: urlData.signedUrl }));
    }
    setLoading(false);
  }

  async function updateStatus(newStatus: string) {
    setSavingStatus(true);
    const updates: any = { status: newStatus };
    if (newStatus === 'resolved') updates.resolved_at = new Date().toISOString();
    if (newStatus === 'closed') updates.closed_at = new Date().toISOString();
    await fetch(`/api/tickets/${params.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
    setTicket((t: any) => ({ ...t, ...updates }));
    setSavingStatus(false);
  }

  async function saveResolution() {
    await fetch(`/api/tickets/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resolution_type: resolution.type,
        credit_memo_number: resolution.credit_memo_number,
        return_shipping_responsibility: resolution.return_shipping,
        resolution_notes: resolution.notes,
      }),
    });
    alert('Resolution saved');
  }

  async function addComment() {
    if (!newComment.trim() || !commentAuthor.trim()) return;
    setSavingComment(true);
    const res = await fetch(`/api/tickets/${params.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: commentAuthor, content: newComment, is_internal: true }),
    });
    const { data } = await res.json();
    setComments(prev => [...prev, data]);
    setNewComment('');
    setSavingComment(false);
  }

  async function uploadPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadingPhoto(true);
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('uploaded_by', 'Staff');
      const res = await fetch(`/api/tickets/${params.id}/photos`, { method: 'POST', body: fd });
      const { data } = await res.json();
      if (data) {
        setPhotos(prev => [...prev, data]);
        const { data: urlData } = await supabase.storage.from('ticket-photos').createSignedUrl(data.storage_path, 3600);
        if (urlData) setPhotoUrls(prev => ({ ...prev, [data.id]: urlData.signedUrl }));
      }
    }
    setUploadingPhoto(false);
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;
  if (!ticket) return <div className="p-8 text-gray-400">Ticket not found</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/tickets" className="hover:text-brand-600">Tickets</Link>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        <span className="text-gray-700 font-medium">{ticket.ticket_number}</span>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <div className="card">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-xl font-bold text-gray-900">{ticket.ticket_number}</h1>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ticket.status]}`}>{STATUS_LABELS[ticket.status]}</span>
                  {ticket.is_customer_submitted && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">Customer submitted</span>}
                </div>
                <p className="text-sm text-gray-500">Submitted by {ticket.submitted_by || 'Unknown'} · {new Date(ticket.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-1">Customer</p>
                <p className="text-sm font-medium text-gray-900">{ticket.customer_name}</p>
                <p className="text-xs text-gray-500">{ticket.customer_email}</p>
                {ticket.am_customer_id && <Link href={`/customers/${ticket.am_customer_id}`} className="text-xs text-brand-600 hover:underline">View customer →</Link>}
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">References</p>
                {ticket.invoice_number && <p className="text-sm"><span className="text-gray-500">Invoice:</span> <Link href={`/invoices/${ticket.invoice_number}`} className="text-brand-600 hover:underline font-medium">#{ticket.invoice_number}</Link></p>}
                {ticket.order_number && <p className="text-sm"><span className="text-gray-500">Order:</span> <Link href={`/orders/${ticket.order_number}`} className="text-brand-600 hover:underline font-medium">#{ticket.order_number}</Link></p>}
                {ticket.pick_ticket_number && <p className="text-sm"><span className="text-gray-500">Pick Ticket:</span> <span className="font-medium">#{ticket.pick_ticket_number}</span></p>}
              </div>
            </div>
            <div className="mt-4">
              <p className="text-xs text-gray-400 mb-2">Issue Types</p>
              <div className="flex flex-wrap gap-1.5">
                {(ticket.issue_types || []).map((issue: string) => (
                  <span key={issue} className="px-2.5 py-1 bg-brand-50 text-brand-700 rounded-full text-xs font-medium">{ISSUE_LABELS[issue] || issue}</span>
                ))}
              </div>
            </div>
            {ticket.description && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Description</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{ticket.description}</p>
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="card">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Affected Items</h2>
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Style</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Color</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Size</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Issue</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Notes</th>
                </tr></thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} className="border-b border-gray-100">
                      <td className="px-3 py-2 font-medium">{item.style_number || '-'}</td>
                      <td className="px-3 py-2 text-gray-600">{item.color || '-'}</td>
                      <td className="px-3 py-2 text-gray-600">{item.size || '-'}</td>
                      <td className="px-3 py-2 text-right">{item.quantity}</td>
                      <td className="px-3 py-2 text-gray-600">{ISSUE_LABELS[item.issue_type] || item.issue_type || '-'}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{item.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">Photos ({photos.length})</h2>
              <label className="cursor-pointer px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 flex items-center gap-1.5">
                {uploadingPhoto ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> : '+'}
                Add Photos
                <input type="file" multiple accept="image/*" className="hidden" onChange={uploadPhoto} />
              </label>
            </div>
            {photos.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No photos uploaded yet</p>
            ) : (
              <div className="grid grid-cols-4 gap-3">
                {photos.map(photo => (
                  <div key={photo.id}>
                    {photoUrls[photo.id] ? (
                      <a href={photoUrls[photo.id]} target="_blank" rel="noopener noreferrer">
                        <img src={photoUrls[photo.id]} alt={photo.file_name} className="w-full h-24 object-cover rounded-lg border border-gray-200 hover:opacity-90" />
                      </a>
                    ) : (
                      <div className="w-full h-24 bg-gray-100 rounded-lg flex items-center justify-center">
                        <svg className="w-5 h-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-1 truncate">{photo.is_customer_upload ? '👤 ' : '🏢 '}{photo.file_name}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Internal Notes</h2>
            {comments.length > 0 && (
              <div className="space-y-3 mb-4">
                {comments.map(c => (
                  <div key={c.id} className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-700">{c.author}</span>
                      <span className="text-xs text-gray-400">{new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.content}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <input value={commentAuthor} onChange={e => setCommentAuthor(e.target.value)} className="input text-sm" placeholder="Your name" />
              <textarea value={newComment} onChange={e => setNewComment(e.target.value)} rows={3} className="input resize-none text-sm" placeholder="Add an internal note..." />
              <button onClick={addComment} disabled={savingComment || !newComment.trim() || !commentAuthor.trim()} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50">
                {savingComment ? 'Adding...' : 'Add Note'}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Status</h2>
            <div className="space-y-1.5">
              {STATUSES.map(s => (
                <button key={s} onClick={() => updateStatus(s)} disabled={savingStatus}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${ticket.status === s ? STATUS_COLORS[s] + ' font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Resolution</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Resolution Type</label>
                <select value={resolution.type} onChange={e => setResolution(r => ({ ...r, type: e.target.value }))} className="input text-sm">
                  <option value="">Select...</option>
                  {RESOLUTION_TYPES.map(t => <option key={t} value={t}>{RESOLUTION_LABELS[t]}</option>)}
                </select>
              </div>
              {resolution.type === 'credit_memo' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Credit Memo # (ApparelMagic)</label>
                  <input value={resolution.credit_memo_number} onChange={e => setResolution(r => ({ ...r, credit_memo_number: e.target.value }))} className="input text-sm" placeholder="CM-XXXXX" />
                </div>
              )}
              {resolution.type === 'replacement_shipment' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Return Shipping</label>
                  <select value={resolution.return_shipping} onChange={e => setResolution(r => ({ ...r, return_shipping: e.target.value }))} className="input text-sm">
                    <option value="">Select...</option>
                    <option value="advance_apparels">Advance Apparels provides label</option>
                    <option value="customer">Customer responsible</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Resolution Notes</label>
                <textarea value={resolution.notes} onChange={e => setResolution(r => ({ ...r, notes: e.target.value }))} rows={3} className="input text-sm resize-none" placeholder="Notes on resolution..." />
              </div>
              <button onClick={saveResolution} className="w-full px-3 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">Save Resolution</button>
            </div>
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Timeline</h2>
            <div className="space-y-2 text-xs text-gray-500">
              <div className="flex justify-between"><span>Created</span><span>{new Date(ticket.created_at).toLocaleDateString()}</span></div>
              {ticket.resolved_at && <div className="flex justify-between"><span>Resolved</span><span>{new Date(ticket.resolved_at).toLocaleDateString()}</span></div>}
              {ticket.closed_at && <div className="flex justify-between"><span>Closed</span><span>{new Date(ticket.closed_at).toLocaleDateString()}</span></div>}
              <div className="flex justify-between"><span>Last updated</span><span>{new Date(ticket.updated_at).toLocaleDateString()}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
