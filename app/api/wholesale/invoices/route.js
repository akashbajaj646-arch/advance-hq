// app/api/wholesale/invoices/route.js
// INTERNAL, protected by the existing middleware session check.
//
// GET ?q=<invoice number, customer, or email>  -> { invoices }  picker list
// GET ?invoice_number=<n>                      -> { invoice, items }  full detail
//
// Images: invoice_items.style_number -> products -> product_images.
// If your products table uses a different column for the style number,
// change STYLE_COLUMN below and nothing else needs to move.

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

/** Best-effort thumbnail lookup, keyed by style number. */
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

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const invoiceNumber = url.searchParams.get("invoice_number");
    const q = (url.searchParams.get("q") || "").trim();

    if (invoiceNumber) {
      const { data: invoice, error } = await db()
        .from("invoices")
        .select("*")
        .eq("invoice_number", invoiceNumber)
        .maybeSingle();
      if (error) throw error;
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

    let query = db()
      .from("invoices")
      .select("invoice_number, customer_name, invoice_date, due_date, total_amount, balance_due, payment_status, apparel_magic_order_id")
      .order("invoice_date", { ascending: false })
      .limit(25);

    if (q) {
      query = query.or(
        `invoice_number.ilike.%${q}%,customer_name.ilike.%${q}%,apparel_magic_order_id.ilike.%${q}%`
      );
    } else {
      // Default view: recent invoices that still owe something
      query = query.gt("balance_due", 0);
    }

    const { data, error } = await query;
    if (error) throw error;
    return Response.json({ invoices: data || [] });
  } catch (e) {
    console.error("wholesale/invoices:", e);
    return Response.json({ error: "Could not load invoices" }, { status: 500 });
  }
}
