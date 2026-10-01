// Shared copy-rule settings + hard sanitizers for the Descriptions module (server-side).
// Settings live in copy_settings (key/value jsonb):
//   ban_em_dashes:       boolean (default true)
//   quick_facts_enabled: boolean (default true) — append selected bullets to web descriptions
//   rules:               string[] — hard style requirements injected into every generation prompt
//   examples:            { title, body }[] (max 5) — few-shot style references
// Bullet bank lives in copy_bullets (group_name, text, sort, active).
// Pure formatting helpers live in lib/copy-format.ts (client-safe) and are re-exported here.

import { supabaseAdmin } from '@/lib/supabase-admin';
import { stripEmDashes } from '@/lib/copy-format';

export { stripEmDashes, cleanQuickFacts, stripTrailingFacts, composeWithFacts, normFact, clampAtWord, SEO_TITLE_MAX, SEO_DESC_MAX } from '@/lib/copy-format';

export type CopyExample = { title: string; body: string };

export type CopySettings = {
  ban_em_dashes: boolean;
  quick_facts_enabled: boolean;
  rules: string[];
  examples: CopyExample[];
};

export type CopyBullet = {
  id: string;
  group_name: string;
  text: string;
  sort: number;
  active: boolean;
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

/** Bullet bank, ordered by sort then text. Returns [] if the table is missing or empty. */
export async function loadBullets(activeOnly = true): Promise<CopyBullet[]> {
  let q = supabaseAdmin
    .from('copy_bullets')
    .select('id,group_name,text,sort,active')
    .order('sort', { ascending: true })
    .order('text', { ascending: true });
  if (activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error || !data) return [];
  return data as CopyBullet[];
}

/** Group bullets preserving sort order (group order = first appearance). */
export function groupBullets(bullets: CopyBullet[]): { group: string; items: CopyBullet[] }[] {
  const out: { group: string; items: CopyBullet[] }[] = [];
  for (const b of bullets) {
    let g = out.find(x => x.group === b.group_name);
    if (!g) { g = { group: b.group_name, items: [] }; out.push(g); }
    g.items.push(b);
  }
  return out;
}

/** Apply hard-enforced sanitizers to a single copy field. */
export function sanitizeCopy(text: string, settings: CopySettings): string {
  let out = text ?? '';
  if (settings.ban_em_dashes) out = stripEmDashes(out);
  return out;
}

/** Legacy: append the quick-facts block if its lead line isn't already present. */
export function ensureQuickFacts(webDescription: string, facts: string[]): string {
  const body = (webDescription || '').trim();
  if (!facts.length) return body;
  const marker = facts[0].toLowerCase();
  if (body.toLowerCase().includes(marker)) return body;
  return body + '\n\n' + facts.join('\n');
}
