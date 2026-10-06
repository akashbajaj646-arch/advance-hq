// app/api/wholesale/notify-test/route.js
// Internal. GET to see what Resend actually says. Temporary diagnostic.

export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.RESEND_API_KEY || "";
  const to = process.env.NOTIFY_TO || "sales@advanceapparels.com";
  const from = process.env.NOTIFY_FROM || "onboarding@resend.dev";

  const env = {
    RESEND_API_KEY: key ? `set (${key.slice(0, 5)}..., ${key.length} chars)` : "MISSING",
    NOTIFY_TO: to,
    NOTIFY_FROM: from,
  };

  if (!key) return Response.json({ env, sent: false, reason: "RESEND_API_KEY not set" });

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Advance HQ notification test",
        text: "If you are reading this, Resend is wired up correctly.",
      }),
    });
    const body = await r.text();
    return Response.json({ env, status: r.status, ok: r.ok, resend: body });
  } catch (e) {
    return Response.json({ env, error: String(e?.message || e) }, { status: 500 });
  }
}
