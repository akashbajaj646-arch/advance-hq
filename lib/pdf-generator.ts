import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PrintTemplate, TemplateBlock, getDefaultTemplate } from './template-config';
import { db } from '@/lib/db';

let logoDataUrl: string | null = null;

async function loadLogo(): Promise<string | null> {
  if (logoDataUrl) return logoDataUrl;
  try {
    const res = await fetch('/advance-logo.jpg');
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => { logoDataUrl = reader.result as string; resolve(logoDataUrl); };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

// Load default template for entity type
async function loadDefaultTemplate(entityType: string): Promise<PrintTemplate> {
  try {
    const { data } = await db
      .from('print_templates')
      .select('*')
      .eq('entity_type', entityType)
      .eq('is_default', true)
      .limit(1)
      .maybeSingle();

    if (data) {
      return {
        ...data,
        blocks: typeof data.blocks === 'string' ? JSON.parse(data.blocks) : data.blocks,
        margins: typeof data.margins === 'string' ? JSON.parse(data.margins) : data.margins,
      };
    }
    // Fall back to any template for this type
    const { data: fallback } = await db
      .from('print_templates')
      .select('*')
      .eq('entity_type', entityType)
      .limit(1)
      .maybeSingle();

    if (fallback) {
      return {
        ...fallback,
        blocks: typeof fallback.blocks === 'string' ? JSON.parse(fallback.blocks) : fallback.blocks,
        margins: typeof fallback.margins === 'string' ? JSON.parse(fallback.margins) : fallback.margins,
      };
    }
  } catch (e) {
    console.warn('Failed to load template, using default:', e);
  }
  return getDefaultTemplate(entityType);
}

// Load specific template by ID
async function loadTemplateById(templateId: string): Promise<PrintTemplate | null> {
  try {
    const { data } = await db
      .from('print_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (data) {
      return {
        ...data,
        blocks: typeof data.blocks === 'string' ? JSON.parse(data.blocks) : data.blocks,
        margins: typeof data.margins === 'string' ? JSON.parse(data.margins) : data.margins,
      };
    }
  } catch (e) {
    console.warn('Failed to load template by ID:', e);
  }
  return null;
}

// Get all templates for an entity type (for template picker)
export async function getTemplatesForEntity(entityType: string): Promise<PrintTemplate[]> {
  try {
    const { data } = await db
      .from('print_templates')
      .select('id, name, entity_type, is_default')
      .eq('entity_type', entityType)
      .order('is_default', { ascending: false })
      .order('name');

    return (data || []) as PrintTemplate[];
  } catch {
    return [];
  }
}

function resolveValue(key: string, record: any): string {
  const val = record[key];
  if (val === null || val === undefined || val === '') return '-';
  if (key.match(/total_amount|subtotal|discount_amount|shipping_amount|tax_amount|amount_paid|balance_due|balance|amount|freight|cost|price/)) {
    const n = parseFloat(val);
    if (!isNaN(n)) return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  return String(val);
}

function resolveText(content: string, record: any, notes1: string, notes2: string): string {
  let result = content;
  result = result.replace(/\{\{notes_1\}\}/g, notes1 || '');
  result = result.replace(/\{\{notes_2\}\}/g, notes2 || '');
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => resolveValue(key, record));
  return result;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Render text inside a bounded block with overflow handling.
 * - wrap (default): wraps text, clips at block height
 * - shrink: reduces font size until text fits in the block
 * - truncate: single line, cuts with "..." if too wide
 * - clip: wraps text but hard clips at block boundary (no overflow)
 */
function renderTextInBlock(
  doc: jsPDF,
  text: string,
  block: { x: number; y: number; width: number; height: number; fontSize?: number; fontWeight?: string; textAlign?: string; color?: string; overflow?: string }
) {
  if (!text || !text.trim()) return;

  const baseFontSize = block.fontSize || 9;
  const overflow = block.overflow || 'wrap';
  const align = (block.textAlign || 'left') as 'left' | 'center' | 'right';
  const lineHeightFactor = 1.35; // mm per pt roughly

  const [r, g, b] = hexToRgb(block.color || '#333333');
  doc.setTextColor(r, g, b);
  doc.setFont('helvetica', (block.fontWeight || 'normal') as string);

  let textX = block.x;
  if (align === 'center') textX = block.x + block.width / 2;
  else if (align === 'right') textX = block.x + block.width;

  const textY = block.y + baseFontSize * 0.35;

  if (overflow === 'truncate') {
    // Single line, truncate with ellipsis
    doc.setFontSize(baseFontSize);
    const fullWidth = doc.getTextWidth(text);
    if (fullWidth <= block.width) {
      doc.text(text, textX, textY, { align });
    } else {
      // Binary search for the right truncation point
      let lo = 0, hi = text.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const candidate = text.slice(0, mid) + '…';
        if (doc.getTextWidth(candidate) <= block.width) lo = mid;
        else hi = mid - 1;
      }
      doc.text(text.slice(0, lo) + '…', textX, textY, { align });
    }
    return;
  }

  if (overflow === 'shrink') {
    // Try decreasing font size until all text fits within width × height
    let fs = baseFontSize;
    const minFs = 5;
    while (fs >= minFs) {
      doc.setFontSize(fs);
      const lines = doc.splitTextToSize(text, block.width);
      const lineH = fs * lineHeightFactor * 0.352778; // pt to mm
      const totalH = lines.length * lineH;
      if (totalH <= block.height + 0.5) { // +0.5mm tolerance
        doc.text(lines, textX, block.y + fs * 0.35, { align });
        return;
      }
      fs -= 0.5;
    }
    // At minimum font, just render what fits
    doc.setFontSize(minFs);
    const lines = doc.splitTextToSize(text, block.width);
    const lineH = minFs * lineHeightFactor * 0.352778;
    const maxLines = Math.max(1, Math.floor(block.height / lineH));
    const clipped = lines.slice(0, maxLines);
    if (lines.length > maxLines) {
      const last = clipped[clipped.length - 1];
      clipped[clipped.length - 1] = last.slice(0, -1) + '…';
    }
    doc.text(clipped, textX, block.y + minFs * 0.35, { align });
    return;
  }

  // 'wrap' or 'clip' — both wrap, but clip limits lines to block height
  doc.setFontSize(baseFontSize);
  const lines = doc.splitTextToSize(text, block.width);

  if (overflow === 'clip') {
    const lineH = baseFontSize * lineHeightFactor * 0.352778;
    const maxLines = Math.max(1, Math.floor(block.height / lineH));
    const clipped = lines.slice(0, maxLines);
    if (lines.length > maxLines) {
      const last = clipped[clipped.length - 1];
      clipped[clipped.length - 1] = last.slice(0, -3) + '…';
    }
    doc.text(clipped, textX, textY, { align });
  } else {
    // Default wrap — renders all lines (may overflow block boundary)
    doc.text(lines, textX, textY, { align, maxWidth: block.width });
  }
}

export async function generateFromTemplate(
  entityType: string,
  record: any,
  items: any[],
  action: 'download' | 'print' = 'download',
  templateId?: string   // Optional: specific template ID, otherwise uses default
) {
  let template: PrintTemplate;
  if (templateId) {
    const specific = await loadTemplateById(templateId);
    template = specific || await loadDefaultTemplate(entityType);
  } else {
    template = await loadDefaultTemplate(entityType);
  }

  const logo = await loadLogo();

  const doc = new jsPDF({
    orientation: template.orientation || 'portrait',
    unit: 'mm',
    format: template.page_size || 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const notes1 = template.notes_1 || '';
  const notes2 = template.notes_2 || '';

  const sortedBlocks = [...template.blocks].sort((a, b) => a.y - b.y);

  for (const block of sortedBlocks) {
    switch (block.type) {
      case 'image': {
        if (block.imageKey === 'logo' && logo) {
          try { doc.addImage(logo, 'JPEG', block.x, block.y, block.width, block.height); } catch { /* skip */ }
        }
        break;
      }
      case 'field': {
        const value = resolveValue(block.fieldKey || '', record);
        let text = block.showLabel !== false && block.fieldLabel ? `${block.fieldLabel}: ${value}` : value;
        renderTextInBlock(doc, text, block);
        break;
      }
      case 'text': {
        const resolvedContent = resolveText(block.content || '', record, notes1, notes2);
        if (!resolvedContent.trim()) break;
        renderTextInBlock(doc, resolvedContent, block);
        break;
      }
      case 'line': {
        const [r, g, b] = hexToRgb(block.lineColor || '#CCCCCC');
        doc.setDrawColor(r, g, b);
        doc.setLineWidth(block.lineWidth || 0.3);
        doc.line(block.x, block.y, block.x + block.width, block.y);
        break;
      }
      case 'rectangle': {
        if (block.bgColor && block.bgColor !== '#FFFFFF') {
          const [r, g, b] = hexToRgb(block.bgColor);
          doc.setFillColor(r, g, b);
          doc.rect(block.x, block.y, block.width, block.height, 'F');
        }
        if (block.lineColor) {
          const [r, g, b] = hexToRgb(block.lineColor);
          doc.setDrawColor(r, g, b);
          doc.setLineWidth(block.lineWidth || 0.3);
          doc.rect(block.x, block.y, block.width, block.height, 'S');
        }
        break;
      }
      case 'table': {
        if (!items || items.length === 0) break;
        const columns = block.tableColumns || [];
        if (columns.length === 0) break;

        const head = [columns.map(c => c.header)];
        const body = items.map(row =>
          columns.map(c => {
            const val = row[c.key];
            if (val === null || val === undefined) return '-';
            if (c.key.match(/price|amount|total|cost|freight/) && !isNaN(parseFloat(val))) return `$${parseFloat(val).toFixed(2)}`;
            return String(val || '-');
          })
        );

        if (block.showTotals && record.total_amount) {
          const totalRow = columns.map((_, i) => {
            if (i === columns.length - 2) return 'Total';
            if (i === columns.length - 1) return `$${parseFloat(record.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
            return '';
          });
          body.push(totalRow);
        }

        autoTable(doc, {
          startY: block.y,
          head, body,
          margin: { left: block.x, right: pageWidth - block.x - block.width },
          styles: { fontSize: block.fontSize || 7.5, cellPadding: 2, lineColor: [220, 220, 220], lineWidth: 0.1 },
          headStyles: { fillColor: [50, 50, 50], textColor: [255, 255, 255], fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [250, 250, 250] },
          columnStyles: columns.reduce((acc, col, i) => {
            if (col.align === 'right') acc[i] = { halign: 'right' };
            else if (col.align === 'center') acc[i] = { halign: 'center' };
            return acc;
          }, {} as Record<number, any>),
        });
        break;
      }
    }
  }

  // Footer
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 160);
    doc.setFont('helvetica', 'normal');
    doc.text('Advance Apparels Inc. — Confidential', 15, pageHeight - 8);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 15, pageHeight - 8, { align: 'right' });
  }

  const docNum = record.order_number || record.invoice_number || record.pick_ticket_id || record.am_shipment_id || 'doc';
  const filename = `${entityType}_${docNum}.pdf`;

  if (action === 'print') {
    doc.autoPrint();
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    iframe.contentWindow?.print();
  } else {
    doc.save(filename);
  }
}

// Convenience wrappers — all accept optional templateId
export function generateOrderPDF(record: any, items: any[], action: 'download' | 'print' = 'download', notes: string[] = [], templateId?: string) {
  return generateFromTemplate('order', record, items, action, templateId);
}
export function generateInvoicePDF(record: any, items: any[], action: 'download' | 'print' = 'download', notes: string[] = [], templateId?: string) {
  return generateFromTemplate('invoice', record, items, action, templateId);
}
export function generatePickTicketPDF(record: any, items: any[], action: 'download' | 'print' = 'download', notes: string[] = [], templateId?: string) {
  return generateFromTemplate('pick_ticket', record, items, action, templateId);
}
export function generateShipmentPDF(record: any, boxes: any[], action: 'download' | 'print' = 'download', notes: string[] = [], templateId?: string) {
  return generateFromTemplate('shipment', record, boxes, action, templateId);
}
