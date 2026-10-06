// lib/notify.js
// Internal notifications. Uses Resend's REST API directly so there is no
// package to install. Never throws: a failed email must not fail the request
// that triggered it.
//
// Env:
//   RESEND_API_KEY   from resend.com
//   NOTIFY_TO        defaults to sales@advanceapparels.com (comma-separate for several)
//   NOTIFY_FROM      defaults to wholesale@advanceapparels.com (domain must be verified in Resend)
//   NEXT_PUBLIC_APP_URL  used to link straight to the approval queue

const esc = (v) =>
  String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export async function sendMail({ subject, html, text, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("notify: RESEND_API_KEY not set, skipping email");
    return { skipped: true };
  }

  const to = (process.env.NOTIFY_TO || "sales@advanceapparels.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const body = {
    from: process.env.NOTIFY_FROM || "Advance Apparels <wholesale@advanceapparels.com>",
    to,
    subject,
    html,
    text,
  };
  if (replyTo) body.reply_to = replyTo;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error("notify: resend returned", r.status, await r.text());
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error("notify: send failed", e);
    return { ok: false };
  }
}

/** New wholesale application landed in the approval queue. */
export async function notifyNewApplication(a) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const queue = base ? `${base}/wholesale-approvals` : "";

  const rows = [
    ["Business", a.businessName],
    ["Contact", a.contactName],
    ["Email", a.email],
    ["Phone", a.phone],
    ["Tax ID / resale", a.einResale],
    ["Website", a.website],
    ["Ships to", a.address],
    ["SMS consent", a.smsConsent ? "Yes" : "No"],
  ].filter(([, v]) => v && String(v).trim() && String(v).trim() !== "n/a");

  const tableRows = rows
    .map(
      ([k, v]) =>
        `<tr>
           <td style="padding:7px 16px 7px 0;color:#6b625a;font-size:13px;white-space:nowrap;vertical-align:top;">${esc(k)}</td>
           <td style="padding:7px 0;color:#1c1a17;font-size:14px;font-weight:600;">${esc(v)}</td>
         </tr>`
    )
    .join("");

  const about = a.about && a.about.trim()
    ? `<div style="margin-top:22px;padding-top:18px;border-top:1px solid #e6dfd5;">
         <div style="color:#6b625a;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:7px;">About their shop</div>
         <div style="color:#1c1a17;font-size:14px;line-height:1.65;">${esc(a.about)}</div>
       </div>`
    : "";

  const cta = queue
    ? `<a href="${queue}" style="display:inline-block;margin-top:26px;background:#1c1a17;color:#ffffff;
         text-decoration:none;padding:13px 26px;border-radius:3px;font-size:14px;font-weight:600;">
         Review and approve
       </a>`
    : "";

  const html = `<!doctype html>
<html><body style="margin:0;padding:28px 16px;background:#fbf8f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6dfd5;border-radius:4px;padding:30px;">
    <div style="color:#c4552e;font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;">New wholesale application</div>
    <h1 style="margin:10px 0 24px;font-size:23px;line-height:1.25;color:#1c1a17;">${esc(a.businessName || a.contactName || a.email)}</h1>
    <table style="width:100%;border-collapse:collapse;">${tableRows}</table>
    ${about}
    ${cta}
    <p style="margin:26px 0 0;color:#a1968a;font-size:12px;line-height:1.6;">
      Sent by Advance HQ when an application is submitted at advanceapparelswholesale.com.
    </p>
  </div>
</body></html>`;

  const text = [
    "New wholesale application",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    a.about ? `\nAbout their shop:\n${a.about}` : "",
    queue ? `\nReview: ${queue}` : "",
  ].join("\n");

  return sendMail({
    subject: `New wholesale application: ${a.businessName || a.email}`,
    html,
    text,
    replyTo: a.email,
  });
}
