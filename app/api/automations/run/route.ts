import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';
import { findVariantBySku, setInventoryPolicy, storeConfig, type ShopifyStore } from '@/lib/shopify';

// POST /api/automations/run  (admin only)
// Processes pending automation_events against both Shopify stores according to
// automation_settings.shopify_mode:
//   dry_run → looks up the variant per store and records what it WOULD change; status 'dry_run'
//   live    → actually sets inventoryPolicy (deactivated→DENY, reactivated→CONTINUE); 'completed'/'failed'
// Processes up to BATCH events per call and reports how many remain — the UI loops.
//
// Store semantics: B2B carries every variant (not found there = failure worth flagging);
// DTC intentionally lacks some variants (not found there = fine, skipped).

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BATCH = 15;

export async function POST() {
  try {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { data: modeRow } = await supabaseAdmin.from('automation_settings').select('value').eq('key', 'shopify_mode').single();
    const mode = typeof modeRow?.value === 'string' ? modeRow.value : 'off';
    if (mode === 'off') {
      return NextResponse.json({ error: 'Automation mode is Off. Switch to Dry Run or Live on the Automations page first.' }, { status: 400 });
    }
    if (!storeConfig('b2b') || !storeConfig('dtc')) {
      return NextResponse.json({ error: 'Shopify env vars are not configured for both stores' }, { status: 400 });
    }

    const { data: pending } = await supabaseAdmin
      .from('automation_events')
      .select('*')
      .eq('status', 'pending')
      .order('detected_at', { ascending: true })
      .limit(BATCH);

    if (!pending || pending.length === 0) {
      return NextResponse.json({ success: true, processed: 0, remaining: 0, mode });
    }

    let processed = 0;
    for (const event of pending) {
      const desired: 'CONTINUE' | 'DENY' = event.event_type === 'sku_deactivated' ? 'DENY' : 'CONTINUE';
      const results: Record<string, any> = {};
      let failed = false;

      for (const store of ['b2b', 'dtc'] as ShopifyStore[]) {
        if (!event.sku_concat) {
          results[store] = { ok: false, error: 'Event has no sku_concat to match on' };
          failed = true;
          continue;
        }

        const lookup = await findVariantBySku(store, event.sku_concat);
        if (!lookup.ok) {
          results[store] = { ok: false, error: 'Lookup failed', detail: lookup.errors };
          failed = true;
          continue;
        }
        if (!lookup.variant) {
          if (store === 'dtc') {
            results[store] = { ok: true, skipped: true, note: 'Variant not on DTC store (expected for some variants)' };
          } else {
            results[store] = { ok: false, error: 'Variant not found on B2B store — SKU match failed' };
            failed = true;
          }
          continue;
        }

        const v = lookup.variant;
        const alreadyCorrect = v.inventoryPolicy === desired;

        if (mode === 'dry_run') {
          results[store] = {
            ok: true,
            dry_run: true,
            found: v.displayName,
            product: v.productTitle,
            current_policy: v.inventoryPolicy,
            would_set: alreadyCorrect ? null : desired,
            note: alreadyCorrect ? 'Already at desired policy — no change needed' : `Would set inventory policy to ${desired}`,
          };
        } else {
          if (alreadyCorrect) {
            results[store] = { ok: true, found: v.displayName, note: `Already ${desired} — no change needed` };
          } else {
            const write = await setInventoryPolicy(store, v.productId, v.id, desired);
            if (write.ok) {
              results[store] = { ok: true, found: v.displayName, set_to: desired, was: v.inventoryPolicy };
            } else {
              results[store] = { ok: false, error: 'Policy update failed', detail: write.errors };
              failed = true;
            }
          }
        }
      }

      const newStatus = mode === 'dry_run' ? 'dry_run' : (failed ? 'failed' : 'completed');
      await supabaseAdmin.from('automation_events').update({
        status: newStatus,
        b2b_result: results.b2b ?? null,
        dtc_result: results.dtc ?? null,
        error: failed ? 'One or more store actions failed — see per-store results' : null,
        processed_at: new Date().toISOString(),
      }).eq('id', event.id);

      processed++;
    }

    const { count: remaining } = await supabaseAdmin
      .from('automation_events')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    return NextResponse.json({ success: true, processed, remaining: remaining ?? 0, mode });
  } catch (error: any) {
    console.error('Automation run error:', error);
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
