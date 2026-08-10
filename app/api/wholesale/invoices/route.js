// app/api/wholesale/invoices/route.js
// INTERNAL, protected by the existing middleware session check.
//
// GET ?q=<invoice number, order number, or customer>  -> { invoices }
// GET ?invoice_number=<n>                             -> { invoice, items }
//
// Search adapts to column types: it tries a partial (ilike) match and also
// exact matching for digits, so it works whether invoice_number is text or
// an integer. Failed variants are skipped instead of failing the request.

import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const STYLE_COLUMN = "style_number";
const LIST_COLUMNS =
  "invoice_number, customer_name, invoice_date, due_date, total_amount, balance_due, payment_status, apparel_magic_order_id";

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
    const { data: products } = await db()
      .from("products")
      .select(`id, ${STYLE_COLUMN}`)
      .in(STYLE_COLUMN, unique);
    if (!products || !products.length) return map;

    const byId = {};
    products.forEach((p) => { byId[p.id] = p[STYLE_COLUMN]; });

    const { data: images } = await db()
      .from("product_images")
      .select("product_id, image_url")
      .in("product_id", Object.keys(byId));

    (images || []).forEach((img) => {
      const style = byId[img.product_id];
      if (style && !map[style]) map[style] = img.image_url;
    });
  } catch (e) {
    console.error("imagesForStyles:", e);
  }
  return map;
}

/** Runs a filter, returning [] instead of throwing when the column type rejects it. */
async function tryQuery(build) {
  try {
    const { data, error } = await build(
      db().from("invoices").select(LIST_COLUMNS).order("invoice_date", { ascending: false }).limit(15)
    );
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

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

      const { data: rawItems } = await db()
        .from("invoice_items")
        .select("style_number, description, color_name, size, qty, unit_price, amount")
        .eq("apparel_magic_invoice_id", invoice.apparel_magic_id)
        .order("style_number");

      const imgs = await imagesForStyles((rawItems || []).map((i) => i.style_number));
      const items = (rawItems || []).map((i) => ({
        styleNumber: i.style_number,
        description: i.description,
        color: i.color_name,
        size: i.size,
        qty: Number(i.qty) || 0,
        unitPrice: Number(i.unit_price) || 0,
        amount: Number(i.amount) || 0,
        imageUrl: imgs[i.style_number] || null,
      }));

      return Response.json({ invoice, items });
    }

    if (!q) {
      const { data, error } = await db()
        .from("invoices")
        .select(LIST_COLUMNS)
        .gt("balance_due", 0)
        .order("invoice_date", { ascending: false })
        .limit(15);
      if (error) throw error;
      return Response.json({ invoices: data || [] });
    }

    const isNumeric = /^\d+$/.test(q);
    const results = [];

    results.push(...(await tryQuery((qb) => qb.ilike("invoice_number", `%${q}%`))));
    if (isNumeric) {
      results.push(...(await tryQuery((qb) => qb.eq("invoice_number", Number(q)))));
      results.push(...(await tryQuery((qb) => qb.eq("apparel_magic_order_id", Number(q)))));
    }
    results.push(...(await tryQuery((qb) => qb.ilike("apparel_magic_order_id", `%${q}%`))));
    results.push(...(await tryQuery((qb) => qb.ilike("customer_name", `%${q}%`))));

    const seen = new Set();
    const invoices = results
      .filter((r) => {
        const k = String(r.invoice_number);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 25);

    return Response.json({ invoices });
  } catch (e) {
    console.error("wholesale/invoices:", e);
    return Response.json(
      { error: "Could not load invoices", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
