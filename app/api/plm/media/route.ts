import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Server-side only — service role key, never exposed to browser.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET = 'sample-media';

// Media flows AROUND Vercel, not through it (serverless body limit is
// ~4.5MB — a video would never fit). This route only coordinates:
//   { action: 'create-upload' }  -> signed PUT URL; browser uploads the
//                                   file straight to Supabase Storage
//   { action: 'complete' }       -> records the timeline event after the
//                                   browser finishes uploading
//   { action: 'sign' }           -> signed GET URLs for display (1h)

const EVENT_TYPES = new Set(['image', 'video', 'voice']);

function sanitizeFilename(name: string): string {
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

export async function POST(request: NextRequest) {
  // Verify session cookie (same pattern as /api/data)
  const sessionToken = request.cookies.get('ahq_session')?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: session } = await supabaseAdmin
    .from('app_sessions')
    .select('user_id, expires_at')
    .eq('token', sessionToken)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action } = body;

  if (action === 'create-upload') {
    const { sample_id, filename, content_type } = body;
    if (!sample_id) return NextResponse.json({ error: 'Missing sample_id' }, { status: 400 });
    const ct = String(content_type || '');
    if (!/^(image|video|audio)\//.test(ct)) {
      return NextResponse.json({ error: `Unsupported content type: ${ct}` }, { status: 400 });
    }
    const path = `samples/${sample_id}/${Date.now()}-${sanitizeFilename(filename)}`;
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ path, signedUrl: data.signedUrl, token: data.token });
  }

  if (action === 'complete') {
    const { sample_id, version_id, path, event_type, body: eventBody, author, reply_to_event_id } = body;
    if (!sample_id || !path) return NextResponse.json({ error: 'Missing sample_id or path' }, { status: 400 });
    if (!EVENT_TYPES.has(event_type)) {
      return NextResponse.json({ error: `Invalid event type: ${event_type}` }, { status: 400 });
    }
    // Confirm the object actually landed before recording the event.
    const dir = path.substring(0, path.lastIndexOf('/'));
    const base = path.substring(path.lastIndexOf('/') + 1);
    const { data: listed, error: listErr } = await supabaseAdmin.storage.from(BUCKET).list(dir, { search: base });
    if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
    if (!listed || listed.length === 0) {
      return NextResponse.json({ error: 'Upload not found in storage — try again' }, { status: 400 });
    }
    const { data: ev, error } = await supabaseAdmin
      .from('sample_timeline_events')
      .insert({
        sample_id,
        version_id: version_id || null,
        event_type,
        media_url: path,
        body: eventBody || null,
        author: author || null,
        reply_to_event_id: reply_to_event_id || null,
      })
      .select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: ev });
  }

  if (action === 'sign') {
    const { paths } = body;
    if (!Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json({ data: {} });
    }
    const clean = paths.filter((p: any) => typeof p === 'string' && p.startsWith('samples/')).slice(0, 100);
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrls(clean, 3600);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const map: Record<string, string> = {};
    for (const item of data || []) {
      if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
    }
    return NextResponse.json({ data: map });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
