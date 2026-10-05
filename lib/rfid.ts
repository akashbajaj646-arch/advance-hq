// Shared helpers for the RFID pages.
export const WAREHOUSE_LABELS: Record<string, string> = {
  LEUNING: 'Leuning',
  STATE_ST: 'State St',
};

export function whLabel(w?: string | null): string {
  if (!w) return 'Never seen';
  return WAREHOUSE_LABELS[w] ?? w;
}

export function fmtDate(v?: string | null): string {
  if (!v) return '-';
  try {
    return new Date(v).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return v;
  }
}

export function fmtNum(v: any): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : '-';
}

export function errMsg(e: any): string {
  if (!e) return '';
  if (typeof e === 'string') return e;
  return e.message ?? JSON.stringify(e);
}
