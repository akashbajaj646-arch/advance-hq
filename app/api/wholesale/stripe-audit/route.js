// app/api/wholesale/stripe-audit/route.js
// INTERNAL, protected by the existing middleware session check.
//
// Pulls one page at a time so a large customer base never trips the
// function timeout. The page loops until each side is exhausted.
//
// GET ?source=stripe&cursor=<stripe id>  -> { customers, nextCursor }
// GET ?source=hq&offset=0                -> { customers, nextOffset }

import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const PAGE = 100;

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

/** Column names vary, so read through the likely candidates. */
const pick = (row, names) => {
  for (const n of names) {
    if (row[n] !== null && row[n] !== undefined && row[n] !== "") return row[n];
  }
  return null;
};

const ID_FIELDS = ["apparel_magic_customer_id", "customer_id", "am_customer_id", "id"];
const EMAIL_FIELDS = ["email", "email_address", "customer_email", "contact_email", "primary_email"];
const NAME_FIELDS = ["customer_name", "company_name", "company", "name", "bill_to_name"];

export async function GET(req) {
  const url = new URL(req.url);
  const source = url.searchParams.get("source");

  try {
    if (source === "stripe") {
      const cursor = url.searchParams.get("cursor") || undefined;
      const res = await getStripe().customers.list({
        limit: PAGE,
        ...(cursor ? { starting_after: cursor } : {}),
      });
      const customers = res.data.map((c) => ({
        id: c.id,
        email: (c.email || "").trim().toLowerCase(),
        name: c.name || "",
        created: c.created,
      }));
      return Response.json({
        customers,
        nextCursor: res.has_more && res.data.length ? res.data[res.data.length - 1].id : null,
      });
    }

    if (source === "hq") {
      const offset = Number(url.searchParams.get("offset") || 0);
      const { data, error } = await db()
        .from("customers")
        .select("*")
        .range(offset, offset + PAGE - 1);
      if (error) throw error;

      const customers = (data || []).map((r) => ({
        id: String(pick(r, ID_FIELDS) ?? ""),
        email: String(pick(r, EMAIL_FIELDS) || "").trim().toLowerCase(),
        name: pick(r, NAME_FIELDS) || "",
      })).filter((c) => c.id);

      return Response.json({
        customers,
        nextOffset: (data || []).length === PAGE ? offset + PAGE : null,
        columns: data && data[0] ? Object.keys(data[0]) : [],
      });
    }

    return Response.json({ error: "source must be 'stripe' or 'hq'" }, { status: 400 });
  } catch (e) {
    console.error("wholesale/stripe-audit:", e);
    return Response.json(
      { error: "Audit failed", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
