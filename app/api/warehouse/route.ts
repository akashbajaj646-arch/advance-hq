import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

// ============================================================
// Warehouse Pick/Pack API
// All warehouse workflow state goes through this route so the
// /api/data mutation whitelist (PLM-only) stays untouched.
// ============================================================

type Key = { style_number: string; attr_2: string | null; size: string | null };
const keyOf = (r: Key) => `${r.style_number}||${r.attr_2 || ''}||${r.size || ''}`;

async function imageMapFor(productIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const { data } = await supabase
    .from('product_images')
    .select('product_id, image_url, sort_order')
    .in('product_id', ids)
    .order('sort_order', { ascending: true });
  const map: Record<string, string> = {};
  (data || []).forEach((img: any) => {
    if (!map[img.product_id]) map[img.product_id] = img.image_url;
  });
  return map;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    // ── Queue: recent pick tickets + their job status ──────────
    if (action === 'get_queue') {
      const search = (body.search || '').trim();
      let q = supabase
        .from('pick_tickets')
        .select('pick_ticket_id, apparel_magic_order_id, customer_name, customer_po, pick_ticket_date, qty, qty_open, notes')
        .order('pick_ticket_date', { ascending: false })
        .limit(100);
      if (search) {
        q = q.or(`pick_ticket_id.ilike.%${search}%,customer_name.ilike.%${search}%,customer_po.ilike.%${search}%`);
      }
      const { data: tickets, error } = await q;
      if (error) throw error;

      const { data: jobs } = await supabase
        .from('warehouse_jobs')
        .select('id, pick_ticket_id, status, created_at, completed_at')
        .order('created_at', { ascending: false })
        .limit(300);

      return NextResponse.json({ tickets: tickets || [], jobs: jobs || [] });
    }

    // ── Create job: snapshot pick ticket lines ─────────────────
    if (action === 'create_job') {
      const { pick_ticket_id } = body;

      const { data: existing } = await supabase
        .from('warehouse_jobs')
        .select('id, status')
        .eq('pick_ticket_id', pick_ticket_id)
        .not('status', 'in', '(complete,cancelled)')
        .maybeSingle();
      if (existing) return NextResponse.json({ job_id: existing.id, existing: true });

      const { data: pt, error: ptErr } = await supabase
        .from('pick_tickets')
        .select('pick_ticket_id, apparel_magic_order_id, customer_name, customer_po')
        .eq('pick_ticket_id', pick_ticket_id)
        .single();
      if (ptErr || !pt) throw new Error(`Pick ticket ${pick_ticket_id} not found`);

      const { data: items, error: itemsErr } = await supabase
        .from('pick_ticket_items')
        .select('product_id, style_number, description, attr_2, attr_3, size, qty, notes, location, upc')
        .eq('pick_ticket_id', pick_ticket_id);
      if (itemsErr) throw itemsErr;

      const lines = (items || []).filter((i: any) => Number(i.qty) > 0);
      if (lines.length === 0) throw new Error('Pick ticket has no line items with quantity');

      const { data: job, error: jobErr } = await supabase
        .from('warehouse_jobs')
        .insert({
          pick_ticket_id: pt.pick_ticket_id,
          apparel_magic_order_id: pt.apparel_magic_order_id,
          customer_name: pt.customer_name,
          customer_po: pt.customer_po,
          status: 'picking',
        })
        .select()
        .single();
      if (jobErr) throw jobErr;

      const snapshot = lines.map((i: any) => ({
        job_id: job.id,
        product_id: i.product_id,
        style_number: i.style_number,
        description: i.description,
        attr_2: i.attr_2,
        attr_3: i.attr_3,
        size: i.size,
        qty_ordered: Number(i.qty) || 0,
        location: i.location,
        notes: i.notes,
        upc: i.upc,
      }));
      const { error: snapErr } = await supabase.from('warehouse_pick_items').insert(snapshot);
      if (snapErr) throw snapErr;

      return NextResponse.json({ job_id: job.id });
    }

    // ── Load job + pick items + images ─────────────────────────
    if (action === 'get_job') {
      const { job_id } = body;
      const { data: job, error: jobErr } = await supabase
        .from('warehouse_jobs').select('*').eq('id', job_id).single();
      if (jobErr || !job) throw new Error('Job not found');

      const { data: items } = await supabase
        .from('warehouse_pick_items').select('*').eq('job_id', job_id);

      const images = await imageMapFor((items || []).map((i: any) => i.product_id));

      return NextResponse.json({
        job,
        items: (items || []).map((i: any) => ({ ...i, image_url: images[i.product_id] || null })),
      });
    }

    // ── Picker: confirm a line / report a problem ──────────────
    if (action === 'save_pick') {
      const { id, qty_picked, is_picked, problem, problem_note } = body;
      const { error } = await supabase
        .from('warehouse_pick_items')
        .update({
          qty_picked: qty_picked ?? null,
          is_picked: !!is_picked,
          problem: problem || null,
          problem_note: problem_note || null,
          picked_at: is_picked || problem ? new Date().toISOString() : null,
        })
        .eq('id', id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // ── Stage transitions with server-side gates ───────────────
    if (action === 'set_status') {
      const { job_id, status } = body;

      if (status === 'checking') {
        const { data: open } = await supabase
          .from('warehouse_pick_items')
          .select('id')
          .eq('job_id', job_id)
          .eq('is_picked', false)
          .is('problem', null)
          .limit(1);
        if (open && open.length > 0) {
          return NextResponse.json({ error: 'Not all items are picked or flagged' }, { status: 400 });
        }
      }

      if (status === 'packing') {
        const { data: unresolved } = await supabase
          .from('warehouse_discrepancies')
          .select('id')
          .eq('job_id', job_id)
          .is('resolution', null)
          .limit(1);
        if (unresolved && unresolved.length > 0) {
          return NextResponse.json({ error: 'Unresolved discrepancies remain' }, { status: 400 });
        }
      }

      const stamps: Record<string, object> = {
        checking: { picking_completed_at: new Date().toISOString(), checking_started_at: new Date().toISOString() },
        packing: { checking_completed_at: new Date().toISOString(), packing_started_at: new Date().toISOString() },
        complete: { completed_at: new Date().toISOString() },
        picking: {},
        cancelled: {},
      };
      const { error } = await supabase
        .from('warehouse_jobs')
        .update({ status, ...(stamps[status] || {}) })
        .eq('id', job_id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // ── Checker: styles on the ticket (blind — no expected qtys) ─
    if (action === 'get_check_data') {
      const { job_id } = body;

      const { data: items } = await supabase
        .from('warehouse_pick_items')
        .select('product_id, style_number, description')
        .eq('job_id', job_id);

      const { data: counts } = await supabase
        .from('warehouse_check_counts').select('*').eq('job_id', job_id);

      // Styles from the ticket + any unexpected styles the checker added
      const styleMap: Record<string, { product_id: string | null; style_number: string; description: string | null; is_unexpected: boolean }> = {};
      (items || []).forEach((i: any) => {
        if (i.style_number && !styleMap[i.style_number]) {
          styleMap[i.style_number] = { product_id: i.product_id, style_number: i.style_number, description: i.description, is_unexpected: false };
        }
      });
      (counts || []).forEach((c: any) => {
        if (c.style_number && !styleMap[c.style_number]) {
          styleMap[c.style_number] = { product_id: c.product_id, style_number: c.style_number, description: null, is_unexpected: true };
        }
      });

      const styles = Object.values(styleMap);
      const images = await imageMapFor(styles.map(s => s.product_id || ''));

      return NextResponse.json({
        styles: styles.map(s => ({ ...s, image_url: s.product_id ? images[s.product_id] || null : null })),
        counts: counts || [],
      });
    }

    // ── Full color/size matrix for one product (blind grid) ────
    if (action === 'get_style_matrix') {
      const { product_id, style_number } = body;
      let skus: any[] = [];
      if (product_id) {
        const { data } = await supabase
          .from('product_skus')
          .select('attr_2, attr_2_name, size')
          .eq('product_id', product_id);
        skus = data || [];
      }
      // Fallback: derive axes from pick items if product has no SKUs synced
      if (skus.length === 0 && body.job_id) {
        const { data } = await supabase
          .from('warehouse_pick_items')
          .select('attr_2, size')
          .eq('job_id', body.job_id)
          .eq('style_number', style_number || '');
        skus = data || [];
      }
      const colors: { code: string; name: string | null }[] = [];
      const sizes: string[] = [];
      skus.forEach((s: any) => {
        const c = s.attr_2 || '';
        if (!colors.some(x => x.code === c)) colors.push({ code: c, name: s.attr_2_name || null });
        const sz = s.size || '';
        if (!sizes.includes(sz)) sizes.push(sz);
      });
      return NextResponse.json({ colors, sizes });
    }

    // ── Checker: product search for "found item not shown" ─────
    if (action === 'search_products') {
      const q = (body.q || '').trim();
      if (!q) return NextResponse.json({ products: [] });
      const { data } = await supabase
        .from('products')
        .select('product_id, style_number, description')
        .ilike('style_number', `%${q}%`)
        .limit(12);
      const images = await imageMapFor((data || []).map((p: any) => p.product_id));
      return NextResponse.json({
        products: (data || []).map((p: any) => ({ ...p, image_url: images[p.product_id] || null })),
      });
    }

    // ── Checker: persist counts for one style (replace) ────────
    if (action === 'save_counts') {
      const { job_id, product_id, style_number, is_unexpected, counts } = body;
      const { error: delErr } = await supabase
        .from('warehouse_check_counts')
        .delete()
        .eq('job_id', job_id)
        .eq('style_number', style_number);
      if (delErr) throw delErr;

      const rows = (counts || [])
        .filter((c: any) => Number(c.qty) > 0)
        .map((c: any) => ({
          job_id,
          product_id: product_id || null,
          style_number,
          attr_2: c.attr_2 || null,
          size: c.size || null,
          qty_counted: Number(c.qty),
          is_unexpected: !!is_unexpected,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from('warehouse_check_counts').insert(rows);
        if (error) throw error;
      }
      return NextResponse.json({ ok: true });
    }

    // ── Verify: expected (pick ticket) vs found (blind counts) ─
    if (action === 'verify') {
      const { job_id } = body;

      const { data: items } = await supabase
        .from('warehouse_pick_items')
        .select('style_number, attr_2, size, qty_ordered, qty_picked, problem')
        .eq('job_id', job_id);
      const { data: counts } = await supabase
        .from('warehouse_check_counts')
        .select('style_number, attr_2, size, qty_counted')
        .eq('job_id', job_id);

      const expected: Record<string, { key: Key; qty: number; picker_qty: number; picker_problem: string | null }> = {};
      (items || []).forEach((i: any) => {
        const k = keyOf(i);
        if (!expected[k]) expected[k] = { key: { style_number: i.style_number, attr_2: i.attr_2, size: i.size }, qty: 0, picker_qty: 0, picker_problem: null };
        expected[k].qty += Number(i.qty_ordered) || 0;
        expected[k].picker_qty += Number(i.qty_picked) || 0;
        if (i.problem) expected[k].picker_problem = i.problem;
      });

      const found: Record<string, { key: Key; qty: number }> = {};
      (counts || []).forEach((c: any) => {
        const k = keyOf(c);
        if (!found[k]) found[k] = { key: { style_number: c.style_number, attr_2: c.attr_2, size: c.size }, qty: 0 };
        found[k].qty += Number(c.qty_counted) || 0;
      });

      const allKeys = new Set([...Object.keys(expected), ...Object.keys(found)]);
      const matched: any[] = [];
      const discrepancies: any[] = [];

      allKeys.forEach(k => {
        const exp = expected[k]?.qty || 0;
        const fnd = found[k]?.qty || 0;
        const key = expected[k]?.key || found[k]!.key;
        const base = {
          style_number: key.style_number,
          attr_2: key.attr_2,
          size: key.size,
          qty_expected: exp,
          qty_found: fnd,
          picker_problem: expected[k]?.picker_problem || null,
          picker_qty: expected[k]?.picker_qty ?? null,
        };
        if (exp === fnd) {
          matched.push(base);
        } else {
          discrepancies.push({ ...base, kind: exp === 0 ? 'wrong_item' : fnd > exp ? 'over' : 'short' });
        }
      });

      // Replace discrepancy rows (fresh verification resets resolutions)
      await supabase.from('warehouse_discrepancies').delete().eq('job_id', job_id);
      if (discrepancies.length > 0) {
        const { error } = await supabase.from('warehouse_discrepancies').insert(
          discrepancies.map(d => ({
            job_id,
            style_number: d.style_number,
            attr_2: d.attr_2,
            size: d.size,
            qty_expected: d.qty_expected,
            qty_found: d.qty_found,
            kind: d.kind,
          }))
        );
        if (error) throw error;
      }

      const { data: discRows } = await supabase
        .from('warehouse_discrepancies').select('*').eq('job_id', job_id);

      // Attach picker context to stored rows
      const withCtx = (discRows || []).map((r: any) => {
        const k = keyOf(r);
        return { ...r, picker_problem: expected[k]?.picker_problem || null, picker_qty: expected[k]?.picker_qty ?? null };
      });

      return NextResponse.json({ matched, discrepancies: withCtx });
    }

    // ── Resolve one discrepancy ────────────────────────────────
    if (action === 'resolve_discrepancy') {
      const { id, resolution, note } = body;
      const { error } = await supabase
        .from('warehouse_discrepancies')
        .update({ resolution, note: note || null, resolved_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // ── Packer: targets, boxes, remaining ──────────────────────
    if (action === 'get_pack_data') {
      const { job_id } = body;

      const { data: counts } = await supabase
        .from('warehouse_check_counts')
        .select('product_id, style_number, attr_2, size, qty_counted')
        .eq('job_id', job_id);
      const { data: discs } = await supabase
        .from('warehouse_discrepancies').select('*').eq('job_id', job_id);
      const { data: boxes } = await supabase
        .from('warehouse_boxes').select('*').eq('job_id', job_id).order('box_number');
      const { data: boxItems } = await supabase
        .from('warehouse_box_items').select('*').eq('job_id', job_id);

      // Pack target per key: found qty, unless discrepancy resolved as
      // 'corrected' (cart fixed to match the order) → expected qty.
      const targets: Record<string, any> = {};
      (counts || []).forEach((c: any) => {
        const k = keyOf(c);
        if (!targets[k]) targets[k] = { style_number: c.style_number, attr_2: c.attr_2, size: c.size, product_id: c.product_id, qty: 0 };
        targets[k].qty += Number(c.qty_counted) || 0;
      });
      (discs || []).forEach((d: any) => {
        const k = keyOf(d);
        if (d.resolution === 'corrected') {
          if (!targets[k]) targets[k] = { style_number: d.style_number, attr_2: d.attr_2, size: d.size, product_id: null, qty: 0 };
          targets[k].qty = Number(d.qty_expected) || 0;
        }
      });
      const targetList = Object.values(targets).filter((t: any) => t.qty > 0);
      const images = await imageMapFor(targetList.map((t: any) => t.product_id || ''));

      return NextResponse.json({
        targets: targetList.map((t: any) => ({ ...t, image_url: t.product_id ? images[t.product_id] || null : null })),
        boxes: boxes || [],
        box_items: boxItems || [],
      });
    }

    if (action === 'save_box') {
      const { job_id, box_id, box_number, length_in, width_in, height_in, weight_lb } = body;
      if (box_id) {
        const { error } = await supabase
          .from('warehouse_boxes')
          .update({ length_in, width_in, height_in, weight_lb })
          .eq('id', box_id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      const { data, error } = await supabase
        .from('warehouse_boxes')
        .insert({ job_id, box_number })
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ box: data });
    }

    if (action === 'delete_box') {
      const { box_id } = body;
      const { error } = await supabase.from('warehouse_boxes').delete().eq('id', box_id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'save_box_item') {
      const { job_id, box_id, style_number, attr_2, size, qty } = body;
      const { error: delErr } = await supabase
        .from('warehouse_box_items')
        .delete()
        .eq('box_id', box_id)
        .eq('style_number', style_number)
        .filter('attr_2', attr_2 ? 'eq' : 'is', attr_2 || null)
        .filter('size', size ? 'eq' : 'is', size || null);
      if (delErr) throw delErr;
      if (Number(qty) > 0) {
        const { error } = await supabase
          .from('warehouse_box_items')
          .insert({ job_id, box_id, style_number, attr_2: attr_2 || null, size: size || null, qty: Number(qty) });
        if (error) throw error;
      }
      return NextResponse.json({ ok: true });
    }

    // ── Complete: validate boxes match targets, dims + weight set ─
    if (action === 'complete_job') {
      const { job_id } = body;

      const { data: boxes } = await supabase
        .from('warehouse_boxes').select('*').eq('job_id', job_id);
      const { data: boxItems } = await supabase
        .from('warehouse_box_items').select('*').eq('job_id', job_id);
      const { data: counts } = await supabase
        .from('warehouse_check_counts').select('*').eq('job_id', job_id);
      const { data: discs } = await supabase
        .from('warehouse_discrepancies').select('*').eq('job_id', job_id);

      const problems: string[] = [];

      if (!boxes || boxes.length === 0) problems.push('No boxes created');
      (boxes || []).forEach((b: any) => {
        if (!(Number(b.weight_lb) > 0)) problems.push(`Box ${b.box_number}: missing weight`);
        if (!(Number(b.length_in) > 0 && Number(b.width_in) > 0 && Number(b.height_in) > 0))
          problems.push(`Box ${b.box_number}: missing dimensions`);
      });

      const targets: Record<string, number> = {};
      (counts || []).forEach((c: any) => {
        targets[keyOf(c)] = (targets[keyOf(c)] || 0) + Number(c.qty_counted);
      });
      (discs || []).forEach((d: any) => {
        if (d.resolution === 'corrected') targets[keyOf(d)] = Number(d.qty_expected);
      });

      const packed: Record<string, number> = {};
      (boxItems || []).forEach((i: any) => {
        packed[keyOf(i)] = (packed[keyOf(i)] || 0) + Number(i.qty);
      });

      const allKeys = new Set([...Object.keys(targets), ...Object.keys(packed)]);
      allKeys.forEach(k => {
        const t = targets[k] || 0;
        const p = packed[k] || 0;
        if (t !== p) {
          const [style, color, size] = k.split('||');
          problems.push(`${style} ${color} ${size}: ${p} boxed / ${t} verified`);
        }
      });

      if (problems.length > 0) {
        return NextResponse.json({ ok: false, problems });
      }

      const { error } = await supabase
        .from('warehouse_jobs')
        .update({ status: 'complete', completed_at: new Date().toISOString() })
        .eq('id', job_id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('Warehouse API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Temporary diagnostics — visit /api/warehouse in the browser while logged in
export async function GET() {
  const out: any = {
    has_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    has_anon_key: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    has_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
  const pt = await supabase.from('pick_tickets').select('*', { count: 'exact', head: true });
  out.pick_tickets_count = pt.count;
  out.pick_tickets_error = pt.error?.message || null;
  const sample = await supabase.from('pick_tickets')
    .select('pick_ticket_id, pick_ticket_date, customer_name')
    .order('pick_ticket_date', { ascending: false })
    .limit(3);
  out.sample = sample.data;
  out.sample_error = sample.error?.message || null;
  const wj = await supabase.from('warehouse_jobs').select('*', { count: 'exact', head: true });
  out.warehouse_jobs_count = wj.count;
  out.warehouse_jobs_error = wj.error?.message || null;
  return NextResponse.json(out);
}
