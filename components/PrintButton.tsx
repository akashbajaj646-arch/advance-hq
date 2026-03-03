'use client';

import { useState, useEffect, useRef } from 'react';
import { getTemplatesForEntity } from '@/lib/pdf-generator';

interface PrintButtonProps {
  entityType: 'order' | 'invoice' | 'pick_ticket' | 'shipment';
  onDownload: (templateId?: string) => Promise<void>;
  onPrint: (templateId?: string) => Promise<void>;
}

export default function PrintButton({ entityType, onDownload, onPrint }: PrintButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [pendingAction, setPendingAction] = useState<'download' | 'print' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowTemplatePicker(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function loadTemplates() {
    const tmps = await getTemplatesForEntity(entityType);
    setTemplates(tmps.map(t => ({ id: t.id!, name: t.name, is_default: t.is_default || false })));
    return tmps;
  }

  async function handleAction(action: 'download' | 'print', templateId?: string) {
    setLoading(true);
    setOpen(false);
    setShowTemplatePicker(false);
    try {
      if (action === 'download') await onDownload(templateId);
      else await onPrint(templateId);
    } finally {
      setLoading(false);
    }
  }

  async function handleChooseTemplate(action: 'download' | 'print') {
    setPendingAction(action);
    const tmps = await loadTemplates();
    if (tmps.length <= 1) {
      // Only one or zero templates, just use default
      await handleAction(action);
    } else {
      setShowTemplatePicker(true);
    }
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => { setOpen(!open); setShowTemplatePicker(false); }}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        {loading ? (
          <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18.75 3v2.25M15.75 3v2.25M12.75 3v2.25M9.75 3v2.25" /></svg>
        )}
        Print
        <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>

      {/* Main dropdown */}
      {open && !showTemplatePicker && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[180px]">
          <button onClick={() => handleAction('download')} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Download PDF
          </button>
          <button onClick={() => handleAction('print')} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18" /></svg>
            Print
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button onClick={() => handleChooseTemplate('download')} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-500">
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5A3.375 3.375 0 006.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0015 2.25h-1.5a2.251 2.251 0 00-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664" /></svg>
            Choose Template...
          </button>
        </div>
      )}

      {/* Template picker sub-dropdown */}
      {showTemplatePicker && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[220px]">
          <p className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase">Select Template</p>
          {templates.map(t => (
            <button
              key={t.id}
              onClick={() => handleAction(pendingAction || 'download', t.id)}
              className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2"
            >
              <span className="flex-1 truncate">{t.name}</span>
              {t.is_default && <span className="text-[9px] bg-green-100 text-green-700 px-1 py-0.5 rounded">Default</span>}
            </button>
          ))}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <button onClick={() => setShowTemplatePicker(false)} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">← Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
