// Shared copy-rule settings + hard sanitizers for the Descriptions module.
// Settings live in copy_settings (key/value jsonb):
//   ban_em_dashes: boolean (default true)
//   rules:         string[] — hard style requirements injected into every generation prompt
//   examples:      { title, body }[] (max 5) — few-shot style references

import { supabaseAdmin } from '@/lib/supabase-admin';

export type CopyExample = { title: string; body: string };

export type CopySettings = {
  ban_em_dashes: boolean;
  quick_facts_enabled: boolean;
  rules: string[];
  examples: CopyExample[];
};

export async function loadCopySettings(): Promise<CopySettings> {
  const { data } = await supabaseAdmin.from('copy_settings').select('key,value');
  const map: Record<string, any> = Object.fromEntries((data || []).map((r: any) => [r.key, r.value]));
  return {
    ban_em_dashes: map.ban_em_dashes !== undefined ? !!map.ban_em_dashes : true,
    quick_facts_enabled: map.quick_facts_enabled !== undefined ? !!map.quick_facts_enabled : true,
    rules: Array.isArray(map.rules) ? map.rules.filter((r: any) => typeof r === 'string' && r.trim()) : [],
    examples: Array.isArray(map.examples)
      ? map.examples
          .filter((e: any) => e && typeof e.body === 'string' && e.body.trim())
          .slice(0, 5)
          .map((e: any) => ({ title: String(e.title || ''), body: String(e.body) }))
      : [],
  };
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

/** Apply hard-enforced sanitizers to a single copy field. */
export function sanitizeCopy(text: string, settings: CopySettings): string {
  let out = text ?? '';
  if (settings.ban_em_dashes) out = stripEmDashes(out);
  return out;
}

/** Normalize quick-fact lines: short, trimmed, deduped, max 6. */
export function cleanQuickFacts(lines: any): string[] {
  if (!Array.isArray(lines)) return [];
  const out: string[] = [];
  for (const l of lines) {
    if (typeof l !== 'string') continue;
    const t = l.replace(/^[-•*]\s*/, '').replace(/[.;,]\s*$/, '').trim();
    if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

/** Append the quick-facts block to a web description if it isn't already present. */
export function ensureQuickFacts(webDescription: string, facts: string[]): string {
  const body = (webDescription || '').trim();
  if (!facts.length) return body;
  const marker = facts[0].toLowerCase();
  if (body.toLowerCase().includes(marker)) return body; // block (or at least its lead line) already present
  return body + '\n\n' + facts.join('\n');
}
