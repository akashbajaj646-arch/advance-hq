import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const formData = await request.formData();
  const file = formData.get('file') as File;
  const uploadedBy = formData.get('uploaded_by') as string || 'Staff';
  const isCustomer = formData.get('is_customer_upload') === 'true';

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const ext = file.name.split('.').pop();
  const path = `${params.id}/${Date.now()}.${ext}`;
  const buffer = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from('ticket-photos')
    .upload(path, buffer, { contentType: file.type });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data, error } = await supabase.from('ticket_photos').insert({
    ticket_id: params.id,
    storage_path: path,
    file_name: file.name,
    file_size: file.size,
    uploaded_by: uploadedBy,
    is_customer_upload: isCustomer,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
