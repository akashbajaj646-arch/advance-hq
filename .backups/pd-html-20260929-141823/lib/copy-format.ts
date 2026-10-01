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
