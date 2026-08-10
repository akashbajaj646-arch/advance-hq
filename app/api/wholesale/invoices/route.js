// app/api/wholesale/invoices/route.js
// INTERNAL, protected by the existing middleware session check.
//
// GET ?q=<invoice number, order number, or customer>  -> { invoices }
// GET ?invoice_number=<n>                             -> { invoice, items }
//
// Deliberately defensive: it selects * rather than naming columns, and each
// search variant runs independently so a column that doesn't exist in this
// schema is skipped instead of failing the whole request.

import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const STYLE_COLUMN = "style_number";

let _db = null;
function db() {
  if (!_db) {
    _db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }
  return _db;
}

async function imagesForStyles(styles) {
  const map = {};
  const unique = [...new Set(styles.filter(Boolean))];
  if (!unique.length) return map;
  try {
    // products keys on product_id (not id) and carries style_number
    const { data: products, error: pErr } = await db()
      .from("products")
      .select("product_id, style_number")
      .in("style_number", unique);
    if (pErr || !products || !products.length) return map;

    const styleByProductId = {};
    products.forEach((p) => { styleByProductId[p.product_id] = p.style_number; });
    const productIds = Object.keys(styleByProductId);

    // Primary image first, then anything else for styles that lack one
    const { data: primary } = await db()
      .from("product_images")
      .select("product_id, image_url")
      .in("product_id", productIds)
      .eq("sort_order", 0);

    (primary || []).forEach((img) => {
      const style = styleByProductId[img.product_id];
      if (style && !map[style]) map[style] = img.image_url;
    });

    const missing = productIds.filter((id) => !map[styleByProductId[id]]);
    if (missing.length) {
      const { data: any } = await db()
        .from("product_images")
        .select("product_id, image_url")
        .in("product_id", missing);
      (any || []).forEach((img) => {
        const style = styleByProductId[img.product_id];
        if (style && !map[style]) map[style] = img.image_url;
      });
    }
  } catch (e) {
    console.error("imagesForStyles:", e);
  }
  return map;
}

/** Runs a filter, returning [] when the column doesn't exist or the type rejects it. */
async function tryQuery(build) {
  try {
    const { data, error } = await build(
      db().from("invoices").select("*").order("invoice_date", { ascending: false }).limit(15)
    );
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

const isVoid = (r) => r.void === true || r.is_void === true;

/** Only the fields the picker needs, with fallbacks for naming differences. */
const toListItem = (r) => ({
  invoice_number: r.invoice_number,
  customer_name:
    r.customer_name || r.ship_to_name || r.bill_to_name || r.customer || "",
  apparel_magic_customer_id: r.apparel_magic_customer_id ?? null,
  apparel_magic_order_id: r.apparel_magic_order_id ?? null,
  invoice_date: r.invoice_date ?? null,
  due_date: r.due_date ?? null,
  total_amount: r.total_amount ?? null,
  balance_due: r.balance_due ?? null,
  payment_status: r.payment_status ?? null,
});

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const invoiceNumber = url.searchParams.get("invoice_number");
    const q = (url.searchParams.get("q") || "").trim();

    if (invoiceNumber) {
      let invoice = null;
      const asText = await db().from("invoices").select("*").eq("invoice_number", invoiceNumber).maybeSingle();
      invoice = asText.data;
      if (!invoice && /^\d+$/.test(invoiceNumber)) {
        const asNum = await db().from("invoices").select("*").eq("invoice_number", Number(invoiceNumber)).maybeSingle();
        invoice = asNum.data;
      }
      if (!invoice) return Response.json({ error: "Invoice not found" }, { status: 404 });

      // invoice_items keys on a text column, so coerce and try the likely
      // identifiers in order until one returns rows.
      const candidates = [invoice.apparel_magic_id, invoice.invoice_number]
        .filter((v) => v !== null && v !== undefined && v !== "")
        .map((v) => String(v));

      let rawItems = [];
      let matchedOn = null;
      const attempts = [];
      for (const key of candidates) {
        const { data, error } = await db()
          .from("invoice_items")
          .select("*")
          .eq("apparel_magic_invoice_id", key)
          .order("style_number");
        attempts.push({ key, rows: data ? data.length : 0, error: error ? error.message : null });
        if (data && data.length) {
          rawItems = data;
          matchedOn = key;
          break;
        }
      }

      // Probe the table itself so we can tell "no match" from "cannot read"
      let probe = null;
      if (!rawItems.length) {
        const { data, error } = await db()
          .from("invoice_items")
          .select("apparel_magic_invoice_id")
          .limit(3);
        probe = {
          reachable: !error,
          error: error ? error.message : null,
          sampleKeys: (data || []).map((r) => JSON.stringify(r.apparel_magic_invoice_id)),
        };
      }

      const imgs = await imagesForStyles(
        (rawItems || []).map((i) => i.style_number || i.style || i.sku)
      );
      // Column names vary across the synced schema, so fall back through
      // the likely candidates rather than naming one in the select.
      const pick = (row, ...names) => {
        for (const n of names) {
          if (row[n] !== null && row[n] !== undefined && row[n] !== "") return row[n];
        }
        return null;
      };

      const items = (rawItems || []).map((i) => ({
        styleNumber: pick(i, "style_number", "style", "sku", "item_number"),
        description: pick(i, "description", "style_description", "item_description", "name"),
        color: pick(i, "color_name", "color", "color_code", "colour"),
        size: pick(i, "size", "size_name", "size_code"),
        qty: Number(pick(i, "qty", "quantity", "qty_shipped")) || 0,
        unitPrice: Number(pick(i, "unit_price", "price", "unit_cost")) || 0,
        amount: Number(pick(i, "amount", "extended_amount", "line_total", "total")) || 0,
        imageUrl: imgs[pick(i, "style_number", "style", "sku")] || null,
      }));

      return Response.json({
        invoice: { ...toListItem(invoice), ...invoice },
        items,
        debug: { triedKeys: candidates, matchedOn, itemCount: items.length, attempts, probe, columns: rawItems[0] ? Object.keys(rawItems[0]) : [], imagesFound: items.filter((i) => i.imageUrl).length },
      });
    }

    let results = [];

    if (!q) {
      results = await tryQuery((qb) => qb.gt("balance_due", 0));
    } else {
      const isNumeric = /^\d+$/.test(q);
      results.push(...(await tryQuery((qb) => qb.ilike("invoice_number", `%${q}%`))));
      if (isNumeric) {
        results.push(...(await tryQuery((qb) => qb.eq("invoice_number", Number(q)))));
        results.push(...(await tryQuery((qb) => qb.eq("apparel_magic_order_id", Number(q)))));
        results.push(...(await tryQuery((qb) => qb.eq("apparel_magic_customer_id", Number(q)))));
      }
      results.push(...(await tryQuery((qb) => qb.ilike("apparel_magic_order_id", `%${q}%`))));
      // Customer name may live under a different column, or not exist at all
      results.push(...(await tryQuery((qb) => qb.ilike("customer_name", `%${q}%`))));
      results.push(...(await tryQuery((qb) => qb.ilike("ship_to_name", `%${q}%`))));
    }

    const seen = new Set();
    const invoices = results
      .filter((r) => !isVoid(r))
      .filter((r) => {
        const k = String(r.invoice_number);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 25)
      .map(toListItem);

    return Response.json({ invoices });
  } catch (e) {
    console.error("wholesale/invoices:", e);
    return Response.json(
      { error: "Could not load invoices", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
