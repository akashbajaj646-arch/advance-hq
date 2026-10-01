// Pure, client-safe copy formatting helpers for the Descriptions module.
// NO server imports here: app/descriptions/page.tsx imports this file directly.

/** Normalize a bullet/fact line for comparison: drop leading bullet marks and trailing punctuation, lowercase. */
export function normFact(s: string): string {
  return String(s || '')
    .replace(/^[-•*]\s*/, '')
    .replace(/[.;,]\s*$/, '')
    .trim()
    .toLowerCase();
}

/** Remove em/en dashes: digit ranges become hyphens, everything else becomes a comma. */
export function stripEmDashes(text: string): string {
  if (!text) return text;
  return text
    .replace(/(\d)\s*[\u2014\u2013]\s*(\d)/g, '$1-$2')
    .replace(/\s*[\u2014\u2013]+\s*/g, ', ')
    .replace(/,\s*,+/g, ',')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Normalize bullet lines: short, trimmed, deduped, capped. */
export function cleanQuickFacts(lines: any, max = 8): string[] {
  if (!Array.isArray(lines)) return [];
  const out: string[] = [];
  for (const l of lines) {
    if (typeof l !== 'string') continue;
    const t = l.replace(/^[-•*]\s*/, '').replace(/[.;,]\s*$/, '').trim();
    if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Remove a trailing bullet block from a web description. Pops blank lines and any
 * trailing line that matches a known bullet (bank text or previously chosen fact),
 * stopping at the first line of real prose.
 */
export function stripTrailingFacts(body: string, known: string[]): string {
  const set = new Set(known.map(normFact).filter(Boolean));
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  while (lines.length) {
    const n = normFact(lines[lines.length - 1]);
    if (n === '' || set.has(n)) { lines.pop(); continue; }
    break;
  }
  return lines.join('\n').trim();
}

/** Prose + bullet block, with any stale bullet block stripped first so nothing duplicates. */
export function composeWithFacts(prose: string, facts: string[], known: string[]): string {
  const body = stripTrailingFacts(prose, [...known, ...facts]);
  if (!facts.length) return body;
  return body + '\n\n' + facts.join('\n');
}

/** Trim to max chars at a word boundary (no mid-word cuts, no dangling punctuation). */
export function clampAtWord(s: string, max: number): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const idx = cut.lastIndexOf(' ');
  return (idx > max * 0.6 ? cut.slice(0, idx) : cut).replace(/[\s,;:.\-]+$/, '');
}

export const SEO_TITLE_MAX = 60;
export const SEO_DESC_MAX = 155;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Rich-text (HTML) → plain text: keeps paragraph/list breaks, drops tags, decodes common entities. */
export function htmlToText(html: string): string {
  const s = String(html || '');
  if (!/<[a-z][\s\S]*>/i.test(s)) return s.trim();
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<\/(p|div|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Prose + bullets as HTML for AM's rich-text web description (→ Shopify):
 * paragraphs become <p>, bullets become a real <ul><li> list.
 */
export function composeHtml(prose: string, facts: string[], known: string[]): string {
  const body = stripTrailingFacts(htmlToText(prose), [...known, ...facts]);
  const paras = body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`);
  const list = facts.length ? `<ul>${facts.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : '';
  return paras.join('') + list;
}
